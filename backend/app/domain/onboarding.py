"""What each role must provide before an application can be submitted."""

from __future__ import annotations

from dataclasses import dataclass

from .enums import DocumentType, IdDocumentType, Role, VehicleType

CONSENT_VERSION = "2026-10-01"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Magic-byte signatures; the declared content type is never trusted on its own.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"%PDF-", "application/pdf"),
]

ALLOWED_TYPES: dict[DocumentType, set[str]] = {
    DocumentType.SELFIE: {"image/jpeg", "image/png", "image/webp"},
    DocumentType.ID_FRONT: {"image/jpeg", "image/png", "image/webp", "application/pdf"},
    DocumentType.ID_BACK: {"image/jpeg", "image/png", "image/webp", "application/pdf"},
    DocumentType.LICENSE: {"image/jpeg", "image/png", "image/webp", "application/pdf"},
    DocumentType.VEHICLE_FRONT: {"image/jpeg", "image/png", "image/webp"},
    DocumentType.VEHICLE_EXTRA: {"image/jpeg", "image/png", "image/webp"},
    DocumentType.INSURANCE: {"image/jpeg", "image/png", "image/webp", "application/pdf"},
    DocumentType.OTHER: {"image/jpeg", "image/png", "image/webp", "application/pdf"},
}


def sniff_content_type(data: bytes) -> str | None:
    for sig, ctype in _SIGNATURES:
        if data.startswith(sig):
            return ctype
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class UploadRejected(ValueError):
    pass


def validate_upload(doc_type: DocumentType, data: bytes) -> str:
    if not data:
        raise UploadRejected("file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise UploadRejected(f"file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    ctype = sniff_content_type(data)
    if ctype is None or ctype not in ALLOWED_TYPES[doc_type]:
        raise UploadRejected(f"file type not allowed for {doc_type.value}")
    return ctype


@dataclass(frozen=True)
class Missing:
    fields: list[str]
    documents: list[str]

    @property
    def ok(self) -> bool:
        return not self.fields and not self.documents


def required_documents(role: Role, id_type: IdDocumentType | None,
                       vehicle_type: VehicleType | None = None) -> set[DocumentType]:
    docs = {DocumentType.SELFIE, DocumentType.ID_FRONT}
    if id_type is IdDocumentType.NATIONAL_ID:
        docs.add(DocumentType.ID_BACK)
    if role is Role.DRIVER:
        docs |= {DocumentType.LICENSE, DocumentType.VEHICLE_FRONT, DocumentType.INSURANCE}
    return docs


def missing_requirements(role: Role, profile: dict, documents: set[DocumentType]) -> Missing:
    """Check a driver/rider profile document (as stored in Mongo) for completeness."""
    fields: list[str] = []
    for key in ("full_name", "id_type", "id_number", "country", "city"):
        if not profile.get(key):
            fields.append(key)

    consent = profile.get("consent") or {}
    if not (consent.get("documents") and consent.get("selfie")):
        fields.append("consent")

    id_type = IdDocumentType(profile["id_type"]) if profile.get("id_type") else None
    vehicle_type = None
    if role is Role.DRIVER:
        if not profile.get("license_number"):
            fields.append("license_number")
        vehicle = profile.get("vehicle") or {}
        for key in ("type", "make", "model", "year", "color", "plate_number"):
            if not vehicle.get(key):
                fields.append(f"vehicle.{key}")
        if vehicle.get("type"):
            vehicle_type = VehicleType(vehicle["type"])
        payout = profile.get("payout") or {}
        if not payout.get("method") or not payout.get("account_number"):
            fields.append("payout")

    needed = required_documents(role, id_type, vehicle_type)
    docs_missing = sorted(d.value for d in needed - documents)
    return Missing(fields=fields, documents=docs_missing)
