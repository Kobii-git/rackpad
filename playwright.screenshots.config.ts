import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/screenshots",
  testMatch: "capture.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: "list",
  outputDir: ".cache/rackpad-screenshot-results",
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    viewport: { width: 1920, height: 1200 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    screenshot: "off",
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        "--disable-gpu",
        "--disable-lcd-text",
        "--disable-font-subpixel-positioning",
        "--font-render-hinting=none",
      ],
    },
  },
  webServer: {
    command:
      'RACKPAD_CAPTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/rackpad-screenshots.XXXXXX"); trap \'rm -rf "$RACKPAD_CAPTURE_DIR"\' EXIT INT TERM; mkdir -p "$RACKPAD_CAPTURE_DIR/native"; DATABASE_PATH="$RACKPAD_CAPTURE_DIR/rackpad.db" RACKPAD_NATIVE_BACKUP_DIR="$RACKPAD_CAPTURE_DIR/native" RACKPAD_SECRET_KEY=rackpad-screenshot-capture-secret NODE_ENV=test RACKPAD_RATE_LIMIT_DISABLED=1 SNMP_INVENTORY_SYNC=1 INTEGRATION_STATUS_INTERVAL_MS=0 RACKPAD_FREEZE_SCREENSHOT_TIME=1 NODE_OPTIONS=--import=./scripts/screenshots/fixed-time.mjs npm run dev:all',
    url: "http://127.0.0.1:5173/api/auth/status",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
