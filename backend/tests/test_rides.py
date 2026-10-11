"""End-to-end ride flow: request -> dispatch -> accept -> track -> complete -> pay -> rate."""

import asyncio
from datetime import timedelta

import pytest

from .conftest import HAVE_API_DEPS

pytestmark = pytest.mark.skipif(not HAVE_API_DEPS, reason="API dependencies not installed")

API = "/api/v1"
DOUALA_AKWA = {"lat": 4.0511, "lng": 9.7008, "address": "Akwa, Douala"}
DOUALA_BONAPRISO = {"lat": 4.0230, "lng": 9.6950, "address": "Bonapriso, Douala"}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def make_user(client, login):
    """Create an approved rider/driver directly in the DB, then sign in through OTP."""
    from app.core.db import get_db, utcnow
    from app.domain.categorization import eligible_for
    from app.domain.enums import RideCategory, Role
    from app.services.users import new_user

    def _make(role: str, phone: str, *, lat=None, lng=None, category="economy", status="approved",
              online=True, name=None):
        user = new_user(phone, "CM", Role(role), full_name=name or f"{role.title()} {phone[-3:]}")
        user["status"] = status
        user["city"] = "Douala"
        if role == "driver":
            cat = RideCategory(category)
            user["vehicle"] = {"type": "moto" if cat is RideCategory.MOTO else "car", "make": "Toyota",
                               "model": "Corolla", "year": 2019, "color": "White",
                               "plate_number": f"LT {phone[-4:]} A"}
            user["payout"] = {"method": "mtn_momo", "account_name": "X", "account_number": "677000000"}
            user["driver"].update({
                "category": cat.value, "eligible_categories": [c.value for c in eligible_for(cat)],
                "online": online,
                "location": {"type": "Point", "coordinates": [lng, lat]} if lat is not None else None,
                "location_updated_at": utcnow() if lat is not None else None,
            })
        run(get_db().users.insert_one(user))
        headers = login(phone, role)
        return user["_id"], headers

    return _make


def request_ride(client, rider_h, **extra):
    body = {"pickup": DOUALA_AKWA, "dropoff": DOUALA_BONAPRISO, "category": "economy", **extra}
    r = client.post(f"{API}/rides", headers=rider_h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_full_cash_ride(client, make_user):
    from app.core.db import get_db

    _, rider = make_user("rider", "+237677100001", name="Awa Ngono")
    driver_id, driver = make_user("driver", "+237677100002", lat=4.0550, lng=9.7020)

    est = client.post(f"{API}/rides/estimate", headers=rider, json={
        "pickup": DOUALA_AKWA, "dropoff": DOUALA_BONAPRISO}).json()
    economy = next(o for o in est["options"] if o["category"] == "economy")
    assert economy["available"] and economy["fare"] > 0
    assert next(o for o in est["options"] if o["category"] == "gold")["available"] is False
    assert len(est["options"]) == 6

    ride = request_ride(client, rider)
    assert ride["status"] == "requested" and ride["estimate"]["fare"]["total"] == economy["fare"]

    offers = client.get(f"{API}/drivers/me/offers", headers=driver).json()
    assert len(offers) == 1 and offers[0]["ride_id"] == ride["id"]
    assert "phone" not in str(offers[0]) and offers[0]["rider_first_name"] == "Awa"

    r = client.post(f"{API}/rides/{ride['id']}/accept", headers=driver)
    assert r.status_code == 200 and r.json()["status"] == "accepted"
    assert r.json()["rider"]["phone"] == "+237677100001"  # driver can call the rider now

    active = client.get(f"{API}/rides/active", headers=rider).json()
    assert active["driver"]["vehicle"]["plate_number"] and active["driver"]["phone"]
    assert client.post(f"{API}/drivers/me/online", headers=driver, json={"online": False}).status_code == 409

    # chat during the ride
    assert client.post(f"{API}/rides/{ride['id']}/messages", headers=rider,
                       json={"text": "Je suis devant la pharmacie"}).status_code == 201
    msgs = client.get(f"{API}/rides/{ride['id']}/messages", headers=driver).json()
    assert msgs[0]["sender_role"] == "rider"

    assert client.post(f"{API}/rides/{ride['id']}/start", headers=driver).status_code == 409  # not arrived
    assert client.post(f"{API}/rides/{ride['id']}/arrive", headers=driver).json()["status"] == "arrived"
    assert client.post(f"{API}/rides/{ride['id']}/start", headers=driver).json()["status"] == "in_progress"
    assert client.post(f"{API}/rides/{ride['id']}/cancel", headers=rider, json={}).status_code == 409

    # drive south, reporting GPS
    for lat in (4.0511, 4.0450, 4.0390, 4.0330, 4.0270, 4.0230):
        assert client.post(f"{API}/drivers/me/location", headers=driver,
                           json={"lat": lat, "lng": 9.6990}).status_code == 204
    tracked = run(get_db().rides.find_one({"_id": ride["id"]}))["tracked_km"]
    assert 2.5 < tracked < 3.5
    seen = client.get(f"{API}/rides/{ride['id']}", headers=rider).json()
    assert seen["driver_location"]["lat"] == 4.0230

    done = client.post(f"{API}/rides/{ride['id']}/complete", headers=driver).json()
    assert done["status"] == "completed" and done["payment"]["status"] == "paid"
    fare = done["fare"]
    assert fare["total"] <= -(-ride["estimate"]["fare"]["total"] * 13 // 10) + 50
    assert client.post(f"{API}/rides/{ride['id']}/messages", headers=rider,
                       json={"text": "merci"}).status_code == 409  # chat closes

    # ratings, once each
    assert client.post(f"{API}/rides/{ride['id']}/rating", headers=rider, json={"stars": 5}).status_code == 200
    assert client.post(f"{API}/rides/{ride['id']}/rating", headers=rider, json={"stars": 1}).status_code == 409
    assert client.post(f"{API}/rides/{ride['id']}/rating", headers=driver, json={"stars": 4}).status_code == 200
    driver_doc = run(get_db().users.find_one({"_id": driver_id}))
    assert driver_doc["rating"] == {"avg": 5.0, "count": 1}
    assert driver_doc["driver"]["current_ride_id"] is None

    # cash ride: driver owes the commission
    earn = client.get(f"{API}/drivers/me/earnings", headers=driver).json()
    assert earn["balance"] == -fare["commission"]
    assert earn["summary"]["today"]["rides"] == 1
    assert earn["summary"]["today"]["earnings"] == fare["driver_earnings"]

    # after the ride the rider no longer sees the driver's phone
    past = client.get(f"{API}/rides", headers=rider).json()["items"][0]
    assert "phone" not in past["driver"]


def test_only_one_driver_wins_and_busy_drivers_are_skipped(client, make_user):
    _, rider = make_user("rider", "+237677200001")
    _, d1 = make_user("driver", "+237677200002", lat=4.0520, lng=9.7010)
    _, d2 = make_user("driver", "+237677200003", lat=4.0530, lng=9.7010)
    ride = request_ride(client, rider)
    assert client.post(f"{API}/rides/{ride['id']}/accept", headers=d1).status_code == 200
    r = client.post(f"{API}/rides/{ride['id']}/accept", headers=d2)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ride_no_longer_available"
    assert client.get(f"{API}/drivers/me/offers", headers=d1).json() == []  # busy

    # a second rider's request goes to d2 only
    _, rider2 = make_user("rider", "+237677200004")
    ride2 = request_ride(client, rider2)
    assert [o["ride_id"] for o in client.get(f"{API}/drivers/me/offers", headers=d2).json()] == [ride2["id"]]


def test_rider_rules(client, make_user):
    _, pending = make_user("rider", "+237677300001", status="pending")
    r = client.post(f"{API}/rides", headers=pending, json={
        "pickup": DOUALA_AKWA, "dropoff": DOUALA_BONAPRISO, "category": "economy"})
    assert r.status_code == 403
    _, rider = make_user("rider", "+237677300002")
    request_ride(client, rider)
    r = client.post(f"{API}/rides", headers=rider, json={
        "pickup": DOUALA_AKWA, "dropoff": DOUALA_BONAPRISO, "category": "economy"})
    assert r.status_code == 409  # one ride at a time
    r = client.post(f"{API}/rides", headers=rider, json={
        "pickup": DOUALA_AKWA, "dropoff": DOUALA_BONAPRISO, "category": "economy",
        "payment_method": "airtel_money"})
    assert r.status_code in (409, 422)
    # cancelling before a driver accepts is free and allowed
    active = client.get(f"{API}/rides/active", headers=rider).json()
    assert client.post(f"{API}/rides/{active['id']}/cancel", headers=rider,
                       json={"reason": "changed my mind"}).json()["status"] == "cancelled"


def test_dispatch_waves_and_timeout(client, make_user):
    from app.core.db import get_db, utcnow
    from app.services.rides import dispatch_tick

    _, rider = make_user("rider", "+237677400001")
    _, far = make_user("driver", "+237677400002", lat=4.1230, lng=9.7008)  # ~8 km away
    ride = request_ride(client, rider)
    assert client.get(f"{API}/drivers/me/offers", headers=far).json() == []  # wave 1: 5 km

    run(get_db().rides.update_one({"_id": ride["id"]},
                                  {"$set": {"created_at": utcnow() - timedelta(seconds=25)}}))
    # keep the driver's GPS fresh
    run(get_db().users.update_many({"role": "driver"}, {"$set": {"driver.location_updated_at": utcnow()}}))
    run(dispatch_tick())
    assert [o["ride_id"] for o in client.get(f"{API}/drivers/me/offers", headers=far).json()] == [ride["id"]]

    run(get_db().rides.update_one({"_id": ride["id"]},
                                  {"$set": {"created_at": utcnow() - timedelta(seconds=200)}}))
    run(dispatch_tick())
    gone = client.get(f"{API}/rides/{ride['id']}", headers=rider).json()
    assert gone["status"] == "cancelled" and gone["cancel_reason"] == "no_driver_available"


def test_mobile_money_payment_and_payouts(client, make_user, admin_headers):
    _, rider = make_user("rider", "+237677500001")
    driver_id, driver = make_user("driver", "+237677500002", lat=4.0520, lng=9.7010)
    ride = request_ride(client, rider, payment_method="mtn_momo")
    for step in ("accept", "arrive", "start"):
        client.post(f"{API}/rides/{ride['id']}/{step}", headers=driver)
    done = client.post(f"{API}/rides/{ride['id']}/complete", headers=driver).json()
    assert done["payment"] == {"method": "mtn_momo", "status": "pending"}
    assert client.get(f"{API}/drivers/me/earnings", headers=driver).json()["balance"] == 0

    r = client.post(f"{API}/admin/rides/{ride['id']}/payment", headers=admin_headers,
                    json={"paid": True, "reference": "MOMO-123"})
    assert r.status_code == 200 and r.json()["payment"]["status"] == "paid"
    balance = client.get(f"{API}/drivers/me/earnings", headers=driver).json()["balance"]
    assert balance == done["fare"]["driver_earnings"]

    assert client.post(f"{API}/drivers/me/payouts", headers=driver,
                       json={"amount": balance + 1000}).status_code == 422
    p = client.post(f"{API}/drivers/me/payouts", headers=driver, json={"amount": 1000}).json()
    assert client.get(f"{API}/drivers/me/earnings", headers=driver).json()["balance"] == balance - 1000
    assert client.post(f"{API}/drivers/me/payouts", headers=driver, json={"amount": 1000}).status_code == 409

    queue = client.get(f"{API}/admin/payouts", headers=admin_headers).json()
    assert queue[0]["destination"]["account_number"] == "677000000"
    assert client.post(f"{API}/admin/payouts/{p['id']}/decision", headers=admin_headers,
                       json={"approve": True}).status_code == 422  # needs a transfer reference
    client.post(f"{API}/admin/payouts/{p['id']}/decision", headers=admin_headers,
                json={"approve": False, "note": "Wrong account name"})
    assert client.get(f"{API}/drivers/me/earnings", headers=driver).json()["balance"] == balance


def test_admin_can_cancel_ride_in_progress(client, make_user, admin_headers):
    _, rider = make_user("rider", "+237677600001")
    _, driver = make_user("driver", "+237677600002", lat=4.0520, lng=9.7010)
    ride = request_ride(client, rider)
    for step in ("accept", "arrive", "start"):
        client.post(f"{API}/rides/{ride['id']}/{step}", headers=driver)
    r = client.post(f"{API}/admin/rides/{ride['id']}/cancel", headers=admin_headers,
                    json={"reason": "Safety report from rider"})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"{API}/drivers/me/online", headers=driver, json={"online": False}).status_code == 200
    logs = client.get(f"{API}/admin/audit-logs", headers=admin_headers, params={"action": "ride."}).json()
    assert logs["items"][0]["action"] == "ride.cancel"
