"""Distances and rough travel-time estimates (no external routing service).

Straight-line distance times a road factor is a good enough first estimate in
dense African cities; swap ``estimate_trip`` for Mapbox Directions later
without touching callers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_RADIUS_KM = 6371.0088
ROAD_FACTOR = 1.35  # roads are longer than the straight line
CITY_SPEED_KMH = 20.0  # average urban speed including traffic
PICKUP_SPEED_KMH = 18.0


@dataclass(frozen=True)
class Point:
    lat: float
    lng: float

    def __post_init__(self) -> None:
        if not (-90 <= self.lat <= 90 and -180 <= self.lng <= 180):
            raise ValueError("invalid coordinates")

    def geojson(self) -> dict:
        return {"type": "Point", "coordinates": [self.lng, self.lat]}

    @classmethod
    def from_geojson(cls, g: dict) -> "Point":
        lng, lat = g["coordinates"]
        return cls(lat=lat, lng=lng)


def haversine_km(a: Point, b: Point) -> float:
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(h))


@dataclass(frozen=True)
class TripEstimate:
    distance_km: float
    duration_min: float


def estimate_trip(a: Point, b: Point) -> TripEstimate:
    km = haversine_km(a, b) * ROAD_FACTOR
    return TripEstimate(distance_km=round(km, 2), duration_min=round(km / CITY_SPEED_KMH * 60, 1))


def pickup_eta_min(driver: Point, pickup: Point) -> int:
    km = haversine_km(driver, pickup) * ROAD_FACTOR
    return max(1, round(km / PICKUP_SPEED_KMH * 60))
