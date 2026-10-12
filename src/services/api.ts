import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "anyskill_access_token";
const REFRESH_KEY = "anyskill_refresh_token";

async function setStoredValue(key: string, value: string | null) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
    return;
  }

  if (value) await SecureStore.setItemAsync(key, value);
  else await SecureStore.deleteItemAsync(key);
}

async function getStoredValue(key: string) {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

export const setAccessToken = (token: string | null) => setStoredValue(TOKEN_KEY, token);
export const getAccessToken = () => getStoredValue(TOKEN_KEY);
export const setRefreshToken = (token: string | null) => setStoredValue(REFRESH_KEY, token);
export const getRefreshToken = () => getStoredValue(REFRESH_KEY);

export async function clearSession() {
  await Promise.all([setAccessToken(null), setRefreshToken(null)]);
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const token = await getRefreshToken();
    if (!token) return false;

    try {
      const response = await fetch(API_URL + "/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
      });

      if (!response.ok) return false;

      const body = await response.json();
      await Promise.all([
        setAccessToken(body.data.accessToken),
        setRefreshToken(body.data.refreshToken),
      ]);
      return true;
    } catch {
      return false;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401 && retry && path !== "/auth/refresh") {
    if (await refreshSession()) return api<T>(path, options, false);
    await clearSession();
  }

  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.code ?? "HTTP_" + response.status);
  }

  return body as T;
}
