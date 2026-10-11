"""User documents: creation, serialization and account status changes."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status

from ..core.db import get_db, new_id, utcnow
from ..core.security import revoke_all_tokens
from ..domain.categorization import eligible_for
from ..domain.enums import AccountStatus, DocumentType, Role, RideCategory
from ..domain.onboarding import missing_requirements
from ..domain.status import StatusAction, TransitionError, allowed_actions, next_status
from . import audit
from .storage import decrypt_field, mask


def new_user(phone: str, country: str, role: Role, language: str = "fr",
             full_name: str | None = None) -> dict:
    now = utcnow()
    doc: dict[str, Any] = {
        "_id": new_id(),
        "phone": phone,
        "role": role.value,
        "status": (AccountStatus.APPROVED if role.is_staff else AccountStatus.ONBOARDING).value,
        "full_name": full_name,
        "email": None,
        "language": language,
        "country": country,
        "city": None,
        "date_of_birth": None,
        "id_type": None,
        "id_number": None,  # encrypted
        "consent": None,
        "review": None,
        "token_version": 0,
        "rating": {"avg": None, "count": 0},
        "created_at": now,
        "updated_at": now,
        "submitted_at": None,
        "deleted_at": None,
    }
    if role is Role.DRIVER:
        doc["license_number"] = None
        doc["vehicle"] = None
        doc["payout"] = None  # account_number encrypted
        doc["driver"] = {
            "category": None,
            "suggested_category": None,
            "category_source": None,  # "auto" | "admin"
            "eligible_categories": [],
            "online": False,
            "location": None,  # GeoJSON point
            "location_updated_at": None,
        }
    return doc


async def documents_of(user_id: str) -> list[dict]:
    files = get_db().files.find({"owner_id": user_id, "deleted_at": None}).sort("created_at", 1)
    return [{
        "id": f["_id"], "doc_type": f["doc_type"], "content_type": f["content_type"],
        "size": f["size"], "created_at": f["created_at"],
    } async for f in files]


async def document_types_of(user_id: str) -> set[DocumentType]:
    return {DocumentType(d["doc_type"]) for d in await documents_of(user_id)}


def serialize_user(user: dict, *, staff_view: bool = False) -> dict:
    """Public representation. Owners see masked identifiers; staff see them in full."""
    uid = user["_id"]
    id_number = decrypt_field(user.get("id_number"), f"{uid}:id_number")
    out: dict[str, Any] = {
        "id": uid,
        "phone": user["phone"],
        "role": user["role"],
        "status": user["status"],
        "full_name": user.get("full_name"),
        "email": user.get("email"),
        "language": user.get("language"),
        "country": user.get("country"),
        "city": user.get("city"),
        "date_of_birth": user.get("date_of_birth"),
        "id_type": user.get("id_type"),
        "id_number": id_number if staff_view else mask(id_number),
        "consent": user.get("consent"),
        "review": user.get("review"),
        "rating": user.get("rating"),
        "created_at": user.get("created_at"),
        "submitted_at": user.get("submitted_at"),
    }
    if user["role"] == Role.DRIVER.value:
        payout = dict(user["payout"]) if user.get("payout") else None
        if payout:
            acct = decrypt_field(payout.get("account_number"), f"{uid}:payout")
            payout["account_number"] = acct if staff_view else mask(acct)
        driver = dict(user.get("driver") or {})
        loc = driver.pop("location", None)
        if loc:
            driver["lng"], driver["lat"] = loc["coordinates"]
        out.update({
            "license_number": user.get("license_number"),
            "vehicle": user.get("vehicle"),
            "payout": payout,
            "driver": driver,
        })
    if staff_view and user.get("deleted_at"):
        out["deleted_at"] = user["deleted_at"]
    return out


async def onboarding_state(user: dict) -> dict:
    role = Role(user["role"])
    profile = dict(user)
    profile["id_number"] = user.get("id_number")  # presence check only
    missing = missing_requirements(role, profile, await document_types_of(user["_id"]))
    return {
        "status": user["status"],
        "can_submit": missing.ok and user["status"] in (
            AccountStatus.ONBOARDING.value, AccountStatus.REJECTED.value),
        "missing_fields": missing.fields,
        "missing_documents": missing.documents,
        "review": user.get("review"),
    }


async def get_user_or_404(user_id: str, role: Role | None = None) -> dict:
    query: dict[str, Any] = {"_id": user_id, "deleted_at": None}
    if role:
        query["role"] = role.value
    user = await get_db().users.find_one(query)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})
    return user


async def apply_status_action(target: dict, action: StatusAction, actor: dict,
                              reason: str | None, ip: str | None) -> dict:
    try:
        new_status = next_status(target["status"], action, actor["role"], reason)
    except TransitionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            detail={"code": "invalid_transition", "message": str(exc)})

    if action is StatusAction.SUBMIT:
        missing = missing_requirements(Role(target["role"]), target,
                                       await document_types_of(target["_id"]))
        if not missing.ok:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={
                "code": "application_incomplete",
                "missing_fields": missing.fields,
                "missing_documents": missing.documents,
            })

    now = utcnow()
    update: dict[str, Any] = {"status": new_status.value, "updated_at": now}
    if action is StatusAction.SUBMIT:
        update["submitted_at"] = now
    else:
        update["review"] = {
            "action": action.value, "reason": reason, "by": actor["_id"],
            "by_name": actor.get("full_name"), "at": now,
        }
    if new_status is not AccountStatus.APPROVED and target["role"] == Role.DRIVER.value:
        update["driver.online"] = False  # take drivers off the road immediately

    db = get_db()
    # Compare-and-set on the old status so two admins can't race each other.
    res = await db.users.update_one({"_id": target["_id"], "status": target["status"]},
                                    {"$set": update})
    if res.modified_count == 0:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "status_changed"})

    if new_status in (AccountStatus.SUSPENDED, AccountStatus.BANNED):
        await revoke_all_tokens(target["_id"])

    await audit.record(
        actor, f"{target['role']}.{action.value}", target["role"], target["_id"],
        before={"status": target["status"]}, after={"status": new_status.value},
        reason=reason, ip=ip,
    )
    return await db.users.find_one({"_id": target["_id"]})


async def set_driver_category(driver: dict, category: RideCategory, source: str) -> None:
    await get_db().users.update_one({"_id": driver["_id"]}, {"$set": {
        "driver.category": category.value,
        "driver.category_source": source,
        "driver.eligible_categories": [c.value for c in eligible_for(category)],
        "updated_at": utcnow(),
    }})


def review_actions(user: dict, actor: dict) -> list[str]:
    return [a.value for a in allowed_actions(user["status"], actor["role"])]
