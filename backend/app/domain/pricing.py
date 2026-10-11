"""Fare calculation: base + distance + time, times the category multiplier.

Amounts are integers in XAF (no minor unit). Fares are rounded up to a
cash-friendly step (default 50 XAF) because most rides are paid in cash.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .enums import RideCategory

# Sensible launch defaults; admins override them per country/city/category.
DEFAULT_MULTIPLIERS: dict[RideCategory, float] = {
    RideCategory.MOTO: 0.5,
    RideCategory.ECONOMY: 1.0,
    RideCategory.COMFORT: 1.3,
    RideCategory.PRESTIGE: 1.6,
    RideCategory.GOLD: 2.2,
    RideCategory.PLATINUM: 3.0,
}


@dataclass(frozen=True)
class PricingRule:
    category: RideCategory
    base_fare: int = 500
    per_km: int = 250
    per_minute: int = 25
    minimum_fare: int = 1000
    multiplier: float = 1.0
    booking_fee: int = 0
    commission_rate: float = 0.15  # Akeva's share of the fare
    rounding_step: int = 50

    def __post_init__(self) -> None:
        for name in ("base_fare", "per_km", "per_minute", "minimum_fare", "booking_fee"):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative")
        if self.multiplier <= 0:
            raise ValueError("multiplier must be positive")
        if not 0 <= self.commission_rate < 1:
            raise ValueError("commission_rate must be between 0 and 1")
        if self.rounding_step <= 0:
            raise ValueError("rounding_step must be positive")


@dataclass(frozen=True)
class FareBreakdown:
    base_fare: int
    distance_fare: int
    time_fare: int
    multiplier: float
    surge: float
    booking_fee: int
    subtotal: int
    total: int
    commission: int
    driver_earnings: int
    currency: str = "XAF"


def _round_up(amount: float, step: int) -> int:
    return int(math.ceil(amount / step) * step)


def calculate_fare(
    rule: PricingRule,
    distance_km: float,
    duration_min: float,
    surge: float = 1.0,
) -> FareBreakdown:
    if distance_km < 0 or duration_min < 0:
        raise ValueError("distance and duration cannot be negative")
    if surge < 1.0:
        raise ValueError("surge cannot be below 1.0")

    distance_fare = round(rule.per_km * distance_km)
    time_fare = round(rule.per_minute * duration_min)
    raw = (rule.base_fare + distance_fare + time_fare) * rule.multiplier * surge
    subtotal = max(rule.minimum_fare, _round_up(raw, rule.rounding_step))
    total = subtotal + rule.booking_fee
    commission = round(subtotal * rule.commission_rate)
    return FareBreakdown(
        base_fare=rule.base_fare,
        distance_fare=distance_fare,
        time_fare=time_fare,
        multiplier=rule.multiplier,
        surge=surge,
        booking_fee=rule.booking_fee,
        subtotal=subtotal,
        total=total,
        commission=commission + rule.booking_fee,
        driver_earnings=subtotal - commission,
    )


def default_rule(category: RideCategory) -> PricingRule:
    if category is RideCategory.MOTO:
        return PricingRule(category, base_fare=200, per_km=100, per_minute=10,
                           minimum_fare=300, multiplier=1.0)
    return PricingRule(category, multiplier=DEFAULT_MULTIPLIERS[category])
