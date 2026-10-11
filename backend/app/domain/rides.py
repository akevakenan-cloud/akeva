"""Ride lifecycle rules, driver matching and final fare, free of I/O.

    requested --accept--> accepted --arrive--> arrived --start--> in_progress --complete--> completed
        |                    |                    |                    |
        +--------------------+------cancel--------+                    +--cancel (staff only)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum

from .enums import RideCategory, RideStatus
from .geo import Point, haversine_km, pickup_eta_min
from .pricing import FareBreakdown, PricingRule, calculate_fare


class RideAction(str, Enum):
    ACCEPT = "accept"
    ARRIVE = "arrive"
    START = "start"
    COMPLETE = "complete"
    CANCEL = "cancel"


class Actor(str, Enum):
    RIDER = "rider"
    DRIVER = "driver"
    STAFF = "staff"


R = RideStatus
TRANSITIONS: dict[tuple[RideStatus, RideAction], RideStatus] = {
    (R.REQUESTED, RideAction.ACCEPT): R.ACCEPTED,
    (R.ACCEPTED, RideAction.ARRIVE): R.ARRIVED,
    (R.ARRIVED, RideAction.START): R.IN_PROGRESS,
    (R.IN_PROGRESS, RideAction.COMPLETE): R.COMPLETED,
    (R.REQUESTED, RideAction.CANCEL): R.CANCELLED,
    (R.ACCEPTED, RideAction.CANCEL): R.CANCELLED,
    (R.ARRIVED, RideAction.CANCEL): R.CANCELLED,
    (R.IN_PROGRESS, RideAction.CANCEL): R.CANCELLED,
}

ALLOWED_ACTORS: dict[RideAction, set[Actor]] = {
    RideAction.ACCEPT: {Actor.DRIVER},
    RideAction.ARRIVE: {Actor.DRIVER},
    RideAction.START: {Actor.DRIVER},
    RideAction.COMPLETE: {Actor.DRIVER},
    RideAction.CANCEL: {Actor.RIDER, Actor.DRIVER, Actor.STAFF},
}


class RideTransitionError(ValueError):
    pass


def next_ride_status(current: RideStatus | str, action: RideAction | str, actor: Actor | str) -> RideStatus:
    current, action, actor = RideStatus(current), RideAction(action), Actor(actor)
    if actor not in ALLOWED_ACTORS[action]:
        raise RideTransitionError(f"{actor.value} cannot {action.value} a ride")
    if current is R.IN_PROGRESS and action is RideAction.CANCEL and actor is not Actor.STAFF:
        raise RideTransitionError("a ride in progress can only be cancelled by support")
    target = TRANSITIONS.get((current, action))
    if target is None:
        raise RideTransitionError(f"cannot {action.value} a ride that is {current.value}")
    return target


# --- matching ----------------------------------------------------------------

LOCATION_FRESH_SECONDS = 120  # ignore drivers whose GPS hasn't reported recently


@dataclass(frozen=True)
class Wave:
    after_seconds: int
    max_drivers: int
    radius_km: float


# Offer the ride to the closest drivers first, then widen the search.
DISPATCH_WAVES = (Wave(0, 5, 5.0), Wave(20, 10, 10.0), Wave(40, 15, 15.0))
DISPATCH_TIMEOUT_SECONDS = 75


@dataclass(frozen=True)
class Candidate:
    driver_id: str
    location: Point
    eligible: tuple[str, ...]
    location_at: datetime


@dataclass(frozen=True)
class Match:
    driver_id: str
    distance_km: float
    eta_min: int


def rank_drivers(pickup: Point, category: RideCategory, candidates: list[Candidate], now: datetime,
                 radius_km: float, limit: int, exclude: set[str] = frozenset()) -> list[Match]:
    """Closest fresh, eligible drivers within the radius, nearest first."""
    out = []
    for c in candidates:
        if c.driver_id in exclude or category.value not in c.eligible:
            continue
        if now - c.location_at > timedelta(seconds=LOCATION_FRESH_SECONDS):
            continue
        d = haversine_km(c.location, pickup)
        if d <= radius_km:
            out.append(Match(c.driver_id, round(d, 2), pickup_eta_min(c.location, pickup)))
    out.sort(key=lambda m: m.distance_km)
    return out[:limit]


# --- final fare --------------------------------------------------------------

FARE_CAP_RATIO = 1.3  # riders never pay more than 30% above the upfront estimate


def final_fare(rule: PricingRule, estimated_total: int, tracked_km: float, estimated_km: float,
               started_at: datetime, ended_at: datetime) -> FareBreakdown:
    """Fare from the actual trip, capped relative to the price shown upfront.

    GPS tracking can miss segments, so the distance is never taken as less
    than 70% of the estimate.
    """
    minutes = max(0.0, (ended_at - started_at).total_seconds() / 60)
    km = max(tracked_km, estimated_km * 0.7)
    fare = calculate_fare(rule, km, minutes)
    cap = int(math.ceil(estimated_total * FARE_CAP_RATIO / rule.rounding_step) * rule.rounding_step)
    if fare.total <= cap:
        return fare
    subtotal = max(rule.minimum_fare, cap - rule.booking_fee)
    commission = round(subtotal * rule.commission_rate)
    return FareBreakdown(
        base_fare=fare.base_fare, distance_fare=fare.distance_fare, time_fare=fare.time_fare,
        multiplier=fare.multiplier, surge=fare.surge, booking_fee=rule.booking_fee,
        subtotal=subtotal, total=subtotal + rule.booking_fee,
        commission=commission + rule.booking_fee, driver_earnings=subtotal - commission,
    )


def path_increment_km(prev: Point | None, new: Point) -> float:
    """Distance to add for a GPS update; ignores jitter and impossible jumps."""
    if prev is None:
        return 0.0
    d = haversine_km(prev, new)
    if d < 0.02 or d > 3.0:  # <20 m is GPS noise; >3 km between updates is a glitch
        return 0.0
    return d
