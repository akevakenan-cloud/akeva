"""Shared enumerations used across the Akeva backend.

These values are part of the public API contract (mobile apps and the admin
console depend on them), so treat renames as breaking changes.
"""

from enum import Enum


class Role(str, Enum):
    RIDER = "rider"
    DRIVER = "driver"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"

    @property
    def is_staff(self) -> bool:
        return self in (Role.ADMIN, Role.SUPER_ADMIN)


class AccountStatus(str, Enum):
    ONBOARDING = "onboarding"  # registered via OTP, profile not yet submitted
    PENDING = "pending"  # submitted, waiting for admin review
    APPROVED = "approved"
    REJECTED = "rejected"  # can fix and resubmit
    SUSPENDED = "suspended"  # temporary, reversible
    BANNED = "banned"  # permanent unless a super-admin reinstates


class RideCategory(str, Enum):
    MOTO = "moto"
    ECONOMY = "economy"
    COMFORT = "comfort"
    PRESTIGE = "prestige"
    GOLD = "gold"
    PLATINUM = "platinum"

    @property
    def rank(self) -> int:
        return CATEGORY_ORDER.index(self)


CATEGORY_ORDER: list[RideCategory] = [
    RideCategory.MOTO,
    RideCategory.ECONOMY,
    RideCategory.COMFORT,
    RideCategory.PRESTIGE,
    RideCategory.GOLD,
    RideCategory.PLATINUM,
]


class VehicleType(str, Enum):
    MOTO = "moto"
    CAR = "car"


class DocumentType(str, Enum):
    ID_FRONT = "id_front"
    ID_BACK = "id_back"
    SELFIE = "selfie"
    LICENSE = "license"
    VEHICLE_FRONT = "vehicle_front"
    VEHICLE_EXTRA = "vehicle_extra"
    INSURANCE = "insurance"
    OTHER = "other"


class IdDocumentType(str, Enum):
    NATIONAL_ID = "national_id"
    PASSPORT = "passport"


class PayoutMethod(str, Enum):
    MTN_MOMO = "mtn_momo"
    ORANGE_MONEY = "orange_money"
    AIRTEL_MONEY = "airtel_money"
    MOOV_MONEY = "moov_money"
    BANK = "bank"


class PaymentMethod(str, Enum):
    CASH = "cash"
    MTN_MOMO = "mtn_momo"
    ORANGE_MONEY = "orange_money"
    AIRTEL_MONEY = "airtel_money"
    MOOV_MONEY = "moov_money"


class RideStatus(str, Enum):
    REQUESTED = "requested"  # looking for a driver
    ACCEPTED = "accepted"  # driver heading to pickup
    ARRIVED = "arrived"  # driver waiting at pickup
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


ACTIVE_RIDE_STATUSES = (RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS)


class PaymentStatus(str, Enum):
    PENDING = "pending"  # mobile money requested, not yet confirmed
    PAID = "paid"
    FAILED = "failed"


class PayoutStatus(str, Enum):
    REQUESTED = "requested"
    PAID = "paid"
    REJECTED = "rejected"


class DisputeStatus(str, Enum):
    OPEN = "open"
    IN_REVIEW = "in_review"
    RESOLVED = "resolved"
    REJECTED = "rejected"


class Language(str, Enum):
    FR = "fr"
    EN = "en"
