"""Pluggable delivery of login codes by SMS and WhatsApp.

Pick the SMS provider with AKEVA_SMS_PROVIDER. "console" only logs messages
(SMS and WhatsApp) and is refused in production by config validation.
WhatsApp goes through Twilio and is switched on with AKEVA_WHATSAPP_ENABLED.
"""

from __future__ import annotations

import json
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


def _twilio_error(r: httpx.Response, what: str) -> SmsError:
    # Twilio's error code (e.g. 21612 unsupported route, 63016 template issue) helps diagnosis.
    try:
        code = r.json().get("code")
    except ValueError:
        code = None
    log.error("Twilio %s send failed: HTTP %s, Twilio code %s", what, r.status_code, code)
    return SmsError(f"Twilio {what} returned {r.status_code} (code {code})")


class TwilioSms:
    """Sends through a Messaging Service if configured, else from a number or sender ID.

    Alphanumeric sender IDs ("AKEVA") are only accepted in some countries and may
    need registration; a Messaging Service lets Twilio pick a valid sender per country.
    """

    def __init__(self, s: Settings):
        self.sid, self.token = s.twilio_account_sid, s.twilio_auth_token
        self.service_sid = s.twilio_messaging_service_sid
        self.sender = s.twilio_from_number or s.sms_sender_id

    async def send(self, to_e164: str, message: str) -> None:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        data = {"To": to_e164, "Body": message}
        if self.service_sid:
            data["MessagingServiceSid"] = self.service_sid
        else:
            data["From"] = self.sender
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, auth=(self.sid, self.token), data=data)
        if r.status_code >= 300:
            raise _twilio_error(r, "SMS")


class CodeSender(Protocol):
    """WhatsApp only allows pre-approved templates, so it receives the code, not free text."""

    async def send_code(self, to_e164: str, code: str, language: str) -> None: ...


class ConsoleWhatsApp:
    sent: list[tuple[str, str, str]] = []  # inspected by tests

    async def send_code(self, to_e164: str, code: str, language: str) -> None:
        ConsoleWhatsApp.sent.append((to_e164, code, language))
        log.warning("DEV WHATSAPP to %s (%s): code %s", to_e164, language, code)


class TwilioWhatsApp:
    """Sends a WhatsApp "authentication" template through Twilio's Content API.

    Meta fixes the wording of authentication templates (e.g. "123456 is your
    verification code"), translated per language; the code is variable {{1}}.
    """

    def __init__(self, s: Settings):
        self.sid, self.token = s.twilio_account_sid, s.twilio_auth_token
        self.sender = s.twilio_whatsapp_from
        self.templates = {"fr": s.twilio_whatsapp_content_sid_fr, "en": s.twilio_whatsapp_content_sid_en}

    async def send_code(self, to_e164: str, code: str, language: str) -> None:
        content_sid = self.templates.get(language) or self.templates["fr"] or self.templates["en"]
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json"
        sender = self.sender if self.sender.startswith("whatsapp:") else f"whatsapp:{self.sender}"
        data = {
            "To": f"whatsapp:{to_e164}",
            "From": sender,
            "ContentSid": content_sid,
            "ContentVariables": json.dumps({"1": code}),
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, auth=(self.sid, self.token), data=data)
        if r.status_code >= 300:
            raise _twilio_error(r, "WhatsApp")


def get_whatsapp_sender() -> CodeSender:
    s = get_settings()
    if s.sms_provider == "console":
        return ConsoleWhatsApp()
    return TwilioWhatsApp(s)


def get_sms_provider() -> SmsProvider:
    s = get_settings()
    if s.sms_provider == "africastalking":
        return AfricasTalkingSms(s)
    if s.sms_provider == "twilio":
        return TwilioSms(s)
    return ConsoleSms()
