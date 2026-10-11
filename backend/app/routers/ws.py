"""WebSocket endpoints. Browsers can't set headers on WebSockets, so the access
token is sent as the first message instead of in the URL (keeps it out of logs)."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..core.deps import user_from_token
from ..domain.enums import Role
from ..services.realtime import ADMIN_LIVE, hub, user_channel

router = APIRouter()


async def _authenticate(ws: WebSocket) -> dict | None:
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        token = json.loads(raw).get("token", "")
        return await user_from_token(token)
    except (asyncio.TimeoutError, ValueError, HTTPException, WebSocketDisconnect):
        return None


@router.websocket("/ws/admin/live")
async def admin_live(ws: WebSocket) -> None:
    await ws.accept()
    user = await _authenticate(ws)
    if user is None or not Role(user["role"]).is_staff:
        await ws.close(code=4401)
        return
    await hub.subscribe(ADMIN_LIVE, ws)
    await ws.send_text(json.dumps({"event": "ready", "data": {}}))
    try:
        while True:
            await ws.receive_text()  # keep-alive pings from the client
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe(ADMIN_LIVE, ws)


@router.websocket("/ws/me")
async def my_events(ws: WebSocket) -> None:
    """Rider/driver event stream: ride offers, status changes, driver location, chat."""
    await ws.accept()
    user = await _authenticate(ws)
    if user is None or Role(user["role"]).is_staff:
        await ws.close(code=4401)
        return
    channel = user_channel(user["_id"])
    await hub.subscribe(channel, ws)
    await ws.send_text(json.dumps({"event": "ready", "data": {}}))
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await hub.unsubscribe(channel, ws)
