import { test, expect } from "@playwright/test";
test.describe.configure({ mode: "serial" });
async function demo(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "動作デモ" }).click();
  await page.getByRole("button", { name: "一時停止" }).click();
}
test("タスク登録からCLI起動コマンド・依頼とリンクを表示する", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "＋ タスク登録" }).click();
  await page.getByLabel("タイトル", { exact: true }).fill("新しい実タスク");
  await page
    .getByLabel("依頼内容", { exact: true })
    .fill("要件を確認して修正とテストを行う");
  await page
    .getByLabel("CLIを動かすPC上の作業フォルダー")
    .fill("C:\\projects\\my app");
  await page
    .getByLabel("関連リンク")
    .fill("https://github.com/example/repo/issues/12");
  await page
    .getByRole("button", { name: "登録して起動コマンドを表示" })
    .click();
  await expect(page.locator("#launch-dialog")).toBeVisible();
  await page.screenshot({path: 'test-results/launch.png', fullPage: true});
  await expect(page.locator("#launch-command")).toHaveValue(
    /^tobari start --task [a-f0-9-]+ --provider codex$/,
  );
  await page.getByLabel("エージェント", { exact: true }).selectOption("claude");
  await expect(page.locator("#launch-command")).toHaveValue(
    /--provider claude$/,
  );
  await page
    .getByRole("button", { name: "起動コマンドをコピー", exact: true })
    .click();
  await expect(page.locator("#copy-status")).toContainText("コピー");
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(page.locator("#detail")).toContainText("登録済み・CLI起動待ち");
  await expect(page.locator("#detail")).toContainText(
    "要件を確認して修正とテストを行う",
  );
  await expect(page.locator("#detail a")).toHaveAttribute(
    "href",
    "https://github.com/example/repo/issues/12",
  );
  expect(errors).toEqual([]);
});
test("実データ・デモが分離され、関係図から担当の結果を確認できる", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/tasks")).json();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await demo(page);
  await expect(page.locator("#replay")).toContainText("架空の4タスク");
  await expect(page.locator("#tasks .task-row")).toHaveCount(4);
  await page.getByRole("button", { name: /原因調査：/ }).click();
  await expect(page.locator("#detail h2")).toHaveText("原因調査");
  await expect(page.locator("#detail")).toContainText("担当の原因調査を完了");
  await page
    .getByRole("button", { name: "タスク全体の結果", exact: true })
    .click();
  await expect(page.locator("#detail")).toContainText(
    "既存セッションは維持する方針",
  );
  await page.getByRole("button", { name: "実データ", exact: true }).click();
  await expect(page.locator("#replay")).toBeHidden();
  await expect(page.locator("#tasks")).not.toContainText("DEMO-01");
  expect((await (await request.get("/api/tasks")).json()).tasks).toEqual(
    before.tasks,
  );
  expect(errors).toEqual([]);
});
test("検索・状態フィルター・判断待ちからの選択が連動する", async ({ page }) => {
  await demo(page);
  await page.locator("#attention").click();
  await expect(page.locator(".task-row")).toHaveCount(2);
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(page.locator("#detail h2")).toHaveText(
    "通知設定のアクセシビリティ",
  );
  await page.getByRole("button", { name: "すべて", exact: true }).click();
  await page.getByRole("textbox", { name: "タスクを検索" }).fill("検索API");
  await expect(page.locator(".task-row")).toHaveCount(1);
  await expect(page.locator("#detail h2")).toHaveText(
    "検索APIのレスポンス改善",
  );
  await page
    .getByRole("textbox", { name: "タスクを検索" })
    .fill("存在しないタスク");
  await expect(page.locator("#graph")).toContainText("タスクを選択");
});
test("再生位置で状態・関係図・タイムラインが変化し、過去の報告を開ける", async ({
  page,
}) => {
  await demo(page);
  const range = page.getByRole("slider", { name: "デモの再生位置" });
  await range.fill("120");
  await expect(page.locator("#metrics")).toContainText("完了報告");
  await expect(page.locator("#metrics .metric").last()).toContainText("4");
  await expect(page.locator("#attention")).toBeHidden();
  await page.locator(".time-marker").first().click();
  await expect(page.locator("#detail")).toContainText("過去の報告");
  await range.fill("45");
  await expect(page.locator("#attention")).toBeVisible();
  await expect(page.locator(".edge.active")).not.toHaveCount(0);
  const animation = await page
    .locator(".edge.active")
    .first()
    .evaluate((e) => getComputedStyle(e).animationName);
  expect(animation).toBe("flow");
  await page.getByRole("button", { name: "再生", exact: true }).click();
  await expect(range).not.toHaveValue("45");
});
test("モバイルで画面全体が横にあふれず、低モーション設定を尊重する", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "動作デモ" }).click();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".edge.active")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
  ).toBe("none");
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("通信失敗を表示し、復旧後に新しい報告を反映する", async ({ page }) => {
  let fail = false,
    updated = false;
  await page.route("**/api/tasks", async (route) => {
    if (fail) return route.fulfill({ status: 503, body: "offline" });
    const data = {
      tasks: [
        {
          task: "connection-test",
          title: "接続検証",
          status: "unreported",
          summary: updated ? "新しい到達点を受信" : "報告待ち",
          created: new Date().toISOString(),
          launches: [],
        },
      ],
    };
    return route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("接続済み");
  fail = true;
  await expect(page.locator("#connection")).toContainText("接続切断", {
    timeout: 10000,
  });
  fail = false;
  updated = true;
  await expect(page.locator("#connection")).toContainText("接続済み", {
    timeout: 10000,
  });
  await expect(page.locator("#tasks")).toContainText("新しい到達点を受信");
});
