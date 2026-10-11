"""Which channel (SMS or WhatsApp) delivers a login code.

Default: SMS, except in countries listed as "WhatsApp first" (used while an
SMS sender ID is awaiting operator registration). The app can also ask for a
specific channel, e.g. a "Send by WhatsApp instead" button. If the first
channel fails to send, the other one is tried.
"""

from __future__ import annotations

from enum import Enum


class Channel(str, Enum):
    SMS = "sms"
    WHATSAPP = "whatsapp"


class ChannelUnavailable(ValueError):
    pass


def channel_order(
    requested: Channel | str | None,
    country: str,
    whatsapp_enabled: bool,
    whatsapp_first_countries: set[str],
) -> list[Channel]:
    """Channels to try, in order. Raises if the requested channel is switched off."""
    if requested is not None:
        requested = Channel(requested)
        if requested is Channel.WHATSAPP and not whatsapp_enabled:
            raise ChannelUnavailable("WhatsApp delivery is not enabled")
        primary = requested
    elif whatsapp_enabled and country.upper() in whatsapp_first_countries:
        primary = Channel.WHATSAPP
    else:
        primary = Channel.SMS

    if not whatsapp_enabled:
        return [Channel.SMS]
    other = Channel.SMS if primary is Channel.WHATSAPP else Channel.WHATSAPP
    return [primary, other]


def parse_countries(raw: str) -> set[str]:
    return {c.strip().upper() for c in raw.split(",") if c.strip()}
