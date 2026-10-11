"""Supported markets: CEMAC countries served by Akeva.

All six use the Central African CFA franc (XAF), which has no minor unit, so
every amount in the system is stored as an integer number of francs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .enums import PayoutMethod

CURRENCY = "XAF"


@dataclass(frozen=True)
class Country:
    code: str  # ISO 3166-1 alpha-2
    dial_code: str  # without "+"
    name_fr: str
    name_en: str
    national_lengths: tuple[int, ...]  # allowed digit counts after the dial code
    timezone: str
    default_cities: tuple[str, ...]
    payout_methods: tuple[PayoutMethod, ...] = field(default_factory=tuple)


COUNTRIES: dict[str, Country] = {
    c.code: c
    for c in [
        Country(
            "CM", "237", "Cameroun", "Cameroon", (9,), "Africa/Douala",
            ("Douala", "Yaoundé", "Bafoussam", "Garoua", "Bamenda", "Kribi"),
            (PayoutMethod.MTN_MOMO, PayoutMethod.ORANGE_MONEY, PayoutMethod.BANK),
        ),
        Country(
            "TD", "235", "Tchad", "Chad", (8,), "Africa/Ndjamena",
            ("N'Djamena", "Moundou", "Abéché"),
            (PayoutMethod.AIRTEL_MONEY, PayoutMethod.MOOV_MONEY, PayoutMethod.BANK),
        ),
        Country(
            "GA", "241", "Gabon", "Gabon", (7, 8), "Africa/Libreville",
            ("Libreville", "Port-Gentil", "Franceville"),
            (PayoutMethod.AIRTEL_MONEY, PayoutMethod.MOOV_MONEY, PayoutMethod.BANK),
        ),
        Country(
            "GQ", "240", "Guinée Équatoriale", "Equatorial Guinea", (9,), "Africa/Malabo",
            ("Malabo", "Bata"),
            (PayoutMethod.BANK,),
        ),
        Country(
            "CF", "236", "République Centrafricaine", "Central African Republic", (8,),
            "Africa/Bangui",
            ("Bangui", "Bimbo", "Berbérati"),
            (PayoutMethod.ORANGE_MONEY, PayoutMethod.BANK),
        ),
        Country(
            "CG", "242", "Congo", "Republic of the Congo", (9,), "Africa/Brazzaville",
            ("Brazzaville", "Pointe-Noire", "Dolisie"),
            (PayoutMethod.MTN_MOMO, PayoutMethod.AIRTEL_MONEY, PayoutMethod.BANK),
        ),
    ]
}

_DIAL_TO_COUNTRY = {c.dial_code: c for c in COUNTRIES.values()}


class InvalidPhoneNumber(ValueError):
    pass


@dataclass(frozen=True)
class Phone:
    e164: str  # e.g. "+237677123456"
    country: str  # ISO code


def normalize_phone(raw: str, default_country: str | None = None) -> Phone:
    """Normalize a phone number to E.164 and identify its country.

    Accepts "+237 677 12 34 56", "00237677123456", "237677123456", or a local
    number ("677123456") when ``default_country`` is given. Only the six
    supported countries are accepted.
    """
    if not raw or not raw.strip():
        raise InvalidPhoneNumber("empty phone number")
    s = raw.strip()
    has_plus = s.startswith("+")
    digits = re.sub(r"\D", "", s)
    if not has_plus and digits.startswith("00"):
        digits, has_plus = digits[2:], True

    country: Country | None = None
    national = ""
    for dial, c in _DIAL_TO_COUNTRY.items():
        if digits.startswith(dial) and len(digits) - len(dial) in c.national_lengths:
            country, national = c, digits[len(dial):]
            break

    if country is None and not has_plus and default_country:
        c = COUNTRIES.get(default_country.upper())
        if c is None:
            raise InvalidPhoneNumber(f"unsupported country {default_country}")
        if len(digits) in c.national_lengths:
            country, national = c, digits

    if country is None:
        raise InvalidPhoneNumber("phone number is not a valid number for a supported country")
    return Phone(e164=f"+{country.dial_code}{national}", country=country.code)


def country_for_phone(e164: str) -> Country:
    return COUNTRIES[normalize_phone(e164).country]
