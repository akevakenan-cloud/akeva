"""Pluggable SMS delivery for OTP codes.

Pick a provider with AKEVA_SMS_PROVIDER. "console" only logs the message and
is refused in production by config validation.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from ..core.config import Settings, get_settings

log = logging.getLogger("akeva.sms")


class SmsError(Exception):
    pass


class SmsProvider(Protocol):
    async def send(self, to_e164: str, message: str) -> None: ...


class ConsoleSms:
    sent: list[tuple[str, str]] = []  # inspected by tests

    async def send(self, to_e164: str, message: str) -> None:
        ConsoleSms.sent.append((to_e164, message))
        log.warning("DEV SMS to %s: %s", to_e164, message)


class AfricasTalkingSms:
    URL = "https://api.africastalking.com/version1/messaging"

    def __init__(self, s: Settings):
        self.username, self.api_key, self.sender = (
            s.africastalking_username, s.africastalking_api_key, s.sms_sender_id)

    async def send(self, to_e164: str, message: str) -> None:
        data = {"username": self.username, "to": to_e164, "message": message}
        if self.sender:
            data["from"] = self.sender
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(self.URL, data=data, headers={
                "apiKey": self.api_key, "Accept": "application/json"})
        if r.status_code >= 300:
            raise SmsError(f"Africa's Talking returned {r.status_code}")


class TwilioSms:
    def __init__(self, s: Settings):
        self.sid, self.token, self.sender = (
            s.twilio_account_sid, s.twilio_auth_token, s.twilio_from_number)

    async def send(self, to_e164: str, message: str) -> None:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, auth=(self.sid, self.token),
                                  data={"To": to_e164, "From": self.sender, "Body": message})
        if r.status_code >= 300:
            raise SmsError(f"Twilio returned {r.status_code}")


def get_sms_provider() -> SmsProvider:
    s = get_settings()
    if s.sms_provider == "africastalking":
        return AfricasTalkingSms(s)
    if s.sms_provider == "twilio":
        return TwilioSms(s)
    return ConsoleSms()
