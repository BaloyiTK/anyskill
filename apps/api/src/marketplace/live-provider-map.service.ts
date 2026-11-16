import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { Duplex } from "node:stream";

type Discovery = (latitude: number, longitude: number, radiusKm: number) => Promise<unknown>;
type MapClient = {
  socket: Duplex;
  latitude: number;
  longitude: number;
  radiusKm: number;
  sending: boolean;
};

@Injectable()
export class LiveProviderMapService {
  private readonly logger = new Logger(LiveProviderMapService.name);
  private readonly clients = new Set<MapClient>();
  private discover: Discovery | null = null;

  attach(server: Server, discover: Discovery): void {
    this.discover = discover;
    server.on("upgrade", (request, socket) => {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (requestUrl.pathname !== "/api/v1/marketplace/discover/providers/live") return;

      const latitude = Number(requestUrl.searchParams.get("latitude"));
      const longitude = Number(requestUrl.searchParams.get("longitude"));
      const radiusKm = Number(requestUrl.searchParams.get("radiusKm"));
      const key = request.headers["sec-websocket-key"];
      if (
        typeof key !== "string" ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        ![5, 10, 20, 50].includes(radiusKm)
      ) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
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

      const client: MapClient = { socket, latitude, longitude, radiusKm, sending: false };
      this.clients.add(client);
      socket.on("close", () => this.clients.delete(client));
      socket.on("end", () => this.clients.delete(client));
      socket.on("error", () => this.clients.delete(client));
      socket.on("data", (data: Buffer) => {
        // The map stream is server-to-client. Honour a browser close frame.
        if (data.length > 0 && ((data.at(0) ?? 0) & 0x0f) === 0x08) socket.end();
      });
      void this.sendSnapshot(client);
    });
  }

  notifyChanged(): void {
    for (const client of this.clients) void this.sendSnapshot(client);
  }

  private async sendSnapshot(client: MapClient): Promise<void> {
    if (client.sending || client.socket.destroyed || !this.discover) return;
    client.sending = true;
    try {
      const providers = await this.discover(client.latitude, client.longitude, client.radiusKm);
      if (!client.socket.destroyed) this.sendFrame(client.socket, JSON.stringify(providers));
    } catch (error) {
      this.logger.warn(`Could not publish a live Provider map update: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      client.sending = false;
    }
  }

  private sendFrame(socket: Duplex, message: string): void {
    const payload = Buffer.from(message);
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
    socket.write(Buffer.concat([header, payload]));
  }
}
