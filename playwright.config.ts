import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "mkdir -p .cache && rm -f .cache/rackpad-e2e.db .cache/rackpad-e2e.db-shm .cache/rackpad-e2e.db-wal && DATABASE_PATH=.cache/rackpad-e2e.db NODE_ENV=test RACKPAD_RATE_LIMIT_DISABLED=1 npm run dev:all",
    url: "http://127.0.0.1:5173/api/auth/status",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
