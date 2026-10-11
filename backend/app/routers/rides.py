"""Ride endpoints shared by the rider and driver apps."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status

from ..core.db import get_db
from ..core.deps import CurrentUser, Driver, Rider
from ..core.ratelimit import hit
from ..domain.enums import CATEGORY_ORDER, ACTIVE_RIDE_STATUSES
from ..domain.geo import Point
from ..domain.rides import RideAction
from ..domain.status import can_operate
from ..models.schemas import CancelIn, DisputeIn, EstimateIn, MessageIn, RatingIn, RideRequestIn
from ..services import rides as svc

router = APIRouter(prefix="/rides", tags=["rides"])


def _member(user: dict) -> None:
    if user["role"] not in ("rider", "driver"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "forbidden"})


@router.post("/estimate")
async def estimate(body: EstimateIn, rider: Rider) -> dict:
    """Upfront price and pickup time for each category, before requesting."""
    return await svc.estimates(rider["country"], body.city_id, Point(body.pickup.lat, body.pickup.lng),
                               Point(body.dropoff.lat, body.dropoff.lng), body.categories or CATEGORY_ORDER)


@router.post("", status_code=201)
async def request_ride(body: RideRequestIn, rider: Rider) -> dict:
    if not can_operate(rider["status"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "not_approved", "status": rider["status"]})
    await hit("ride_request", rider["_id"], 20, 3600)
    ride = await svc.create_ride(rider, body)
    return svc.ride_view(ride, "rider")


@router.get("/active")
async def active_ride(user: CurrentUser) -> dict | None:
    """The ride the app should show right now (also used to resume after a restart)."""
    _member(user)
    key = "rider_id" if user["role"] == "rider" else "driver_id"
    statuses = [s.value for s in ACTIVE_RIDE_STATUSES] + (["requested"] if user["role"] == "rider" else [])
    ride = await get_db().rides.find_one({key: user["_id"], "status": {"$in": statuses}},
                                         sort=[("created_at", -1)])
    return svc.ride_view(ride, user["role"]) if ride else None


@router.get("")
async def my_rides(user: CurrentUser, page: int = Query(default=1, ge=1),
                   page_size: int = Query(default=20, ge=1, le=50)) -> dict:
    _member(user)
    key = "rider_id" if user["role"] == "rider" else "driver_id"
    query = {key: user["_id"], "status": {"$in": ["completed", "cancelled"]}}
    cursor = get_db().rides.find(query).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size)
    items = [svc.ride_view(r, user["role"]) async for r in cursor]
    return {"items": items, "total": await get_db().rides.count_documents(query)}


@router.get("/{ride_id}")
async def get_ride(ride_id: str, user: CurrentUser) -> dict:
    _member(user)
    ride = await svc.get_ride_for(ride_id, user)
    out = svc.ride_view(ride, user["role"])
    if user["role"] == "rider" and ride.get("driver_id") and ride["status"] in svc.ACTIVE:
        drv = await get_db().users.find_one({"_id": ride["driver_id"]}, {"driver.location": 1, "driver.heading": 1})
        loc = ((drv or {}).get("driver") or {}).get("location")
        if loc:
            out["driver_location"] = {"lng": loc["coordinates"][0], "lat": loc["coordinates"][1],
                                      "heading": drv["driver"].get("heading")}
    return out


@router.post("/{ride_id}/cancel")
async def cancel(ride_id: str, body: CancelIn, user: CurrentUser) -> dict:
    _member(user)
    ride = await svc.advance(ride_id, user, RideAction.CANCEL, body.reason)
    return svc.ride_view(ride, user["role"])


# --- driver actions -----------------------------------------------------------

@router.post("/{ride_id}/accept")
async def accept(ride_id: str, driver: Driver) -> dict:
    return svc.ride_view(await svc.accept(ride_id, driver), "driver")


@router.post("/{ride_id}/decline", status_code=204)
async def decline(ride_id: str, driver: Driver) -> None:
    await svc.decline(ride_id, driver)


@router.post("/{ride_id}/arrive")
async def arrive(ride_id: str, driver: Driver) -> dict:
    return svc.ride_view(await svc.advance(ride_id, driver, RideAction.ARRIVE), "driver")


@router.post("/{ride_id}/start")
async def start(ride_id: str, driver: Driver) -> dict:
    return svc.ride_view(await svc.advance(ride_id, driver, RideAction.START), "driver")


@router.post("/{ride_id}/complete")
async def complete(ride_id: str, driver: Driver) -> dict:
    return svc.ride_view(await svc.advance(ride_id, driver, RideAction.COMPLETE), "driver")


# --- after / during the ride --------------------------------------------------

@router.post("/{ride_id}/rating")
async def rate(ride_id: str, body: RatingIn, user: CurrentUser) -> dict:
    _member(user)
    return await svc.rate(ride_id, user, body.stars, body.comment)


@router.get("/{ride_id}/messages")
async def messages(ride_id: str, user: CurrentUser) -> list[dict]:
    _member(user)
    return await svc.list_messages(ride_id, user)


@router.post("/{ride_id}/messages", status_code=201)
async def send_message(ride_id: str, body: MessageIn, user: CurrentUser) -> dict:
    _member(user)
    await hit("ride_chat", user["_id"], 120, 3600)
    return await svc.add_message(ride_id, user, body.text)


@router.post("/{ride_id}/dispute", status_code=201)
async def dispute(ride_id: str, body: DisputeIn, user: CurrentUser) -> dict:
    _member(user)
    return await svc.open_dispute(ride_id, user, body.subject, body.description)
