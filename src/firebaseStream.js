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

  const effectiveUserId = userId || import.meta.env.VITE_FIREBASE_USER_ID;
  if (!effectiveUserId) {
    onError(
      new Error("No user is signed in and VITE_FIREBASE_USER_ID is not set."),
    );
    return { connected: false, unsubscribe: () => {} };
  }

  const path = `UsersData/${effectiveUserId}/readings`;
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
  const usersData = payload?.UsersData;
  const [firstUser] = usersData ? Object.values(usersData) : [];
  return normalizeReadings(firstUser?.readings ?? {});
}
