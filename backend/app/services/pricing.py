"""Look up the pricing rule that applies to a city and category."""

from __future__ import annotations

from ..core.db import get_db
from ..domain.enums import RideCategory
from ..domain.pricing import PricingRule, default_rule

RULE_FIELDS = ("base_fare", "per_km", "per_minute", "minimum_fare", "multiplier",
               "booking_fee", "commission_rate", "rounding_step")


def rule_from_doc(doc: dict) -> PricingRule:
    return PricingRule(RideCategory(doc["category"]), **{k: doc[k] for k in RULE_FIELDS if k in doc})


async def resolve_rule(country: str, city_id: str | None, category: RideCategory) -> tuple[PricingRule, str]:
    """City rule, else country-wide rule, else built-in default. Returns (rule, source)."""
    db = get_db()
    if city_id:
        doc = await db.pricing_rules.find_one(
            {"country": country, "city_id": city_id, "category": category.value})
        if doc:
            return rule_from_doc(doc), "city"
    doc = await db.pricing_rules.find_one(
        {"country": country, "city_id": None, "category": category.value})
    if doc:
        return rule_from_doc(doc), "country"
    return default_rule(category), "default"
