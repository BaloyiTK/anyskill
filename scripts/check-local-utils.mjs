import net from "node:net";

export function parseEnvKeys(source) {
  return new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter(Boolean),
  );
}

export function parseMobileApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL must be a valid absolute HTTP(S) URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("EXPO_PUBLIC_API_URL must use HTTP or HTTPS.");
  }

  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) {
    throw new Error("EXPO_PUBLIC_API_URL must use your computer's LAN address, not localhost.");
  }

  return url;
}

export function isLocalIPv4Address(hostname, localAddresses) {
  return net.isIP(hostname) !== 4 || localAddresses.includes(hostname);
}

export function createHealthUrl(baseUrl, hostname) {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\\/+$/, "")}/health`.replace(/\\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  if (hostname) url.hostname = hostname;
  return url;
}
