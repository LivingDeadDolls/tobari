import { stateEvents } from "./model.js";
// Deliberately synthetic, browser-only data; never written to the user's SQLite store.
export function demoTasks(second, epoch) {
  const specs = [
    {
      id: "DEMO-01",
      title: "認証フローの不具合修正",
      provider: "codex",
      start: 0,
      children: ["原因調査", "修正・テスト", "独立レビュー"],
      reports: [
        [4, "in_progress", "再現条件を特定。調査とテストを並列で進行中"],
        [35, "needs_input", "原因は期限判定。既存セッションの扱いに判断が必要"],
        [65, "in_progress", "既存セッションを維持する方針で修正中"],
        [100, "completed", "修正・回帰テスト完了。既存セッションへの影響なし"],
      ],
      conclusion: "トークンの期限判定に境界値の不具合がありました。",
      rationale:
        "利用中のセッションを切断しないことを優先し、期限判定のみを変更します。",
      evidence: "再現テスト・境界値テストを確認（デモ）。",
      remaining: "期限判定の修正と独立レビュー",
      human_action: "既存セッションは維持する方針で進めてよいですか？",
    },
    {
      id: "DEMO-02",
      title: "検索APIのレスポンス改善",
      provider: "claude",
      start: 8,
      children: ["クエリ分析", "性能検証"],
      reports: [
        [12, "in_progress", "ボトルネックを特定。改善案を計測中"],
        [78, "completed", "クエリを削減。性能検証まで完了"],
      ],
      conclusion: "重複したデータ取得をまとめました。",
      rationale: "レスポンス形式を変えずにクエリ回数を削減。",
      evidence: "負荷テストの改善を確認（デモ）。",
      remaining: "なし",
    },
    {
      id: "DEMO-03",
      title: "通知設定のアクセシビリティ",
      provider: "codex",
      start: 2,
      children: ["キーボード操作"],
      reports: [
        [5, "in_progress", "フォーカス移動とラベルを確認中"],
        [30, "completed", "キーボード操作と読み上げラベルを修正済み"],
      ],
      conclusion: "通知設定をキーボードのみで操作できます。",
      rationale: "フォーカス順と明示的なラベルを基準に確認。",
      evidence: "操作手順とラベルを検証（デモ）。",
      remaining: "なし",
    },
    {
      id: "DEMO-04",
      title: "デプロイ手順の整備",
      provider: "claude",
      start: 15,
      children: [],
      reports: [
        [18, "in_progress", "既存手順と環境差分を整理中"],
        [40, "blocked", "検証環境へのアクセス待ち。手順書は作成済み"],
        [90, "in_progress", "検証環境が復旧。手順を再実行中"],
        [115, "completed", "手順の再実行とロールバック確認が完了"],
      ],
      conclusion: "環境の準備手順と戻し方を整理しました。",
      rationale: "第三者が同じ手順を再現できることを基準にしています。",
      evidence: "手順のレビューを実施（デモ）。",
      remaining: "検証環境での実行確認",
      human_action: "検証環境へのアクセスを確認してください。",
    },
  ];
  return specs
    .filter((s) => s.start <= second)
    .map((s) => {
      const stamp = (t) => new Date(epoch + t * 1000).toISOString();
      const root = {
        id: s.id + "-main",
        session: s.id + "-session",
        agent: "",
        role: "coordinator",
        name: "取りまとめ",
        operational: "idle",
        last_observed: stamp(s.start),
        report: null,
      };
      const actors = [root];
      const events = [];
      const add = (t, actor, kind, payload = {}) => {
        if (t <= second)
          events.push({
            id: `${s.id}-${actor}-${kind}-${t}`,
            actor,
            kind,
            payload,
            received: stamp(t),
          });
      };
      add(s.start, root.id, "SessionStart");
      add(s.start + 1, root.id, "UserPromptSubmit");
      const final = s.reports.at(-1)[0];
      for (let t = s.start + 10; t < final; t += 10)
        add(t, root.id, "PostToolUse");
      s.children.forEach((name, i) => {
        const start = s.start + 6 + i * 4;
        if (start > second) return;
        const actor = {
          id: `${s.id}-child-${i}`,
          session: root.session,
          agent: `agent-${i}`,
          role: "member",
          name,
          operational: "running",
          last_observed: stamp(start),
          report: null,
        };
        actors.push(actor);
        add(start, actor.id, "SubagentStart");
        const end = Math.min(final - 3, start + 22 + i * 15);
        for (let t = start + 7; t < end; t += 7)
          add(t, actor.id, "PostToolUse");
        if (end <= second) {
          actor.report = {
            revision: 1,
            status: "completed",
            summary: `${name}が完了`,
            conclusion: `担当の${name}を完了しました。`,
            rationale: "担当範囲の受け入れ条件と照合。",
            evidence: "デモ用の確認結果",
            remaining: "なし",
            received: stamp(end),
          };
          add(end, actor.id, "ProgressReport", actor.report);
          add(end + 0.2, actor.id, "SubagentStop");
        }
      });
      s.reports.forEach(([t, status, summary], i) => {
        const report = {
          revision: i + 1,
          status,
          summary,
          conclusion: s.conclusion,
          rationale: s.rationale,
          evidence: s.evidence,
          remaining: status === "completed" ? "なし" : s.remaining,
          human_action: ["needs_input", "blocked"].includes(status)
            ? s.human_action
            : undefined,
          received: stamp(t),
        };
        if (t <= second) root.report = report;
        add(t, root.id, "ProgressReport", report);
        if (["needs_input", "blocked", "completed"].includes(status))
          add(t + 0.1, root.id, "Stop");
        else add(t + 0.1, root.id, "UserPromptSubmit");
      });
      // No artificial activity while the coordinator is waiting for a decision.
      const filtered = events.filter(
        (e) =>
          e.kind !== "PostToolUse" ||
          e.actor !== root.id ||
          !s.reports.some(
            ([t, status], i) =>
              ["needs_input", "blocked"].includes(status) &&
              Date.parse(e.received) >= epoch + t * 1000 &&
              Date.parse(e.received) <
                epoch + (s.reports[i + 1]?.[0] ?? Infinity) * 1000,
          ),
      );
      filtered.sort((a, b) => Date.parse(a.received) - Date.parse(b.received));
      for (const a of actors) {
        const own = filtered.filter((e) => e.actor === a.id);
        for (const e of own) {
          a.operational = stateEvents[e.kind] ?? a.operational;
          a.last_observed = e.received;
        }
      }
      return {
        task: s.id,
        title: s.title,
        status: root.report?.status ?? "unreported",
        summary: root.report?.summary ?? "開始を観測",
        launches: [
          {
            id: s.id,
            task: s.id,
            title: s.title,
            provider: s.provider,
            created: stamp(s.start),
            cwd: "demo / product",
            root_session: root.session,
            actors,
            events: filtered,
          },
        ],
      };
    });
}
