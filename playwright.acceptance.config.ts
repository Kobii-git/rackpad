import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

process.env.MCP_ENABLED = "1";

export default defineConfig({
  ...base,
  grep: /guided template editor|remaining feedback template colors|template block transfers|mixed-model220-port stacks|Rack Studio rejects an occupied drag|Rack Studio reveals both devices|MCP token UI|24 short patch cords/,
  projects: [
    { name: "acceptance-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "acceptance-firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    ...base.webServer,
    command: "node scripts/start-e2e.mjs",
    url: "http://127.0.0.1:5173/api/auth/status",
    env: { MCP_ENABLED: "1" },
  },
});
