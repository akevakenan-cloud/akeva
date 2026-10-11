"""Automatic ride-category suggestion for driver vehicles.

Rules (highest eligible category wins):

* Moto      - any motorcycle.
* Platinum  - car from 2020+ that is either an ultra-luxury brand or a
              flagship model of a luxury brand (see PLATINUM_MODELS).
* Gold      - car from 2015+ of an internationally known luxury brand.
* Prestige  - any car from 2018+.
* Comfort   - any car from 2014+.
* Economy   - every other car (standard taxi cabs).

The reference lists are deliberately simple; admins can always override the
result, and the lists can be extended without code changes elsewhere.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .enums import CATEGORY_ORDER, RideCategory, VehicleType

COMFORT_MIN_YEAR = 2014
PRESTIGE_MIN_YEAR = 2018
GOLD_MIN_YEAR = 2015
PLATINUM_MIN_YEAR = 2020

# Ultra-luxury brands: any model qualifies for Platinum (2020+) or Gold (2015+).
PLATINUM_BRANDS = {
    "rolls-royce", "bentley", "maybach", "ferrari", "lamborghini",
    "aston martin", "mclaren", "bugatti",
}

# Internationally recognised luxury brands: eligible for Gold (2015+).
GOLD_BRANDS = {
    "mercedes-benz", "bmw", "audi", "lexus", "porsche", "land rover",
    "range rover", "jaguar", "volvo", "infiniti", "cadillac", "lincoln",
    "genesis", "maserati", "tesla", "alfa romeo", "acura",
}

# Flagship models of Gold brands that qualify for Platinum when 2020+.
PLATINUM_MODELS: dict[str, set[str]] = {
    "mercedes-benz": {"s-class", "s class", "maybach", "g-class", "g class", "gls", "eqs", "amg gt"},
    "bmw": {"7 series", "x7", "i7", "8 series", "m8", "xm"},
    "audi": {"a8", "q8", "e-tron gt", "rs q8", "r8"},
    "lexus": {"ls", "lx"},
    "porsche": {"panamera", "cayenne", "911", "taycan"},
    "land rover": {"range rover", "defender"},
    "range rover": {"range rover", "autobiography", "sv"},
    "cadillac": {"escalade"},
    "lincoln": {"navigator"},
    "genesis": {"g90", "gv80"},
    "maserati": {"quattroporte", "levante"},
}

_BRAND_ALIASES = {
    "mercedes": "mercedes-benz",
    "mercedes benz": "mercedes-benz",
    "benz": "mercedes-benz",
    "merco": "mercedes-benz",
    "mercedes-maybach": "maybach",
    "rolls royce": "rolls-royce",
    "rollsroyce": "rolls-royce",
    "landrover": "land rover",
    "land-rover": "land rover",
    "range-rover": "range rover",
    "astonmartin": "aston martin",
    "aston-martin": "aston martin",
    "alfa": "alfa romeo",
}


def normalize_brand(make: str) -> str:
    s = re.sub(r"\s+", " ", (make or "").strip().lower())
    return _BRAND_ALIASES.get(s, s)


def _normalize_model(model: str) -> str:
    return re.sub(r"\s+", " ", (model or "").strip().lower())


# Model-number patterns for flagships usually written as a code ("S 580", "S500").
_PLATINUM_MODEL_PATTERNS: dict[str, list[str]] = {
    "mercedes-benz": [r"s\s?\d{3}\b.*", r"g\s?\d{2,3}\b.*"],
}


def _is_platinum_model(brand: str, model: str) -> bool:
    m = _normalize_model(model)
    for flagship in PLATINUM_MODELS.get(brand, set()):
        # The flagship name must be followed by the end, a space, a hyphen or a
        # digit, so "LX 600", "A8 L" and "Range Rover Vogue" match but "A80" or
        # "LSX" do not.
        if re.match(rf"{re.escape(flagship)}(?=$|[\s\-])", m):
            return True
    return any(re.fullmatch(p, m) for p in _PLATINUM_MODEL_PATTERNS.get(brand, []))


@dataclass(frozen=True)
class CategorySuggestion:
    category: RideCategory
    eligible: list[RideCategory]  # categories this vehicle may serve
    reasons: list[str]


def suggest_category(
    vehicle_type: VehicleType | str,
    make: str,
    model: str,
    year: int,
) -> CategorySuggestion:
    vtype = VehicleType(vehicle_type)
    if vtype is VehicleType.MOTO:
        return CategorySuggestion(RideCategory.MOTO, [RideCategory.MOTO], ["motorcycle"])

    brand = normalize_brand(make)
    reasons: list[str] = []
    if brand in PLATINUM_BRANDS:
        reasons.append(f"ultra-luxury brand ({brand})")
    elif brand in GOLD_BRANDS:
        reasons.append(f"luxury brand ({brand})")

    if year >= PLATINUM_MIN_YEAR and (brand in PLATINUM_BRANDS or _is_platinum_model(brand, model)):
        cat = RideCategory.PLATINUM
        reasons.append(f"year {year} >= {PLATINUM_MIN_YEAR}")
    elif year >= GOLD_MIN_YEAR and (brand in GOLD_BRANDS or brand in PLATINUM_BRANDS):
        cat = RideCategory.GOLD
        reasons.append(f"year {year} >= {GOLD_MIN_YEAR}")
    elif year >= PRESTIGE_MIN_YEAR:
        cat = RideCategory.PRESTIGE
        reasons.append(f"year {year} >= {PRESTIGE_MIN_YEAR}")
    elif year >= COMFORT_MIN_YEAR:
        cat = RideCategory.COMFORT
        reasons.append(f"year {year} >= {COMFORT_MIN_YEAR}")
    else:
        cat = RideCategory.ECONOMY
        reasons.append(f"year {year} < {COMFORT_MIN_YEAR}")

    # A car can always serve car categories below its own (never Moto).
    eligible = [c for c in CATEGORY_ORDER if c is not RideCategory.MOTO and c.rank <= cat.rank]
    return CategorySuggestion(cat, eligible, reasons)


def eligible_for(category: RideCategory) -> list[RideCategory]:
    """Categories a driver assigned to ``category`` may accept rides for."""
    if category is RideCategory.MOTO:
        return [RideCategory.MOTO]
    return [c for c in CATEGORY_ORDER if c is not RideCategory.MOTO and c.rank <= category.rank]
