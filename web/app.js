import {
  labels,
  operations,
  colors,
  latest,
  mainActor,
  active,
  actorName,
  observedIntervals,
} from "./model.js";
import { demoTasks } from "./demo.js";

const $ = (q) => document.querySelector(q);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svgEl = (tag, attrs = {}, text) => {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
};
const time = (t) =>
  new Date(t).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const stamp = (t) => (t ? new Date(t).toLocaleString("ja-JP") : "未取得");
const short = (s, n = 17) => (s.length > n ? s.slice(0, n) + "…" : s);
const badge = (status) =>
  el("span", `badge ${status}`, labels[status] ?? status);
let realTasks = [],
  tasks = [],
  selected = null,
  selectedActor = null,
  selectedEvent = null,
  filter = "all",
  query = "",
  mode = "real",
  playing = true,
  second = 45;
let epoch = Date.now() - 45000,
  now = Date.now(),
  seen = new Set(),
  signature = "",
  connectionError = false;
function age(t) {
  if (!t) return "未観測";
  const s = Math.max(0, Math.round((now - Date.parse(t)) / 1000));
  return s < 60
    ? `${s}秒前`
    : s < 3600
      ? `${Math.floor(s / 60)}分前`
      : `${Math.floor(s / 3600)}時間前`;
}
function actorState(a) {
  return a.report?.status ?? (active(a, now) ? "in_progress" : "unreported");
}
function operational(a) {
  return a.operational === "running" && !active(a, now)
    ? "観測が途絶えています"
    : (operations[a.operational] ?? a.operational);
}
function selectTask(id) {
  selected = id;
  selectedActor = null;
  selectedEvent = null;
  render();
}
function setFilter(value) {
  filter = value;
  render();
}
function renderMetrics() {
  const target = $("#metrics");
  target.replaceChildren();
  const running = tasks
    .flatMap((t) => latest(t).actors)
    .filter((a) => active(a, now)).length;
  const rows = [
    [
      "すべてのタスク",
      tasks.length,
      `${tasks.filter((t) => t.status === "unreported").length}件は報告未取得`,
      "gray",
      "all",
      "✦",
    ],
    [
      "進行中",
      tasks.filter((t) => t.status === "in_progress").length,
      `全タスクで ${running} セッション稼働を観測`,
      "blue",
      "in_progress",
      "◌",
    ],
    [
      "判断・対応待ち",
      tasks.filter((t) => ["needs_input", "blocked"].includes(t.status)).length,
      "あなたの確認が必要",
      "amber",
      "attention",
      "◇",
    ],
    [
      "完了報告",
      tasks.filter((t) => t.status === "completed").length,
      "成果と根拠を確認",
      "green",
      "completed",
      "✓",
    ],
  ];
  for (const [label, count, note, color, value, icon] of rows) {
    const b = el("button", "metric");
    b.dataset.focus = `metric-${value}`;
    b.setAttribute("aria-label", `${label} ${count}件`);
    const top = el("div", "metric-top");
    top.append(el("i", `key ${color}`), el("span", "", label));
    const num = el("div", "metric-number", count);
    num.append(el("span", "metric-note", note));
    b.append(top, num, el("span", `metric-decoration ${color}`, icon));
    b.onclick = () => setFilter(value);
    target.append(b);
  }
  const waiting = tasks.filter((t) =>
    ["needs_input", "blocked"].includes(t.status),
  );
  const notice = $("#attention");
  notice.hidden = !waiting.length;
  notice.replaceChildren();
  if (waiting.length) {
    notice.append(
      el("span", "", "◇"),
      el("strong", "", `${waiting.length}件のタスクが判断・対応を待っています`),
      el(
        "span",
        "attention-text",
        mainActor(waiting[0])?.report?.human_action ?? waiting[0].summary,
      ),
      el("span", "arrow", "確認する →"),
    );
    notice.onclick = () => {
      filter = "attention";
      selectTask(waiting[0].task);
    };
  }
}
function visibleTasks() {
  return tasks.filter(
    (t) =>
      (filter === "all" ||
        (filter === "attention"
          ? ["needs_input", "blocked"].includes(t.status)
          : t.status === filter)) &&
      `${t.title} ${t.task} ${t.summary}`.toLowerCase().includes(query),
  );
}
function renderList(visible) {
  $("#task-count").textContent = visible.length;
  const list = $("#tasks");
  const scroll = list.scrollTop;
  list.replaceChildren();
  for (const task of visible) {
    const run = latest(task),
      b = el("button", `task-row${task.task === selected ? " selected" : ""}`);
    b.dataset.focus = task.task;
    b.setAttribute("aria-pressed", String(task.task === selected));
    const top = el("div", "task-row-top");
    top.append(
      el(
        "span",
        "",
        `${run.provider.toUpperCase()} · ${task.task.startsWith("DEMO") ? task.task : "LOCAL"}`,
      ),
      badge(task.status),
    );
    const meta = el("div", "task-meta");
    meta.append(
      el("span", "", `${run.actors.length} セッション`),
      el("span", "", `報告 ${age(mainActor(task)?.report?.received)}`),
    );
    b.append(
      top,
      el("span", "task-title", task.title),
      el("span", "task-summary", task.summary),
      meta,
    );
    b.onclick = () => selectTask(task.task);
    list.append(b);
  }
  if (!visible.length)
    list.append(
      el(
        "p",
        "empty",
        tasks.length
          ? "条件に一致するタスクはありません。"
          : "まだタスクがありません。右上の「タスク登録」から仕事を追加できます。",
      ),
    );
  list.scrollTop = scroll;
  document.querySelectorAll("[data-filter]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.filter === filter);
    b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  });
}
function renderGraph(task) {
  const target = $("#graph");
  target.replaceChildren();
  $("#graph-meta").textContent = "";
  $("#graph-caption").textContent =
    "タスク → 主セッション → 分担先。ノードを選んで担当ごとの結果を確認。";
  if (!task) {
    target.append(
      el(
        "p",
        "empty graph-empty",
        "タスクを選択すると、担当の関係が表示されます。",
      ),
    );
    return;
  }
  const run = latest(task),
    main = mainActor(task),
    members = run.actors.filter((a) => a !== main),
    height = Math.max(340, members.length * 88 + 60);
  const svg = svgEl("svg", {
    viewBox: `0 0 660 ${height}`,
    role: "group",
    "aria-label": `${task.title}の分担関係`,
  });
  target.append(svg);
  const center = height / 2;
  $("#graph-meta").textContent = `${run.actors.length} セッション`;
  for (const [x, label] of [
    [60, "TASK"],
    [270, "COORDINATOR"],
    [515, "DELEGATED WORK"],
  ])
    svg.append(
      svgEl(
        "text",
        { x, y: 27, class: "graph-label", "text-anchor": "middle" },
        label,
      ),
    );
  function edge(x1, y1, x2, y2, isActive, uncertain = false) {
    svg.append(
      svgEl("path", {
        d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`,
        class: `edge${isActive ? " active" : ""}${uncertain ? " uncertain" : ""}`,
      }),
    );
  }
  if (main) edge(94, center, 208, center, active(main, now));
  const root = svgEl("g", {
    class: "graph-node",
    role: "button",
    tabindex: 0,
    "aria-label": "タスク全体の結果",
    transform: `translate(65 ${center})`,
  });
  root.append(
    svgEl("rect", {
      x: -50,
      y: -36,
      width: 100,
      height: 108,
      rx: 8,
      fill: "transparent",
      "pointer-events": "all",
    }),
  );
  root.append(
    svgEl("circle", {
      r: 28,
      class: `orbit${main && active(main, now) ? " active" : ""}`,
    }),
    svgEl("path", {
      d: "M0,-17 L4,-4 L17,0 L4,4 L0,17 L-4,4 L-17,0 L-4,-4 Z",
      class: "star-core",
    }),
    svgEl("text", { y: 48, "text-anchor": "middle" }, "タスク全体"),
    svgEl(
      "text",
      { y: 66, "text-anchor": "middle", class: "node-caption" },
      labels[task.status],
    ),
  );
  root.onclick = () => {
    selectedActor = null;
    selectedEvent = null;
    render();
  };
  root.onkeydown = (e) => {
    if (["Enter", " "].includes(e.key)) {
      e.preventDefault();
      root.onclick();
    }
  };
  svg.append(root);
  function node(a, x, y) {
    const state = actorState(a);
    const g = svgEl("g", {
      transform: `translate(${x} ${y})`,
      class: `graph-node${selectedActor === a.id ? " selected" : ""}`,
      role: "button",
      tabindex: 0,
      "aria-label": `${actorName(a)}：${labels[state]}、${operational(a)}`,
    });
    g.dataset.focus = a.id;
    g.append(
      svgEl("rect", {
        x: -63,
        y: -32,
        width: 126,
        height: 64,
        rx: 8,
        class: "node-body",
      }),
      svgEl("circle", { cx: -47, cy: -12, r: 3, fill: colors[state] }),
      svgEl("text", { x: -37, y: -9 }, short(actorName(a), 9)),
      svgEl(
        "text",
        { x: -47, y: 10, class: "node-state", fill: colors[state] },
        labels[state],
      ),
      svgEl(
        "text",
        { x: -47, y: 25, class: "node-caption" },
        short(operational(a), 13),
      ),
    );
    g.onclick = () => {
      selectedActor = a.id;
      selectedEvent = null;
      render();
    };
    g.onkeydown = (e) => {
      if (["Enter", " "].includes(e.key)) {
        e.preventDefault();
        g.onclick();
      }
    };
    return g;
  }
  members.forEach((a, i) => {
    const parentKnown = main && a.agent && a.session === main.session;
    const y =
      members.length === 1
        ? center + (parentKnown ? 0 : 80)
        : 60 + (i * (height - 120)) / (members.length - 1);
    edge(parentKnown ? 334 : 94, center, 457, y, active(a, now), !parentKnown);
    svg.append(node(a, 520, y));
  });
  if (main) svg.append(node(main, 271, center));
  else
    svg.append(
      svgEl(
        "text",
        { x: 230, y: center, class: "node-caption" },
        "主セッションの接続は未確認",
      ),
    );
  if (members.some((a) => !main || !a.agent || a.session !== main.session))
    $("#graph-caption").textContent =
      "実線：観測できた親子関係。点線：同じタスクの所属のみ確認できたセッション。";
}
function renderDetail(task) {
  const panel = $("#detail"),
    scroll = panel.scrollTop;
  panel.replaceChildren();
  if (!task) {
    panel.append(
      el("p", "empty", "タスクを選択すると、結果と判断材料を表示します。"),
    );
    return;
  }
  const run = latest(task),
    actor = run.actors.find((a) => a.id === selectedActor) ?? mainActor(task),
    report = selectedEvent?.payload ?? actor?.report;
  const top = el("div", "detail-kicker");
  top.append(
    el(
      "span",
      "",
      selectedEvent
        ? "過去の報告"
        : selectedActor
          ? "担当の結果"
          : "タスク全体の結果",
    ),
    badge(report?.status ?? task.status),
  );
  panel.append(
    top,
    el("h2", "", selectedActor && actor ? actorName(actor) : task.title),
    el("p", "lead", report?.summary ?? task.summary),
  );
  if (mode === "real") {
    const launch = el("button", "launch-action", "起動コマンドを表示");
    launch.dataset.focus = "launch-task";
    launch.onclick = () => openLaunch(task);
    panel.append(launch);
    if (task.request) {
      const section = el("section", "detail-section");
      section.append(
        el("h3", "", "依頼内容"),
        el("p", "task-request", task.request),
      );
      panel.append(section);
    }
    for (const link of task.links ?? []) {
      if (!/^https?:\/\//.test(link)) continue;
      const a = el("a", "task-request", link);
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      panel.append(a);
    }
  }
  for (const [key, label] of [
    ["human_action", "あなたへの依頼"],
    ["conclusion", "結論"],
    ["rationale", "判断の根拠"],
    ["evidence", "確認したこと"],
    ["remaining", "残っていること"],
  ]) {
    if (report?.[key]) {
      const section = el(
        "section",
        `detail-section${key === "human_action" ? " human-action" : ""}`,
      );
      section.append(el("h3", "", label), el("p", "", report[key]));
      panel.append(section);
    }
  }
  if (!report)
    panel.append(
      el(
        "p",
        "empty",
        "報告はまだ届いていません。応答の終了だけでは、完了と判定しません。",
      ),
    );
  const bottom = el("div", "detail-footer");
  bottom.append(
    el(
      "div",
      "",
      `最終観測：${actor ? operational(actor) : "未接続"} · ${age(actor?.last_observed)}`,
    ),
    el(
      "div",
      "",
      `報告日時：${stamp(selectedEvent?.received ?? report?.received)}`,
    ),
    el("div", "", `作業先：${run.cwd}`),
    el("div", "", `セッション：${actor?.session ?? "未接続"}`),
  );
  panel.append(bottom);
  panel.scrollTop = scroll;
}
function renderTimeline(task) {
  const target = $("#timeline");
  target.replaceChildren();
  $("#timeline-range").textContent = "";
  if (!task || !latest(task).actors.length) {
    target.append(
      el(
        "p",
        "empty",
        "セッションのイベントが届くと、観測区間が表示されます。",
      ),
    );
    return;
  }
  const run = latest(task),
    dates = run.events.map((e) => Date.parse(e.received));
  const start = Math.min(Date.parse(run.created), ...dates);
  let end = Math.max(start + 1000, ...dates);
  if (run.actors.some((a) => active(a, now))) end = Math.max(end, now);
  const duration = end - start;
  $("#timeline-range").textContent = `${time(start)} — ${time(end)}`;
  const wrap = el("div", "timeline-wrap"),
    axis = el("div", "time-axis");
  axis.append(el("span", "", "担当 / 最後の観測"));
  const ticks = el("div", "ticks");
  for (let i = 0; i <= 4; i++)
    ticks.append(el("span", "", time(start + (duration * i) / 4)));
  axis.append(ticks);
  wrap.append(axis);
  for (const actor of run.actors) {
    const row = el("div", "time-row"),
      label = el("div", "time-label", actorName(actor));
    label.append(el("small", "", operational(actor)));
    const track = el("div", "time-track");
    for (const interval of observedIntervals(run.events, actor.id, end)) {
      const b = el("button", `interval ${interval.state}`);
      b.style.left = `${((interval.start - start) / duration) * 100}%`;
      b.style.width = `${((interval.end - interval.start) / duration) * 100}%`;
      b.title = `${actorName(actor)} · ${operations[interval.state] ?? "未観測"} · ${time(interval.start)}–${time(interval.end)}`;
      b.setAttribute("aria-label", b.title);
      b.onclick = () => {
        selectedActor = actor.id;
        selectedEvent = null;
        render();
      };
      track.append(b);
    }
    for (const e of run.events.filter(
      (e) => e.actor === actor.id && e.kind === "ProgressReport",
    )) {
      const mark = el("button", `time-marker ${e.payload.status}`);
      mark.style.left = `${Math.min(99, ((Date.parse(e.received) - start) / duration) * 100)}%`;
      mark.title = `${time(e.received)} ${e.payload.summary}`;
      mark.setAttribute("aria-label", mark.title);
      mark.dataset.focus = e.id;
      mark.onclick = () => {
        selectedActor = actor.id;
        selectedEvent = e;
        renderDetail(task);
      };
      track.append(mark);
    }
    row.append(label, track);
    wrap.append(row);
  }
  target.append(wrap);
}
function renderFeed() {
  const relevant = {
    ProgressReport: "進捗報告",
    SubagentStart: "分担を開始",
    SubagentStop: "担当の応答が終了",
    SessionStart: "セッションを開始",
    StopFailure: "APIエラー",
    Interrupt: "中断",
    SessionEnd: "セッションが終了",
  };
  const events = tasks
    .flatMap((t) =>
      latest(t)
        .events.filter((e) => relevant[e.kind])
        .map((e) => ({ ...e, task: t })),
    )
    .sort((a, b) => Date.parse(b.received) - Date.parse(a.received))
    .slice(0, 20);
  const feed = $("#feed"),
    scroll = feed.scrollTop;
  feed.replaceChildren();
  $("#feed-meta").textContent = `${events.length} EVENTS`;
  for (const e of events) {
    const fresh = seen.size > 0 && !seen.has(e.id);
    const row = el("div", `feed-item${fresh ? " new-event" : ""}`),
      body = el("div");
    body.append(
      el("p", "", e.payload.summary ?? relevant[e.kind]),
      el("small", "", e.task.title),
    );
    row.append(
      el(
        "i",
        `key ${e.payload.status === "completed" ? "green" : e.payload.status === "needs_input" ? "amber" : "blue"}`,
      ),
      body,
      el("time", "", time(e.received)),
    );
    feed.append(row);
  }
  if (!events.length)
    feed.append(el("p", "empty", "新しい報告がここに届きます。"));
  if (events.some((e) => !seen.has(e.id)) && seen.size)
    $("#announcement").textContent = "新しい活動を受信しました。";
  seen = new Set(events.map((e) => e.id));
  feed.scrollTop = scroll;
}
function render() {
  const focus = document.activeElement?.dataset.focus;
  now = mode === "demo" ? epoch + second * 1000 : Date.now();
  tasks = mode === "demo" ? demoTasks(second, epoch) : realTasks;
  const visible = visibleTasks();
  if (!visible.some((t) => t.task === selected)) {
    selected =
      visible.find((t) => ["needs_input", "blocked"].includes(t.status))
        ?.task ??
      visible[0]?.task ??
      null;
    selectedActor = null;
    selectedEvent = null;
  }
  renderMetrics();
  renderList(visible);
  const task = visible.find((t) => t.task === selected);
  renderGraph(task);
  renderDetail(task);
  renderTimeline(task);
  renderFeed();
  $("#replay").hidden = mode !== "demo";
  $("#play").textContent = playing ? "一時停止" : "再生";
  $("#scrub").value = second;
  $("#replay-time").textContent =
    `${String(Math.floor(second / 60)).padStart(2, "0")}:${String(second % 60).padStart(2, "0")} / 02:00`;
  $("#source-note").textContent =
    mode === "demo"
      ? "DEMO · 架空の再生データ / 実際の作業記録は変更しません"
      : "LOCAL WORKSPACE · 2秒ごとに取得 / 古い稼働は観測途絶として表示";
  for (const id of ["real", "demo"]) {
    $(`#${id}-mode`).classList.toggle("selected", mode === id);
    $(`#${id}-mode`).setAttribute("aria-pressed", String(mode === id));
  }
  if (focus)
    document
      .querySelector(`[data-focus="${CSS.escape(focus)}"]`)
      ?.focus({ preventScroll: true });
}
function switchMode(next) {
  mode = next;
  selected = null;
  selectedActor = null;
  selectedEvent = null;
  filter = "all";
  seen = new Set();
  query = "";
  $("#search").value = "";
  if (next === "demo") {
    epoch = Date.now() - 45000;
    second = 45;
    playing = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  render();
}
$("#real-mode").onclick = () => switchMode("real");
$("#demo-mode").onclick = () => switchMode("demo");
$("#play").onclick = () => {
  if (second >= 120) second = 0;
  playing = !playing;
  render();
};
$("#scrub").oninput = (e) => {
  second = Number(e.target.value);
  playing = false;
  selectedEvent = null;
  render();
};
$("#search").oninput = (e) => {
  query = e.target.value.toLowerCase();
  render();
};
document
  .querySelectorAll("[data-filter]")
  .forEach((b) => (b.onclick = () => setFilter(b.dataset.filter)));
async function refresh() {
  try {
    const response = await fetch("/api/tasks", {
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401 && !$("#login-dialog").open)
      $("#login-dialog").showModal();
    if (!response.ok) throw new Error("fetch");
    const data = await response.json();
    realTasks = data.tasks;
    const next = JSON.stringify(realTasks);
    if (next !== signature) {
      signature = next;
      if (mode === "real") render();
    }
    connectionError = false;
    $("#connection").textContent = "接続済み · " + time(Date.now());
    $("#connection").classList.remove("error");
  } catch {
    connectionError = true;
    $("#connection").textContent = "接続切断 · 保存済み表示";
    $("#connection").classList.add("error");
  } finally {
    setTimeout(refresh, 2000);
  }
}
setInterval(() => {
  $("#clock").textContent = time(Date.now());
  if (mode === "demo" && playing) {
    second = Math.min(120, second + 2);
    if (second === 120) playing = false;
    render();
  } else if (mode === "real" && !connectionError) {
    render();
  }
}, 1000);
render();
refresh();

let launchTask;
function updateLaunch() {
  if (!/^[a-zA-Z0-9_-]+$/.test(launchTask.task)) {
    $("#launch-command").value =
      "旧形式のタスクIDです。新しくタスクを登録してください。";
    $("#copy-launch").disabled = true;
    return;
  }
  $("#copy-launch").disabled = false;
  $("#launch-command").value =
    `tobari start --task ${launchTask.task} --provider ${$("#launch-provider").value}`;
}
function openLaunch(task) {
  launchTask = task;
  $("#launch-task-title").textContent = task.title;
  $("#setup-command").textContent =
    `npm link --omit=dev\ntobari connect --server ${location.origin}`;
  $("#copy-status").textContent = "";
  updateLaunch();
  $("#launch-dialog").showModal();
}
$("#launch-provider").onchange = updateLaunch;
$("#close-launch").onclick = () => $("#launch-dialog").close();
$("#copy-launch").onclick = async () => {
  const field = $("#launch-command");
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(field.value);
    else {
      field.focus();
      field.select();
      if (!document.execCommand("copy")) throw new Error("copy");
    }
    $("#copy-status").textContent =
      "コピーしました。ターミナルで実行してください。";
  } catch {
    field.focus();
    field.select();
    $("#copy-status").textContent =
      "選択したコマンドを Ctrl+C / ⌘C でコピーしてください。";
  }
};
$("#new-task").onclick = () => {
  $("#task-error").textContent = "";
  $("#task-dialog").showModal();
};
$("#cancel-task").onclick = () => $("#task-dialog").close();
$("#task-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  data.links = data.links
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || "登録できませんでした");
    realTasks.unshift(task);
    signature = "";
    switchMode("real");
    selectTask(task.task);
    $("#task-dialog").close();
    form.reset();
    openLaunch(task);
  } catch (error) {
    $("#task-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
$("#login-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("#login-form").onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget,
    submit = form.querySelector("[type=submit]");
  submit.disabled = true;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    form.reset();
    $("#login-error").textContent = "";
    $("#login-dialog").close();
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    submit.disabled = false;
  }
};
