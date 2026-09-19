export const labels = {
  unreported: "報告未取得",
  in_progress: "進行中",
  needs_input: "判断待ち",
  blocked: "対応待ち",
  completed: "完了",
};
export const operations = {
  idle: "待機",
  running: "稼働を観測",
  response_ended: "応答終了",
  ended: "セッション終了",
  launcher_exited: "CLI終了",
  permission_requested: "許可確認",
  interrupted: "中断",
  error: "エラー",
  unknown: "未観測",
};
export const colors = {
  in_progress: "#8aaaff",
  needs_input: "#e7b878",
  blocked: "#e5979b",
  completed: "#83cdb4",
  unreported: "#8690a3",
};
export const stateEvents = {
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
export function latest(task) {
  return (
    task.launches.at(-1) ?? {
      provider: "未起動",
      actors: [],
      events: [],
      created: task.created,
      cwd: task.cwd,
    }
  );
}
export function mainActor(task) {
  return latest(task)?.actors.find((a) => a.role === "coordinator");
}
export function active(actor, now) {
  return (
    actor.operational === "running" &&
    now - Date.parse(actor.last_observed) < 30000
  );
}
export function actorName(actor) {
  return (
    actor.name ||
    (actor.role === "coordinator"
      ? "取りまとめ"
      : actor.role === "member" && actor.agent
        ? `分担 ${actor.agent.slice(0, 7)}`
        : "所属未確定")
  );
}
export function observedIntervals(events, actorId, now) {
  const own = events
    .filter((e) => e.actor === actorId && stateEvents[e.kind])
    .sort((a, b) => Date.parse(a.received) - Date.parse(b.received));
  const intervals = [];
  for (let i = 0; i < own.length; i++) {
    const e = own[i],
      start = Date.parse(e.received),
      state = stateEvents[e.kind];
    if (!["running", "idle", "permission_requested"].includes(state)) continue;
    const next = own[i + 1] ? Date.parse(own[i + 1].received) : now;
    const end = Math.min(next, start + 30000, now);
    if (end > start) intervals.push({ start, end, state });
    if (next > end) intervals.push({ start: end, end: next, state: "unknown" });
  }
  return intervals;
}
