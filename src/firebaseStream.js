import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref } from "firebase/database";

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

  return Object.values(snapshotValue)
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Number.isFinite(Number(entry.timestamp)),
    )
    .map((entry) => ({
      ...entry,
      timestamp: Number(entry.timestamp),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function subscribeToLiveReadings(onData, onError) {
  const { config, hasRequired } = getConfig();

  if (!hasRequired) {
    return { connected: false, unsubscribe: () => {} };
  }

  const app = initializeApp(config);
  const db = getDatabase(app);
  const userId = import.meta.env.VITE_FIREBASE_USER_ID;

  const path = userId ? `UsersData/${userId}/readings` : "UsersData";
  const readingsRef = ref(db, path);

  const unsubscribe = onValue(
    readingsRef,
    (snapshot) => {
      const value = snapshot.val();

      if (!value) {
        onData([]);
        return;
      }

      if (path === "UsersData") {
        const [firstUser] = Object.values(value);
        const readingsObject = firstUser?.readings ?? {};
        onData(normalizeReadings(readingsObject));
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
  const usersData = payload?.UsersData;
  const [firstUser] = usersData ? Object.values(usersData) : [];
  return normalizeReadings(firstUser?.readings ?? {});
}
