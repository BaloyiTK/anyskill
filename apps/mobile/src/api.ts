import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Use the host machine from web/iOS and the Android-emulator bridge on Android.
const DEFAULT_API_BASE_URL = Platform.OS === "android"
  ? "http://10.0.2.2:3000/api/v1"
  : "http://localhost:3000/api/v1";
const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_URL;
// The Android emulator host is not reachable from a desktop browser.
const API_BASE_URL = Platform.OS === "web" && configuredApiBaseUrl?.includes("10.0.2.2")
  ? "http://localhost:3000/api/v1"
  : configuredApiBaseUrl ?? DEFAULT_API_BASE_URL;

export function liveWebSocketUrl(path: string): string {
  const base = API_BASE_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${base}${path}`;
}
const ACCESS_TOKEN_KEY = "anyskill.access-token";
const REFRESH_TOKEN_KEY = "anyskill.refresh-token";

function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window === "undefined" ? null : window.localStorage.getItem(key));
  }
  return SecureStore.getItemAsync(key);
}

function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, value);
}

function removeStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.localStorage.removeItem(key);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key);
}

const IDEMPOTENCY_STORAGE_PREFIX = "anyskill.idempotency.";

export async function getOrCreateIdempotencyKey(storageKey: string, payload: unknown): Promise<string> {
  const fingerprint = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(payload),
  );
  const storageKeyHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, storageKey);
  const storageId = IDEMPOTENCY_STORAGE_PREFIX + storageKeyHash;
  const stored = await getStoredItem(storageId);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { key?: string; fingerprint?: string };
      if (parsed.key && parsed.fingerprint === fingerprint) return parsed.key;
    } catch {
      // Replace malformed local state with a fresh key.
    }
  }
  const key = Crypto.randomUUID();
  await setStoredItem(storageId, JSON.stringify({ key, fingerprint }));
  return key;
}

export async function clearIdempotencyKey(storageKey: string): Promise<void> {
  await removeStoredItem(IDEMPOTENCY_STORAGE_PREFIX + storageKey);
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

let refreshInFlight: Promise<TokenResponse | null> | null = null;

async function refreshSessionOnce(): Promise<TokenResponse | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await clearTokens();
        return null;
      }
      const tokens = (await response.json()) as TokenResponse;
      await saveTokens(tokens);
      return tokens;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : Array.isArray(payload.message)
          ? payload.message.join(", ")
          : "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return payload;
}

export async function saveTokens(tokens: TokenResponse): Promise<void> {
  await Promise.all([
    setStoredItem(ACCESS_TOKEN_KEY, tokens.accessToken),
    setStoredItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    removeStoredItem(ACCESS_TOKEN_KEY),
    removeStoredItem(REFRESH_TOKEN_KEY),
  ]);
}

export async function hasStoredAuthSession(): Promise<boolean> {
  const [accessToken, refreshToken] = await Promise.all([
    getStoredItem(ACCESS_TOKEN_KEY),
    getStoredItem(REFRESH_TOKEN_KEY),
  ]);
  return Boolean(accessToken || refreshToken);
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  authenticated = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  const isMultipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!isMultipart) headers.set("Content-Type", "application/json");
  else headers.delete("Content-Type");

  if (authenticated) {
    const accessToken = await getStoredItem(ACCESS_TOKEN_KEY);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (authenticated && response.status === 401) {
    const tokens = await refreshSessionOnce();
    if (tokens) {
      headers.set("Authorization", `Bearer ${tokens.accessToken}`);
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      });
    }
  }

  return (await readJson(response)) as T;
}

export async function signOut(): Promise<void> {
  const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
  if (refreshToken) {
    try {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Local credentials must still be cleared when the device is offline.
    } finally {
      await clearTokens();
    }
  } else {
    await clearTokens();
  }
}

export type AccountSummary = {
  id: string;
  email: string;
  emailVerified: boolean;
  identityVerification: string;
  googleLinked: boolean;
  seekerRoleStatus: string;
  providerRoleStatus: string;
  activeMarketplaceMode: "SEEKER" | "PROVIDER" | null;
  initialMode: "SEEKER" | "PROVIDER";
};

export type IdentitySummary = {
  status: string;
  verifiedAt: string | null;
  latestCase: {
    id: string;
    status: string;
    submittedAt: string;
    reviewedAt: string | null;
    decisionReason: string | null;
  } | null;
  previews?: {
    ID_SELFIE?: string | null;
  };
};


export type AppNotification = {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export async function fetchNotifications(): Promise<AppNotification[]> {
  return apiRequest<AppNotification[]>("/notifications", {}, true);
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiRequest(`/notifications/${notificationId}/read`, { method: "PATCH" }, true);
}
