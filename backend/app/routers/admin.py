"""Admin console API. Every mutating call and every document view is audited."""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from ..core.db import get_db, new_id, utcnow
from ..core.deps import Staff, SuperAdmin
from ..core.ratelimit import client_ip
from ..domain.countries import InvalidPhoneNumber, normalize_phone
from ..domain.enums import AccountStatus, Role, RideStatus
from ..domain.pricing import calculate_fare
from ..domain.status import StatusAction
from ..models.schemas import (
    CategoryOverrideIn,
    CityIn,
    CityPatch,
    DeletionDecisionIn,
    DisputeUpdateIn,
    FarePreviewIn,
    PricingRuleIn,
    StaffCreateIn,
    StatusActionIn,
)
from ..services import audit
from ..services.pricing import RULE_FIELDS, resolve_rule
from ..services.storage import purge_owner_files, read_document
from ..services.users import (
    apply_status_action,
    documents_of,
    get_user_or_404,
    new_user,
    review_actions,
    serialize_user,
    set_driver_category,
)

router = APIRouter(prefix="/admin", tags=["admin"])

MEMBER_ROLES = (Role.DRIVER.value, Role.RIDER.value)
STAFF_ROLES = (Role.ADMIN.value, Role.SUPER_ADMIN.value)


def _page(page: int, page_size: int) -> tuple[int, int]:
    return (page - 1) * page_size, page_size


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, detail={"code": "not_found"})


# --- overview -------------------------------------------------------------

@router.get("/overview")
async def overview(admin: Staff) -> dict:
    db = get_db()
    counts: dict[str, dict[str, int]] = {"driver": {}, "rider": {}}
    async for row in db.users.aggregate([
        {"$match": {"role": {"$in": list(MEMBER_ROLES)}, "deleted_at": None}},
        {"$group": {"_id": {"role": "$role", "status": "$status"}, "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]["role"]][row["_id"]["status"]] = row["n"]

    since = utcnow() - timedelta(hours=24)
    rides_24h = await db.rides.count_documents({"created_at": {"$gte": since}})
    completed = [r async for r in db.rides.find(
        {"status": RideStatus.COMPLETED.value, "completed_at": {"$gte": since}},
        {"fare.total": 1, "fare.commission": 1})]
    return {
        "drivers": counts["driver"],
        "riders": counts["rider"],
        "pending_reviews": counts["driver"].get("pending", 0) + counts["rider"].get("pending", 0),
        "drivers_online": await db.users.count_documents(
            {"role": "driver", "driver.online": True, "deleted_at": None}),
        "active_rides": await db.rides.count_documents({"status": {"$in": [
            RideStatus.ACCEPTED.value, RideStatus.ARRIVING.value, RideStatus.IN_PROGRESS.value]}}),
        "rides_24h": rides_24h,
        "gross_24h": sum((r.get("fare") or {}).get("total", 0) for r in completed),
        "commission_24h": sum((r.get("fare") or {}).get("commission", 0) for r in completed),
        "open_disputes": await db.disputes.count_documents({"status": {"$in": ["open", "in_review"]}}),
        "pending_deletions": await db.deletion_requests.count_documents({"status": "pending"}),
    }


# --- drivers & riders ------------------------------------------------------

@router.get("/users")
async def list_users(
    admin: Staff,
    role: str = Query(pattern="^(driver|rider)$"),
    status_: str | None = Query(default=None, alias="status"),
    country: str | None = None,
    city: str | None = None,
    category: str | None = None,
    q: str | None = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict:
    query: dict[str, Any] = {"role": role, "deleted_at": None}
    if status_:
        query["status"] = status_
    if country:
        query["country"] = country.upper()
    if city:
        query["city"] = city
    if category:
        query["driver.category"] = category
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"full_name": rx}, {"phone": rx}, {"vehicle.plate_number": rx}]
    skip, limit = _page(page, page_size)
    db = get_db()
    # Pending applications are reviewed oldest first; everything else newest first.
    sort = [("submitted_at", 1)] if status_ == "pending" else [("created_at", -1)]
    items = [serialize_user(u) async for u in db.users.find(query).sort(sort).skip(skip).limit(limit)]
    return {"items": items, "total": await db.users.count_documents(query),
            "page": page, "page_size": page_size}


@router.get("/users/{user_id}")
async def get_user(user_id: str, admin: Staff) -> dict:
    user = await get_user_or_404(user_id)
    out = serialize_user(user, staff_view=True)
    out["documents"] = await documents_of(user_id)
    out["allowed_actions"] = review_actions(user, admin)
    out["history"] = [_audit_out(a) async for a in get_db().audit_logs.find(
        {"target_id": user_id}).sort("created_at", -1).limit(50)]
    return out


@router.post("/users/{user_id}/status")
async def change_status(user_id: str, body: StatusActionIn, admin: Staff, request: Request) -> dict:
    if body.action is StatusAction.SUBMIT:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_action"})
    target = await get_user_or_404(user_id)
    if target["role"] in STAFF_ROLES and admin["role"] != Role.SUPER_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "super_admin_only"})
    if target["_id"] == admin["_id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "cannot_review_self"})
    updated = await apply_status_action(target, body.action, admin, body.reason, client_ip(request))
    return await get_user(user_id, admin) if updated else {}


@router.post("/users/{user_id}/category")
async def override_category(user_id: str, body: CategoryOverrideIn, admin: Staff,
                            request: Request) -> dict:
    driver = await get_user_or_404(user_id, Role.DRIVER)
    vehicle_type = (driver.get("vehicle") or {}).get("type")
    is_moto = body.category.value == "moto"
    if vehicle_type and (vehicle_type == "moto") != is_moto:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={
            "code": "category_vehicle_mismatch",
            "message": "Motorcycles can only be Moto, and cars cannot be Moto."})
    before = (driver.get("driver") or {}).get("category")
    await set_driver_category(driver, body.category, "admin")
    await audit.record(admin, "driver.category_override", "driver", user_id,
                       before={"category": before}, after={"category": body.category.value},
                       reason=body.reason, ip=client_ip(request))
    return await get_user(user_id, admin)


@router.get("/files/{file_id}")
async def view_file(file_id: str, admin: Staff, request: Request) -> Response:
    f = await get_db().files.find_one({"_id": file_id})
    if f is None:
        raise _not_found()
    await audit.record(admin, "file.view", "file", file_id,
                       meta={"owner_id": f["owner_id"], "doc_type": f["doc_type"]},
                       ip=client_ip(request))
    return Response(await read_document(f), media_type=f["content_type"], headers={
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
    })


# --- live map ----------------------------------------------------------------

@router.get("/live/drivers")
async def live_drivers(admin: Staff, country: str | None = None) -> list[dict]:
    query: dict[str, Any] = {"role": "driver", "driver.online": True,
                             "driver.location": {"$ne": None}, "deleted_at": None}
    if country:
        query["country"] = country.upper()
    out = []
    async for u in get_db().users.find(query, {"full_name": 1, "phone": 1, "driver": 1,
                                                "vehicle": 1}).limit(5000):
        d = u["driver"]
        lng, lat = d["location"]["coordinates"]
        out.append({"driver_id": u["_id"], "name": u.get("full_name"), "phone": u["phone"],
                    "category": d.get("category"), "lat": lat, "lng": lng,
                    "heading": d.get("heading"), "at": d.get("location_updated_at"),
                    "plate": (u.get("vehicle") or {}).get("plate_number")})
    return out


# --- rides, finance, disputes ------------------------------------------------

@router.get("/rides")
async def list_rides(
    admin: Staff,
    status_: str | None = Query(default=None, alias="status"),
    country: str | None = None,
    driver_id: str | None = None,
    rider_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict:
    query: dict[str, Any] = {}
    for key, val in (("status", status_), ("driver_id", driver_id), ("rider_id", rider_id)):
        if val:
            query[key] = val
    if country:
        query["country"] = country.upper()
    skip, limit = _page(page, page_size)
    db = get_db()
    items = [_ride_out(r) async for r in db.rides.find(query).sort("created_at", -1).skip(skip).limit(limit)]
    return {"items": items, "total": await db.rides.count_documents(query),
            "page": page, "page_size": page_size}


@router.get("/rides/{ride_id}")
async def get_ride(ride_id: str, admin: Staff) -> dict:
    ride = await get_db().rides.find_one({"_id": ride_id})
    if ride is None:
        raise _not_found()
    return _ride_out(ride)


def _ride_out(r: dict) -> dict:
    out = {k: v for k, v in r.items() if k != "_id"}
    out["id"] = r["_id"]
    return out


@router.get("/finance/summary")
async def finance_summary(
    admin: Staff,
    date_from: datetime | None = Query(default=None, alias="from"),
    date_to: datetime | None = Query(default=None, alias="to"),
    country: str | None = None,
) -> dict:
    end = date_to or utcnow()
    start = date_from or end - timedelta(days=30)
    match: dict[str, Any] = {"status": RideStatus.COMPLETED.value,
                             "completed_at": {"$gte": start, "$lte": end}}
    if country:
        match["country"] = country.upper()
    by_category: dict[str, dict] = {}
    by_method: dict[str, int] = {}
    totals = {"rides": 0, "gross": 0, "commission": 0, "driver_earnings": 0}
    async for r in get_db().rides.find(match, {"category": 1, "fare": 1, "payment": 1}):
        fare = r.get("fare") or {}
        cat = by_category.setdefault(r.get("category", "unknown"),
                                     {"rides": 0, "gross": 0, "commission": 0})
        cat["rides"] += 1
        cat["gross"] += fare.get("total", 0)
        cat["commission"] += fare.get("commission", 0)
        method = (r.get("payment") or {}).get("method", "cash")
        by_method[method] = by_method.get(method, 0) + fare.get("total", 0)
        totals["rides"] += 1
        totals["gross"] += fare.get("total", 0)
        totals["commission"] += fare.get("commission", 0)
        totals["driver_earnings"] += fare.get("driver_earnings", 0)
    return {"from": start, "to": end, "currency": "XAF", "totals": totals,
            "by_category": by_category, "by_payment_method": by_method}


@router.get("/disputes")
async def list_disputes(
    admin: Staff,
    status_: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict:
    query = {"status": status_} if status_ else {}
    skip, limit = _page(page, page_size)
    db = get_db()
    items = [_ride_out(d) async for d in db.disputes.find(query).sort("created_at", -1).skip(skip).limit(limit)]
    return {"items": items, "total": await db.disputes.count_documents(query)}


@router.patch("/disputes/{dispute_id}")
async def update_dispute(dispute_id: str, body: DisputeUpdateIn, admin: Staff,
                         request: Request) -> dict:
    db = get_db()
    d = await db.disputes.find_one({"_id": dispute_id})
    if d is None:
        raise _not_found()
    changes = body.model_dump(mode="json", exclude_unset=True)
    changes.update({"handled_by": admin["_id"], "updated_at": utcnow()})
    await db.disputes.update_one({"_id": dispute_id}, {"$set": changes})
    await audit.record(admin, "dispute.update", "dispute", dispute_id,
                       before={"status": d["status"]}, after=changes, ip=client_ip(request))
    return _ride_out(await db.disputes.find_one({"_id": dispute_id}))


# --- cities & pricing -------------------------------------------------------

@router.get("/cities")
async def list_cities(admin: Staff, country: str | None = None) -> list[dict]:
    query = {"country": country.upper()} if country else {}
    return [_ride_out(c) async for c in get_db().cities.find(query).sort([("country", 1), ("name", 1)])]


@router.post("/cities", status_code=201)
async def create_city(body: CityIn, admin: Staff, request: Request) -> dict:
    doc = {"_id": new_id(), **body.model_dump(), "created_at": utcnow()}
    try:
        await get_db().cities.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "city_exists"})
    await audit.record(admin, "city.create", "city", doc["_id"], after=body.model_dump(),
                       ip=client_ip(request))
    return _ride_out(doc)


@router.patch("/cities/{city_id}")
async def update_city(city_id: str, body: CityPatch, admin: Staff, request: Request) -> dict:
    db = get_db()
    city = await db.cities.find_one({"_id": city_id})
    if city is None:
        raise _not_found()
    changes = body.model_dump(exclude_unset=True)
    await db.cities.update_one({"_id": city_id}, {"$set": changes})
    await audit.record(admin, "city.update", "city", city_id,
                       before={k: city.get(k) for k in changes}, after=changes,
                       ip=client_ip(request))
    return _ride_out(await db.cities.find_one({"_id": city_id}))


@router.get("/pricing")
async def list_pricing(admin: Staff, country: str | None = None) -> list[dict]:
    query = {"country": country.upper()} if country else {}
    return [_ride_out(p) async for p in get_db().pricing_rules.find(query)]


@router.put("/pricing")
async def upsert_pricing(body: PricingRuleIn, admin: Staff, request: Request) -> dict:
    db = get_db()
    if body.city_id and not await db.cities.find_one({"_id": body.city_id, "country": body.country}):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "unknown_city"})
    key = {"country": body.country, "city_id": body.city_id, "category": body.category.value}
    values = {k: getattr(body, k) for k in RULE_FIELDS}
    before = await db.pricing_rules.find_one(key)
    await db.pricing_rules.update_one(
        key,
        {"$set": {**values, "updated_at": utcnow(), "updated_by": admin["_id"]},
         "$setOnInsert": {"_id": new_id()}},
        upsert=True,
    )
    doc = await db.pricing_rules.find_one(key)
    await audit.record(admin, "pricing.upsert", "pricing_rule", doc["_id"],
                       before={k: before.get(k) for k in RULE_FIELDS} if before else None,
                       after=values, meta=key, ip=client_ip(request))
    return _ride_out(doc)


@router.post("/pricing/preview")
async def preview_fare(body: FarePreviewIn, admin: Staff) -> dict:
    rule, source = await resolve_rule(body.country, body.city_id, body.category)
    fare = calculate_fare(rule, body.distance_km, body.duration_min, body.surge)
    return {"rule_source": source, "fare": fare.__dict__}


# --- audit log --------------------------------------------------------------

def _audit_out(a: dict) -> dict:
    out = {k: v for k, v in a.items() if k != "_id"}
    out["id"] = a["_id"]
    return out


@router.get("/audit-logs")
async def audit_logs(
    admin: Staff,
    action: str | None = None,
    actor_id: str | None = None,
    target_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> dict:
    query: dict[str, Any] = {}
    if action:
        query["action"] = {"$regex": f"^{re.escape(action)}"}
    if actor_id:
        query["actor_id"] = actor_id
    if target_id:
        query["target_id"] = target_id
    skip, limit = _page(page, page_size)
    db = get_db()
    items = [_audit_out(a) async for a in db.audit_logs.find(query).sort("created_at", -1).skip(skip).limit(limit)]
    return {"items": items, "total": await db.audit_logs.count_documents(query)}


# --- staff management (super-admin) -----------------------------------------

@router.get("/staff")
async def list_staff(admin: SuperAdmin) -> list[dict]:
    return [serialize_user(u) async for u in get_db().users.find(
        {"role": {"$in": list(STAFF_ROLES)}, "deleted_at": None}).sort("created_at", 1)]


@router.post("/staff", status_code=201)
async def create_staff(body: StaffCreateIn, admin: SuperAdmin, request: Request) -> dict:
    try:
        phone = normalize_phone(body.phone, body.country)
    except InvalidPhoneNumber:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_phone"})
    db = get_db()
    if await db.users.find_one({"phone": phone.e164, "role": {"$in": list(STAFF_ROLES)},
                                "deleted_at": None}):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "staff_exists"})
    user = new_user(phone.e164, phone.country, Role(body.role), full_name=body.full_name)
    await db.users.insert_one(user)
    await audit.record(admin, "staff.create", "user", user["_id"],
                       after={"phone": phone.e164, "role": user["role"]}, ip=client_ip(request))
    return serialize_user(user)


# --- right to be forgotten -------------------------------------------------

@router.get("/deletion-requests")
async def list_deletion_requests(admin: Staff, status_: str = Query(default="pending", alias="status")) -> list[dict]:
    return [_ride_out(d) async for d in get_db().deletion_requests.find(
        {"status": status_}).sort("created_at", 1)]


@router.post("/deletion-requests/{request_id}/decision")
async def decide_deletion(request_id: str, body: DeletionDecisionIn, admin: SuperAdmin,
                          request: Request) -> dict:
    db = get_db()
    req = await db.deletion_requests.find_one({"_id": request_id, "status": "pending"})
    if req is None:
        raise _not_found()
    if not body.approve:
        await db.deletion_requests.update_one({"_id": request_id}, {"$set": {
            "status": "rejected", "note": body.note, "decided_by": admin["_id"], "decided_at": utcnow()}})
        await audit.record(admin, "user.deletion_rejected", "user", req["user_id"],
                           reason=body.note, ip=client_ip(request))
        return {"status": "rejected"}

    active = await db.rides.count_documents({
        "$or": [{"rider_id": req["user_id"]}, {"driver_id": req["user_id"]}],
        "status": {"$nin": [RideStatus.COMPLETED.value, RideStatus.CANCELLED.value]}})
    if active:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "user_has_active_rides"})

    purged = await purge_owner_files(req["user_id"])
    now = utcnow()
    # Anonymise instead of deleting so ride and payment history stays consistent.
    wipe: dict[str, Any] = {
        "phone": f"deleted:{req['user_id']}", "full_name": None, "email": None,
        "id_number": None, "id_type": None, "date_of_birth": None, "consent": None,
        "review": None, "status": AccountStatus.BANNED.value, "deleted_at": now,
    }
    if req["role"] == Role.DRIVER.value:
        wipe.update({"license_number": None, "payout": None, "vehicle": None,
                     "driver.location": None, "driver.online": False})
    await db.users.update_one({"_id": req["user_id"]}, {"$set": wipe, "$inc": {"token_version": 1}})
    await db.refresh_tokens.delete_many({"user_id": req["user_id"]})
    await db.deletion_requests.update_one({"_id": request_id}, {"$set": {
        "status": "completed", "phone": None, "full_name": None, "note": body.note,
        "decided_by": admin["_id"], "decided_at": now, "files_purged": purged}})
    await audit.record(admin, "user.deleted", "user", req["user_id"],
                       meta={"files_purged": purged}, ip=client_ip(request))
    return {"status": "completed", "files_purged": purged}


# --- exports ----------------------------------------------------------------

EXPORTS: dict[str, tuple[str, dict, list[str]]] = {
    "drivers": ("users", {"role": "driver", "deleted_at": None},
                ["_id", "full_name", "phone", "status", "country", "city", "driver.category",
                 "driver.category_source", "vehicle.make", "vehicle.model", "vehicle.year",
                 "vehicle.plate_number", "created_at", "submitted_at"]),
    "riders": ("users", {"role": "rider", "deleted_at": None},
               ["_id", "full_name", "phone", "email", "status", "country", "city", "created_at"]),
    "rides": ("rides", {}, ["_id", "status", "category", "country", "rider_id", "driver_id",
                            "fare.total", "fare.commission", "payment.method", "created_at",
                            "completed_at"]),
    "audit_logs": ("audit_logs", {}, ["_id", "created_at", "actor_name", "actor_role", "action",
                                      "target_type", "target_id", "reason", "ip"]),
}


def _get_path(doc: dict, path: str) -> Any:
    for part in path.split("."):
        if not isinstance(doc, dict):
            return None
        doc = doc.get(part)
    return doc


def _csv_cell(value: Any) -> str:
    s = "" if value is None else (value.isoformat() if isinstance(value, datetime) else str(value))
    # Neutralise spreadsheet formula injection.
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


@router.get("/export/{dataset}.csv")
async def export_csv(dataset: str, admin: Staff, request: Request) -> StreamingResponse:
    if dataset not in EXPORTS:
        raise _not_found()
    collection, query, columns = EXPORTS[dataset]
    await audit.record(admin, "data.export", dataset, None, ip=client_ip(request))

    async def rows() -> AsyncIterator[str]:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([c.replace("_id", "id") if c == "_id" else c for c in columns])
        yield "﻿" + buf.getvalue()  # BOM so Excel opens accents correctly
        async for doc in get_db()[collection].find(query).sort("created_at", -1):
            buf.seek(0)
            buf.truncate()
            writer.writerow([_csv_cell(_get_path(doc, c)) for c in columns])
            yield buf.getvalue()

    filename = f"akeva-{dataset}-{utcnow():%Y%m%d}.csv"
    return StreamingResponse(rows(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})
