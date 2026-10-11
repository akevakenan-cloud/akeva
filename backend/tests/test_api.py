"""End-to-end API tests against an in-memory MongoDB."""

import pytest

from .conftest import HAVE_API_DEPS, JPEG, PDF

pytestmark = pytest.mark.skipif(not HAVE_API_DEPS, reason="API dependencies not installed")

API = "/api/v1"
CONSENT = {"documents": True, "selfie": True, "version": "2026-10-01"}


def upload(client, headers, doc_type, data=JPEG, name="photo.jpg"):
    r = client.post(f"{API}/me/documents", headers=headers, data={"doc_type": doc_type},
                    files={"file": (name, data, "application/octet-stream")})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def complete_rider(client, headers):
    r = client.patch(f"{API}/me", headers=headers, json={
        "full_name": "Awa Ngono", "country": "CM", "city": "Douala",
        "id_type": "passport", "id_number": "P0012345", "email": "awa@example.com"})
    assert r.status_code == 200, r.text
    assert client.put(f"{API}/me/consent", headers=headers, json=CONSENT).status_code == 200
    upload(client, headers, "selfie")
    upload(client, headers, "id_front")


def complete_driver(client, headers, make="Toyota", model="Corolla", year=2019, vtype="car",
                    plate="LT 456 CD"):
    r = client.patch(f"{API}/me", headers=headers, json={
        "full_name": "Jean Mbarga", "country": "CM", "city": "Yaoundé",
        "id_type": "national_id", "id_number": "CM123456789", "license_number": "DL-998877"})
    assert r.status_code == 200, r.text
    assert client.put(f"{API}/me/consent", headers=headers, json=CONSENT).status_code == 200
    r = client.put(f"{API}/drivers/me/vehicle", headers=headers, json={
        "type": vtype, "make": make, "model": model, "year": year, "color": "Black",
        "plate_number": plate})
    assert r.status_code == 200, r.text
    r2 = client.put(f"{API}/drivers/me/payout", headers=headers, json={
        "method": "mtn_momo", "account_name": "Jean Mbarga", "account_number": "677123456"})
    assert r2.status_code == 200, r2.text
    for t in ("selfie", "id_front", "id_back", "license", "vehicle_front"):
        upload(client, headers, t)
    upload(client, headers, "insurance", PDF, "insurance.pdf")
    return r.json()


def test_rider_registration_and_approval(client, login, admin_headers):
    h = login("+237 677 11 22 33", "rider")
    me = client.get(f"{API}/me", headers=h).json()
    assert me["status"] == "onboarding" and me["phone"] == "+237677112233"

    r = client.post(f"{API}/me/submit", headers=h)
    assert r.status_code == 422
    assert "selfie" in r.json()["detail"]["missing_documents"]

    complete_rider(client, h)
    me = client.get(f"{API}/me", headers=h).json()
    assert me["onboarding"]["can_submit"] is True
    assert me["id_number"].endswith("2345") and "P001" not in me["id_number"]  # masked for owner

    r = client.post(f"{API}/me/submit", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "pending"
    # profile is locked while under review
    assert client.patch(f"{API}/me", headers=h, json={"full_name": "Other"}).status_code == 409

    queue = client.get(f"{API}/admin/users", headers=admin_headers,
                       params={"role": "rider", "status": "pending"}).json()
    assert queue["total"] == 1
    rider_id = queue["items"][0]["id"]

    detail = client.get(f"{API}/admin/users/{rider_id}", headers=admin_headers).json()
    assert detail["id_number"] == "P0012345"  # staff see the full value
    assert set(detail["allowed_actions"]) == {"approve", "reject", "suspend", "ban"}
    selfie = next(d for d in detail["documents"] if d["doc_type"] == "selfie")
    img = client.get(f"{API}/admin/files/{selfie['id']}", headers=admin_headers)
    assert img.status_code == 200 and img.content == JPEG

    r = client.post(f"{API}/admin/users/{rider_id}/status", headers=admin_headers,
                    json={"action": "reject"})
    assert r.status_code == 409  # reason required
    r = client.post(f"{API}/admin/users/{rider_id}/status", headers=admin_headers,
                    json={"action": "approve"})
    assert r.status_code == 200 and r.json()["status"] == "approved"

    logs = client.get(f"{API}/admin/audit-logs", headers=admin_headers).json()["items"]
    actions = {a["action"] for a in logs}
    assert {"rider.approve", "file.view", "staff.login"} <= actions


def test_driver_category_online_and_ban(client, login, admin_headers):
    h = login("+242061234567", "driver")
    result = complete_driver(client, h, make="Mercedes", model="S 580", year=2022)
    assert result["suggested_category"] == "platinum"

    assert client.post(f"{API}/drivers/me/online", headers=h, json={"online": True}).status_code == 403
    assert client.post(f"{API}/me/submit", headers=h).status_code == 200

    driver_id = client.get(f"{API}/me", headers=h).json()["id"]
    r = client.post(f"{API}/admin/users/{driver_id}/category", headers=admin_headers,
                    json={"category": "moto", "reason": "test"})
    assert r.status_code == 422  # a car can't be moto
    r = client.post(f"{API}/admin/users/{driver_id}/category", headers=admin_headers,
                    json={"category": "gold", "reason": "Vehicle condition below Platinum standard"})
    assert r.status_code == 200
    assert r.json()["driver"]["category"] == "gold"
    assert r.json()["driver"]["category_source"] == "admin"
    assert r.json()["payout"]["account_number"] == "677123456"

    client.post(f"{API}/admin/users/{driver_id}/status", headers=admin_headers,
                json={"action": "approve"})
    assert client.post(f"{API}/drivers/me/online", headers=h, json={"online": True}).status_code == 200
    assert client.post(f"{API}/drivers/me/location", headers=h,
                       json={"lat": -4.2634, "lng": 15.2429}).status_code == 204
    live = client.get(f"{API}/admin/live/drivers", headers=admin_headers).json()
    assert live[0]["driver_id"] == driver_id and live[0]["category"] == "gold"

    r = client.post(f"{API}/admin/users/{driver_id}/status", headers=admin_headers,
                    json={"action": "ban", "reason": "Fraudulent documents"})
    assert r.status_code == 200 and r.json()["status"] == "banned"
    assert r.json()["driver"]["online"] is False
    # existing tokens stop working immediately
    assert client.get(f"{API}/me", headers=h).status_code == 401


def test_duplicate_plate_rejected(client, login):
    h1 = login("+237677000111", "driver")
    complete_driver(client, h1, plate="CE 001 AA")
    h2 = login("+237677000222", "driver")
    client.patch(f"{API}/me", headers=h2, json={"full_name": "Paul"})
    r = client.put(f"{API}/drivers/me/vehicle", headers=h2, json={
        "type": "car", "make": "Kia", "model": "Rio", "year": 2015, "color": "Red",
        "plate_number": "ce 001 aa"})
    assert r.status_code == 409


def test_role_separation(client, login, admin_headers):
    rider = login("+23566123456", "rider")
    assert client.get(f"{API}/admin/users", headers=rider, params={"role": "rider"}).status_code == 403
    assert client.put(f"{API}/drivers/me/vehicle", headers=rider, json={
        "type": "moto", "make": "Honda", "year": 2020, "color": "Red",
        "plate_number": "AB123"}).status_code == 403
    # the same phone can hold a separate driver account
    driver = login("+23566123456", "driver")
    assert client.get(f"{API}/me", headers=driver).json()["role"] == "driver"


def test_admin_login_requires_existing_staff(client):
    r = client.post(f"{API}/auth/otp/request", json={"phone": "+237699999999", "app": "admin"})
    assert r.status_code == 200 and "dev_code" not in r.json()
    r = client.post(f"{API}/auth/otp/verify",
                    json={"phone": "+237699999999", "app": "admin", "code": "123456"})
    assert r.status_code == 400


def test_otp_protection(client):
    body = {"phone": "+241 06 12 34 56", "app": "rider"}
    assert client.post(f"{API}/auth/otp/request", json=body).status_code == 200
    r = client.post(f"{API}/auth/otp/request", json=body)
    assert r.status_code == 429 and r.json()["detail"]["code"] == "otp_resend_too_soon"
    for _ in range(5):
        r = client.post(f"{API}/auth/otp/verify",
                        json={"phone": body["phone"], "app": "rider", "code": "000000"})
    assert r.status_code in (400, 429)
    r = client.post(f"{API}/auth/otp/verify",
                    json={"phone": body["phone"], "app": "rider", "code": "000000"})
    assert r.status_code in (400, 429)
    assert client.post(f"{API}/auth/otp/request",
                       json={"phone": "+33612345678", "app": "rider"}).status_code == 422


def test_refresh_rotation_and_reuse_detection(client):
    r = client.post(f"{API}/auth/otp/request", json={"phone": "+236 72 12 34 56", "app": "rider"})
    code = r.json()["dev_code"]
    tokens = client.post(f"{API}/auth/otp/verify", json={
        "phone": "+23672123456", "app": "rider", "code": code}).json()
    r1 = client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r1.status_code == 200
    # replaying the old token revokes the whole family
    assert client.post(f"{API}/auth/refresh",
                       json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post(f"{API}/auth/refresh",
                       json={"refresh_token": r1.json()["refresh_token"]}).status_code == 401


def test_upload_validation(client, login):
    h = login("+240222123456", "rider")
    r = client.post(f"{API}/me/documents", headers=h, data={"doc_type": "selfie"},
                    files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 403  # consent first
    client.put(f"{API}/me/consent", headers=h, json=CONSENT)
    r = client.post(f"{API}/me/documents", headers=h, data={"doc_type": "selfie"},
                    files={"file": ("a.jpg", b"<script>", "image/jpeg")})
    assert r.status_code == 422
    r = client.post(f"{API}/me/documents", headers=h, data={"doc_type": "license"},
                    files={"file": ("a.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 422  # riders don't upload licences


def test_pricing_and_cities(client, admin_headers):
    r = client.post(f"{API}/admin/cities", headers=admin_headers, json={
        "country": "CM", "name": "Douala", "lat": 4.0511, "lng": 9.7679})
    assert r.status_code == 201
    city_id = r.json()["id"]
    r = client.put(f"{API}/admin/pricing", headers=admin_headers, json={
        "country": "CM", "city_id": city_id, "category": "economy", "base_fare": 500,
        "per_km": 250, "per_minute": 25, "minimum_fare": 1000, "multiplier": 1.0,
        "commission_rate": 0.2})
    assert r.status_code == 200
    r = client.post(f"{API}/admin/pricing/preview", headers=admin_headers, json={
        "country": "CM", "city_id": city_id, "category": "economy",
        "distance_km": 8.2, "duration_min": 21})
    assert r.json()["rule_source"] == "city" and r.json()["fare"]["total"] == 3100
    cfg = client.get(f"{API}/config").json()
    cm = next(c for c in cfg["countries"] if c["code"] == "CM")
    assert cm["cities"][0]["name"] == "Douala"
    assert len(cfg["categories"]) == 6


def test_deletion_request_flow(client, login, admin_headers):
    h = login("+237677555666", "rider")
    complete_rider(client, h)
    rider_id = client.get(f"{API}/me", headers=h).json()["id"]
    req = client.post(f"{API}/me/deletion-request", headers=h, json={"reason": "leaving"}).json()
    r = client.post(f"{API}/admin/deletion-requests/{req['id']}/decision",
                    headers=admin_headers, json={"approve": True})
    assert r.status_code == 200 and r.json()["files_purged"] == 2
    assert client.get(f"{API}/admin/users/{rider_id}", headers=admin_headers).status_code == 404
    # the phone can register again as a fresh account
    h2 = login("+237677555666", "rider")
    assert client.get(f"{API}/me", headers=h2).json()["id"] != rider_id


def test_export_csv(client, login, admin_headers):
    login("+237677888999", "rider")
    r = client.get(f"{API}/admin/export/riders.csv", headers=admin_headers)
    assert r.status_code == 200
    assert "+237677888999" in r.text and r.text.startswith("﻿id,")
