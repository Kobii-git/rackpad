#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.RACKPAD_SCREENSHOT_URL ?? "http://127.0.0.1:3050";
const token = process.env.RACKPAD_SCREENSHOT_TOKEN;
const outputDir = process.env.RACKPAD_SCREENSHOT_DIR ?? "docs/screenshots";
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? "9224");
const profileDir =
  process.env.CHROME_USER_DATA_DIR ?? "/private/tmp/rackpad-doc-screenshots";

if (!token) {
  throw new Error("Set RACKPAD_SCREENSHOT_TOKEN to an authenticated Rackpad token.");
}

const captures = [
  { file: "dashboard.png", path: "/" },
  { file: "racks.png", path: "/racks" },
  { file: "devices.png", path: "/devices" },
  { file: "ports.png", path: "/ports" },
  { file: "cables.png", path: "/cables" },
  { file: "ipam.png", path: "/ipam" },
  {
    file: "visualizer.png",
    path: "/visualizer",
    storage: {
      "rackpad.visualizer.layout-mode": "diagram",
    },
  },
  {
    file: "visualizer-cables.png",
    path: "/visualizer",
    storage: {
      "rackpad.visualizer.layout-mode": "grouped",
      "rackpad.visualizer.rack-face-mode": "both",
    },
  },
  {
    file: "visualizer-health.png",
    path: "/visualizer",
    storage: {
      "rackpad.visualizer.health": "true",
      "rackpad.visualizer.layout-mode": "grouped",
    },
  },
  {
    file: "visualizer-trace.png",
    path: "/visualizer",
    storage: {
      "rackpad.visualizer.layout-mode": "pyramid",
    },
  },
  {
    file: "visualizer-layout.png",
    path: "/visualizer",
    storage: {
      "rackpad.visualizer.layout-mode": "grouped",
      "rackpad.visualizer.loose-placement": "below-racks",
      "rackpad.visualizer.room-only-sections": "true",
    },
  },
  { file: "monitoring.png", path: "/monitoring" },
  { file: "compute.png", path: "/compute" },
  { file: "wifi.png", path: "/wifi" },
  { file: "discovery.png", path: "/discovery" },
  { file: "documentation.png", path: "/documentation" },
];

await rm(profileDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--window-size=1920,1200",
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

let chromeExited = false;
chrome.on("exit", () => {
  chromeExited = true;
});

try {
  const page = await openDebugPage();
  const client = await createCdpClient(page.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await navigate(client, "/");
  await client.send("Runtime.evaluate", {
    expression: `
      localStorage.setItem("rackpad.auth.token", ${JSON.stringify(token)});
      localStorage.setItem("rackpad-theme", "light");
      document.documentElement.classList.add("light");
      document.documentElement.classList.remove("dark");
    `,
  });

  for (const capture of captures) {
    await prepareStorage(client, capture.storage ?? {});
    await navigate(client, capture.path);
    await waitForApp(client);
    await client.send("Runtime.evaluate", {
      expression: `
        document.documentElement.classList.add("light");
        document.documentElement.classList.remove("dark");
      `,
    });
    await delay(Number(process.env.RACKPAD_SCREENSHOT_DELAY_MS ?? "1200"));
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(`${outputDir}/${capture.file}`, Buffer.from(result.data, "base64"));
    console.log(`captured ${capture.file}`);
  }

  await client.close();
} finally {
  if (!chromeExited) chrome.kill("SIGTERM");
}

async function openDebugPage() {
  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Unable to open Chrome debug page: ${response.status}`);
  }
  return response.json();
}

async function waitForJson(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 10_000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();

    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const messageId = ++id;
          ws.send(JSON.stringify({ id: messageId, method, params }));
          return new Promise((sendResolve, sendReject) => {
            pending.set(messageId, { resolve: sendResolve, reject: sendReject });
          });
        },
        close() {
          ws.close();
        },
      });
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(message.error.message));
      } else {
        request.resolve(message.result ?? {});
      }
    });

    ws.addEventListener("error", reject);
  });
}

async function prepareStorage(client, storage) {
  const entries = {
    "rackpad-theme": "light",
    "rackpad.visualizer.health": "false",
    "rackpad.visualizer.layout-mode": "grouped",
    "rackpad.visualizer.loose-placement": "beside-racks",
    "rackpad.visualizer.room-only-sections": "false",
    "rackpad.visualizer.rack-face-mode": "front",
    ...storage,
  };
  await client.send("Runtime.evaluate", {
    expression: Object.entries(entries)
      .map(([key, value]) => `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join("\n"),
  });
}

async function navigate(client, path) {
  await client.send("Page.navigate", { url: `${appUrl}${path}` });
  await delay(500);
}

async function waitForApp(client) {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const result = await client.send("Runtime.evaluate", {
      expression: `
        !document.body.innerText.includes("Sign in") &&
        !document.body.innerText.includes("Loading") &&
        document.body.innerText.length > 200
      `,
      returnByValue: true,
    });
    if (result.result?.value === true) return;
    await delay(250);
  }
}
