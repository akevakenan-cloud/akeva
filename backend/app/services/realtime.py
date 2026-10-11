"""In-process pub/sub for WebSocket clients (live map, ride status).

This works for a single API instance. To run several instances, replace the
body of ``publish`` with a Redis PUBLISH and have each instance relay messages
from a Redis subscription into ``_deliver`` - the WebSocket routes don't change.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("akeva.realtime")


class Hub:
    def __init__(self) -> None:
        self._channels: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, channel: str, ws: WebSocket) -> None:
        async with self._lock:
            self._channels[channel].add(ws)

    async def unsubscribe(self, channel: str, ws: WebSocket) -> None:
        async with self._lock:
            self._channels[channel].discard(ws)
            if not self._channels[channel]:
                self._channels.pop(channel, None)

    async def publish(self, channel: str, event: str, data: dict[str, Any]) -> None:
        await self._deliver(channel, json.dumps({"event": event, "data": data}, default=str))

    async def _deliver(self, channel: str, message: str) -> None:
        dead = []
        for ws in list(self._channels.get(channel, ())):
            try:
                await ws.send_text(message)
            except Exception:  # client went away
                dead.append(ws)
        for ws in dead:
            await self.unsubscribe(channel, ws)


hub = Hub()

ADMIN_LIVE = "admin.live"
