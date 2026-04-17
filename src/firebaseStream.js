import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getDatabase, onValue, ref } from "firebase/database";

let firebaseServices = null;

function getConfig() {
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  };

  const hasRequired = Boolean(
    config.apiKey && config.databaseURL && config.projectId && config.appId,
  );
  return { config, hasRequired };
}

function normalizeReadings(snapshotValue) {
  if (!snapshotValue || typeof snapshotValue !== "object") {
    return [];
  }

  // Direct field name mapping: Firebase field → Normalized field name
  const fieldAliases = {
    // Temperature & Humidity & Pressure (keep as-is)
    temperature: "temperature",
    humidity: "humidity",
    pressure: "pressure",
    altitude: "altitude",

    // UV
    uv_voltage: "uv",

    // Accelerometer (normalize to mpu6050_*)
    accel_x: "mpu6050_accel_x",
    accel_y: "mpu6050_accel_y",
    accel_z: "mpu6050_accel_z",

    // Gyroscope (normalize to mpu6050_*)
    gyro_x: "mpu6050_gyro_x",
    gyro_y: "mpu6050_gyro_y",
    gyro_z: "mpu6050_gyro_z",

    // Rain
    rain_raw: "rain",
    rain_status: "rain_status",

    // MQ5 (normalize to mq5_*)
    lpg_ppm: "mq5",
    // mq5_Rs: "mq5_rs_kohm",

    // MICS5524 (normalize to mics5524_*)
    co_ppm: "mics5524_co_ppm",
    ch4_ppm: "mics5524_ch4_ppm",
    h2_ppm: "mics5524_h2_ppm",
    ethanol_ppm: "mics5524_ethanol_ppm",
    // mics_Rs: "mics5524_rs_kohm",

    // Dust
    dust_density: "dust_density_ugm3",
    dust_voltage: "dust_voltage_v",

    // Wind Direction
    wind_direction_deg: "wind_direction_deg",
    wind_direction_text: "wind_direction_text",
    wind_voltage: "wind_voltage_v",

    // Wind Speed
    wind_speed_kmh: "wind_speed_kmh",
    wind_speed_ms: "wind_speed_ms",

    // Timestamp
    timestamp: "timestamp",
  };

  function coerceReading(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    // Flatten nested data if it exists (for backward compatibility)
    const flattened = {};

    for (const [key, value] of Object.entries(entry)) {
      if (value === null || value === undefined) {
        continue;
      }

      // If it's a nested object, flatten it with sensor group prefix
      if (typeof value === "object" && !Array.isArray(value)) {
        for (const [subKey, subValue] of Object.entries(value)) {
          const aliasKey = `${key}_${subKey}`;
          const alias = fieldAliases[aliasKey] ?? aliasKey;
          flattened[alias] = subValue;
        }
      } else {
        // Direct field - use alias or original name
        const alias = fieldAliases[key] ?? key;
        flattened[alias] = value;
      }
    }

    if (Object.keys(flattened).length === 0) {
      return null;
    }

    return flattened;
  }

  const entries = Array.isArray(snapshotValue)
    ? snapshotValue
    : Object.values(snapshotValue);

  const readings = entries
    .map((entry) => coerceReading(entry))
    .filter(Boolean)
    .sort((a, b) => Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0));

  const normalizedReadings = [];
  let lastSnapshot = {};

  for (const reading of readings) {
    lastSnapshot = {
      ...lastSnapshot,
      ...reading,
    };
    normalizedReadings.push(lastSnapshot);
  }

  return normalizedReadings;
}

function getFirebaseServices() {
  if (firebaseServices) {
    return firebaseServices;
  }

  const { config, hasRequired } = getConfig();
  if (!hasRequired) {
    return null;
  }

  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getDatabase(app);
  firebaseServices = { app, auth, db };
  return firebaseServices;
}

export function observeAuth(onChange, onError) {
  const services = getFirebaseServices();
  if (!services) {
    onError(
      new Error(
        "Firebase is not configured. Set required VITE_FIREBASE_* variables in .env.",
      ),
    );
    return () => {};
  }

  return onAuthStateChanged(services.auth, onChange, onError);
}

export async function loginWithEmailPassword(email, password) {
  const services = getFirebaseServices();
  if (!services) {
    throw new Error(
      "Firebase is not configured. Set required VITE_FIREBASE_* variables in .env.",
    );
  }

  const credentials = await signInWithEmailAndPassword(
    services.auth,
    email,
    password,
  );
  return credentials.user;
}

export async function logoutCurrentUser() {
  const services = getFirebaseServices();
  if (!services) {
    return;
  }

  await signOut(services.auth);
}

export function subscribeToLiveReadings(userId, onData, onError) {
  const services = getFirebaseServices();
  if (!services) {
    return { connected: false, unsubscribe: () => {} };
  }

  const path = "readings";
  const readingsRef = ref(services.db, path);

  const unsubscribe = onValue(
    readingsRef,
    (snapshot) => {
      const value = snapshot.val();

      if (!value) {
        onData([]);
        return;
      }

      onData(normalizeReadings(value));
    },
    (error) => {
      onError(error);
    },
  );

  return { connected: true, unsubscribe };
}

export async function getFallbackReadings() {
  const response = await fetch("/firebase-export.json");

  if (!response.ok) {
    throw new Error("Could not load fallback export file.");
  }

  const payload = await response.json();
  return normalizeReadings(payload?.readings ?? {});
}
