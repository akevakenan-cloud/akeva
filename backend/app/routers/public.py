"""Unauthenticated configuration the apps need before login."""

from __future__ import annotations

from fastapi import APIRouter

from ..core.config import get_settings
from ..core.db import get_db
from ..domain.categorization import (
    COMFORT_MIN_YEAR,
    GOLD_MIN_YEAR,
    PLATINUM_MIN_YEAR,
    PRESTIGE_MIN_YEAR,
    suggest_category,
)
from ..domain.countries import COUNTRIES, CURRENCY
from ..domain.enums import CATEGORY_ORDER, Language
from ..domain.onboarding import CONSENT_VERSION
from ..models.schemas import CategoryPreviewIn

router = APIRouter(tags=["public"])

CATEGORY_INFO = {
    "moto": {"fr": "Moto-taxi", "en": "Moto taxi", "min_year": None, "vehicle": "moto"},
    "economy": {"fr": "Économie", "en": "Economy", "min_year": None, "vehicle": "car"},
    "comfort": {"fr": "Confort", "en": "Comfort", "min_year": COMFORT_MIN_YEAR, "vehicle": "car"},
    "prestige": {"fr": "Prestige", "en": "Prestige", "min_year": PRESTIGE_MIN_YEAR, "vehicle": "car"},
    "gold": {"fr": "Gold", "en": "Gold", "min_year": GOLD_MIN_YEAR, "vehicle": "car"},
    "platinum": {"fr": "Platinum", "en": "Platinum", "min_year": PLATINUM_MIN_YEAR, "vehicle": "car"},
}


@router.get("/health")
async def health() -> dict:
    await get_db().command("ping")
    return {"ok": True}


@router.get("/config")
async def app_config() -> dict:
    cities: dict[str, list[dict]] = {}
    async for c in get_db().cities.find({"active": True}).sort("name", 1):
        cities.setdefault(c["country"], []).append(
            {"id": c["_id"], "name": c["name"], "lat": c["lat"], "lng": c["lng"]})
    return {
        "currency": CURRENCY,
        "languages": [lang.value for lang in Language],
        "consent_version": CONSENT_VERSION,
        "mapbox_public_token": get_settings().mapbox_public_token,
        "categories": [{"id": c.value, **CATEGORY_INFO[c.value]} for c in CATEGORY_ORDER],
        "countries": [
            {
                "code": c.code, "dial_code": f"+{c.dial_code}", "name_fr": c.name_fr,
                "name_en": c.name_en, "national_lengths": list(c.national_lengths),
                "payout_methods": [m.value for m in c.payout_methods],
                "cities": cities.get(c.code) or [{"id": None, "name": n} for n in c.default_cities],
            }
            for c in COUNTRIES.values()
        ],
    }


@router.post("/vehicles/categorize")
async def categorize_preview(body: CategoryPreviewIn) -> dict:
    """Lets the driver app show the expected category while the form is being filled."""
    s = suggest_category(body.type, body.make, body.model, body.year)
    return {"suggested_category": s.category.value,
            "eligible_categories": [c.value for c in s.eligible], "reasons": s.reasons}
