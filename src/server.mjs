import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { parseArgs } from "node:util";
import { openStore } from "./store.mjs";

const { values } = parseArgs({
  options: {
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "3000" },
    db: { type: "string", default: ".tobari/local.sqlite" },
    "token-file": { type: "string" },
    "no-auth": { type: "boolean", default: false },
  },
});
const port = Number(values.port),
  host = values.host;
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid port");
if (isIP(host) !== 4) throw new Error("--host must be an IPv4 address");
if (values["no-auth"] && host !== "127.0.0.1")
  throw new Error("--no-auth is only allowed on loopback");
const tokenFile = resolve(values["token-file"] || ".tobari/access-key.txt");
let token = "";
if (!values["no-auth"]) {
  mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 });
  try {
    token = readFileSync(tokenFile, "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    token = randomBytes(32).toString("hex");
    writeFileSync(tokenFile, token + "\n", { mode: 0o600, flag: "wx" });
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid access key file");
}
const store = openStore(values.db);
const addresses = [
  "127.0.0.1",
  ...Object.values(networkInterfaces())
    .flat()
    .filter((a) => a.family === "IPv4")
    .map((a) => a.address),
];
const allowedHosts = new Set(
  ["localhost", ...(host === "0.0.0.0" ? addresses : [host, "127.0.0.1"])].map(
    (h) => `${h}:${port}`,
  ),
);
const sessions = new Map(),
  attempts = new Map();
const equal = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value) &&
  timingSafeEqual(Buffer.from(value), Buffer.from(token));
const assets = new Map(
  ["index.html", "app.js", "model.js", "demo.js", "style.css"].map((file) => [
    file === "index.html" ? "/" : "/" + file,
    new URL("../web/" + file, import.meta.url),
  ]),
);
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON required");
  let chunks = [],
    size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  const json = (code, data) => {
    res
      .writeHead(code, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify(data));
  };
  if (!allowedHosts.has(req.headers.host))
    return json(403, { error: "Forbidden host" });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return json(403, { error: "Forbidden origin" });
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (req.method === "GET" && assets.has(path)) {
      res
        .writeHead(200, {
          "Content-Type": path.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : path.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
        })
        .end(readFileSync(assets.get(path)));
      return;
    }
    if (req.method === "POST" && path === "/api/login") {
      const ip = req.socket.remoteAddress,
        attempt = attempts.get(ip);
      if (attempt && attempt.count >= 10 && Date.now() - attempt.time < 60000)
        return json(429, { error: "しばらく待ってから接続してください" });
      const data = await body(req);
      if (token && !equal(data.token)) {
        attempts.set(ip, {
          count:
            attempt && Date.now() - attempt.time < 60000
              ? attempt.count + 1
              : 1,
          time: Date.now(),
        });
        return json(401, { error: "アクセスキーが違います" });
      }
      attempts.delete(ip);
      const session = randomBytes(32).toString("hex");
      sessions.set(session, Date.now() + 86400000);
      res.setHeader(
        "Set-Cookie",
        `tobari=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
      );
      return json(200, { ok: true });
    }
    const cookie = /(?:^|;\s*)tobari=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const bearer =
      token &&
      req.headers.authorization?.startsWith("Bearer ") &&
      equal(req.headers.authorization.slice(7));
    if (token && !bearer && !(sessions.get(cookie) > Date.now()))
      return json(401, { error: "接続にはアクセスキーが必要です" });
    if (req.method === "GET" && path === "/api/tasks")
      return json(200, {
        tasks: store.taskIds().map((id) => store.snapshot(id)),
        observed_at: new Date().toISOString(),
      });
    if (req.method === "POST" && path === "/api/tasks") {
      const data = await body(req);
      const task = store.register({
        title: data.title,
        request: data.request,
        cwd: data.cwd,
        links: data.links,
      });
      return json(201, store.snapshot(task.id));
    }
    if (req.method === "POST" && path === "/api/sync") {
      if (token && !bearer)
        return json(403, { error: "CLI credential required" });
      const data = await body(req);
      if (!Array.isArray(data.operations) || data.operations.length > 100)
        throw new Error("Invalid operations");
      const accepted = [];
      for (const operation of data.operations) {
        store.apply(operation);
        accepted.push(operation.id);
      }
      return json(200, { accepted });
    }
    json(404, { error: "Not found" });
  } catch (error) {
    json(400, {
      error:
        "入力を確認してください。" +
        (error.code?.startsWith("SQLITE") ? "" : error.message),
    });
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
let heartbeat;
server.on("error", (error) => {
  console.error(`STOPPED: ${error.message}`);
  clearInterval(heartbeat);
  store.close();
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const urls = (host === "0.0.0.0" ? [...new Set(addresses)] : [host]).map(
    (address) => `http://${address}:${port}/`,
  );
  if (process.stdout.isTTY) process.stdout.write("\x1b]0;Tobari — RUNNING\x07");
  console.log(`Tobari — RUNNING\n${urls.join("\n")}\nStore: ${store.path}`);
  if (token)
    console.log(
      `Access key file: ${tokenFile}\nOpen this file locally to sign in or connect a CLI. Do not share it.`,
    );
  console.log("Keep this window open. Ctrl+C to stop.");
  heartbeat = setInterval(() => {
    for (const [key, expiry] of sessions)
      if (expiry < Date.now()) sessions.delete(key);
    for (const [key, attempt] of attempts)
      if (Date.now() - attempt.time > 60000) attempts.delete(key);
    console.log(
      `[${new Date().toLocaleTimeString()}] RUNNING | uptime ${Math.floor(process.uptime())}s | ${urls[0]}`,
    );
  }, 30000);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(heartbeat);
    console.log("Tobari — STOPPING");
    server.close(() => {
      store.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
