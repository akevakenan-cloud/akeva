"""One-time passcodes sent by SMS. Codes are stored only as keyed hashes."""

from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status

from ..core.config import get_settings
from ..core.db import aware, get_db, new_id, utcnow
from ..domain.crypto import generate_otp, hash_secret, verify_secret
from .sms import get_sms_provider

MESSAGES = {
    "fr": "Votre code Akeva est {code}. Il expire dans {minutes} min. Ne le partagez avec personne.",
    "en": "Your Akeva code is {code}. It expires in {minutes} min. Never share it with anyone.",
}


async def send_otp(phone: str, role: str, language: str = "fr") -> str:
    """Create and send a code. Returns the code (only exposed to callers in dev)."""
    s = get_settings()
    db = get_db()
    existing = await db.otp_codes.find_one({"phone": phone, "role": role})
    if existing and (utcnow() - aware(existing["created_at"])).total_seconds() < s.otp_resend_seconds:
        wait = s.otp_resend_seconds - int((utcnow() - aware(existing["created_at"])).total_seconds())
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            detail={"code": "otp_resend_too_soon", "retry_after": wait})

    code = generate_otp(s.otp_length)
    await db.otp_codes.delete_many({"phone": phone, "role": role})
    await db.otp_codes.insert_one({
        "_id": new_id(),
        "phone": phone,
        "role": role,
        "code_hash": hash_secret(f"{phone}:{role}:{code}", s.otp_pepper),
        "attempts": 0,
        "created_at": utcnow(),
        "expires_at": utcnow() + timedelta(seconds=s.otp_ttl_seconds),
    })
    template = MESSAGES.get(language, MESSAGES["fr"])
    await get_sms_provider().send(phone, template.format(code=code, minutes=s.otp_ttl_seconds // 60))
    return code


async def verify_otp(phone: str, role: str, code: str) -> None:
    s = get_settings()
    db = get_db()
    doc = await db.otp_codes.find_one({"phone": phone, "role": role})
    invalid = HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "otp_invalid"})
    if doc is None or aware(doc["expires_at"]) < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "otp_expired"})
    if doc["attempts"] >= s.otp_max_attempts:
        await db.otp_codes.delete_one({"_id": doc["_id"]})
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            detail={"code": "otp_too_many_attempts"})
    if not verify_secret(f"{phone}:{role}:{code.strip()}", doc["code_hash"], s.otp_pepper):
        await db.otp_codes.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        raise invalid
    await db.otp_codes.delete_one({"_id": doc["_id"]})
