import test from "node:test";
import assert from "node:assert/strict";
import {
  createHealthUrl,
  isLocalIPv4Address,
  parseEnvKeys,
  parseMobileApiUrl,
} from "./check-local-utils.mjs";

test("parseEnvKeys reads variable names without exposing values", () => {
  const keys = parseEnvKeys("# comment\n DATABASE_URL=postgres://secret\nJWT_ACCESS_SECRET='hidden'\n");
  assert.deepEqual([...keys], ["DATABASE_URL", "JWT_ACCESS_SECRET"]);
});

test("parseMobileApiUrl accepts a LAN API URL", () => {
  const url = parseMobileApiUrl("http://10.67.19.121:3000/api/v1");
  assert.equal(url.hostname, "10.67.19.121");
  assert.equal(url.port, "3000");
});

test("parseMobileApiUrl rejects localhost for physical-device configuration", () => {
  assert.throws(() => parseMobileApiUrl("http://localhost:3000/api/v1"), /LAN address/);
});

test("parseMobileApiUrl rejects non-HTTP protocols", () => {
  assert.throws(() => parseMobileApiUrl("ftp://10.0.0.2/api"), /HTTP or HTTPS/);
});

test("parseMobileApiUrl rejects malformed values", () => {
  assert.throws(() => parseMobileApiUrl("not a URL"), /valid absolute HTTP/);
});

test("isLocalIPv4Address checks whether an IPv4 host belongs to this machine", () => {
  assert.equal(isLocalIPv4Address("10.0.0.4", ["10.0.0.4"]), true);
  assert.equal(isLocalIPv4Address("10.0.0.5", ["10.0.0.4"]), false);
  assert.equal(isLocalIPv4Address("api.local", ["10.0.0.4"]), true);
});

test("createHealthUrl builds the health endpoint and removes query/hash", () => {
  const result = createHealthUrl("http://10.67.19.121:3000/api/v1/?debug=1#section");
  assert.equal(result.href, "http://10.67.19.121:3000/api/v1/health");
});

test("createHealthUrl can target localhost while preserving port and API prefix", () => {
  const result = createHealthUrl("http://10.67.19.121:3000/api/v1", "localhost");
  assert.equal(result.href, "http://localhost:3000/api/v1/health");
});
