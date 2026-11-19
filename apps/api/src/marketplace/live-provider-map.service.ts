import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";

type Discovery = (latitude: number, longitude: number, radiusKm: number) => Promise<unknown>;
const MAX_LIVE_MAP_CLIENTS = 200;
const MAX_LIVE_MAP_FRAME_BYTES = 1_000_000;

type MapClient = {
  socket: Duplex;
  latitude: number;
  longitude: number;
  radiusKm: number;
  sending: boolean;
  dirty: boolean;
};

@Injectable()
export class LiveProviderMapService {
  private readonly logger = new Logger(LiveProviderMapService.name);
  private readonly clients = new Set<MapClient>();
  private discover: Discovery | null = null;
  private expirySweep: ReturnType<typeof setInterval> | undefined;

  attach(server: Server, discover: Discovery): void {
    this.discover = discover;
    // Expire stale provider pins even when no new location event arrives.
    // Discovery itself filters out locations older than the live-location TTL.
    if (!this.expirySweep) {
      this.expirySweep = setInterval(() => this.notifyChanged(), 10_000);
      this.expirySweep.unref?.();
    }
    server.on("upgrade", (request, socket) => {
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      } catch {
        socket.end("HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n");
        return;
      }
      if (requestUrl.pathname !== "/api/v1/marketplace/discover/providers/live") {
        socket.end("HTTP/1.1 404 Not Found\\r\\nConnection: close\\r\\n\\r\\n");
        return;
      }

      const latitudeValue = requestUrl.searchParams.get("latitude");
      const longitudeValue = requestUrl.searchParams.get("longitude");
      const radiusValue = requestUrl.searchParams.get("radiusKm");
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);
      const radiusKm = Number(radiusValue);
      const key = request.headers["sec-websocket-key"];
      const connectionHeader = String(request.headers.connection ?? "").toLowerCase().split(",").map((value) => value.trim());
      const origin = request.headers.origin;
      const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
      const allowedOrigins = process.env.NODE_ENV === "production"
        ? configuredOrigins
        : [...configuredOrigins, "http://localhost:4173", "http://127.0.0.1:4173"];
      const originAllowed = typeof origin !== "string" || allowedOrigins.includes(origin);
      const validKey = typeof key === "string" && Buffer.from(key, "base64").length === 16;
      if (
        request.headers.upgrade?.toLowerCase() !== "websocket" ||
        !connectionHeader.includes("upgrade") ||
        request.headers["sec-websocket-version"] !== "13" ||
        !validKey ||
        !originAllowed ||
        !latitudeValue || !longitudeValue || !radiusValue ||
        requestUrl.searchParams.getAll("latitude").length !== 1 ||
        requestUrl.searchParams.getAll("longitude").length !== 1 ||
        requestUrl.searchParams.getAll("radiusKm").length !== 1 ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        ![5, 10, 20, 50].includes(radiusKm)
      ) {
        socket.end("HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n");
        return;
      }
      if (this.clients.size >= MAX_LIVE_MAP_CLIENTS) {
        socket.end("HTTP/1.1 503 Service Unavailable\\r\\nConnection: close\\r\\nRetry-After: 10\\r\\n\\r\\n");
        return;
      }

      const accept = createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n",
      ].join("\r\n"));

      const client: MapClient = { socket, latitude, longitude, radiusKm, sending: false, dirty: false };
      this.clients.add(client);
      socket.on("close", () => this.clients.delete(client));
      socket.on("end", () => this.clients.delete(client));
      socket.on("error", () => this.clients.delete(client));
      socket.on("data", (data: Buffer) => {
        // Browser control frames are masked. Handle close and ping without
        // accepting client application messages on this read-only stream.
        if (data.length < 2) return;
        const opcode = data[0]! & 0x0f;
        const masked = (data[1]! & 0x80) !== 0;
        const length = data[1]! & 0x7f;
        if (opcode === 0x08) {
          socket.end();
          return;
        }
        if (opcode === 0x09 && masked && length <= 125 && data.length >= 6 + length) {
          const mask = data.subarray(2, 6);
          const payload = Buffer.from(data.subarray(6, 6 + length));
          for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        }
      });
      void this.sendSnapshot(client);
    });
  }

  notifyChanged(): void {
    for (const client of this.clients) {
      client.dirty = true;
      if (!client.sending) void this.sendSnapshot(client);
    }
  }

  private async sendSnapshot(client: MapClient): Promise<void> {
    if (client.sending || client.socket.destroyed || !this.discover) return;
    client.sending = true;
    try {
      // Preserve updates that arrive while a database snapshot is in flight.
      do {
        client.dirty = false;
        const providers = await this.discover(client.latitude, client.longitude, client.radiusKm);
        if (!client.socket.destroyed) this.sendFrame(client.socket, JSON.stringify(providers));
      } while (client.dirty && !client.socket.destroyed);
    } catch (error) {
      this.logger.warn(`Could not publish a live Provider map update: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      client.sending = false;
      if (client.dirty && !client.socket.destroyed) void this.sendSnapshot(client);
    }
  }

  private sendFrame(socket: Duplex, message: string): void {
    const payload = Buffer.from(message);
    if (payload.length > MAX_LIVE_MAP_FRAME_BYTES) {
      socket.destroy();
      return;
    }
    let header: Buffer;
    if (payload.length < 126) {
      header = Buffer.from([0x81, payload.length]);
    } else if (payload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    // Disconnect slow consumers rather than buffering unbounded map snapshots.
    if (!socket.write(Buffer.concat([header, payload]))) socket.destroy();
  }
}
