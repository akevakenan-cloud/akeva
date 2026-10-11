"""Create the first super-admin (run once per environment).

    python -m app.scripts.create_superadmin --phone "+237677000000" --name "Jane Admin"
"""

from __future__ import annotations

import argparse
import asyncio

from ..core import db
from ..domain.countries import normalize_phone
from ..domain.enums import Role
from ..services import audit
from ..services.users import new_user


async def main(phone: str, name: str) -> None:
    database = await db.connect()
    p = normalize_phone(phone)
    existing = await database.users.find_one({"phone": p.e164, "role": Role.SUPER_ADMIN.value})
    if existing:
        print(f"Super-admin {p.e164} already exists ({existing['_id']}).")
        return
    user = new_user(p.e164, p.country, Role.SUPER_ADMIN, full_name=name)
    await database.users.insert_one(user)
    await audit.record(None, "staff.bootstrap", "user", user["_id"], after={"phone": p.e164})
    print(f"Created super-admin {name} <{p.e164}> ({user['_id']}). Sign in with an OTP.")
    await db.disconnect()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--phone", required=True)
    ap.add_argument("--name", required=True)
    args = ap.parse_args()
    asyncio.run(main(args.phone, args.name))
