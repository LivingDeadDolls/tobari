import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const COMMON_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PermissionRequest",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Stop",
];
export const eventsFor = (provider) => [
  ...COMMON_EVENTS,
  ...(provider === "codex"
    ? ["Interrupt"]
    : ["StopFailure", "TeammateIdle", "TaskCreated", "TaskCompleted"]),
];
export const quote = (value) => {
  const text =
    process.platform === "win32"
      ? String(value).replaceAll("\\", "/")
      : String(value);
  return `'${text.replaceAll("'", "'\\''")}'`;
};
const string = (value, name, max = 4096) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid ${name}`);
  return value;
};

export function validateReport(value) {
  const result = {};
  if (
    !value ||
    !["in_progress", "needs_input", "blocked", "completed"].includes(
      value.status,
    )
  )
    throw new Error("Invalid report status");
  result.status = value.status;
  result.summary = string(value.summary, "summary", 300);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error("revision must be a positive integer");
  result.revision = value.revision;
  for (const field of [
    "conclusion",
    "rationale",
    "evidence",
    "remaining",
    "human_action",
  ]) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "string" || value[field].length > 8000)
        throw new Error(`Invalid ${field}`);
      result[field] = value[field];
    }
  }
  if (["completed", "needs_input"].includes(result.status)) {
    for (const field of ["conclusion", "rationale", "evidence", "remaining"])
      string(result[field], field, 8000);
  }
  if (result.status === "needs_input")
    string(result.human_action, "human_action", 8000);
  return result;
}

export function openStore(path, { outbox = false } = {}) {
  path = resolve(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, request TEXT NOT NULL, cwd TEXT NOT NULL, links TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY);`);
  const enqueue = (kind, data) => {
    if (outbox)
      db.prepare("INSERT INTO outbox(id,payload) VALUES(?,?)").run(
        randomUUID(),
        JSON.stringify({ kind, ...data }),
      );
  };
  db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS launches (
      id TEXT PRIMARY KEY, task TEXT NOT NULL, title TEXT NOT NULL, provider TEXT NOT NULL,
      cwd TEXT NOT NULL, created TEXT NOT NULL, root_session TEXT);
    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY, launch TEXT NOT NULL REFERENCES launches(id), session TEXT NOT NULL,
      agent TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
      launch TEXT NOT NULL REFERENCES launches(id), actor TEXT REFERENCES actors(id),
      kind TEXT NOT NULL, received TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (
      actor TEXT NOT NULL REFERENCES actors(id), revision INTEGER NOT NULL,
      received TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(actor, revision));`);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const launch = (id) => {
    const row = db.prepare("SELECT * FROM launches WHERE id=?").get(id);
    if (!row) throw new Error("Unknown launch");
    return row;
  };
  const event = (id, actor, kind, payload, eventId = randomUUID()) => {
    const existing = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
    if (existing) {
      if (
        existing.launch !== id ||
        existing.actor !== actor ||
        existing.kind !== kind ||
        existing.payload !== JSON.stringify(payload)
      )
        throw new Error("Conflicting event ID");
      return;
    }
    db.prepare(
      "INSERT INTO events(id,launch,actor,kind,received,payload) VALUES(?,?,?,?,?,?)",
    ).run(
      eventId,
      id,
      actor,
      kind,
      new Date().toISOString(),
      JSON.stringify(payload),
    );
  };
  return {
    path,
    close: () => db.close(),
    register({ id = randomUUID(), title, request = "", cwd, links = [] }) {
      string(id, "id", 200);
      string(title, "title", 200);
      string(cwd, "cwd", 4096);
      if (typeof request !== "string" || request.length > 20000)
        throw new Error("Invalid request");
      if (
        !Array.isArray(links) ||
        links.length > 20 ||
        links.some(
          (link) =>
            typeof link !== "string" ||
            link.length > 2000 ||
            !/^https?:\/\//.test(link),
        )
      )
        throw new Error("Invalid links");
      db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?)").run(
        id,
        title,
        request,
        cwd,
        JSON.stringify(links),
        new Date().toISOString(),
      );
      return this.task(id);
    },
    task(id) {
      const row = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
      return row ? { ...row, links: JSON.parse(row.links) } : null;
    },
    pending() {
      return db
        .prepare("SELECT * FROM outbox ORDER BY seq LIMIT 100")
        .all()
        .map((row) => ({ id: row.id, ...JSON.parse(row.payload) }));
    },
    acknowledge(ids) {
      for (const id of ids) db.prepare("DELETE FROM outbox WHERE id=?").run(id);
    },
    apply(operation) {
      string(operation.id, "operation id", 200);
      if (db.prepare("SELECT id FROM receipts WHERE id=?").get(operation.id))
        return;
      // Each operation is independently idempotent, including a retry after a crash before receipt insertion.
      if (operation.kind === "create") this.create(operation.run);
      else if (operation.kind === "hook")
        this.hook(operation.launch, operation.input, operation.id);
      else if (operation.kind === "report")
        this.report(operation.actor, operation.report);
      else if (operation.kind === "exit")
        this.recordExit(
          operation.launch,
          operation.code,
          operation.signal,
          operation.id,
        );
      else throw new Error("Invalid operation");
      db.prepare("INSERT INTO receipts VALUES(?)").run(operation.id);
    },
    create({ task, title, provider, cwd, id = randomUUID() }) {
      string(task, "task", 200);
      string(title, "title", 200);
      string(id, "launch id", 200);
      string(cwd, "cwd", 4096);
      if (!["codex", "claude"].includes(provider))
        throw new Error("provider must be codex or claude");
      const previous = db.prepare("SELECT * FROM launches WHERE id=?").get(id);
      if (previous) {
        if (
          previous.task !== task ||
          previous.provider !== provider ||
          previous.title !== title ||
          previous.cwd !== cwd
        )
          throw new Error("Conflicting launch");
        return previous;
      }
      tx(() => {
        db.prepare("INSERT INTO launches VALUES(?,?,?,?,?,?,NULL)").run(
          id,
          task,
          title,
          provider,
          cwd,
          new Date().toISOString(),
        );
        enqueue("create", { run: launch(id) });
      });
      return launch(id);
    },
    launch,
    taskIds() {
      return db
        .prepare(
          "SELECT task, MAX(created) AS last FROM (SELECT task, created FROM launches UNION ALL SELECT id AS task, created FROM tasks) GROUP BY task ORDER BY last DESC",
        )
        .all()
        .map((row) => row.task);
    },
    nextRevision(actor) {
      return Number(
        db
          .prepare(
            "SELECT COALESCE(MAX(revision),0)+1 AS next FROM reports WHERE actor=?",
          )
          .get(actor).next,
      );
    },
    hook(id, input, eventId = randomUUID()) {
      return tx(() => {
        const run = launch(id);
        const kind = string(input.hook_event_name, "hook_event_name", 80);
        if (!eventsFor(run.provider).includes(kind))
          throw new Error("Unsupported hook event");
        const session = string(input.session_id, "session_id", 200);
        const agent =
          input.agent_id === undefined
            ? ""
            : string(input.agent_id, "agent_id", 200);
        if (kind.startsWith("Subagent") && !agent)
          throw new Error("Missing subagent identity");
        if (
          kind === "SessionStart" &&
          !agent &&
          !input.teammate_name &&
          !run.root_session
        ) {
          const bound = db
            .prepare(
              "SELECT task FROM launches WHERE provider=? AND root_session=? AND task<>?",
            )
            .get(run.provider, session, run.task);
          if (bound)
            throw new Error(
              "Session already linked to another task; switching is not implemented",
            );
          db.prepare("UPDATE launches SET root_session=? WHERE id=?").run(
            session,
            id,
          );
          run.root_session = session;
        }
        const actor = createHash("sha256")
          .update(
            JSON.stringify([id, session, agent, input.teammate_name ?? ""]),
          )
          .digest("hex");
        const role =
          !agent && !input.teammate_name && session === run.root_session
            ? "coordinator"
            : agent || input.teammate_name
              ? "member"
              : "unassigned";
        db.prepare(
          "INSERT INTO actors VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role",
        ).run(actor, id, session, agent, role);
        // Explicit allowlist: never persist raw prompts, tool inputs/results or final messages.
        const payload = {};
        for (const key of [
          "source",
          "reason",
          "tool_name",
          "agent_type",
          "teammate_name",
          "notification_type",
          "turn_id",
        ]) {
          if (typeof input[key] === "string")
            payload[key] = input[key].slice(0, 200);
        }
        if (typeof input.task_id === "string")
          payload.external_task_id = input.task_id.slice(0, 200);
        event(id, actor, kind, payload, eventId);
        enqueue("hook", {
          launch: id,
          input: {
            hook_event_name: kind,
            session_id: session,
            ...(agent ? { agent_id: agent } : {}),
            ...Object.fromEntries(
              Object.entries(payload).filter(([k]) => k !== "external_task_id"),
            ),
            ...(payload.external_task_id
              ? { task_id: payload.external_task_id }
              : {}),
          },
        });
        return { actor, role, run, kind };
      });
    },
    report(actor, input) {
      const report = validateReport(input);
      return tx(() => {
        const author = db.prepare("SELECT * FROM actors WHERE id=?").get(actor);
        if (!author)
          throw new Error(
            "Unknown actor; a lifecycle hook must register it first",
          );
        const previous = db
          .prepare("SELECT payload FROM reports WHERE actor=? AND revision=?")
          .get(actor, report.revision);
        if (previous) {
          if (previous.payload !== JSON.stringify(report))
            throw new Error("Conflicting report revision");
          return { duplicate: true };
        }
        db.prepare("INSERT INTO reports VALUES(?,?,?,?)").run(
          actor,
          report.revision,
          new Date().toISOString(),
          JSON.stringify(report),
        );
        event(author.launch, actor, "ProgressReport", report);
        enqueue("report", { actor, report });
        return { duplicate: false };
      });
    },
    recordExit(id, code, signal, eventId = randomUUID()) {
      tx(() => {
        launch(id);
        event(id, null, "LauncherExit", { code, signal }, eventId);
        enqueue("exit", { launch: id, code, signal });
      });
    },
    snapshot(task) {
      const runs = db
        .prepare("SELECT * FROM launches WHERE task=? ORDER BY rowid")
        .all(task);
      const metadata = this.task(task);
      if (!runs.length && !metadata) throw new Error("Unknown task");
      const launches = runs.map((run) => {
        const events = db
          .prepare("SELECT * FROM events WHERE launch=? ORDER BY seq")
          .all(run.id)
          .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
        const actors = db
          .prepare("SELECT * FROM actors WHERE launch=?")
          .all(run.id)
          .map((actor) => {
            const report = db
              .prepare(
                "SELECT * FROM reports WHERE actor=? ORDER BY revision DESC LIMIT 1",
              )
              .get(actor.id);
            const own = events.filter((e) => e.actor === actor.id);
            let operational = "unknown";
            for (const e of own) {
              const states = {
                SessionStart: "idle",
                UserPromptSubmit: "running",
                SubagentStart: "running",
                PreToolUse: "running",
                PostToolUse: "running",
                PermissionRequest: "permission_requested",
                Stop: "response_ended",
                SubagentStop: "response_ended",
                Interrupt: "interrupted",
                StopFailure: "error",
                SessionEnd: "ended",
                TeammateIdle: "idle",
              };
              operational = states[e.kind] ?? operational;
            }
            if (
              events.at(-1)?.kind === "LauncherExit" &&
              operational !== "ended"
            )
              operational = "launcher_exited";
            return {
              ...actor,
              operational,
              last_observed: own.at(-1)?.received ?? null,
              report: report
                ? { ...JSON.parse(report.payload), received: report.received }
                : null,
            };
          });
        return { ...run, actors, events };
      });
      const current = launches.at(-1);
      const coordinator = current?.actors.find((a) => a.role === "coordinator");
      return {
        cwd: current?.cwd,
        request: "",
        links: [],
        ...metadata,
        task,
        title: metadata?.title ?? current.title,
        status: coordinator?.report?.status ?? "unreported",
        summary:
          coordinator?.report?.summary ??
          (current ? "進捗報告はまだありません" : "登録済み・CLI起動待ち"),
        launches,
      };
    },
  };
}
