"""Driver-only endpoints: vehicle, payout details, availability and location."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from ..core.db import get_db, utcnow
from ..core.deps import Driver
from ..domain.categorization import suggest_category
from ..domain.countries import COUNTRIES
from ..domain.enums import RideCategory
from ..domain.status import can_operate
from ..models.schemas import LocationIn, OnlineIn, PayoutIn, VehicleIn
from ..services.realtime import ADMIN_LIVE, hub
from ..services.storage import encrypt_field
from ..services.users import serialize_user, set_driver_category
from .me import require_editable

router = APIRouter(prefix="/drivers/me", tags=["drivers"])


@router.put("/vehicle")
async def set_vehicle(body: VehicleIn, user: Driver) -> dict:
    require_editable(user)
    db = get_db()
    plate_taken = await db.users.find_one({
        "role": "driver", "vehicle.plate_number": body.plate_number,
        "_id": {"$ne": user["_id"]}, "deleted_at": None,
    })
    if plate_taken:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "plate_already_registered"})

    suggestion = suggest_category(body.type, body.make, body.model, body.year)
    await db.users.update_one({"_id": user["_id"]}, {"$set": {
        "vehicle": body.model_dump(mode="json"),
        "driver.suggested_category": suggestion.category.value,
        "driver.category_reasons": suggestion.reasons,
        "updated_at": utcnow(),
    }})
    # The suggestion becomes the category unless an admin has already overridden it.
    if (user.get("driver") or {}).get("category_source") != "admin":
        await set_driver_category(user, suggestion.category, "auto")
    return {
        "suggested_category": suggestion.category.value,
        "eligible_categories": [c.value for c in suggestion.eligible],
        "reasons": suggestion.reasons,
    }


@router.put("/payout")
async def set_payout(body: PayoutIn, user: Driver) -> dict:
    country = COUNTRIES.get(user.get("country") or "")
    if country and body.method not in country.payout_methods:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={
            "code": "payout_method_unavailable",
            "available": [m.value for m in country.payout_methods],
        })
    payout = body.model_dump(mode="json")
    payout["account_number"] = encrypt_field(body.account_number, f"{user['_id']}:payout")
    payout["updated_at"] = utcnow()
    # Payout details may change after approval; the change is logged for fraud review.
    await get_db().users.update_one({"_id": user["_id"]}, {"$set": {"payout": payout}})
    user = await get_db().users.find_one({"_id": user["_id"]})
    return {"payout": serialize_user(user)["payout"]}


@router.post("/online")
async def set_online(body: OnlineIn, user: Driver) -> dict:
    if body.online:
        if not can_operate(user["status"]):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={
                "code": "not_approved", "status": user["status"]})
        if not (user.get("driver") or {}).get("category"):
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "no_category"})
    await get_db().users.update_one({"_id": user["_id"]}, {"$set": {
        "driver.online": body.online, "driver.online_changed_at": utcnow()}})
    if not body.online:
        await hub.publish(ADMIN_LIVE, "driver.offline", {"driver_id": user["_id"]})
    return {"online": body.online}


@router.post("/location", status_code=204)
async def update_location(body: LocationIn, user: Driver) -> None:
    driver = user.get("driver") or {}
    if not driver.get("online"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "driver_offline"})
    now = utcnow()
    await get_db().users.update_one({"_id": user["_id"]}, {"$set": {
        "driver.location": {"type": "Point", "coordinates": [body.lng, body.lat]},
        "driver.heading": body.heading,
        "driver.location_updated_at": now,
    }})
    await hub.publish(ADMIN_LIVE, "driver.location", {
        "driver_id": user["_id"], "name": user.get("full_name"),
        "category": driver.get("category") or RideCategory.ECONOMY.value,
        "lat": body.lat, "lng": body.lng, "heading": body.heading, "at": now.isoformat(),
    })
