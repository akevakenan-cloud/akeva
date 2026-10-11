"""FastAPI dependencies for authentication and role-based access control."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..domain.enums import AccountStatus, Role
from .db import get_db
from .security import TokenError, decode_access_token

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(code: str = "unauthorized") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail={"code": code},
                         headers={"WWW-Authenticate": "Bearer"})


async def user_from_token(token: str) -> dict:
    try:
        payload = decode_access_token(token)
    except TokenError:
        raise _unauthorized("invalid_token")
    user = await get_db().users.find_one({"_id": payload["sub"], "deleted_at": None})
    if user is None or user.get("token_version", 0) != payload.get("tv"):
        raise _unauthorized("session_revoked")
    if user["status"] == AccountStatus.BANNED.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "account_banned"})
    return user


async def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict:
    if creds is None:
        raise _unauthorized()
    return await user_from_token(creds.credentials)


CurrentUser = Annotated[dict, Depends(current_user)]


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    async def dep(user: CurrentUser) -> dict:
        if user["role"] not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail={"code": "forbidden"})
        return user

    return dep


Driver = Annotated[dict, Depends(require_roles(Role.DRIVER))]
Rider = Annotated[dict, Depends(require_roles(Role.RIDER))]
Staff = Annotated[dict, Depends(require_roles(Role.ADMIN, Role.SUPER_ADMIN))]
SuperAdmin = Annotated[dict, Depends(require_roles(Role.SUPER_ADMIN))]
