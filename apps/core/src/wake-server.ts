import http from "node:http";
import type { RuntimeConfig } from "@maximus/agent-runtime";

export function startWakeServer(
  config: RuntimeConfig,
  onWake: () => void
): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, agent: "Maximus" }));
      return;
    }

    if (req.url === "/wake" && req.method === "POST") {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${config.wakeSecret}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      onWake();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "wake accepted" }));
      return;
    }

    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  server.listen(config.wakePort, () => {
    console.log(`Wake server listening on :${config.wakePort}`);
    console.log(`  GET  /health`);
    console.log(`  POST /wake  (Authorization: Bearer ${config.wakeSecret})`);
  });

  return server;
}
