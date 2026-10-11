# Akeva mobile apps

Two Expo (React Native) apps in one npm workspace:

| Folder | App | Store ID |
|---|---|---|
| `apps/rider` | Akeva, for passengers | `com.akeva.rider` |
| `apps/driver` | Akeva Driver | `com.akeva.driver` |
| `packages/core` | Shared code: sign-in (SMS/WhatsApp code), registration and document capture, API client, map, FR/EN text, theme | |

## First run

The apps use Mapbox for maps, which needs native code, so they run in a **development build** rather than Expo Go.

```bash
cd mobile
npm install
cd apps/rider && npx expo install --fix   # align library versions with the Expo SDK (once)
cp .env.example .env                      # set EXPO_PUBLIC_API_URL and EXPO_PUBLIC_MAPBOX_TOKEN
export RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk... # secret Mapbox token, needed to build
npx expo run:android                      # or: npx eas build --profile development
```

Repeat in `apps/driver` for the driver app. On a real phone, set `EXPO_PUBLIC_API_URL` to your computer's local network address (for example `http://192.168.1.10:8000/api/v1`), not `localhost`.

## What the apps do

**Rider app**
- Sign in with a code sent by SMS or WhatsApp, with a button to switch channel if it doesn't arrive.
- Register: identity details, explicit consent, then a live selfie (front camera only) and ID photos. Photos are compressed before upload to save mobile data.
- Wait for approval. If the application is rejected, the screen shows the reason and the rider can fix it and resubmit.
- Choose a destination by search or by long-pressing the map, then compare all six categories with upfront prices and pickup times.
- Pay in cash or by Mobile Money (the options depend on the country).
- Follow the ride live, with the driver's name, plate and car; call or message the driver; cancel before pickup.
- Rate the driver and see past rides.

**Driver app**
- Same sign-in. Registration adds vehicle details (with a live preview of the expected category), licence, vehicle photo, insurance (photo or PDF) and payout details.
- Go online or offline. While online, the GPS position is sent every few seconds.
- Ride offers show the pickup distance, the trip and what the driver will earn, with a countdown. Accept or decline.
- During a ride: open turn-by-turn directions in Google Maps or Apple Maps; call or message the rider; mark arrived, start and end the ride; collect cash; rate the rider.
- Earnings dashboard (today, 7 days, 30 days), balance, and withdrawal requests.

Both apps keep the last-known profile and configuration on the phone, so they still open on a bad connection, and they fall back to polling when the live connection drops.

## Not done yet

- **Background location for drivers.** Tracking runs while the app is open. Add `expo-task-manager` background updates so tracking continues while the driver is in Waze or Google Maps.
- **Push notifications.** New ride offers and status changes currently arrive while the app is open. Add `expo-notifications` and send pushes from the API.
- **Mobile Money collection.** Riders choose MTN MoMo, Orange Money and so on, but the payment request to the provider isn't wired in yet. Staff confirm payments in the admin console until the provider APIs are connected.
- **Masked calling.** Riders and drivers see each other's real numbers during a ride. A number-masking service (for example Twilio Proxy) can replace this later.
