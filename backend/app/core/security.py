"""JWT access/refresh tokens.

Access tokens are short-lived and carry the user's ``token_version``: bumping
that number (on suspend, ban, logout-everywhere) invalidates every token the
user holds. Refresh tokens are single-use and stored hashed, so a stolen
refresh token is detected when the real client tries to use it.
"""

from __future__ import annotations

import secrets
from datetime import timedelta

import jwt

from ..domain.crypto import hash_secret
from ..domain.enums import Role
from .config import get_settings
from .db import aware, get_db, new_id, utcnow


class TokenError(Exception):
    pass


def create_access_token(user: dict) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": user["_id"],
        "role": user["role"],
        "tv": user.get("token_version", 0),
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_minutes),
        "typ": "access",
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise TokenError("invalid or expired token") from exc
    if payload.get("typ") != "access":
        raise TokenError("wrong token type")
    return payload


async def issue_refresh_token(user: dict, family: str | None = None) -> str:
    s = get_settings()
    raw = secrets.token_urlsafe(48)
    lifetime = (timedelta(hours=s.admin_refresh_token_hours)
                if Role(user["role"]).is_staff else timedelta(days=s.refresh_token_days))
    await get_db().refresh_tokens.insert_one({
        "_id": new_id(),
        "token_hash": hash_secret(raw, s.jwt_secret),
        "user_id": user["_id"],
        "family": family or new_id(),
        "used": False,
        "created_at": utcnow(),
        "expires_at": utcnow() + lifetime,
    })
    return raw


async def rotate_refresh_token(raw: str) -> tuple[dict, str]:
    """Consume a refresh token and return (user, new_refresh_token)."""
    s = get_settings()
    db = get_db()
    doc = await db.refresh_tokens.find_one({"token_hash": hash_secret(raw, s.jwt_secret)})
    if doc is None or aware(doc["expires_at"]) < utcnow():
        raise TokenError("invalid refresh token")
    if doc["used"]:
        # Reuse of a consumed token means it was stolen: revoke the whole family.
        await db.refresh_tokens.delete_many({"family": doc["family"]})
        raise TokenError("refresh token reuse detected")
    await db.refresh_tokens.update_one({"_id": doc["_id"]}, {"$set": {"used": True}})
    user = await db.users.find_one({"_id": doc["user_id"], "deleted_at": None})
    if user is None:
        raise TokenError("account no longer exists")
    return user, await issue_refresh_token(user, family=doc["family"])


async def revoke_all_tokens(user_id: str) -> None:
    db = get_db()
    await db.users.update_one({"_id": user_id}, {"$inc": {"token_version": 1}})
    await db.refresh_tokens.delete_many({"user_id": user_id})
