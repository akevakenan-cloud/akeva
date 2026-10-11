"""Driver money ledger. The balance is what Akeva owes the driver (negative = driver owes Akeva).

* Cash ride: the driver keeps the cash and owes Akeva its commission  -> -commission
* Mobile Money ride (once paid): Akeva holds the money, owes the driver -> +driver_earnings
* Payout requested: the amount is held immediately                    -> -amount
* Payout rejected: the hold is released                                -> +amount
"""

from __future__ import annotations

from ..core.db import get_db, new_id, utcnow


async def add_entry(driver_id: str, kind: str, amount: int, *, ride_id: str | None = None,
                    payout_id: str | None = None, note: str | None = None) -> None:
    await get_db().ledger.insert_one({
        "_id": new_id(), "driver_id": driver_id, "kind": kind, "amount": int(amount),
        "ride_id": ride_id, "payout_id": payout_id, "note": note, "created_at": utcnow(),
    })


async def balance(driver_id: str) -> int:
    total = 0
    async for e in get_db().ledger.find({"driver_id": driver_id}, {"amount": 1}):
        total += e["amount"]
    return total
