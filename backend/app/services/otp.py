"""One-time passcodes sent by SMS or WhatsApp. Codes are stored only as keyed hashes."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

import httpx
from fastapi import HTTPException, status

from ..core.config import get_settings
from ..core.db import aware, get_db, new_id, utcnow
from ..domain.countries import normalize_phone
from ..domain.crypto import generate_otp, hash_secret, verify_secret
from ..domain.otp_channels import Channel, ChannelUnavailable, channel_order, parse_countries
from .sms import SmsError, get_sms_provider, get_whatsapp_sender

MESSAGES = {
    "fr": "Votre code Akeva est {code}. Il expire dans {minutes} min. Ne le partagez avec personne.",
    "en": "Your Akeva code is {code}. It expires in {minutes} min. Never share it with anyone.",
}


@dataclass
class OtpSent:
    code: str
    channel: Channel
    alternate: Channel | None  # what a "send another way" button should offer


async def _deliver(channel: Channel, phone: str, code: str, language: str) -> None:
    s = get_settings()
    if channel is Channel.WHATSAPP:
        await get_whatsapp_sender().send_code(phone, code, language)
    else:
        template = MESSAGES.get(language, MESSAGES["fr"])
        await get_sms_provider().send(phone, template.format(code=code, minutes=s.otp_ttl_seconds // 60))


async def send_otp(phone: str, role: str, language: str = "fr",
                   channel: Channel | str | None = None) -> OtpSent:
    """Create and send a code, trying the preferred channel first, then the other one."""
    s = get_settings()
    db = get_db()
    try:
        order = channel_order(channel, normalize_phone(phone).country, s.whatsapp_enabled,
                              parse_countries(s.otp_whatsapp_first_countries))
    except ChannelUnavailable:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "channel_unavailable"})

    existing = await db.otp_codes.find_one({"phone": phone, "role": role})
    if existing:
        elapsed = (utcnow() - aware(existing["created_at"])).total_seconds()
        # Switching channel ("send by WhatsApp instead") is allowed once without waiting.
        switching = (channel is not None and Channel(channel).value != existing.get("channel")
                     and not existing.get("switched"))
        if elapsed < s.otp_resend_seconds and not switching:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail={
                "code": "otp_resend_too_soon", "retry_after": s.otp_resend_seconds - int(elapsed)})
        was_switch = switching and elapsed < s.otp_resend_seconds
    else:
        was_switch = False

    code = generate_otp(s.otp_length)
    await db.otp_codes.delete_many({"phone": phone, "role": role})

    used: Channel | None = None
    for ch in order:
        try:
            await _deliver(ch, phone, code, language)
            used = ch
            break
        except (SmsError, httpx.HTTPError):
            continue
    if used is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": "sms_unavailable"})

    # Stored only after a successful send, so an undelivered code never blocks a retry.
    await db.otp_codes.insert_one({
        "_id": new_id(),
        "phone": phone,
        "role": role,
        "channel": used.value,
        "switched": was_switch,
        "code_hash": hash_secret(f"{phone}:{role}:{code}", s.otp_pepper),
        "attempts": 0,
        "created_at": utcnow(),
        "expires_at": utcnow() + timedelta(seconds=s.otp_ttl_seconds),
    })
    alternate = next((c for c in order if c is not used), None)
    return OtpSent(code=code, channel=used, alternate=alternate)


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
