"""Driver-only endpoints: vehicle, payout details, availability, location, offers and earnings."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, HTTPException, status

from ..core.db import aware, get_db, new_id, utcnow
from ..core.deps import Driver
from ..domain.categorization import suggest_category
from ..domain.countries import COUNTRIES
from ..domain.enums import RideCategory
from ..domain.geo import Point, haversine_km, pickup_eta_min
from ..domain.rides import DISPATCH_TIMEOUT_SECONDS
from ..domain.status import can_operate
from ..models.schemas import LocationIn, OnlineIn, PayoutIn, PayoutRequestIn, VehicleIn
from ..services import ledger
from ..services import rides as ride_svc
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
        if not user.get("payout"):
            raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "payout_details_missing"})
    elif (user.get("driver") or {}).get("current_ride_id"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "finish_ride_first"})
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
    await ride_svc.on_driver_location(user, Point(body.lat, body.lng), body.heading)
    await hub.publish(ADMIN_LIVE, "driver.location", {
        "driver_id": user["_id"], "name": user.get("full_name"),
        "category": driver.get("category") or RideCategory.ECONOMY.value,
        "lat": body.lat, "lng": body.lng, "heading": body.heading, "at": now.isoformat(),
    })


# --- ride offers --------------------------------------------------------------

@router.get("/offers")
async def offers(user: Driver) -> list[dict]:
    """Pending offers (the WebSocket pushes them too; this is the fallback on bad networks)."""
    d = user.get("driver") or {}
    if not d.get("online") or d.get("current_ride_id"):
        return []
    since = utcnow() - timedelta(seconds=DISPATCH_TIMEOUT_SECONDS)
    loc = d.get("location")
    here = Point.from_geojson(loc) if loc else None
    out = []
    async for ride in get_db().rides.find({"status": "requested", "offered_to": user["_id"],
                                           "declined_by": {"$ne": user["_id"]},
                                           "created_at": {"$gte": since}}).sort("created_at", 1):
        pickup = Point(ride["pickup"]["lat"], ride["pickup"]["lng"])
        out.append(ride_svc.offer_view(
            ride, distance_km=round(haversine_km(here, pickup), 2) if here else None,
            eta_min=pickup_eta_min(here, pickup) if here else None))
    return out


# --- earnings & payouts -----------------------------------------------------------

@router.get("/earnings")
async def earnings(user: Driver) -> dict:
    db = get_db()
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    periods = {"today": day_start, "week": now - timedelta(days=7), "month": now - timedelta(days=30)}
    summary = {k: {"rides": 0, "earnings": 0, "cash_collected": 0} for k in periods}
    async for r in db.rides.find({"driver_id": user["_id"], "status": "completed",
                                  "completed_at": {"$gte": periods["month"]}},
                                 {"completed_at": 1, "fare": 1, "payment": 1}):
        fare = r.get("fare") or {}
        for key, since in periods.items():
            if aware(r["completed_at"]) >= since:
                summary[key]["rides"] += 1
                summary[key]["earnings"] += fare.get("driver_earnings", 0)
                if (r.get("payment") or {}).get("method") == "cash":
                    summary[key]["cash_collected"] += fare.get("total", 0)
    entries = [{"id": e["_id"], "kind": e["kind"], "amount": e["amount"], "ride_id": e.get("ride_id"),
                "created_at": e["created_at"]}
               async for e in db.ledger.find({"driver_id": user["_id"]}).sort("created_at", -1).limit(30)]
    payouts = [_payout_out(p) async for p in
               db.payouts.find({"driver_id": user["_id"]}).sort("created_at", -1).limit(10)]
    return {"currency": "XAF", "balance": await ledger.balance(user["_id"]), "summary": summary,
            "entries": entries, "payouts": payouts}


def _payout_out(p: dict) -> dict:
    return {"id": p["_id"], "amount": p["amount"], "status": p["status"], "method": p.get("method"),
            "reference": p.get("reference"), "note": p.get("note"), "created_at": p["created_at"],
            "decided_at": p.get("decided_at")}


@router.post("/payouts", status_code=201)
async def request_payout(body: PayoutRequestIn, user: Driver) -> dict:
    """Withdraw part of the balance to the driver's Mobile Money or bank account."""
    if not can_operate(user["status"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "not_approved"})
    if not user.get("payout"):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "payout_details_missing"})
    db = get_db()
    if await db.payouts.find_one({"driver_id": user["_id"], "status": "requested"}):
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": "payout_already_pending"})
    available = await ledger.balance(user["_id"])
    if body.amount > available:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "insufficient_balance", "balance": available})
    payout = {"_id": new_id(), "driver_id": user["_id"], "driver_name": user.get("full_name"),
              "driver_phone": user["phone"], "amount": body.amount, "method": user["payout"]["method"],
              "status": "requested", "created_at": utcnow()}
    await db.payouts.insert_one(payout)
    await ledger.add_entry(user["_id"], "payout_hold", -body.amount, payout_id=payout["_id"])
    return _payout_out(payout)
