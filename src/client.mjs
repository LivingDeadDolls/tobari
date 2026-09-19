import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const defaultConfig = () =>
  process.env.TOBARI_CONFIG || join(homedir(), ".tobari", "client.json");
export function readConfig(path = defaultConfig()) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function saveConfig(path, server, token) {
  const url = new URL(server);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Use a server origin such as http://192.168.0.174:3000");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid access key");
  mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const config = {
    server: url.origin,
    token,
    db: join(dirname(resolve(path)), "client.sqlite"),
  };
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  return config;
}
export async function request(config, route, body, timeout = 4000) {
  const response = await fetch(config.server + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Server returned ${response.status}`);
  return response.json();
}
export async function flush(store, config) {
  if (!config) return 0;
  const operations = [];
  let bytes = 0;
  for (const operation of store.pending()) {
    const size = Buffer.byteLength(JSON.stringify(operation));
    if (operations.length && bytes + size > 500000) break;
    operations.push(operation);
    bytes += size;
  }
  if (!operations.length) return 0;
  const result = await request(config, "/api/sync", { operations }, 1500);
  store.acknowledge(result.accepted);
  return result.accepted.length;
}
