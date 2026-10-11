"""Phone OTP login for all three apps.

The ``app`` field decides which account the phone signs into: the rider app
and driver app create an account on first login; the admin console only
accepts phones that a super-admin has already registered as staff.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pymongo.errors import DuplicateKeyError

from ..core.config import get_settings
from ..core.db import get_db
from ..core.deps import CurrentUser
from ..core.ratelimit import client_ip, hit
from ..core.security import (
    TokenError,
    create_access_token,
    issue_refresh_token,
    revoke_all_tokens,
    rotate_refresh_token,
)
from ..domain.countries import InvalidPhoneNumber, normalize_phone
from ..domain.enums import Role
from ..models.schemas import OtpRequestIn, OtpVerifyIn, RefreshIn, TokenOut
from ..services import audit
from ..services.otp import send_otp, verify_otp
from ..services.users import new_user, serialize_user

router = APIRouter(prefix="/auth", tags=["auth"])

STAFF_ROLES = [Role.ADMIN.value, Role.SUPER_ADMIN.value]


def _phone(raw: str, country: str | None) -> str:
    try:
        return normalize_phone(raw, country).e164
    except InvalidPhoneNumber:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"code": "invalid_phone"})


async def _staff_account(phone: str) -> dict | None:
    return await get_db().users.find_one(
        {"phone": phone, "role": {"$in": STAFF_ROLES}, "deleted_at": None})


@router.post("/otp/request")
async def request_otp(body: OtpRequestIn, request: Request) -> dict:
    s = get_settings()
    phone = _phone(body.phone, body.country)
    await hit("otp_ip", client_ip(request), s.otp_requests_per_ip_per_hour, 3600)
    await hit("otp_phone", phone, s.otp_requests_per_phone_per_hour, 3600)

    otp_role = "staff" if body.app == "admin" else body.app
    if body.app == "admin" and await _staff_account(phone) is None:
        # Same response as success so the endpoint can't be used to find staff phones.
        return {"sent": True, "phone": phone, "expires_in": s.otp_ttl_seconds}

    code = await send_otp(phone, otp_role, body.language.value)
    out = {"sent": True, "phone": phone, "expires_in": s.otp_ttl_seconds}
    if s.is_dev and s.sms_provider == "console":
        out["dev_code"] = code  # convenience for local development only
    return out


@router.post("/otp/verify", response_model=TokenOut)
async def verify(body: OtpVerifyIn, request: Request) -> TokenOut:
    phone = _phone(body.phone, body.country)
    await hit("otp_verify_ip", client_ip(request), 60, 3600)
    db = get_db()

    if body.app == "admin":
        await verify_otp(phone, "staff", body.code)
        user = await _staff_account(phone)
        if user is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "otp_invalid"})
        await audit.record(user, "staff.login", "user", user["_id"], ip=client_ip(request))
    else:
        await verify_otp(phone, body.app, body.code)
        role = Role(body.app)
        user = await db.users.find_one({"phone": phone, "role": role.value, "deleted_at": None})
        if user is None:
            user = new_user(phone, normalize_phone(phone).country, role)
            try:
                await db.users.insert_one(user)
            except DuplicateKeyError:
                user = await db.users.find_one({"phone": phone, "role": role.value})

    if user["status"] == "banned":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "account_banned"})

    return TokenOut(
        access_token=create_access_token(user),
        refresh_token=await issue_refresh_token(user),
        user=serialize_user(user),
    )


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn) -> TokenOut:
    try:
        user, new_refresh = await rotate_refresh_token(body.refresh_token)
    except TokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": "invalid_refresh_token"})
    if user["status"] == "banned":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "account_banned"})
    return TokenOut(access_token=create_access_token(user), refresh_token=new_refresh,
                    user=serialize_user(user))


@router.post("/logout")
async def logout(user: CurrentUser) -> dict:
    """Signs the user out on every device."""
    await revoke_all_tokens(user["_id"])
    return {"ok": True}
