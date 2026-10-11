"""Request/response schemas for the HTTP API."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from ..domain.countries import COUNTRIES
from ..domain.enums import (
    DisputeStatus,
    IdDocumentType,
    Language,
    PayoutMethod,
    RideCategory,
    Role,
    VehicleType,
)
from ..domain.status import StatusAction

AppName = Literal["rider", "driver", "admin"]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _country(v: str | None) -> str | None:
    if v is None:
        return v
    v = v.upper()
    if v not in COUNTRIES:
        raise ValueError(f"unsupported country; use one of {', '.join(COUNTRIES)}")
    return v


# --- auth -----------------------------------------------------------------

class OtpRequestIn(_In):
    phone: str = Field(min_length=6, max_length=24)
    app: AppName
    country: str | None = None  # lets users type local numbers ("677 12 34 56")
    language: Language = Language.FR

    _c = field_validator("country")(_country)


class OtpVerifyIn(_In):
    phone: str = Field(min_length=6, max_length=24)
    app: AppName
    code: str = Field(min_length=4, max_length=8, pattern=r"^\d+$")
    country: str | None = None

    _c = field_validator("country")(_country)


class RefreshIn(_In):
    refresh_token: str = Field(min_length=20, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict
    dev_code: str | None = None


# --- profile & onboarding ---------------------------------------------------

class ProfileIn(_In):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    language: Language | None = None
    country: str | None = None
    city: str | None = Field(default=None, max_length=80)
    date_of_birth: date | None = None
    id_type: IdDocumentType | None = None
    id_number: str | None = Field(default=None, min_length=3, max_length=40)
    license_number: str | None = Field(default=None, min_length=3, max_length=40)  # drivers

    _c = field_validator("country")(_country)


class ConsentIn(_In):
    documents: bool
    selfie: bool
    version: str


class VehicleIn(_In):
    type: VehicleType
    make: str = Field(min_length=2, max_length=40)
    model: str = Field(default="", max_length=60)
    year: int = Field(ge=1980, le=date.today().year + 1)
    color: str = Field(min_length=2, max_length=30)
    plate_number: str = Field(min_length=3, max_length=15)

    @field_validator("plate_number")
    @classmethod
    def _plate(cls, v: str) -> str:
        return " ".join(v.upper().split())


class PayoutIn(_In):
    method: PayoutMethod
    account_name: str = Field(min_length=2, max_length=120)
    account_number: str = Field(min_length=4, max_length=40)  # phone for mobile money, IBAN/RIB for bank
    bank_name: str | None = Field(default=None, max_length=80)


class CategoryPreviewIn(_In):
    type: VehicleType
    make: str
    model: str = ""
    year: int = Field(ge=1980, le=date.today().year + 1)


class LocationIn(_In):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    heading: float | None = Field(default=None, ge=0, le=360)
    speed_kmh: float | None = Field(default=None, ge=0, le=300)


class OnlineIn(_In):
    online: bool


class DeletionRequestIn(_In):
    reason: str | None = Field(default=None, max_length=500)


# --- admin ------------------------------------------------------------------

class StatusActionIn(_In):
    action: StatusAction
    reason: str | None = Field(default=None, max_length=500)


class CategoryOverrideIn(_In):
    category: RideCategory
    reason: str = Field(min_length=3, max_length=500)


class CityIn(_In):
    country: str
    name: str = Field(min_length=2, max_length=80)
    active: bool = True
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    _c = field_validator("country")(_country)


class CityPatch(_In):
    active: bool | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class PricingRuleIn(_In):
    country: str
    city_id: str | None = None  # None = country-wide default
    category: RideCategory
    base_fare: int = Field(ge=0, le=1_000_000)
    per_km: int = Field(ge=0, le=100_000)
    per_minute: int = Field(ge=0, le=100_000)
    minimum_fare: int = Field(ge=0, le=1_000_000)
    multiplier: float = Field(gt=0, le=20)
    booking_fee: int = Field(default=0, ge=0, le=100_000)
    commission_rate: float = Field(default=0.15, ge=0, lt=1)
    rounding_step: int = Field(default=50, ge=1, le=1000)

    _c = field_validator("country")(_country)


class FarePreviewIn(_In):
    country: str
    city_id: str | None = None
    category: RideCategory
    distance_km: float = Field(ge=0, le=500)
    duration_min: float = Field(ge=0, le=600)
    surge: float = Field(default=1.0, ge=1, le=5)

    _c = field_validator("country")(_country)


class DisputeUpdateIn(_In):
    status: DisputeStatus
    resolution_note: str | None = Field(default=None, max_length=1000)
    refund_amount: int | None = Field(default=None, ge=0)


class StaffCreateIn(_In):
    phone: str
    full_name: str = Field(min_length=2, max_length=120)
    role: Literal[Role.ADMIN, Role.SUPER_ADMIN] = Role.ADMIN
    country: str | None = None

    _c = field_validator("country")(_country)


class DeletionDecisionIn(_In):
    approve: bool
    note: str | None = Field(default=None, max_length=500)
