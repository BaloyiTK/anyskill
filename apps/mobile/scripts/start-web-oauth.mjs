import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";

const host = "127.0.0.1";
const publicPort = Number(process.env.ANYSKILL_WEB_PORT ?? 8081);
const expoPort = Number(process.env.ANYSKILL_EXPO_PORT ?? 8083);

// Keep the browser origin on localhost:8081 (the redirect URI already
// registered in Google Cloud), while Expo/Metro runs behind it on 8083.
const proxy = http.createServer((request, response) => {
  const upstream = http.request(
    {
      hostname: host,
      port: expoPort,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (upstreamResponse) => {
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value !== undefined) response.setHeader(name, value);
      }

      // This must be on the document response, not only Metro bundle responses.
      response.setHeader(
        "Cross-Origin-Opener-Policy",
        "same-origin-allow-popups",
      );
      response.writeHead(upstreamResponse.statusCode ?? 502);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    response.end(
      `Expo dev server is not responding on port ${expoPort}: ${error.message}`,
    );
  });

  request.pipe(upstream);
});

// Metro uses WebSockets for hot reload. Forward upgrades as raw TCP so the
// browser continues to use the same localhost:8081 origin.
proxy.on("upgrade", (request, socket, head) => {
  const upstream = net.connect(expoPort, host, () => {
    const lines = [
      `${request.method} ${request.url} HTTP/${request.httpVersion}`,
    ];

    for (const [name, value] of Object.entries(request.headers)) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item !== undefined) lines.push(`${name}: ${item}`);
      }
    }

    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

proxy.listen(publicPort, "127.0.0.1", () => {
  console.log(`AnySkill web URL: http://localhost:${publicPort}`);
  console.log(
    `COOP header proxy -> Expo Metro at http://127.0.0.1:${expoPort}`,
  );
  console.log("Google web redirect URI remains http://localhost:8081");

  const expo = spawn(
    "pnpm",
    ["exec", "expo", "start", "--web", "--localhost", "--port", String(expoPort)],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  const stop = () => {
    expo.kill();
    proxy.close();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  expo.on("exit", (code) => {
    proxy.close();
    process.exit(code ?? 0);
  });
});

proxy.on("error", (error) => {
  console.error(
    `Could not start the AnySkill web proxy on port ${publicPort}: ${error.message}`,
  );
  process.exit(1);
});
