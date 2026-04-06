# Firebase Sensor Dashboard (Vite + React)

This project renders a real-time environmental dashboard from Firebase Realtime Database data.

## What it includes

- Live Firebase subscription (`onValue`) for continuous updates
- Sensor cards for all metrics in the latest reading
- Quality index gauge inspired by your reference layout
- Daily, weekly, and monthly charts (Recharts)
- Automatic fallback to `public/firebase-export.json` when Firebase config is missing or connection fails

## 1) Install and run

```bash
npm install
npm run dev
```

## 2) Firebase setup

1. Copy `.env.example` to `.env`.
2. Fill all `VITE_FIREBASE_*` values from your Firebase project settings.
3. Optionally set `VITE_FIREBASE_USER_ID` to a specific user id.

Without `.env`, the app will still run using the exported JSON fallback.

## 3) Data shape expected

The app expects readings like:

```json
{
  "UsersData": {
    "<userId>": {
      "readings": {
        "1773119203": {
          "temperature": 26.2,
          "humidity": 60.1,
          "timestamp": 1773119203
        }
      }
    }
  }
}
```

## 4) Build for production

```bash
npm run build
npm run preview
```
# sensorMonitor
