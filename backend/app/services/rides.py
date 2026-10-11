"""Ride operations: request, dispatch, lifecycle, payments and notifications.

Dispatch is driven by ``dispatch_tick``, a loop that scans rides waiting for a
driver and sends the next "wave" of offers when it's due (closest drivers
first, then a wider radius), and cancels rides nobody accepted. Because the
state lives in MongoDB rather than in per-ride timers, a server restart
doesn't lose any ride, and waves are claimed with compare-and-set so several
API instances can run the loop safely.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status

from ..core.db import aware, get_db, new_id, utcnow
from ..domain.countries import COUNTRIES
from ..domain.enums import (
    ACTIVE_RIDE_STATUSES,
    PaymentMethod,
    PaymentStatus,
    RideCategory,
    RideStatus,
)
from ..domain.geo import Point, estimate_trip
from ..domain.pricing import calculate_fare
from ..domain.rides import (
    DISPATCH_TIMEOUT_SECONDS,
    DISPATCH_WAVES,
    Actor,
    Candidate,
    RideAction,
    RideTransitionError,
    final_fare,
    next_ride_status,
    path_increment_km,
    rank_drivers,
)
from . import audit, ledger
from .pricing import resolve_rule
from .realtime import ADMIN_LIVE, hub, user_channel

log = logging.getLogger("akeva.rides")

ACTIVE = [s.value for s in ACTIVE_RIDE_STATUSES]


def _err(code: int, key: str, **extra: Any) -> HTTPException:
    return HTTPException(code, detail={"code": key, **extra})


def mobile_money_methods(country: str) -> set[str]:
    c = COUNTRIES.get(country)
    return {m.value for m in c.payout_methods if m.value != "bank"} if c else set()


# --- estimates ----------------------------------------------------------------

async def estimates(country: str, city_id: str | None, pickup: Point, dropoff: Point,
                    categories: list[RideCategory]) -> dict:
    trip = estimate_trip(pickup, dropoff)
    candidates = await _candidates(country)
    now = utcnow()
    options = []
    for cat in categories:
        rule, _ = await resolve_rule(country, city_id, cat)
        fare = calculate_fare(rule, trip.distance_km, trip.duration_min)
        nearby = rank_drivers(pickup, cat, candidates, now, radius_km=DISPATCH_WAVES[-1].radius_km, limit=1)
        options.append({
            "category": cat.value, "fare": fare.total, "currency": "XAF",
            "pickup_eta_min": nearby[0].eta_min if nearby else None,
            "available": bool(nearby),
        })
    return {"distance_km": trip.distance_km, "duration_min": trip.duration_min, "options": options}


async def _candidates(country: str) -> list[Candidate]:
    """Online, approved, idle drivers in the country with a recent GPS position."""
    since = utcnow() - timedelta(minutes=5)
    out = []
    async for u in get_db().users.find({
        "role": "driver", "status": "approved", "deleted_at": None, "country": country,
        "driver.online": True, "driver.current_ride_id": None,
        "driver.location_updated_at": {"$gte": since},
    }, {"driver": 1}):
        d = u["driver"]
        if not d.get("location"):
            continue
        out.append(Candidate(u["_id"], Point.from_geojson(d["location"]),
                             tuple(d.get("eligible_categories") or ()), aware(d["location_updated_at"])))
    return out


# --- creating a ride --------------------------------------------------------

async def create_ride(rider: dict, body: Any) -> dict:
    db = get_db()
    if await db.rides.find_one({"rider_id": rider["_id"], "status": {"$in": ["requested", *ACTIVE]}}):
        raise _err(status.HTTP_409_CONFLICT, "ride_already_active")

    country = rider.get("country")
    method = body.payment_method.value
    if method != PaymentMethod.CASH.value and method not in mobile_money_methods(country):
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "payment_method_unavailable",
                   available=["cash", *sorted(mobile_money_methods(country))])

    pickup = Point(body.pickup.lat, body.pickup.lng)
    dropoff = Point(body.dropoff.lat, body.dropoff.lng)
    trip = estimate_trip(pickup, dropoff)
    if trip.distance_km < 0.2:
        raise _err(status.HTTP_422_UNPROCESSABLE_ENTITY, "trip_too_short")
    rule, rule_source = await resolve_rule(country, body.city_id, body.category)
    fare = calculate_fare(rule, trip.distance_km, trip.duration_min)

    now = utcnow()
    ride = {
        "_id": new_id(),
        "status": RideStatus.REQUESTED.value,
        "category": body.category.value,
        "country": country,
        "city_id": body.city_id,
        "rider_id": rider["_id"],
        "rider": {"name": rider.get("full_name"), "phone": rider["phone"],
                  "rating": (rider.get("rating") or {}).get("avg")},
        "driver_id": None,
        "driver": None,
        "pickup": {"lat": pickup.lat, "lng": pickup.lng, "address": body.pickup.address},
        "dropoff": {"lat": dropoff.lat, "lng": dropoff.lng, "address": body.dropoff.address},
        "estimate": {"distance_km": trip.distance_km, "duration_min": trip.duration_min,
                     "fare": fare.__dict__, "rule_source": rule_source},
        "fare": None,
        "payment": {"method": method, "status": None},
        "offered_to": [],
        "declined_by": [],
        "waves_sent": 0,
        "tracked_km": 0.0,
        "last_point": None,
        "ratings": {"by_rider": None, "by_driver": None},
        "created_at": now,
        "accepted_at": None, "arrived_at": None, "started_at": None,
        "completed_at": None, "cancelled_at": None,
        "cancelled_by": None, "cancel_reason": None,
    }
    await db.rides.insert_one(ride)
    await _send_wave(ride, 0)
    await hub.publish(ADMIN_LIVE, "ride.requested", {"ride_id": ride["_id"], "category": ride["category"],
                                                     "lat": pickup.lat, "lng": pickup.lng})
    return await db.rides.find_one({"_id": ride["_id"]})


async def _send_wave(ride: dict, index: int) -> int:
    """Offer the ride to the next set of drivers. Returns how many were offered."""
    db = get_db()
    # Claim this wave atomically so two dispatcher loops never send it twice.
    claimed = await db.rides.update_one(
        {"_id": ride["_id"], "status": "requested", "waves_sent": index},
        {"$set": {"waves_sent": index + 1}})
    if claimed.modified_count == 0:
        return 0
    wave = DISPATCH_WAVES[index]
    fresh = await db.rides.find_one({"_id": ride["_id"]})
    exclude = set(fresh["offered_to"]) | set(fresh["declined_by"])
    pickup = Point(fresh["pickup"]["lat"], fresh["pickup"]["lng"])
    matches = rank_drivers(pickup, RideCategory(fresh["category"]), await _candidates(fresh["country"]),
                           utcnow(), wave.radius_km, wave.max_drivers, exclude)
    if not matches:
        return 0
    await db.rides.update_one({"_id": ride["_id"]},
                              {"$addToSet": {"offered_to": {"$each": [m.driver_id for m in matches]}}})
    for m in matches:
        await hub.publish(user_channel(m.driver_id), "ride.offer",
                          offer_view(fresh, distance_km=m.distance_km, eta_min=m.eta_min))
    return len(matches)


async def dispatch_tick() -> None:
    """Send due waves and expire rides nobody accepted. Called every few seconds."""
    db = get_db()
    now = utcnow()
    async for ride in db.rides.find({"status": "requested"}):
        age = (now - aware(ride["created_at"])).total_seconds()
        if age >= DISPATCH_TIMEOUT_SECONDS:
            await _cancel_unmatched(ride)
            continue
        idx = ride.get("waves_sent", 0)
        if idx < len(DISPATCH_WAVES) and age >= DISPATCH_WAVES[idx].after_seconds:
            await _send_wave(ride, idx)


async def _cancel_unmatched(ride: dict) -> None:
    res = await get_db().rides.update_one(
        {"_id": ride["_id"], "status": "requested"},
        {"$set": {"status": "cancelled", "cancelled_at": utcnow(), "cancelled_by": "system",
                  "cancel_reason": "no_driver_available"}})
    if res.modified_count:
        updated = await get_db().rides.find_one({"_id": ride["_id"]})
        await _notify(updated, "ride.updated")
        for driver_id in ride["offered_to"]:
            await hub.publish(user_channel(driver_id), "ride.offer_withdrawn", {"ride_id": ride["_id"]})


async def dispatch_loop(interval: float = 3.0) -> None:
    while True:
        try:
            await dispatch_tick()
        except Exception:  # never let the loop die
            log.exception("dispatch tick failed")
        await asyncio.sleep(interval)


# --- views --------------------------------------------------------------------

def offer_view(ride: dict, distance_km: float | None = None, eta_min: int | None = None) -> dict:
    """What a driver sees before accepting: no rider phone, first name only."""
    fare = ride["estimate"]["fare"]
    name = (ride["rider"].get("name") or "").split(" ")[0] or None
    return {
        "ride_id": ride["_id"], "category": ride["category"],
        "pickup": ride["pickup"], "dropoff": ride["dropoff"],
        "distance_km": ride["estimate"]["distance_km"], "duration_min": ride["estimate"]["duration_min"],
        "fare": fare["total"], "driver_earnings": fare["driver_earnings"],
        "payment_method": ride["payment"]["method"],
        "rider_first_name": name, "rider_rating": ride["rider"].get("rating"),
        "pickup_distance_km": distance_km, "pickup_eta_min": eta_min,
        "expires_at": (aware(ride["created_at"]) + timedelta(seconds=DISPATCH_TIMEOUT_SECONDS)).isoformat(),
    }


def ride_view(ride: dict, viewer_role: str) -> dict:
    """Ride as seen by a participant. Phone numbers are only shared while the ride is active."""
    active = ride["status"] in ACTIVE
    out = {k: v for k, v in ride.items()
           if k not in ("_id", "offered_to", "declined_by", "last_point", "waves_sent")}
    out["id"] = ride["_id"]
    if viewer_role == "rider":
        out.pop("rider", None)
        if out.get("driver") and not active:
            out["driver"] = {k: v for k, v in out["driver"].items() if k != "phone"}
    elif viewer_role == "driver":
        out.pop("driver", None)
        rider = dict(out.get("rider") or {})
        if not active:
            rider.pop("phone", None)
        out["rider"] = rider
    return out


# --- lifecycle ----------------------------------------------------------------

async def _notify(ride: dict, event: str) -> None:
    rider_view, driver_view = ride_view(ride, "rider"), ride_view(ride, "driver")
    await hub.publish(user_channel(ride["rider_id"]), event, rider_view)
    if ride.get("driver_id"):
        await hub.publish(user_channel(ride["driver_id"]), event, driver_view)
    await hub.publish(ADMIN_LIVE, "ride.status", {"ride_id": ride["_id"], "status": ride["status"]})


async def get_ride_for(ride_id: str, user: dict) -> dict:
    ride = await get_db().rides.find_one({"_id": ride_id})
    if ride is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found")
    if user["role"] == "rider" and ride["rider_id"] != user["_id"]:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found")
    if user["role"] == "driver" and ride.get("driver_id") != user["_id"]:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found")
    return ride


async def accept(ride_id: str, driver: dict) -> dict:
    db = get_db()
    d = driver.get("driver") or {}
    if driver["status"] != "approved" or not d.get("online"):
        raise _err(status.HTTP_403_FORBIDDEN, "driver_not_available")
    # 1) reserve the driver (one ride at a time), 2) claim the ride; undo 1 if 2 fails.
    reserved = await db.users.update_one({"_id": driver["_id"], "driver.current_ride_id": None},
                                         {"$set": {"driver.current_ride_id": ride_id}})
    if reserved.modified_count == 0:
        raise _err(status.HTTP_409_CONFLICT, "driver_busy")
    now = utcnow()
    vehicle = driver.get("vehicle") or {}
    claimed = await db.rides.update_one(
        {"_id": ride_id, "status": "requested", "offered_to": driver["_id"]},
        {"$set": {
            "status": "accepted", "driver_id": driver["_id"], "accepted_at": now,
            "driver": {
                "name": driver.get("full_name"), "phone": driver["phone"],
                "rating": (driver.get("rating") or {}).get("avg"),
                "vehicle": {k: vehicle.get(k) for k in ("type", "make", "model", "color", "plate_number")},
                "category": d.get("category"),
            },
        }})
    if claimed.modified_count == 0:
        await db.users.update_one({"_id": driver["_id"], "driver.current_ride_id": ride_id},
                                  {"$set": {"driver.current_ride_id": None}})
        raise _err(status.HTTP_409_CONFLICT, "ride_no_longer_available")
    ride = await db.rides.find_one({"_id": ride_id})
    for other in ride["offered_to"]:
        if other != driver["_id"]:
            await hub.publish(user_channel(other), "ride.offer_withdrawn", {"ride_id": ride_id})
    await _notify(ride, "ride.updated")
    return ride


async def decline(ride_id: str, driver: dict) -> None:
    await get_db().rides.update_one({"_id": ride_id, "status": "requested", "offered_to": driver["_id"]},
                                    {"$addToSet": {"declined_by": driver["_id"]}})


async def advance(ride_id: str, user: dict, action: RideAction, reason: str | None = None,
                  actor: Actor | None = None) -> dict:
    """arrive / start / complete / cancel, enforcing who may do what."""
    db = get_db()
    ride = await db.rides.find_one({"_id": ride_id}) if actor is Actor.STAFF else await get_ride_for(ride_id, user)
    if ride is None:
        raise _err(status.HTTP_404_NOT_FOUND, "not_found")
    actor = actor or Actor(user["role"])
    try:
        target = next_ride_status(ride["status"], action, actor)
    except RideTransitionError as exc:
        raise _err(status.HTTP_409_CONFLICT, "invalid_ride_transition", message=str(exc))

    now = utcnow()
    update: dict[str, Any] = {"status": target.value}
    stamp = {RideAction.ARRIVE: "arrived_at", RideAction.START: "started_at",
             RideAction.COMPLETE: "completed_at", RideAction.CANCEL: "cancelled_at"}[action]
    update[stamp] = now
    if action is RideAction.CANCEL:
        update.update({"cancelled_by": actor.value, "cancel_reason": reason})
    if action is RideAction.START:
        update.update({"tracked_km": 0.0, "last_point": None})
    if action is RideAction.COMPLETE:
        rule, _ = await resolve_rule(ride["country"], ride.get("city_id"), RideCategory(ride["category"]))
        fare = final_fare(rule, ride["estimate"]["fare"]["total"], ride.get("tracked_km") or 0.0,
                          ride["estimate"]["distance_km"], aware(ride["started_at"]), now)
        is_cash = ride["payment"]["method"] == PaymentMethod.CASH.value
        update["fare"] = fare.__dict__
        update["payment.status"] = (PaymentStatus.PAID if is_cash else PaymentStatus.PENDING).value

    res = await db.rides.update_one({"_id": ride_id, "status": ride["status"]}, {"$set": update})
    if res.modified_count == 0:
        raise _err(status.HTTP_409_CONFLICT, "ride_changed")

    if target in (RideStatus.COMPLETED, RideStatus.CANCELLED) and ride.get("driver_id"):
        await db.users.update_one({"_id": ride["driver_id"], "driver.current_ride_id": ride_id},
                                  {"$set": {"driver.current_ride_id": None}})
    if target is RideStatus.CANCELLED and ride["status"] == "requested":
        for driver_id in ride["offered_to"]:
            await hub.publish(user_channel(driver_id), "ride.offer_withdrawn", {"ride_id": ride_id})
    if action is RideAction.COMPLETE and update["payment.status"] == PaymentStatus.PAID.value:
        # Cash: the driver collected the fare and owes Akeva the commission.
        await ledger.add_entry(ride["driver_id"], "cash_commission", -update["fare"]["commission"],
                               ride_id=ride_id)
    if actor is Actor.STAFF:
        await audit.record(user, f"ride.{action.value}", "ride", ride_id,
                           before={"status": ride["status"]}, after={"status": target.value}, reason=reason)

    updated = await db.rides.find_one({"_id": ride_id})
    await _notify(updated, "ride.updated")
    return updated


async def mark_payment(ride_id: str, staff: dict, paid: bool, reference: str | None) -> dict:
    """Confirm or fail a Mobile Money payment (until provider callbacks are wired in)."""
    db = get_db()
    new_status = (PaymentStatus.PAID if paid else PaymentStatus.FAILED).value
    res = await db.rides.update_one(
        {"_id": ride_id, "status": "completed", "payment.status": PaymentStatus.PENDING.value},
        {"$set": {"payment.status": new_status, "payment.reference": reference, "payment.updated_at": utcnow()}})
    if res.modified_count == 0:
        raise _err(status.HTTP_409_CONFLICT, "payment_not_pending")
    ride = await db.rides.find_one({"_id": ride_id})
    if paid:
        await ledger.add_entry(ride["driver_id"], "mobile_money_earning", ride["fare"]["driver_earnings"],
                               ride_id=ride_id)
    await audit.record(staff, f"payment.{new_status}", "ride", ride_id, meta={"reference": reference})
    await _notify(ride, "ride.updated")
    return ride


# --- tracking -----------------------------------------------------------------

async def on_driver_location(driver: dict, point: Point, heading: float | None) -> None:
    ride_id = (driver.get("driver") or {}).get("current_ride_id")
    if not ride_id:
        return
    db = get_db()
    ride = await db.rides.find_one({"_id": ride_id})
    if ride is None or ride["status"] not in ACTIVE:
        return
    if ride["status"] == RideStatus.IN_PROGRESS.value:
        prev = Point(**ride["last_point"]) if ride.get("last_point") else None
        inc = path_increment_km(prev, point)
        await db.rides.update_one({"_id": ride_id}, {
            "$inc": {"tracked_km": inc}, "$set": {"last_point": {"lat": point.lat, "lng": point.lng}}})
    await hub.publish(user_channel(ride["rider_id"]), "driver.location",
                      {"ride_id": ride_id, "lat": point.lat, "lng": point.lng, "heading": heading,
                       "at": utcnow().isoformat()})


# --- ratings, messages, disputes -------------------------------------------

async def rate(ride_id: str, user: dict, stars: int, comment: str | None) -> dict:
    db = get_db()
    ride = await get_ride_for(ride_id, user)
    if ride["status"] != RideStatus.COMPLETED.value:
        raise _err(status.HTTP_409_CONFLICT, "ride_not_completed")
    by, target = ("by_rider", ride["driver_id"]) if user["role"] == "rider" else ("by_driver", ride["rider_id"])
    res = await db.rides.update_one({"_id": ride_id, f"ratings.{by}": None}, {"$set": {
        f"ratings.{by}": {"stars": stars, "comment": comment, "at": utcnow()}}})
    if res.modified_count == 0:
        raise _err(status.HTTP_409_CONFLICT, "already_rated")
    target_user = await db.users.find_one({"_id": target}, {"rating": 1})
    r = (target_user or {}).get("rating") or {"avg": None, "count": 0}
    count = (r.get("count") or 0) + 1
    avg = round((((r.get("avg") or 0) * (count - 1)) + stars) / count, 2)
    await db.users.update_one({"_id": target}, {"$set": {"rating": {"avg": avg, "count": count}}})
    return {"ok": True}


async def add_message(ride_id: str, user: dict, text: str) -> dict:
    ride = await get_ride_for(ride_id, user)
    if ride["status"] not in ACTIVE:
        raise _err(status.HTTP_409_CONFLICT, "chat_closed")
    msg = {"_id": new_id(), "ride_id": ride_id, "sender_id": user["_id"], "sender_role": user["role"],
           "text": text, "created_at": utcnow()}
    await get_db().ride_messages.insert_one(msg)
    out = _msg_out(msg)
    other = ride["driver_id"] if user["role"] == "rider" else ride["rider_id"]
    await hub.publish(user_channel(other), "ride.message", out)
    return out


async def list_messages(ride_id: str, user: dict) -> list[dict]:
    await get_ride_for(ride_id, user)
    cursor = get_db().ride_messages.find({"ride_id": ride_id}).sort("created_at", 1).limit(500)
    return [_msg_out(m) async for m in cursor]


def _msg_out(m: dict) -> dict:
    return {"id": m["_id"], "ride_id": m["ride_id"], "sender_role": m["sender_role"],
            "text": m["text"], "created_at": m["created_at"]}


async def open_dispute(ride_id: str, user: dict, subject: str, description: str) -> dict:
    ride = await get_ride_for(ride_id, user)
    doc = {"_id": new_id(), "ride_id": ride_id, "opened_by": user["_id"], "opened_by_role": user["role"],
           "subject": subject, "description": description, "status": "open",
           "country": ride["country"], "created_at": utcnow()}
    await get_db().disputes.insert_one(doc)
    return {"id": doc["_id"], "status": "open"}

