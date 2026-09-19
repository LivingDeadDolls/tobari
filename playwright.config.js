import { defineConfig } from "@playwright/test";
process.env.NO_PROXY = [process.env.NO_PROXY, "localhost", "127.0.0.1"]
  .filter(Boolean)
  .join(",");
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1512, height: 982 },
    launchOptions: {
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : process.platform === "linux"
          ? { executablePath: "/usr/bin/google-chrome" }
          : {}),
    },
  },
  webServer: {
    command: "npm run dev -- --port 3100 --db .tobari/e2e.sqlite --no-auth",
    wait: {stdout: /Keep this window open/},
    reuseExistingServer: false,
  },
});
