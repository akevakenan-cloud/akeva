"""Unit tests for pure business rules (no database, no HTTP)."""

import pytest

from app.domain.categorization import suggest_category
from app.domain.countries import InvalidPhoneNumber, normalize_phone
from app.domain.crypto import (
    DecryptionError,
    Encryptor,
    generate_key,
    generate_otp,
    hash_secret,
    verify_secret,
)
from app.domain.enums import AccountStatus, DocumentType, Role, RideCategory
from app.domain.onboarding import UploadRejected, missing_requirements, validate_upload
from app.domain.pricing import PricingRule, calculate_fare, default_rule
from app.domain.status import TransitionError, allowed_actions, next_status

C = RideCategory


# --- categorization ------------------------------------------------------

CATEGORY_CASES = [
    ("moto", "Honda", "CG 125", 2010, C.MOTO),
    ("car", "Toyota", "Corolla", 2008, C.ECONOMY),
    ("car", "Toyota", "Corolla", 2013, C.ECONOMY),
    ("car", "Toyota", "Corolla", 2014, C.COMFORT),
    ("car", "Hyundai", "Elantra", 2017, C.COMFORT),
    ("car", "Toyota", "Camry", 2018, C.PRESTIGE),
    ("car", "Toyota", "Land Cruiser", 2023, C.PRESTIGE),
    ("car", "Mercedes", "C 300", 2014, C.COMFORT),  # luxury brand but too old for Gold
    ("car", "Mercedes-Benz", "C 300", 2015, C.GOLD),
    ("car", "BMW", "X5", 2021, C.GOLD),  # not a flagship model
    ("car", "Lexus", "RX 350", 2019, C.GOLD),
    ("car", "mercedes benz", "S-Class", 2020, C.PLATINUM),
    ("car", "Mercedes", "S 580", 2022, C.PLATINUM),
    ("car", "Mercedes", "Sprinter", 2022, C.GOLD),  # "S" pattern must not catch Sprinter
    ("car", "Mercedes-Benz", "S-Class", 2019, C.GOLD),
    ("car", "Lexus", "LX 600", 2022, C.PLATINUM),
    ("car", "BMW", "X7 xDrive40i", 2021, C.PLATINUM),
    ("car", "Land Rover", "Range Rover Vogue", 2020, C.PLATINUM),
    ("car", "Land Rover", "Discovery Sport", 2020, C.GOLD),
    ("car", "Rolls Royce", "Ghost", 2020, C.PLATINUM),
    ("car", "Bentley", "Bentayga", 2016, C.GOLD),
    ("car", "Audi", "A80", 2021, C.GOLD),  # prefix of a flagship code is not enough
]


def test_suggest_category_table():
    for vtype, make, model, year, expected in CATEGORY_CASES:
        got = suggest_category(vtype, make, model, year).category
        assert got is expected, f"{make} {model} {year}: expected {expected}, got {got}"


def test_eligible_categories():
    s = suggest_category("car", "Toyota", "Camry", 2019)
    assert s.eligible == [C.ECONOMY, C.COMFORT, C.PRESTIGE]
    assert suggest_category("moto", "Yamaha", "", 2020).eligible == [C.MOTO]


# --- phone numbers --------------------------------------------------------

def test_normalize_phone_international_formats():
    assert normalize_phone("+237 677 12 34 56").e164 == "+237677123456"
    assert normalize_phone("00237677123456").country == "CM"
    assert normalize_phone("+235 66 12 34 56").country == "TD"
    assert normalize_phone("+241 06 12 34 56").country == "GA"
    assert normalize_phone("+240 222 123 456").country == "GQ"
    assert normalize_phone("+236 72 12 34 56").country == "CF"
    assert normalize_phone("+242 06 612 3456").country == "CG"


def test_normalize_phone_local_with_default_country():
    p = normalize_phone("677-12-34-56", default_country="CM")
    assert p.e164 == "+237677123456" and p.country == "CM"


def test_normalize_phone_rejects_unsupported():
    for bad in ["+33612345678", "+2376771234", "", "abc", "12345"]:
        with pytest.raises(InvalidPhoneNumber):
            normalize_phone(bad)


# --- status machine -------------------------------------------------------

def test_status_happy_path():
    s = next_status(AccountStatus.ONBOARDING, "submit", Role.DRIVER)
    assert s is AccountStatus.PENDING
    s = next_status(s, "approve", Role.ADMIN)
    assert s is AccountStatus.APPROVED
    s = next_status(s, "suspend", Role.ADMIN, reason="Customer complaints")
    assert s is AccountStatus.SUSPENDED
    assert next_status(s, "reinstate", Role.ADMIN) is AccountStatus.APPROVED


def test_status_rules():
    with pytest.raises(TransitionError):
        next_status("pending", "approve", Role.DRIVER)  # owners cannot approve themselves
    with pytest.raises(TransitionError):
        next_status("pending", "submit", Role.ADMIN)
    with pytest.raises(TransitionError):
        next_status("pending", "reject", Role.ADMIN)  # reason required
    with pytest.raises(TransitionError):
        next_status("banned", "reinstate", Role.ADMIN)  # super-admin only
    assert next_status("banned", "reinstate", Role.SUPER_ADMIN) is AccountStatus.APPROVED
    with pytest.raises(TransitionError):
        next_status("onboarding", "approve", Role.ADMIN)  # must be submitted first
    assert next_status("rejected", "submit", Role.RIDER) is AccountStatus.PENDING


def test_allowed_actions():
    names = {a.value for a in allowed_actions("pending", Role.ADMIN)}
    assert names == {"approve", "reject", "suspend", "ban"}
    assert "reinstate" not in {a.value for a in allowed_actions("banned", Role.ADMIN)}
    assert "reinstate" in {a.value for a in allowed_actions("banned", Role.SUPER_ADMIN)}


# --- pricing --------------------------------------------------------------

def test_fare_calculation():
    rule = PricingRule(C.ECONOMY, base_fare=500, per_km=250, per_minute=25,
                       minimum_fare=1000, multiplier=1.0, commission_rate=0.2)
    f = calculate_fare(rule, distance_km=8.2, duration_min=21)
    # 500 + 2050 + 525 = 3075 -> rounded up to 3100
    assert f.subtotal == 3100 and f.total == 3100
    assert f.commission == 620 and f.driver_earnings == 2480


def test_fare_minimum_multiplier_and_surge():
    rule = PricingRule(C.GOLD, multiplier=2.0, minimum_fare=3000)
    assert calculate_fare(rule, 0.3, 1).subtotal == 3000
    f = calculate_fare(rule, 10, 20, surge=1.5)
    assert f.subtotal == 3 * (500 + 2500 + 500)
    with pytest.raises(ValueError):
        calculate_fare(rule, 1, 1, surge=0.5)


def test_default_rules_cover_all_categories():
    for cat in C:
        assert default_rule(cat).category is cat


# --- crypto ---------------------------------------------------------------

def test_encrypt_roundtrip_and_tamper_detection():
    k1, k2 = generate_key(), generate_key()
    enc = Encryptor({1: k1}, 1)
    blob = enc.encrypt(b"selfie-bytes", b"file-123")
    assert b"selfie-bytes" not in blob
    assert enc.decrypt(blob, b"file-123") == b"selfie-bytes"
    with pytest.raises(DecryptionError):
        enc.decrypt(blob, b"other-file")  # bound to its file id
    tampered = blob[:-1] + bytes([blob[-1] ^ 1])
    with pytest.raises(DecryptionError):
        enc.decrypt(tampered, b"file-123")
    # key rotation: old blobs stay readable
    rotated = Encryptor({1: k1, 2: k2}, 2)
    assert rotated.decrypt(blob, b"file-123") == b"selfie-bytes"
    assert rotated.encrypt(b"x")[4] == 2


def test_otp_hashing():
    code = generate_otp(6)
    assert len(code) == 6 and code.isdigit()
    digest = hash_secret(code, "pepper")
    assert code not in digest
    assert verify_secret(code, digest, "pepper")
    assert not verify_secret("000000" if code != "000000" else "111111", digest, "pepper")


# --- onboarding -----------------------------------------------------------

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100
PDF = b"%PDF-1.7" + b"0" * 100


def test_validate_upload():
    assert validate_upload(DocumentType.SELFIE, JPEG) == "image/jpeg"
    assert validate_upload(DocumentType.INSURANCE, PDF) == "application/pdf"
    with pytest.raises(UploadRejected):
        validate_upload(DocumentType.SELFIE, PDF)  # selfies must be photos
    with pytest.raises(UploadRejected):
        validate_upload(DocumentType.ID_FRONT, b"MZ\x90\x00 not an image")


def test_missing_requirements_driver():
    profile = {
        "full_name": "Jean Mbarga", "id_type": "national_id", "id_number": "123",
        "country": "CM", "city": "Douala", "license_number": "L-1",
        "consent": {"documents": True, "selfie": True},
        "vehicle": {"type": "car", "make": "Toyota", "model": "Yaris", "year": 2016,
                    "color": "White", "plate_number": "LT 123 AB"},
        "payout": {"method": "mtn_momo", "account_number": "+237677123456"},
    }
    docs = {DocumentType.SELFIE, DocumentType.ID_FRONT, DocumentType.LICENSE,
            DocumentType.VEHICLE_FRONT, DocumentType.INSURANCE}
    m = missing_requirements(Role.DRIVER, profile, docs)
    assert m.fields == [] and m.documents == ["id_back"]  # national ID needs both sides
    assert missing_requirements(Role.DRIVER, profile, docs | {DocumentType.ID_BACK}).ok


def test_missing_requirements_rider_passport():
    profile = {"full_name": "Awa", "id_type": "passport", "id_number": "P1",
               "country": "TD", "city": "N'Djamena", "consent": {"documents": True}}
    m = missing_requirements(Role.RIDER, profile, {DocumentType.SELFIE, DocumentType.ID_FRONT})
    assert m.fields == ["consent"]  # selfie consent missing
    assert m.documents == []


# --- OTP channels -----------------------------------------------------------

def test_channel_order():
    from app.domain.otp_channels import Channel, ChannelUnavailable, channel_order, parse_countries

    first = parse_countries(" cm, CG ,")
    assert first == {"CM", "CG"}
    W, S = Channel.WHATSAPP, Channel.SMS
    assert channel_order(None, "CM", True, first) == [W, S]   # WhatsApp-first country
    assert channel_order(None, "TD", True, first) == [S, W]   # everyone else: SMS first
    assert channel_order("whatsapp", "TD", True, first) == [W, S]  # user asked for WhatsApp
    assert channel_order("sms", "CM", True, first) == [S, W]
    assert channel_order(None, "CM", False, first) == [S]     # WhatsApp switched off
    with pytest.raises(ChannelUnavailable):
        channel_order("whatsapp", "CM", False, first)
