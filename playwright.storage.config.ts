import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: "storage-compat.spec.ts",
  projects: [
    { name: "storage-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "storage-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    command: `node scripts/start-e2e.mjs${process.env.RACKPAD_TEST_STORAGE_UPGRADE === "1" ? " --storage-upgrade" : ""}`,
    url: "http://127.0.0.1:5173/api/auth/status",
    timeout: 120000,
    reuseExistingServer: false,
  },
});
