"""Self-service endpoints for riders and drivers: profile, documents, submission."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, Response, UploadFile, status

from ..core.config import get_settings
from ..core.db import get_db, new_id, utcnow
from ..core.deps import CurrentUser
from ..core.ratelimit import client_ip, hit
from ..domain.enums import AccountStatus, DocumentType, Role
from ..domain.onboarding import CONSENT_VERSION, MAX_UPLOAD_BYTES, UploadRejected
from ..domain.status import StatusAction
from ..models.schemas import ConsentIn, DeletionRequestIn, ProfileIn
from ..services import audit
from ..services.storage import encrypt_field, read_document, save_document
from ..services.users import apply_status_action, documents_of, onboarding_state, serialize_user

router = APIRouter(prefix="/me", tags=["me"])

EDITABLE = {AccountStatus.ONBOARDING.value, AccountStatus.REJECTED.value}
ALWAYS_EDITABLE = {"email", "language"}


def _require_member(user: dict) -> None:
    if Role(user["role"]).is_staff:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "not_for_staff"})


def require_editable(user: dict) -> None:
    if user["status"] not in EDITABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={
            "code": "profile_locked",
            "message": "Your application is under review or approved. Contact support to change it.",
        })


@router.get("")
async def me(user: CurrentUser) -> dict:
    out = serialize_user(user)
    if not Role(user["role"]).is_staff:
        out["onboarding"] = await onboarding_state(user)
        out["documents"] = await documents_of(user["_id"])
    return out


@router.patch("")
async def update_profile(body: ProfileIn, user: CurrentUser) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        return serialize_user(user)
    if set(changes) - ALWAYS_EDITABLE:
        _require_member(user)
        require_editable(user)
    if "license_number" in changes and user["role"] != Role.DRIVER.value:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "drivers_only", "field": "license_number"})
    if "id_number" in changes:
        changes["id_number"] = encrypt_field(changes["id_number"], f"{user['_id']}:id_number")
    if changes.get("date_of_birth"):
        changes["date_of_birth"] = changes["date_of_birth"].isoformat()
    for key in ("language", "id_type"):
        if changes.get(key) is not None:
            changes[key] = changes[key].value
    changes["updated_at"] = utcnow()
    await get_db().users.update_one({"_id": user["_id"]}, {"$set": changes})
    return await me(await get_db().users.find_one({"_id": user["_id"]}))


@router.put("/consent")
async def give_consent(body: ConsentIn, user: CurrentUser, request: Request) -> dict:
    _require_member(user)
    if body.version != CONSENT_VERSION:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "consent_outdated", "current_version": CONSENT_VERSION})
    consent = {"documents": body.documents, "selfie": body.selfie, "version": body.version,
               "accepted_at": utcnow(), "ip": client_ip(request)}
    await get_db().users.update_one({"_id": user["_id"]}, {"$set": {"consent": consent}})
    return {"consent": consent}


@router.post("/documents", status_code=201)
async def upload_document(
    user: CurrentUser,
    doc_type: Annotated[DocumentType, Form()],
    file: Annotated[UploadFile, File()],
) -> dict:
    _require_member(user)
    require_editable(user)
    consent = user.get("consent") or {}
    if not consent.get("documents") or (doc_type is DocumentType.SELFIE and not consent.get("selfie")):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "consent_required"})
    if user["role"] == Role.RIDER.value and doc_type not in (
            DocumentType.SELFIE, DocumentType.ID_FRONT, DocumentType.ID_BACK):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "doc_type_not_allowed"})

    s = get_settings()
    await hit("upload", user["_id"], s.upload_requests_per_user_per_hour, 3600)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    try:
        doc = await save_document(user, doc_type, data, file.filename)
    except UploadRejected as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "upload_rejected", "message": str(exc)})
    return {"id": doc["_id"], "doc_type": doc["doc_type"], "content_type": doc["content_type"],
            "size": doc["size"], "created_at": doc["created_at"]}


@router.get("/documents/{file_id}")
async def get_my_document(file_id: str, user: CurrentUser) -> Response:
    f = await get_db().files.find_one({"_id": file_id, "owner_id": user["_id"], "deleted_at": None})
    if f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    return Response(await read_document(f), media_type=f["content_type"],
                    headers={"Cache-Control": "private, no-store"})


@router.get("/onboarding")
async def get_onboarding(user: CurrentUser) -> dict:
    _require_member(user)
    return await onboarding_state(user)


@router.post("/submit")
async def submit_application(user: CurrentUser, request: Request) -> dict:
    """Send the application for admin review (status becomes 'pending')."""
    _require_member(user)
    updated = await apply_status_action(user, StatusAction.SUBMIT, user, None, client_ip(request))
    return await me(updated)


@router.post("/deletion-request", status_code=202)
async def request_deletion(body: DeletionRequestIn, user: CurrentUser, request: Request) -> dict:
    """Right to be forgotten: queued for staff, who must settle open rides/payouts first."""
    db = get_db()
    existing = await db.deletion_requests.find_one({"user_id": user["_id"], "status": "pending"})
    if existing:
        return {"id": existing["_id"], "status": "pending"}
    doc = {"_id": new_id(), "user_id": user["_id"], "role": user["role"],
           "phone": user["phone"], "full_name": user.get("full_name"),
           "reason": body.reason, "status": "pending", "created_at": utcnow()}
    await db.deletion_requests.insert_one(doc)
    await audit.record(user, "user.deletion_requested", "user", user["_id"], ip=client_ip(request))
    return {"id": doc["_id"], "status": "pending"}
