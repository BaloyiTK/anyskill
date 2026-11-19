import { createHash, randomUUID } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
import type { ThrottlerStorage, ThrottlerStorageRecord } from "@nestjs/throttler";

const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local markerKey = KEYS[3]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local blockDuration = tonumber(ARGV[4])
local member = ARGV[5]

local blockTtl = redis.call("PTTL", blockKey)
if blockTtl > 0 then
  local count = redis.call("ZCARD", hitsKey)
  local hitsTtl = redis.call("PTTL", hitsKey)
  return { count, math.max(0, math.ceil(hitsTtl / 1000)), 1, math.ceil(blockTtl / 1000) }
end

-- A marker outlives the active block. Once the block expires, reset the old
-- blocked window exactly once before accepting a new request.
if redis.call("PTTL", markerKey) > 0 then
  redis.call("DEL", hitsKey, markerKey)
end

redis.call("ZREMRANGEBYSCORE", hitsKey, "-inf", now - ttl)
local count = redis.call("ZCARD", hitsKey)

if blockDuration <= 0 then
  if count >= limit then
    local oldest = redis.call("ZRANGE", hitsKey, 0, 0, "WITHSCORES")
    local waitMs = ttl
    if oldest[2] then
      waitMs = math.max(0, tonumber(oldest[2]) + ttl - now)
    end
    return { count + 1, math.max(0, math.ceil(redis.call("PTTL", hitsKey) / 1000)), 1, math.ceil(waitMs / 1000) }
  end
end

redis.call("ZADD", hitsKey, now, member)
redis.call("PEXPIRE", hitsKey, ttl)
count = count + 1

if blockDuration > 0 and count > limit then
  redis.call("SET", blockKey, "1", "PX", blockDuration)
  redis.call("SET", markerKey, "1", "PX", blockDuration + ttl)
  return { count, math.ceil(ttl / 1000), 1, math.ceil(blockDuration / 1000) }
end

return { count, math.ceil(ttl / 1000), 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(endpoint = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (!endpoint || !token) {
      throw new Error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for shared production rate limiting.");
    }

    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") {
      throw new Error("The shared rate-limit Redis REST endpoint must use HTTPS.");
    }

    this.endpoint = parsed.toString().replace(/\/$/, "");
    this.token = token;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const identity = createHash("sha256").update(`${throttlerName}: ${key}`).digest("hex");
    const prefix = `anyskill:throttle:{${identity}}`;
    const args = [
      "EVAL",
      INCREMENT_SCRIPT,
      "3",
      `${prefix}:hits`,
      `${prefix}:block`,
      `${prefix}:marker`,
      String(Date.now()),
      String(Math.max(1, Math.floor(ttl))),
      String(Math.max(0, Math.floor(limit))),
      String(Math.max(0, Math.floor(blockDuration))),
      randomUUID(),
    ];

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(1_500),
      });
      if (!response.ok) {
        throw new Error(`Redis REST returned HTTP ${response.status}`);
      }

      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || !("result" in payload) || !Array.isArray(payload.result)) {
        throw new Error("Redis REST returned an invalid rate-limit response");
      }
      const values = payload.result;
      if (values.length !== 4 || values.some((value) => !Number.isFinite(Number(value)))) {
        throw new Error("Redis returned an invalid rate-limit record");
      }

      return {
        totalHits: Number(values[0]),
        timeToExpire: Number(values[1]),
        isBlocked: Number(values[2]) === 1,
        timeToBlockExpire: Number(values[3]),
      };
    } catch {
      // Fail closed: allowing traffic when the shared limiter is unavailable
      // would silently disable brute-force and abuse protection.
      throw new ServiceUnavailableException("Shared rate-limit protection is temporarily unavailable.");
    }
  }
}
