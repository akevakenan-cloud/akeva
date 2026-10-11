# Akeva

Ride-hailing platform for Central Africa: Cameroon, Chad, Gabon, Equatorial Guinea, the Central African Republic and the Republic of the Congo. Prices are in XAF, and the interfaces are available in French and English.

| Part | Stack | Status |
|---|---|---|
| `backend/` | FastAPI, MongoDB (Motor), JWT and phone OTP | Phase 1 done |
| `admin/` | Next.js 15 (App Router), TypeScript, Mapbox GL | Phase 1 done |
| `apps/driver`, `apps/rider` | Expo / React Native | Phase 2 |

All three apps share one API, one database and one login system (phone number plus SMS code).

## What phase 1 covers

- **Registration logic for riders and drivers.** Applicants sign in with an OTP and fill in their profile. They give explicit consent before uploading documents. Drivers add their vehicle and payout details. Applicants then submit and wait for review.
- **Account status machine.** The states are `onboarding → pending → approved`, with `rejected`, `suspended` and `banned`. Rejecting, suspending and banning all require a reason. Only a super-admin can lift a ban. Suspending or banning an account signs it out everywhere immediately and takes a driver offline.
- **Automatic ride categories.** The category is suggested from the vehicle type, year, make and model (see below). An admin can override it, and the override is kept even if the driver changes their vehicle later.
- **Admin console.** It includes:
  - Approval queues, where the oldest application is shown first.
  - A review screen showing every document, the selfie and the vehicle photos.
  - Category override.
  - A live driver map.
  - Pricing per country, city and category, with a fare simulator.
  - Cities, rides, finance, disputes, the audit log, team management, data-deletion requests and CSV exports.
- **Security.**
  - Documents and selfies are encrypted at rest with AES-256-GCM. ID numbers and payout accounts are encrypted field by field.
  - Every document view and admin action goes to the audit log.
  - OTP codes are stored only as keyed hashes. OTP requests and uploads are rate-limited.
  - Refresh tokens rotate, and reusing an old one is detected.
  - Uploads are checked by their actual file bytes, not by the declared file type.
  - Users can ask to be forgotten. Approving the request erases their documents and anonymises the account while keeping ride history.

### Ride categories

| Category | Rule |
|---|---|
| Moto | Any motorcycle |
| Economy | Any car that doesn't qualify for a higher category |
| Comfort | Car from 2014 or newer |
| Prestige | Car from 2018 or newer |
| Gold | Internationally known luxury brand from 2015 or newer (Mercedes-Benz, BMW, Audi, Lexus, Porsche, Land Rover…) |
| Platinum | From 2020 or newer, and either an ultra-luxury brand (Rolls-Royce, Bentley, Maybach…) or a flagship model (S-Class, 7 Series, LX, Range Rover…) |

The highest eligible category wins. A car can also take rides in the car categories below its own. The brand and model lists are in `backend/app/domain/categorization.py`.

## Run it locally

You need Docker, or Python 3.12+, Node 22+ and MongoDB 7.

```bash
cp backend/.env.example backend/.env      # the defaults work for local development
docker compose up --build
# Create the first super-admin (use your own phone number):
docker compose exec api python -m app.scripts.create_superadmin --phone "+237690000000" --name "Your Name"
```

Open http://localhost:3000 and sign in with that phone number. While `AKEVA_SMS_PROVIDER=console`, no SMS is sent. The code is shown on the login screen and printed in the API logs.

Without Docker:

```bash
cd backend && python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload          # API docs at http://localhost:8000/docs
pytest                                 # unit and API tests (in-memory MongoDB)

cd admin && cp .env.example .env.local && npm install && npm run dev
```

## Before going to production

Set these in `backend/.env`. The API refuses to start in `AKEVA_ENV=production` if any of them is missing.

- `AKEVA_JWT_SECRET` and `AKEVA_OTP_PEPPER`: two different random strings, each 32 characters or more.
- `AKEVA_STORAGE_KEYS`: the encryption key or keys, as `1:<base64 key>`. Generate a key with `python -c "from app.domain.crypto import generate_key; print(generate_key())"`. Keep the keys in a secret manager. **If you lose a key, every document encrypted with it is lost.** To rotate, add `2:<new key>` and set `AKEVA_STORAGE_CURRENT_KEY_ID=2`; old documents remain readable.
- `AKEVA_SMS_PROVIDER`: `africastalking` or `twilio`, plus that provider's credentials. Check coverage and sender-ID registration rules for each of the six countries with the provider.
- **WhatsApp login codes (optional but recommended):** `AKEVA_WHATSAPP_ENABLED=true`, your WhatsApp-enabled Twilio sender in `AKEVA_TWILIO_WHATSAPP_FROM`, and the `HX…` IDs of an approved WhatsApp *authentication* template (French and English) from Twilio's Content Template Builder. Countries listed in `AKEVA_OTP_WHATSAPP_FIRST_COUNTRIES` get WhatsApp first and every other country gets SMS first. If one channel fails, the other is tried automatically, and the login screens offer "Get the code on WhatsApp / by SMS" once. Remove a country from the list when its SMS sender ID is approved.
- A MongoDB deployment with encryption at rest and backups (for example, MongoDB Atlas).

The following are known limitations, each with a marked extension point in the code:

- **Document storage** uses a local volume. For several API servers, add an S3-compatible backend in `app/services/storage.py`.
- **Live updates** (`app/services/realtime.py`) are single-instance. Switch them to Redis pub/sub when scaling out.
- **Liveness check for selfies** isn't implemented yet. The selfie is stored for manual review. A vendor check (for example Smile ID, which covers Central Africa) can be added at upload time.
- **Mobile Money payouts** (MTN MoMo, Orange Money, Airtel Money) are modelled: payout details are collected and encrypted. The payment-provider integration comes with the ride flow in phase 2.

## Repository layout

```
backend/
  app/domain/      pure business rules: categories, fares, status machine, phones, crypto
  app/services/    OTP/SMS, encrypted storage, audit log, users, pricing, realtime hub
  app/routers/     auth, me (onboarding), drivers, admin, public config, websockets
  tests/           test_domain.py (pure rules), test_api.py (end-to-end with in-memory MongoDB)
admin/
  app/(console)/   overview, drivers, riders, live, rides, finance, disputes,
                   pricing, cities, audit, staff, deletions
  components/      review screen, queues, shared UI
  lib/             API client with token refresh, FR/EN dictionary, formatting
```

## API at a glance (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/otp/request`, `POST /auth/otp/verify` (`app`: rider, driver or admin), `POST /auth/refresh`, `POST /auth/logout` |
| Onboarding | `GET/PATCH /me`, `PUT /me/consent`, `POST /me/documents`, `GET /me/onboarding`, `POST /me/submit`, `POST /me/deletion-request` |
| Drivers | `PUT /drivers/me/vehicle` (returns the suggested category), `PUT /drivers/me/payout`, `POST /drivers/me/online`, `POST /drivers/me/location` |
| Public | `GET /config` (countries, cities, categories, consent version), `POST /vehicles/categorize` |
| Admin | `/admin/overview`, `/admin/users`, `/admin/users/{id}/status`, `/admin/users/{id}/category`, `/admin/files/{id}`, `/admin/live/drivers`, `/admin/rides`, `/admin/finance/summary`, `/admin/disputes`, `/admin/cities`, `/admin/pricing`, `/admin/audit-logs`, `/admin/staff`, `/admin/deletion-requests`, `/admin/export/{dataset}.csv` |
| Realtime | `WS /ws/admin/live`. Send `{"token": "<access token>"}` as the first message. |

Errors always have the form `{"detail": {"code": "...", ...}}`. The apps translate the `code`, so the API never returns user-facing text.
