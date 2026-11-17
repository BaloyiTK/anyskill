import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
  const target = join(root, relative);
  if (!target.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "0.0.0.0", () => {
  process.stdout.write(`AnySkill Admin Portal available at http://localhost:${port}\n`);
});
