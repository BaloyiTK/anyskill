import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:3000/api/v1";
const ACCESS_TOKEN_KEY = "anyskill.access-token";
const REFRESH_TOKEN_KEY = "anyskill.refresh-token";

function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window === "undefined" ? null : window.sessionStorage.getItem(key));
  }
  return SecureStore.getItemAsync(key);
}

function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, value);
    return Promise.resolve();
  }
  return SecureStore.setItemAsync(key, value);
}

function removeStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
    return Promise.resolve();
  }
  return SecureStore.deleteItemAsync(key);
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

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

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  authenticated = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (authenticated) {
    const accessToken = await getStoredItem(ACCESS_TOKEN_KEY);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (authenticated && response.status === 401) {
    const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      const refreshResponse = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (refreshResponse.ok) {
        const tokens = (await refreshResponse.json()) as TokenResponse;
        await saveTokens(tokens);
        headers.set("Authorization", `Bearer ${tokens.accessToken}`);
        response = await fetch(`${API_BASE_URL}${path}`, {
          ...options,
          headers,
        });
      } else {
        await clearTokens();
      }
    }
  }

  return (await readJson(response)) as T;
}

export async function signOut(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
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
};
