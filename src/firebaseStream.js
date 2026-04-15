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

  const aliasMap = {
    bme280: {
      temperature_c: "temperature",
      humidity_pct: "humidity",
      pressure_hpa: "pressure",
    },
    bmp280: {
      altitude_m: "altitude",
    },
    rain: {
      adc: "rain",
    },
    mq5: {
      lpg_ppm: "mq5",
      rs_kohm: "mq5_rs_kohm",
      status: "mq5_status",
    },
    uv: {
      voltage_v: "uv",
    },
    mics5524: {
      co_ppm: "mics5524_co_ppm",
      ch4_ppm: "mics5524_ch4_ppm",
      h2_ppm: "mics5524_h2_ppm",
      ethanol_ppm: "mics5524_ethanol_ppm",
      rs_kohm: "mics5524_rs_kohm",
    },
    windspeed: {
      speed_kmh: "wind_speed_kmh",
      speed_ms: "wind_speed_ms",
    },
    wind_direction: {
      angle_degrees: "wind_direction_deg",
      direction: "wind_direction_text",
    },
    dust: {
      density_ugm3: "dust_density_ugm3",
      voltage_v: "dust_voltage_v",
      adc_raw: "dust_adc_raw",
      air_quality: "dust_air_quality",
    },
    mpu6050: {
      accel_x: "mpu6050_accel_x",
      accel_y: "mpu6050_accel_y",
      accel_z: "mpu6050_accel_z",
      gyro_x: "mpu6050_gyro_x",
      gyro_y: "mpu6050_gyro_y",
      gyro_z: "mpu6050_gyro_z",
    },
  };

  function coerceReading(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    if (Number.isFinite(Number(entry.timestamp))) {
      return {
        ...entry,
        timestamp: Number(entry.timestamp),
      };
    }

    const flattened = {};

    for (const [groupName, groupValue] of Object.entries(entry)) {
      if (!groupValue || typeof groupValue !== "object") {
        flattened[groupName] = groupValue;
        continue;
      }

      const aliases = aliasMap[groupName] ?? {};
      for (const [fieldName, fieldValue] of Object.entries(groupValue)) {
        const alias = aliases[fieldName] ?? `${groupName}_${fieldName}`;
        flattened[alias] = fieldValue;
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
