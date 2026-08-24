import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const WIDTH = 1920;
const HEIGHT = 1200;
// Keep this synchronized with fixed-time.mjs, which freezes the server clock.
const SCREENSHOT_TIME_MS = Date.parse("2026-08-24T18:00:00.000Z");
const OUTPUT_DIR = resolve(process.cwd(), "docs/screenshots");
const LEGACY_ASSETS = ["ipam.png"] as const;

type Theme = "light" | "dark";
type SetupName =
  | "none"
  | "proxmox-review"
  | "cable-bulk"
  | "storage-pool"
  | "storage-template"
  | "integrations-schedule"
  | "device-type-usage"
  | "duplicate-macs"
  | "visualizer-fit"
  | "visualizer-cable"
  | "visualizer-trace";

type FocalTarget =
  | { kind: "heading"; name: string }
  | { kind: "testId"; value: string }
  | { kind: "text"; value: string; exact?: boolean }
  | { kind: "css"; value: string };

type Scene = {
  filename: string;
  route: string;
  theme: Theme;
  setup: SetupName;
  focal: FocalTarget;
  scroll?: boolean;
  storage?: Record<string, string>;
};

const workspaceScenes: Scene[] = [
  scene("dashboard.png", "/", "Dashboard"),
  scene("labs.png", "/labs", "Labs"),
  scene("racks.png", "/racks?rackId=rack_net", "Racks / Rooms"),
  scene("devices.png", "/devices", "Devices"),
  scene("compute.png", "/compute", "Compute"),
  scene("storage.png", "/storage?tab=drives", "Storage"),
  scene("wifi.png", "/wifi", "WiFi"),
  scene("discovery.png", "/discovery", "Discovery"),
  {
    ...scene("imports.png", "/imports", "Imports"),
    setup: "proxmox-review",
    focal: { kind: "text", value: "sample-pve-04", exact: true },
    scroll: true,
  },
  scene("monitoring.png", "/monitoring", "Monitoring"),
  {
    ...scene(
      "ports.png",
      "/ports?deviceId=d_srv_pve1&portId=p_d_srv_pve1_bond0",
      "Ports",
    ),
    focal: { kind: "testId", value: "ports-inspector" },
  },
  {
    ...scene("cables.png", "/cables", "Cables"),
    setup: "cable-bulk",
    focal: { kind: "testId", value: "cable-bulk-editor" },
    scroll: true,
  },
  scene("networks.png", "/networks?subnetId=s_default", "Networks"),
  scene("reports.png", "/reports", "Reports"),
  scene("audit-log.png", "/audit-log", "Audit log"),
  {
    ...scene("visualizer.png", "/visualizer", "Visualizer"),
    storage: { "rackpad.visualizer.layout-mode": "diagram" },
  },
  scene("documentation.png", "/documentation", "Documentation"),
  {
    ...scene("device-types.png", "/admin/device-types", "Device types"),
    setup: "device-type-usage",
    focal: { kind: "testId", value: "device-type-usage" },
  },
  scene("admin.png", "/admin", "Admin"),
];

const detailScenes: Scene[] = [
  {
    ...scene(
      "storage-drives.png",
      "/storage?tab=drives&driveId=drv_demo_1",
      "Storage",
    ),
    focal: { kind: "heading", name: "Seagate Exos X18" },
  },
  {
    ...scene("storage-pools.png", "/storage?tab=pools", "Storage"),
    setup: "storage-pool",
    focal: { kind: "heading", name: "tank" },
  },
  {
    ...scene("storage-templates.png", "/storage?tab=templates", "Storage"),
    setup: "storage-template",
    focal: { kind: "heading", name: "12-bay external SAS shelf" },
  },
  {
    ...scene(
      "device-storage.png",
      "/devices/d_srv_nas?tab=storage",
      "truenas-01",
    ),
    focal: { kind: "text", value: "Drive bays", exact: true },
    scroll: true,
  },
  {
    ...scene("device-compute.png", "/devices/d_srv_pve1?tab=compute", "pve-01"),
    focal: { kind: "testId", value: "device-compute-panel" },
    scroll: true,
  },
];

const operationalScenes: Scene[] = [
  {
    ...scene("integrations.png", "/imports", "Imports"),
    setup: "integrations-schedule",
    focal: {
      kind: "text",
      value: "Nightly review at 02:00 UTC",
      exact: true,
    },
    scroll: true,
  },
  {
    ...scene("device-snmp-sync.png", "/devices/d_fw?tab=monitoring", "fw-01"),
    focal: { kind: "text", value: "SNMP inventory sync", exact: true },
    scroll: true,
  },
  {
    ...scene(
      "devices-duplicate-macs.png",
      "/devices?mac=duplicates",
      "Devices",
    ),
    setup: "duplicate-macs",
    focal: { kind: "testId", value: "duplicate-mac-summary" },
    scroll: true,
  },
  {
    ...scene("devices-ip-mismatches.png", "/devices?ip=mismatch", "Devices"),
    focal: { kind: "testId", value: "ip-mismatch-summary" },
    scroll: true,
  },
  {
    ...scene("admin-backups.png", "/admin", "Admin"),
    focal: { kind: "testId", value: "native-backup-panel" },
    scroll: true,
  },
];

const visualizerScenes: Scene[] = [
  {
    ...scene("visualizer-cables.png", "/visualizer", "Visualizer"),
    setup: "visualizer-cable",
    focal: { kind: "text", value: "Selected cable", exact: true },
    storage: { "rackpad.visualizer.layout-mode": "grouped" },
  },
  {
    ...scene("visualizer-health.png", "/visualizer", "Visualizer"),
    storage: {
      "rackpad.visualizer.health": "true",
      "rackpad.visualizer.layout-mode": "grouped",
    },
  },
  {
    ...scene("visualizer-pyramid.png", "/visualizer", "Visualizer"),
    setup: "visualizer-fit",
    focal: { kind: "text", value: "Pyramid view", exact: true },
    storage: { "rackpad.visualizer.layout-mode": "pyramid" },
  },
  {
    ...scene("visualizer-trace.png", "/visualizer", "Visualizer"),
    setup: "visualizer-trace",
    focal: { kind: "testId", value: "trace-image-dialog" },
    storage: { "rackpad.visualizer.layout-mode": "grouped" },
  },
  {
    ...scene("visualizer-layout.png", "/visualizer", "Visualizer"),
    storage: {
      "rackpad.visualizer.layout-mode": "grouped",
      "rackpad.visualizer.loose-placement": "below-racks",
      "rackpad.visualizer.room-only-sections": "true",
      "rackpad.visualizer.rack-face-mode": "both",
    },
  },
];

const darkScenes: Scene[] = [
  scene("dashboard-dark.png", "/", "Dashboard", "dark"),
  {
    ...scene("visualizer-dark.png", "/visualizer", "Visualizer", "dark"),
    storage: { "rackpad.visualizer.layout-mode": "diagram" },
  },
  {
    ...scene("storage-dark.png", "/storage?tab=pools", "Storage", "dark"),
    setup: "storage-pool",
    focal: { kind: "heading", name: "tank" },
  },
];

const scenes = [
  ...workspaceScenes,
  ...detailScenes,
  ...operationalScenes,
  ...visualizerScenes,
  ...darkScenes,
];

test("capture the deterministic Rackpad documentation suite", async ({
  page,
  request,
}) => {
  expect(new Set(scenes.map((entry) => entry.filename)).size).toBe(37);
  expect(scenes).toHaveLength(37);
  expect(page.viewportSize()).toEqual({ width: WIDTH, height: HEIGHT });

  const bootstrapResponse = await request.post("/api/auth/bootstrap", {
    data: {
      username: "screenshot-admin",
      displayName: "Screenshot Admin",
      password: "rackpad-screenshot-password",
      loadDemoData: true,
    },
  });
  expect(bootstrapResponse.status(), await bootstrapResponse.text()).toBe(201);
  const { token } = (await bootstrapResponse.json()) as { token: string };

  const backupResponse = await request.post("/api/admin/native-backups", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(backupResponse.status(), await backupResponse.text()).toBe(201);

  await page.addInitScript(
    ({ authToken, referenceTimeMs }) => {
      const RealDate = globalThis.Date;
      globalThis.Date = new Proxy(RealDate, {
        construct(target, args) {
          return Reflect.construct(
            target,
            args.length === 0 ? [referenceTimeMs] : args,
          );
        },
        get(target, property, receiver) {
          if (property === "now") return () => referenceTimeMs;
          return Reflect.get(target, property, receiver);
        },
      });
      localStorage.setItem("rackpad.auth.token", authToken);
      localStorage.setItem("rackpad.language", "en");
    },
    { authToken: token, referenceTimeMs: SCREENSHOT_TIME_MS },
  );
  await mkdir(OUTPUT_DIR, { recursive: true });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const current of scenes) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    await prepareScene(page, current);
    await page.goto(current.route, { waitUntil: "domcontentloaded" });
    await waitForReady(page);
    await runSetup(page, current.setup);

    const focal = focalLocator(page, current.focal);
    await expect(
      focal.first(),
      `${current.filename}: focal target`,
    ).toBeVisible();
    if (current.scroll) {
      await focal
        .first()
        .evaluate((element) =>
          element.scrollIntoView({ block: "center", inline: "nearest" }),
        );
    }
    await settlePage(page);

    expect(pageErrors, `${current.filename}: page errors`).toEqual([]);
    expect(consoleErrors, `${current.filename}: console errors`).toEqual([]);
    await expect(page.getByText("Sign in", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Loading...", { exact: true })).toHaveCount(0);

    await page.screenshot({
      path: resolve(OUTPUT_DIR, current.filename),
      fullPage: false,
      animations: "disabled",
    });
  }

  await removeLegacyAssetsAfterReferenceCheck();
  await validateGeneratedSuite();
});

function scene(
  filename: string,
  route: string,
  heading: string,
  theme: Theme = "light",
): Scene {
  return {
    filename,
    route,
    theme,
    setup: "none",
    focal: { kind: "heading", name: heading },
  };
}

async function prepareScene(page: Page, current: Scene) {
  await page.emulateMedia({
    colorScheme: current.theme,
    reducedMotion: "reduce",
  });
  if (page.url().startsWith("about:")) await page.goto("/");
  await page.evaluate(
    ({ theme, storage }) => {
      const defaults: Record<string, string> = {
        "rackpad-theme": theme,
        "rackpad.language": "en",
        "rackpad.visualizer.health": "false",
        "rackpad.visualizer.layout-mode": "grouped",
        "rackpad.visualizer.loose-placement": "beside-racks",
        "rackpad.visualizer.room-only-sections": "false",
        "rackpad.visualizer.rack-face-mode": "front",
      };
      for (const [key, value] of Object.entries({ ...defaults, ...storage })) {
        localStorage.setItem(key, value);
      }
    },
    { theme: current.theme, storage: current.storage ?? {} },
  );
}

async function waitForReady(page: Page) {
  await expect(page.locator("h1").first()).toBeVisible();
  await page.addStyleTag({
    content: `
      html { scrollbar-width: none !important; }
      ::-webkit-scrollbar { display: none !important; }
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function settlePage(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolveFrame) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
    );
  });
  await page.waitForTimeout(100);
}

async function runSetup(page: Page, setup: SetupName) {
  switch (setup) {
    case "none":
      return;
    case "proxmox-review":
      await page.getByRole("button", { name: "Load sample Proxmox" }).click();
      await expect(
        page.getByText("sample-pve-04", { exact: true }).first(),
      ).toBeVisible();
      return;
    case "cable-bulk":
      await page.getByTestId("cable-select-l_17").check();
      await page.getByTestId("cable-select-l_18").check();
      await expect(page.getByTestId("cable-bulk-editor")).toContainText(
        "2 selected",
      );
      return;
    case "storage-pool":
      await page.getByRole("button", { name: "Open pool tank" }).click();
      return;
    case "storage-template":
      await page
        .getByRole("button", { name: /12-bay external SAS shelf/ })
        .first()
        .click();
      return;
    case "integrations-schedule":
      await page.getByRole("tab", { name: "Integrations" }).click();
      await expect(
        page.getByText("UniFi Network (disabled example)", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: /Auto-sync \(1\)/ }).click();
      return;
    case "device-type-usage":
      await page
        .getByTestId("device-type-section-custom")
        .getByRole("button", { name: /Disk shelf/ })
        .click();
      await expect(page.getByTestId("device-type-usage")).toContainText("1");
      return;
    case "duplicate-macs":
      await page.getByLabel(/Show ignored/).check();
      await expect(page.getByTestId("duplicate-mac-group")).toHaveCount(2);
      return;
    case "visualizer-fit":
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      return;
    case "visualizer-cable": {
      const cable = page
        .getByRole("button")
        .filter({ hasText: /truenas-01 to sw-tor-01/ })
        .first();
      await cable.click();
      await expect(
        page.getByText("Selected cable", { exact: true }),
      ).toBeVisible();
      return;
    }
    case "visualizer-trace": {
      await page.getByTestId("visualizer-trace-toggle").click();
      await page
        .getByTestId("trace-device-select")
        .selectOption({ label: "pp-01" });
      const rearPort = await page
        .getByTestId("trace-port-select")
        .evaluate((select) => {
          const options = Array.from((select as HTMLSelectElement).options);
          return (
            options.find((option) => /\(rear\)/i.test(option.text))?.value ??
            options.at(-1)?.value ??
            ""
          );
        });
      expect(rearPort).not.toBe("");
      await page.getByTestId("trace-port-select").selectOption(rearPort);
      await page.getByTestId("trace-submit").click();
      await expect(
        page
          .getByText("2 hop path traced from selected port.", {
            exact: true,
          })
          .first(),
      ).toBeVisible();
      const previewButton = page.getByTestId("trace-preview-image");
      await previewButton.scrollIntoViewIfNeeded();
      await previewButton.click();
      await expect(page.getByTestId("trace-preview-svg")).toBeVisible();
      return;
    }
  }
}

function focalLocator(page: Page, target: FocalTarget): Locator {
  switch (target.kind) {
    case "heading":
      return page.getByRole("heading", { name: target.name, exact: true });
    case "testId":
      return page.getByTestId(target.value);
    case "text":
      return page.getByText(target.value, { exact: target.exact ?? false });
    case "css":
      return page.locator(target.value);
  }
}

async function removeLegacyAssetsAfterReferenceCheck() {
  const markdownFiles = [
    resolve(process.cwd(), "README.md"),
    ...(await markdownFilesUnder(resolve(process.cwd(), "docs"))),
  ];
  for (const filename of LEGACY_ASSETS) {
    for (const markdownFile of markdownFiles) {
      const contents = await readFile(markdownFile, "utf8");
      expect(
        contents,
        `${filename} is still referenced by ${markdownFile}`,
      ).not.toContain(filename);
    }
    try {
      await unlink(resolve(OUTPUT_DIR, filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function markdownFilesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return markdownFilesUnder(path);
      return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return nested.flat();
}

async function validateGeneratedSuite() {
  const expected = scenes.map((entry) => entry.filename).sort();
  const actual = (await readdir(OUTPUT_DIR))
    .filter((entry) => entry.endsWith(".png"))
    .sort();
  expect(actual, "screenshot assets must match the manifest exactly").toEqual(
    expected,
  );

  for (const filename of expected) {
    const data = await readFile(resolve(OUTPUT_DIR, filename));
    expect(
      data.subarray(1, 4).toString("ascii"),
      `${filename}: PNG signature`,
    ).toBe("PNG");
    expect(data.readUInt32BE(16), `${filename}: width`).toBe(WIDTH);
    expect(data.readUInt32BE(20), `${filename}: height`).toBe(HEIGHT);
  }
}
