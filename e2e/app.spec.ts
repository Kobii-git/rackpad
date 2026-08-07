import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import packageJson from "../package.json" with { type: "json" };

let token = "";

const primaryRoutes = [
  "/",
  "/labs",
  "/racks",
  "/devices",
  "/compute",
  "/storage",
  "/wifi",
  "/discovery",
  "/imports",
  "/monitoring",
  "/ports",
  "/cables",
  "/networks",
  "/reports",
  "/audit-log",
  "/visualizer",
  "/documentation",
  "/admin",
];

test("storage workspace and dense device topology stay readable", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/storage");
  await expect(
    page.getByRole("heading", { name: "Storage", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Raw capacity", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Missing pool members", { exact: false }),
  ).toBeVisible();

  await page.getByRole("tab", { name: /Drive-bay templates/ }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Slot count", exact: true }),
  ).toHaveValue("12");
  await expect(page.getByTitle("Bay 12", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: /Drives/ }).click();
  await expect(page.getByText("DEMO-STORE-01", { exact: false })).toBeVisible();
  await page.goto("/storage?tab=drives&driveId=drv_demo_1");
  await expect(
    page.getByRole("textbox", { name: "Serial", exact: true }),
  ).toHaveValue("DEMO-STORE-01");
  await page.getByRole("tab", { name: /Logical pools/ }).click();
  await expect(page.getByText("tank", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open pool tank", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit pool tank", exact: true }),
  ).toBeVisible();

  await page.evaluate(() => localStorage.setItem("rackpad-theme", "dark"));
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/devices/d_srv_nas?tab=storage");
  await expect(page.getByRole("tab", { name: /Storage/ })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByText("Bay 24", { exact: true })).toBeVisible();
  await expect(page.getByText("tank", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DEMO-STORE-06", { exact: false })).toBeVisible();
  await expect(
    page.getByText("Missing", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("device-storage-attention")).toContainText("2");

  const crossDeviceMember = page
    .locator("[data-pool-member-row]")
    .filter({ hasText: "DEMO-STORE-05" })
    .first();
  await crossDeviceMember.hover();
  await expect(
    page.locator('[data-pool-member-row][data-pool-highlighted="true"]'),
  ).toHaveCount(6);
  await expect(
    page.locator('button[data-pool-highlighted="true"]'),
  ).toHaveCount(4);
  await crossDeviceMember.getByRole("checkbox").focus();
  await expect(
    page.locator('[data-pool-member-row][data-pool-highlighted="true"]'),
  ).toHaveCount(6);
  await expect(
    page.locator('button[data-pool-highlighted="true"]'),
  ).toHaveCount(4);

  await page.getByRole("button", { name: "New pool", exact: true }).click();
  const assignedElsewhereMember = page
    .locator("[data-pool-member-row]")
    .filter({ hasText: "DEMO-STORE-01" })
    .first();
  await expect(assignedElsewhereMember.getByRole("checkbox")).toBeDisabled();
  await assignedElsewhereMember.focus();
  await expect(assignedElsewhereMember).toBeFocused();
  await expect(
    page.locator('[data-pool-member-row][data-pool-highlighted="true"]'),
  ).toHaveCount(6);
  await expect(
    page.locator('button[data-pool-highlighted="true"]'),
  ).toHaveCount(4);
});

test("storage labels localize built-ins while retaining technical values", async ({
  page,
  request,
}) => {
  const hostname = `storage-enclosure-locale-${Date.now().toString(36)}`;
  const headers = { Authorization: `Bearer ${token}` };
  let deviceId = "";
  try {
    const response = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname,
        deviceType: "storage_enclosure",
        placement: "room",
        status: "online",
      },
    });
    expect(response.status()).toBe(201);
    deviceId = ((await response.json()) as { id: string }).id;

    await authenticate(page, "fr");
    await page.goto("/devices");
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }).first(),
    ).toBeVisible();

    await page.goto(`/devices/${deviceId}`);
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }).first(),
    ).toBeVisible();

    await page.keyboard.press("Control+k");
    const commandSearch = page.getByPlaceholder("Rechercher des commandes");
    await commandSearch.fill(hostname);
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Rechercher des commandes").fill("DEMO-STORE");
    await expect(
      page.getByText("Disques", { exact: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/storage?tab=pools");
    await expect(page.getByText("Dégradé", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Pool de stockage", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Ouvrir le pool de stockage tank",
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("tab", { name: /Modèles de baie/ }).click();
    await expect(
      page.getByText("12 × 3.5-inch Baies de disques", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }),
    ).toBeVisible();
  } finally {
    if (deviceId) {
      const response = await request.delete(`/api/devices/${deviceId}`, {
        headers,
      });
      expect(response.status(), await response.text()).toBe(204);
    }
  }
});

test("custom template drives a cross-device pool through the editor UI", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString(36);
  const templateName = `E2E storage ${suffix}`;
  const labName = `E2E Storage Lab ${suffix}`;
  const hostName = `storage-host-with-a-deliberately-long-name-${suffix}`;
  const enclosureName = `storage-enclosure-with-a-deliberately-long-name-${suffix}`;
  const sectionName = `Long front storage bay section ${suffix}`;
  const slotPrefix = `Long physical drive slot ${suffix} `;
  const secondSlotName = `${slotPrefix}2`;
  const poolName = `cross-device-storage-pool-with-a-long-name-${suffix}`;
  const hostSerial = `E2E-HOST-${suffix}`;
  const enclosureSerial = `E2E-JBOD-${suffix}`;
  const editorUsername = `storage-editor-${suffix}`;
  const editorPassword = "storage-editor-password";
  const headers = { Authorization: `Bearer ${token}` };
  let templateId = "";
  let labId = "";
  let editorId = "";
  let editorContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    page.setDefaultTimeout(10_000);
    await authenticate(page);
    await page.goto("/storage?tab=templates");
    await page.getByRole("button", { name: "Custom template" }).click();
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .first()
      .fill(templateName);
    await page
      .getByRole("textbox", { name: "Description", exact: true })
      .fill("Two-bay E2E storage template");
    await page
      .getByRole("spinbutton", { name: "Slot count", exact: true })
      .fill("2");
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .last()
      .fill(sectionName);
    await page
      .getByRole("textbox", { name: "Slot prefix", exact: true })
      .fill(slotPrefix);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText(templateName, { exact: true }).first(),
    ).toBeVisible();

    const templatesResponse = await request.get(
      "/api/storage/drive-bay-templates",
      { headers },
    );
    expect(templatesResponse.ok()).toBeTruthy();
    const templates = (await templatesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    templateId =
      templates.find((entry) => entry.name === templateName)?.id ?? "";
    expect(templateId).not.toBe("");

    const labResponse = await request.post("/api/labs", {
      headers,
      data: { name: labName, description: "Temporary storage E2E lab" },
    });
    expect(labResponse.status()).toBe(201);
    labId = ((await labResponse.json()) as { id: string }).id;

    const createDevice = async (hostname: string, deviceType: string) => {
      const response = await request.post("/api/devices", {
        headers,
        data: {
          labId,
          hostname,
          deviceType,
          placement: "room",
          status: "online",
          driveBayTemplateId: templateId,
        },
      });
      const result = (await response.json()) as { id?: string; error?: string };
      expect(response.status(), result.error).toBe(201);
      return { id: result.id! };
    };
    const host = await createDevice(hostName, "server");
    const enclosure = await createDevice(enclosureName, "storage_enclosure");

    const editorResponse = await request.post("/api/users", {
      headers,
      data: {
        username: editorUsername,
        displayName: "Storage E2E Editor",
        password: editorPassword,
        role: "editor",
        labAccess: [{ labId, role: "editor" }],
      },
    });
    expect(editorResponse.status()).toBe(201);
    editorId = ((await editorResponse.json()) as { id: string }).id;
    const loginResponse = await request.post("/api/auth/login", {
      data: { username: editorUsername, password: editorPassword },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const editorToken = ((await loginResponse.json()) as { token: string })
      .token;

    editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    editorPage.setDefaultTimeout(10_000);
    await editorPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
      localStorage.setItem("rackpad.language", "en");
    }, editorToken);

    const createDrive = async (
      deviceId: string,
      manufacturer: string,
      serial: string,
      capacity: string,
    ) => {
      await editorPage.goto(
        `http://127.0.0.1:5173/devices/${deviceId}?tab=storage`,
      );
      await expect(
        editorPage.getByText(secondSlotName, { exact: true }),
      ).toBeVisible();
      await editorPage
        .getByTitle("Empty slot", { exact: true })
        .first()
        .click();
      await editorPage
        .getByRole("textbox", { name: "Manufacturer", exact: true })
        .fill(manufacturer);
      await editorPage
        .getByRole("textbox", { name: "Model", exact: true })
        .fill("FlowDrive");
      await editorPage
        .getByRole("textbox", { name: "Serial", exact: true })
        .fill(serial);
      await editorPage
        .getByRole("spinbutton", { name: "Capacity", exact: true })
        .fill(capacity);
      await editorPage
        .getByRole("combobox", { name: "Capacity unit", exact: true })
        .selectOption("gb");
      await editorPage
        .getByRole("button", { name: "Create drive", exact: true })
        .click();
      await expect(
        editorPage.getByRole("textbox", { name: "Serial", exact: true }),
      ).toHaveValue(serial);
    };

    await createDrive(host.id, "HostDisk", hostSerial, "4000");

    await editorPage.goto(
      `http://127.0.0.1:5173/devices/${enclosure.id}?tab=storage`,
    );
    await expect(
      editorPage.getByText(secondSlotName, { exact: true }),
    ).toBeVisible();
    await expect(
      editorPage.getByTestId("device-storage-raw-capacity"),
    ).toContainText("0 GB");
    await expect(
      editorPage.getByTitle("Empty slot", { exact: true }),
    ).toHaveCount(2);
    await editorPage.getByTitle("Empty slot", { exact: true }).first().click();
    await editorPage
      .getByRole("textbox", { name: "Manufacturer", exact: true })
      .fill("ShelfDisk");
    await editorPage
      .getByRole("textbox", { name: "Model", exact: true })
      .fill("FlowDrive");
    await editorPage
      .getByRole("textbox", { name: "Serial", exact: true })
      .fill(hostSerial);
    await editorPage
      .getByRole("spinbutton", { name: "Capacity", exact: true })
      .fill("6000");
    await editorPage
      .getByRole("combobox", { name: "Capacity unit", exact: true })
      .selectOption("gb");
    await editorPage
      .getByRole("button", { name: "Create drive", exact: true })
      .click();
    await expect(
      editorPage.getByText("That record conflicts with an existing value."),
    ).toBeVisible();
    await expect(
      editorPage.getByTestId("device-storage-raw-capacity"),
    ).toContainText("0 GB");
    await expect(
      editorPage.getByTitle("Empty slot", { exact: true }),
    ).toHaveCount(2);
    await editorPage
      .getByRole("textbox", { name: "Serial", exact: true })
      .fill(enclosureSerial);
    await editorPage
      .getByRole("button", { name: "Create drive", exact: true })
      .click();
    await expect(
      editorPage.getByRole("textbox", { name: "Serial", exact: true }),
    ).toHaveValue(enclosureSerial);
    await expect(
      editorPage.getByTestId("device-storage-raw-capacity"),
    ).toContainText("6 TB");

    await editorPage.goto(
      `http://127.0.0.1:5173/devices/${host.id}?tab=storage`,
    );
    await editorPage.getByRole("button", { name: "New pool" }).click();
    await editorPage
      .getByRole("textbox", { name: "Pool name", exact: true })
      .fill(poolName);
    await editorPage
      .getByRole("spinbutton", { name: "Usable capacity", exact: true })
      .fill("7000");
    await editorPage
      .getByRole("combobox", { name: "Capacity unit", exact: true })
      .last()
      .selectOption("gb");
    await editorPage
      .locator("[data-pool-member-row]")
      .filter({ hasText: hostSerial })
      .getByRole("checkbox")
      .check();
    await editorPage
      .locator("[data-pool-member-row]")
      .filter({ hasText: enclosureSerial })
      .getByRole("checkbox")
      .check();
    await editorPage
      .getByRole("button", { name: "Create pool", exact: true })
      .click();

    await expect(
      editorPage.getByText(poolName, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      editorPage.getByTestId("device-storage-raw-capacity"),
    ).toContainText("4 TB");
    await expect(
      editorPage.getByTestId("device-storage-usable-capacity"),
    ).toContainText("7 TB");
    await expect(
      editorPage.getByTestId("device-storage-attention"),
    ).toContainText("0");
    await editorPage.setViewportSize({ width: 720, height: 900 });
    await expect(
      editorPage.getByText(sectionName, { exact: true }),
    ).toBeVisible();
    expect(
      await editorPage.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBeTruthy();

    const remoteMember = editorPage
      .locator("[data-pool-member-row]")
      .filter({ hasText: enclosureSerial })
      .first();
    await remoteMember.hover();
    await expect(
      editorPage.locator(
        '[data-pool-member-row][data-pool-highlighted="true"]',
      ),
    ).toHaveCount(2);
    await expect(
      editorPage.locator('button[data-pool-highlighted="true"]'),
    ).toHaveCount(1);
    await remoteMember.getByRole("checkbox").focus();
    await expect(
      editorPage.locator(
        '[data-pool-member-row][data-pool-highlighted="true"]',
      ),
    ).toHaveCount(2);

    await editorPage.goto(
      `http://127.0.0.1:5173/devices/${enclosure.id}?tab=storage`,
    );
    await editorPage.locator('button[title*="ShelfDisk FlowDrive"]').click();
    await editorPage
      .getByRole("button", { name: "Pull drive", exact: true })
      .click();
    await editorPage.goto(
      `http://127.0.0.1:5173/devices/${host.id}?tab=storage`,
    );
    await expect(
      editorPage.getByTestId("device-storage-attention"),
    ).toContainText("1");
    await expect(
      editorPage.getByText("Missing", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await editorContext?.close();
    if (editorId) {
      const response = await request.delete(`/api/users/${editorId}`, {
        headers,
      });
      expect(response.status(), await response.text()).toBe(204);
    }
    if (labId) {
      const response = await request.delete(`/api/labs/${labId}`, { headers });
      expect(response.status(), await response.text()).toBe(204);
    }
    if (templateId) {
      const response = await request.delete(
        `/api/storage/drive-bay-templates/${templateId}`,
        { headers },
      );
      expect(response.status(), await response.text()).toBe(204);
    }
  }
});

test("storage inventory is read-only for viewers", async ({
  browser,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const username = `storage-viewer-${suffix}`;
  const headers = { Authorization: `Bearer ${token}` };
  let viewerId = "";
  let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    const viewerResponse = await request.post("/api/users", {
      headers,
      data: {
        username,
        displayName: "Storage Viewer",
        password: "storage-viewer-password",
        role: "viewer",
      },
    });
    expect(viewerResponse.status()).toBe(201);
    viewerId = ((await viewerResponse.json()) as { id: string }).id;

    const loginResponse = await request.post("/api/auth/login", {
      data: { username, password: "storage-viewer-password" },
    });
    expect(loginResponse.ok()).toBeTruthy();
    const viewerToken = ((await loginResponse.json()) as { token: string })
      .token;

    viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
    }, viewerToken);

    await viewerPage.goto("http://127.0.0.1:5173/storage?tab=drives");
    await expect(
      viewerPage.getByRole("heading", { name: "Storage", exact: true }),
    ).toBeVisible();
    await expect(viewerPage.getByText("DEMO-STORE-01")).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "New drive", exact: true }),
    ).toHaveCount(0);

    await viewerPage.goto(
      "http://127.0.0.1:5173/storage?tab=drives&driveId=drv_demo_1",
    );
    for (const fieldName of ["Manufacturer", "Model", "Serial", "Notes"]) {
      await expect(
        viewerPage.getByRole("textbox", { name: fieldName, exact: true }),
      ).toBeDisabled();
    }
    await expect(
      viewerPage.getByRole("spinbutton", { name: "Capacity", exact: true }),
    ).toBeDisabled();
    for (const fieldName of [
      "Capacity unit",
      "Interface",
      "Form factor",
      "Select a slot",
    ]) {
      await expect(
        viewerPage.getByRole("combobox", { name: fieldName, exact: true }),
      ).toBeDisabled();
    }
    await expect(
      viewerPage.getByRole("button", { name: "Save drive", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "Delete drive", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "Close", exact: true }),
    ).toBeVisible();

    await viewerPage.goto("http://127.0.0.1:5173/storage?tab=pools");
    await viewerPage
      .getByRole("button", { name: "Open pool tank", exact: true })
      .click();
    await expect(
      viewerPage.getByRole("textbox", { name: "Pool name", exact: true }),
    ).toBeDisabled();
    await expect(
      viewerPage.getByRole("textbox", { name: "Notes", exact: true }),
    ).toHaveValue(
      "Cross-device demo pool with one backup-server member and one pulled member.",
    );
    await expect(viewerPage.getByText("DEMO-STORE-01")).toBeVisible();
    await expect(viewerPage.getByText("DEMO-STORE-06")).toBeVisible();
    const memberCheckboxes = viewerPage.getByRole("checkbox");
    await expect(memberCheckboxes).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      await expect(memberCheckboxes.nth(index)).toBeDisabled();
    }
    await expect(
      viewerPage.getByRole("button", { name: "Close", exact: true }),
    ).toBeVisible();
    for (const controlName of ["New pool", "Save pool", "Delete pool"]) {
      await expect(
        viewerPage.getByRole("button", { name: controlName, exact: true }),
      ).toHaveCount(0);
    }

    await viewerPage.goto(
      "http://127.0.0.1:5173/devices/d_srv_nas?tab=storage",
    );
    await expect(viewerPage.getByText("Bay 24", { exact: true })).toBeVisible();
    for (const controlName of [
      "Add slot",
      "Save slot",
      "Save drive",
      "New pool",
    ]) {
      await expect(
        viewerPage.getByRole("button", { name: controlName, exact: true }),
      ).toHaveCount(0);
    }

    await viewerPage.goto("http://127.0.0.1:5173/storage?tab=templates");
    await expect(
      viewerPage.getByRole("button", {
        name: "Custom template",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("spinbutton", {
        name: "Slot count",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await viewerContext?.close();
    if (viewerId) await request.delete(`/api/users/${viewerId}`, { headers });
  }
});

test("storage interactive views remain accessible and responsive", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await authenticate(page);
  await page.goto("/");
  const routes = [
    "/storage?tab=drives&driveId=drv_demo_1",
    "/storage?tab=pools",
    "/storage?tab=templates",
    "/devices/d_srv_nas?tab=storage",
  ];

  for (const theme of ["light", "dark"]) {
    await page.evaluate((selectedTheme) => {
      localStorage.setItem("rackpad-theme", selectedTheme);
    }, theme);
    for (const viewport of [
      { width: 720, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(route);
        await expect(page.locator("h1").first()).toBeVisible();
        if (route === "/storage?tab=pools") {
          await page
            .getByRole("button", { name: "Open pool tank", exact: true })
            .click();
        }
        if (route.includes("driveId=") || route.endsWith("tab=pools")) {
          await expect(
            page.getByRole("button", { name: "Close", exact: true }),
          ).toBeVisible();
        }
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth + 1,
          ),
          `${route} overflowed in ${theme} at ${viewport.width}px`,
        ).toBeTruthy();
        const results = await new AxeBuilder({ page }).analyze();
        expect(
          results.violations.filter(
            (violation) =>
              violation.impact === "critical" || violation.impact === "serious",
          ),
          `${route} has serious accessibility violations in ${theme} at ${viewport.width}px`,
        ).toEqual([]);
      }
    }
  }
});

test.beforeAll(async ({ request }) => {
  const status = await request.get("/api/auth/status");
  const auth = (await status.json()) as { needsBootstrap: boolean };
  if (auth.needsBootstrap) {
    const bootstrap = await request.post("/api/auth/bootstrap", {
      data: {
        username: "e2e-admin",
        displayName: "E2E Administrator",
        password: "e2e-administrator-password",
        loadDemoData: true,
      },
    });
    expect(bootstrap.status()).toBe(201);
    token = ((await bootstrap.json()) as { token: string }).token;
  } else {
    token = await login(request);
  }
});

async function login(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: { username: "e2e-admin", password: "e2e-administrator-password" },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { token: string }).token;
}

async function authenticate(page: Page, language = "en") {
  await page.addInitScript(
    ({ authToken, selectedLanguage }) => {
      localStorage.setItem("rackpad.auth.token", authToken);
      if (!localStorage.getItem("rackpad.language")) {
        localStorage.setItem("rackpad.language", selectedLanguage);
      }
    },
    { authToken: token, selectedLanguage: language },
  );
}

async function expectTracePngDownload(
  page: Page,
  expectedFilename: string,
  trigger: Locator = page.getByTestId("trace-download-image"),
) {
  const downloadPromise = page.waitForEvent("download");
  await trigger.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(expectedFilename);

  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const png = await readFile(downloadPath!);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
}

test("responsive and serious accessibility matrix passes for supported modes", async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await authenticate(page);
  await page.goto("/");
  for (const mode of [
    {
      name: "light",
      language: "en",
      lang: "en",
      direction: "ltr",
      theme: "light",
    },
    {
      name: "dark",
      language: "en",
      lang: "en",
      direction: "ltr",
      theme: "dark",
    },
    {
      name: "French",
      language: "fr",
      lang: "fr-FR",
      direction: "ltr",
      theme: "light",
    },
    {
      name: "French dark",
      language: "fr",
      lang: "fr-FR",
      direction: "ltr",
      theme: "dark",
    },
    {
      name: "Arabic RTL light",
      language: "ar",
      lang: "ar",
      direction: "rtl",
      theme: "light",
    },
    {
      name: "Arabic RTL",
      language: "ar",
      lang: "ar",
      direction: "rtl",
      theme: "dark",
    },
  ]) {
    await page.evaluate(({ language, theme }) => {
      localStorage.setItem("rackpad.language", language);
      localStorage.setItem("rackpad-theme", theme);
    }, mode);
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of primaryRoutes) {
        await page.goto(route);
        await expect(
          page.locator("h1").first(),
          `${route} did not finish loading in ${mode.name} at ${viewport.width}px`,
        ).toBeVisible({ timeout: 15_000 });
        await expect
          .poll(() => page.evaluate(() => document.documentElement.lang))
          .toBe(mode.lang);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.dir))
          .toBe(mode.direction);
        if (route === "/discovery") {
          const inbox = page.getByTestId("discovery-inbox");
          const inspector = page.getByTestId("discovery-inspector");
          await inbox.scrollIntoViewIfNeeded();
          await expect(inbox).toBeVisible();
          await expect(inspector).toBeVisible();
          const [box, inspectorBox] = await Promise.all([
            inbox.boundingBox(),
            inspector.boundingBox(),
          ]);
          expect(
            box?.height ?? 0,
            `Discovery inbox collapsed in ${mode.name} at ${viewport.width}px`,
          ).toBeGreaterThanOrEqual(352);
          if (viewport.width < 1280) {
            expect(
              await inbox.evaluate(
                (element) => getComputedStyle(element).overflowY,
              ),
              `Discovery inbox cannot scroll in ${mode.name} at ${viewport.width}px`,
            ).toBe("auto");
            expect(
              inspectorBox?.y ?? 0,
              `Discovery inspector overlaps the inbox in ${mode.name} at ${viewport.width}px`,
            ).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0) + 10);
          } else {
            expect(
              inspectorBox?.height ?? 0,
              `Discovery inspector stayed too short in ${mode.name} at ${viewport.width}px`,
            ).toBeGreaterThanOrEqual(600);
          }
        }
        const overflows = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth + 1,
        );
        expect(
          overflows,
          `${route} overflowed in ${mode.name} at ${viewport.width}px`,
        ).toBeFalsy();
        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations.filter(
          (violation) =>
            violation.impact === "critical" || violation.impact === "serious",
        );
        expect(
          blocking,
          `${route} has serious accessibility violations in ${mode.name} at ${viewport.width}px`,
        ).toEqual([]);
      }
    }
  }
  expect(errors).toEqual([]);
});

test("all primary routes load without document overflow in both demo labs", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  for (const labName of ["Home Lab", "Studio / Office"]) {
    const labButton = page.getByRole("button", {
      name: new RegExp(`Lab: ${labName}`),
    });
    if (!(await labButton.count())) {
      await page.getByRole("button", { name: /^Lab:/ }).click();
      await page
        .getByRole("button", { name: new RegExp(`^${labName}`) })
        .click();
      await expect(
        page.getByRole("button", { name: new RegExp(`Lab: ${labName}`) }),
      ).toBeVisible();
    }

    for (const route of primaryRoutes) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
        `${route} overflowed for ${labName}`,
      ).toBeTruthy();
    }
  }
});

test("custom server device types inherit Compute host behavior", async ({
  page,
  request,
}) => {
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-7);
  const serverTypeId = `e2e_compute_server_${suffix}`;
  const endpointTypeId = `e2e_compute_endpoint_${suffix}`;
  const serverHostname = `compute-host-${suffix}`;
  const endpointHostname = `compute-endpoint-${suffix}`;
  const guestHostname = `compute-guest-${suffix}`;
  const deviceIds: string[] = [];
  const deviceTypeIds: string[] = [];

  try {
    for (const definition of [
      {
        id: serverTypeId,
        label: `E2E compute server ${suffix}`,
        parentType: "server",
      },
      {
        id: endpointTypeId,
        label: `E2E compute endpoint ${suffix}`,
        parentType: "endpoint",
      },
    ]) {
      const response = await request.post("/api/device-types", {
        headers,
        data: definition,
      });
      expect(response.status()).toBe(201);
      const created = (await response.json()) as {
        id: string;
        parentType: string;
      };
      expect(created.parentType).toBe(definition.parentType);
      deviceTypeIds.push(created.id);
    }

    for (const device of [
      {
        hostname: serverHostname,
        deviceType: serverTypeId,
      },
      {
        hostname: endpointHostname,
        deviceType: endpointTypeId,
      },
    ]) {
      const response = await request.post("/api/devices", {
        headers,
        data: {
          labId: "lab_home",
          ...device,
          placement: "room",
          status: "unknown",
        },
      });
      expect(response.status()).toBe(201);
      deviceIds.push(((await response.json()) as { id: string }).id);
    }

    const hostDeviceId = deviceIds[0];
    await page.goto("/compute");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: serverHostname, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(endpointHostname, { exact: true })).toHaveCount(
      0,
    );

    const guestResponse = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: guestHostname,
        deviceType: "vm",
        placement: "virtual",
        parentDeviceId: hostDeviceId,
        status: "unknown",
      },
    });
    expect(guestResponse.status()).toBe(201);
    deviceIds.unshift(((await guestResponse.json()) as { id: string }).id);

    await page.reload();
    const activeHostCard = page
      .getByRole("heading", { name: serverHostname, exact: true })
      .locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rk-panel ')][1]",
      );
    await expect(activeHostCard).toBeVisible();
    await expect(activeHostCard).toContainText(guestHostname);
    await expect(
      activeHostCard.getByRole("button", { name: "Add VM on host" }),
    ).toBeVisible();
  } finally {
    for (const deviceId of deviceIds) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
    for (const deviceTypeId of deviceTypeIds.reverse()) {
      await request.delete(`/api/device-types/${deviceTypeId}`, { headers });
    }
  }
});

test("visualizer trace downloads standalone PNGs under the production CSP", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("rackpad-theme", "dark");
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    const traceObjectUrls = {
      created: [] as string[],
      revoked: [] as string[],
      svgByUrl: {} as Record<string, string>,
    };
    Object.assign(window, { __traceObjectUrls: traceObjectUrls });
    URL.createObjectURL = (object) => {
      const url = originalCreateObjectUrl(object);
      traceObjectUrls.created.push(url);
      if (object instanceof Blob && object.type.startsWith("image/svg+xml")) {
        void object.text().then((svg) => {
          traceObjectUrls.svgByUrl[url] = svg;
        });
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      traceObjectUrls.revoked.push(url);
      originalRevokeObjectUrl(url);
    };
  });
  await page.route("**/api/ports", async (route) => {
    const response = await route.fetch();
    const ports = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: [
        ...ports.filter(
          (port) =>
            !(
              port.deviceId === "d_pp24" &&
              port.name === "1" &&
              port.face === "rear"
            ),
        ),
        {
          id: "p_e2e_pp24_1_rear",
          deviceId: "d_pp24",
          name: "1",
          position: 1,
          kind: "rj45",
          speed: "1G",
          linkState: "up",
          mode: "access",
          vlanId: null,
          allowedVlanIds: null,
          description: null,
          face: "rear",
          virtualSwitchId: null,
          snmpIfIndex: null,
          macAddress: null,
          portRole: "physical",
          aggregatePortId: null,
        },
      ],
    });
  });
  await page.route("**/api/port-links", async (route) => {
    const response = await route.fetch();
    const links = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: [
        ...links
          .filter(
            (link) =>
              link.fromPortId !== "p_d_fw_3" && link.toPortId !== "p_d_fw_3",
          )
          .map((link) =>
            link.id === "l_1" ? { ...link, cableLength: "29ft" } : link,
          ),
        {
          id: "l_e2e_patch_trace",
          fromPortId: "p_d_fw_3",
          toPortId: "p_e2e_pp24_1_rear",
          cableType: "Cat6",
          cableLength: "6ft",
          color: "orange",
          notes: null,
        },
      ],
    });
  });

  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const visualizerResponse = await page.goto("/visualizer");
  expect(visualizerResponse?.headers()["content-security-policy"]).toContain(
    "img-src 'self' data: blob:",
  );
  await expect(page.locator("h1").first()).toBeVisible();

  await page.getByTestId("visualizer-trace-toggle").click();
  await page
    .getByTestId("trace-device-select")
    .selectOption({ label: "unifi-01" });
  await page.getByTestId("trace-port-select").selectOption("p_d_unifi_1");
  await page.getByTestId("trace-submit").click();
  await expect(page.getByTestId("trace-download-image")).toBeVisible();
  await page.getByTestId("trace-preview-image").click();
  const directDialog = page.getByTestId("trace-image-dialog");
  const directPreview = page.getByTestId("trace-preview-svg");
  await expect(directDialog).toBeVisible();
  await expect(directPreview).toHaveAttribute("width", "640");
  const directDimensions = await directPreview.evaluate((image) => ({
    height: Number(image.getAttribute("height")),
    naturalHeight: (image as HTMLImageElement).naturalHeight,
    naturalWidth: (image as HTMLImageElement).naturalWidth,
    url: (image as HTMLImageElement).src,
  }));
  expect(directDimensions.height).toBeGreaterThan(0);
  expect(directDimensions.naturalWidth).toBe(640);
  expect(directDimensions.naturalHeight).toBe(directDimensions.height);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & {
              __traceObjectUrls: { svgByUrl: Record<string, string> };
            }
          ).__traceObjectUrls.svgByUrl[url] ?? "",
        directDimensions.url,
      ),
    )
    .toContain('data-theme="dark"');
  await page.getByTestId("trace-preview-close").click();
  await expect(directDialog).toHaveCount(0);
  await expect(page.getByTestId("trace-preview-image")).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & {
              __traceObjectUrls: { revoked: string[] };
            }
          ).__traceObjectUrls.revoked.includes(url),
        directDimensions.url,
      ),
    )
    .toBeTruthy();
  await expectTracePngDownload(
    page,
    "rackpad-trace-unifi-01-eth0-to-sw-tor-01-24.png",
  );

  await page.goto("/visualizer");
  await expect(page.locator("h1").first()).toBeVisible();
  await page.getByTestId("visualizer-trace-toggle").click();
  await page
    .getByTestId("trace-device-select")
    .selectOption({ label: "fw-01" });
  await page.getByTestId("trace-port-select").selectOption("p_d_fw_3");
  await page.getByTestId("trace-submit").click();
  await expect(page.getByText("Trace hops").locator("..")).toContainText(
    "3 hops",
  );
  await expect(page.getByText("Trace hops").locator("..")).toContainText(
    "35ft",
  );
  await page.getByTestId("trace-preview-image").click();
  const multiHopDialog = page.getByTestId("trace-image-dialog");
  const multiHopPreview = page.getByTestId("trace-preview-svg");
  await expect(multiHopDialog).toBeVisible();
  const multiHopPreviewState = await multiHopPreview.evaluate((image) => ({
    height: Number(image.getAttribute("height")),
    url: (image as HTMLImageElement).src,
  }));
  expect(multiHopPreviewState.height).toBeGreaterThan(directDimensions.height);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & {
              __traceObjectUrls: { svgByUrl: Record<string, string> };
            }
          ).__traceObjectUrls.svgByUrl[url] ?? "",
        multiHopPreviewState.url,
      ),
    )
    .toContain("Internal pass-through");
  const multiHopSvg = await page.evaluate(
    (url) =>
      (
        window as typeof window & {
          __traceObjectUrls: { svgByUrl: Record<string, string> };
        }
      ).__traceObjectUrls.svgByUrl[url],
    multiHopPreviewState.url,
  );
  expect(multiHopSvg).toContain("fw-01");
  expect(multiHopSvg).toContain("sw-tor-01");
  expect(multiHopSvg).toContain('data-device-icon="shield"');
  expect(multiHopSvg).toContain('data-device-icon="network"');
  expect(multiHopSvg).toContain('data-theme="dark"');
  expect(multiHopSvg).toContain('fill="#070a0f"');
  expect(multiHopSvg).toContain("3 hops · Length: 35ft");
  await page.keyboard.press("Escape");
  await expect(multiHopDialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & {
              __traceObjectUrls: { revoked: string[] };
            }
          ).__traceObjectUrls.revoked.includes(url),
        multiHopPreviewState.url,
      ),
    )
    .toBeTruthy();

  await page.getByTestId("trace-preview-image").click();
  await expectTracePngDownload(
    page,
    "rackpad-trace-fw-01-igb2-to-sw-tor-01-1.png",
    page.getByTestId("trace-preview-download-image"),
  );
  await page.getByTestId("trace-preview-close").click();

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("light")),
    )
    .toBeTruthy();
  await page.getByTestId("trace-preview-image").click();
  const lightPreview = page.getByTestId("trace-preview-svg");
  const lightPreviewUrl = await lightPreview.evaluate(
    (image) => (image as HTMLImageElement).src,
  );
  await expect
    .poll(() =>
      page.evaluate(
        (url) =>
          (
            window as typeof window & {
              __traceObjectUrls: { svgByUrl: Record<string, string> };
            }
          ).__traceObjectUrls.svgByUrl[url] ?? "",
        lightPreviewUrl,
      ),
    )
    .not.toBe("");
  const lightSvg = await page.evaluate(
    (url) =>
      (
        window as typeof window & {
          __traceObjectUrls: { svgByUrl: Record<string, string> };
        }
      ).__traceObjectUrls.svgByUrl[url],
    lightPreviewUrl,
  );
  expect(lightSvg).toContain('data-theme="light"');
  expect(lightSvg).toContain('fill="#f8fafc"');
  expect(lightSvg).toContain("3 hops · Length: 35ft");
  expect(lightSvg).not.toBe(multiHopSvg);
  await expectTracePngDownload(
    page,
    "rackpad-trace-fw-01-igb2-to-sw-tor-01-1.png",
    page.getByTestId("trace-preview-download-image"),
  );
  await page.getByTestId("trace-preview-close").click();
});

test("cables support atomic bulk metadata editing for physical and aggregate links", async ({
  browser,
  page,
  request,
}) => {
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-7);
  const deviceIds: string[] = [];
  let viewerId = "";

  async function createDevice(hostname: string) {
    const response = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname,
        deviceType: "switch",
        status: "online",
      },
    });
    expect(response.status()).toBe(201);
    const device = (await response.json()) as { id: string };
    deviceIds.push(device.id);
    return device;
  }

  async function createPort(deviceId: string, name: string) {
    const response = await request.post("/api/ports", {
      headers,
      data: {
        deviceId,
        name,
        kind: "rj45",
        linkState: "down",
        speed: "1G",
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string };
  }

  try {
    const leftHostname = `bulk-cable-left-${suffix}`;
    const rightHostname = `bulk-cable-right-${suffix}`;
    const leftDevice = await createDevice(leftHostname);
    const rightDevice = await createDevice(rightHostname);
    const leftMembers = [
      await createPort(leftDevice.id, "Gi0/1"),
      await createPort(leftDevice.id, "Gi0/2"),
    ];
    const rightMembers = [
      await createPort(rightDevice.id, "Gi0/1"),
      await createPort(rightDevice.id, "Gi0/2"),
    ];
    const leftPhysical = await createPort(leftDevice.id, "Gi0/3");
    const rightPhysical = await createPort(rightDevice.id, "Gi0/3");

    const [leftAggregateResponse, rightAggregateResponse] = await Promise.all([
      request.post("/api/port-aggregates", {
        headers,
        data: {
          deviceId: leftDevice.id,
          name: "Port-channel1",
          memberPortIds: leftMembers.map((port) => port.id),
        },
      }),
      request.post("/api/port-aggregates", {
        headers,
        data: {
          deviceId: rightDevice.id,
          name: "Port-channel1",
          memberPortIds: rightMembers.map((port) => port.id),
        },
      }),
    ]);
    expect(leftAggregateResponse.status()).toBe(201);
    expect(rightAggregateResponse.status()).toBe(201);
    const leftAggregate = (await leftAggregateResponse.json()) as {
      aggregate: { id: string };
    };
    const rightAggregate = (await rightAggregateResponse.json()) as {
      aggregate: { id: string };
    };

    const [physicalResponse, logicalResponse] = await Promise.all([
      request.post("/api/port-links", {
        headers,
        data: {
          fromPortId: leftPhysical.id,
          toPortId: rightPhysical.id,
          cableType: "Cat5e",
          cableLength: "1m",
          color: "gray",
        },
      }),
      request.post("/api/port-links", {
        headers,
        data: {
          fromPortId: leftAggregate.aggregate.id,
          toPortId: rightAggregate.aggregate.id,
          cableType: "lacp",
          cableLength: "logical",
          color: "gray",
        },
      }),
    ]);
    expect(physicalResponse.status()).toBe(201);
    expect(logicalResponse.status()).toBe(201);
    const physicalLink = (await physicalResponse.json()) as { id: string };
    const logicalLink = (await logicalResponse.json()) as { id: string };

    await page.goto("/cables");
    const physicalCheckbox = page.getByTestId(
      `cable-select-${physicalLink.id}`,
    );
    const logicalCheckbox = page.getByTestId(`cable-select-${logicalLink.id}`);
    await expect(physicalCheckbox).toBeVisible();
    await expect(logicalCheckbox).toBeVisible();
    await expect(
      logicalCheckbox.locator("xpath=ancestor::tr").getByText("Aggregate port"),
    ).toBeVisible();

    await physicalCheckbox
      .locator("xpath=ancestor::tr")
      .getByText(leftHostname)
      .click();
    await expect(
      page.getByText("Selected cable", { exact: true }),
    ).toBeVisible();

    await physicalCheckbox.check();
    await logicalCheckbox.check();
    const bulkEditor = page.getByTestId("cable-bulk-editor");
    await expect(bulkEditor).toContainText("2 selected");
    await page.getByTestId("bulk-cable-type-enabled").check();
    await page.getByTestId("bulk-cable-length-enabled").check();
    await page.getByTestId("bulk-cable-color-enabled").check();
    await page.getByTestId("bulk-cable-type").fill("Cat6a");
    await page.getByTestId("bulk-cable-length").fill("3m");
    await page.getByTestId("bulk-cable-color").locator("input").fill("purple");
    await page.getByTestId("bulk-cable-apply").click();
    await expect(bulkEditor).toHaveCount(0);

    for (const linkId of [physicalLink.id, logicalLink.id]) {
      const response = await request.get(`/api/port-links/${linkId}`, {
        headers,
      });
      expect(response.ok()).toBeTruthy();
      const link = (await response.json()) as {
        cableType: string;
        cableLength: string;
        color: string;
      };
      expect(link).toMatchObject({
        cableType: "Cat6a",
        cableLength: "3m",
        color: "purple",
      });
    }

    const search = page.getByPlaceholder(
      "Search by device, port, type, color...",
    );
    await search.fill(suffix);
    await page.getByTestId("cable-select-all").check();
    await expect(page.getByTestId("cable-bulk-editor")).toContainText(
      "2 selected",
    );
    await page.getByTestId("bulk-cable-length-enabled").check();
    await page.getByTestId("bulk-cable-apply").click();
    await expect(page.getByTestId("cable-bulk-editor")).toHaveCount(0);

    for (const linkId of [physicalLink.id, logicalLink.id]) {
      const response = await request.get(`/api/port-links/${linkId}`, {
        headers,
      });
      expect(
        ((await response.json()) as { cableLength: string | null }).cableLength,
      ).toBeNull();
    }

    const viewerResponse = await request.post("/api/users", {
      headers,
      data: {
        username: `cable-viewer-${suffix}`,
        displayName: "Cable Viewer",
        password: "cable-viewer-password",
        role: "viewer",
      },
    });
    expect(viewerResponse.status()).toBe(201);
    viewerId = ((await viewerResponse.json()) as { id: string }).id;
    const viewerLogin = await request.post("/api/auth/login", {
      data: {
        username: `cable-viewer-${suffix}`,
        password: "cable-viewer-password",
      },
    });
    expect(viewerLogin.ok()).toBeTruthy();
    const viewerToken = ((await viewerLogin.json()) as { token: string }).token;
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
    }, viewerToken);
    await viewerPage.goto("http://127.0.0.1:5173/cables");
    await expect(viewerPage.getByTestId("cable-select-all")).toHaveCount(0);
    await expect(viewerPage.getByTestId("cable-bulk-editor")).toHaveCount(0);
    await viewerContext.close();
  } finally {
    if (viewerId) {
      await request.delete(`/api/users/${viewerId}`, { headers });
    }
    for (const deviceId of deviceIds) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
  }
});

test("UI regression surfaces remain reachable and unclipped", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await authenticate(page);
  await page.setViewportSize({ width: 1024, height: 768 });

  await page.route("**/api/discovery/scan", async (route) => {
    const timestamp = new Date().toISOString();
    const result = {
      chunkCount: 1,
      scannedHostCount: 254,
      discoveredCount: 2,
      macAddressCount: 2,
      vendorCount: 2,
      technicalCount: 1,
      diagnostics: [
        {
          code: "e2e-safe-scan",
          severity: "warning",
          message: "Intercepted browser regression scan.",
          detail: "No network traffic was generated.",
        },
      ],
      rows: [],
    };
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        job: {
          id: "e2e-discovery-job",
          labId: "lab_home",
          cidr: "10.0.10.0/24",
          status: "completed",
          createdAt: timestamp,
          updatedAt: timestamp,
          startedAt: timestamp,
          finishedAt: timestamp,
          result,
          error: null,
          queuePosition: null,
        },
      }),
    });
  });
  await page.goto("/discovery");
  await expect(
    page.getByRole("button", { name: "Add schedule" }),
  ).toBeVisible();
  const scheduleRow = page
    .getByRole("row")
    .filter({ hasText: "Sample management scan" });
  const scheduleTimestamp = scheduleRow.locator("span[title]");
  await expect(scheduleTimestamp).toBeVisible();
  await expect(scheduleTimestamp).not.toContainText("T02:");
  await expect(scheduleTimestamp).toHaveAttribute("title", /\d/);
  await page.getByRole("button", { name: "Actions" }).click();
  await page
    .locator('select[aria-label="Discovery scan target"]:visible')
    .selectOption("s_default");
  await page
    .getByRole("button", { name: "Scan subnet" })
    .filter({ visible: true })
    .click();
  const scanSummary = page.getByTestId("discovery-scan-summary");
  await expect(scanSummary).toBeVisible();
  await expect(scanSummary).toContainText("254 hosts");
  const scanSummaryState = await scanSummary.evaluate((element) => ({
    flexShrink: getComputedStyle(element).flexShrink,
    clipped: element.scrollHeight > element.clientHeight + 1,
  }));
  expect(scanSummaryState.flexShrink).toBe("0");
  expect(scanSummaryState.clipped).toBeFalsy();

  await page.goto("/documentation");
  const editor = page.getByTestId("documentation-editor");
  const preview = page.getByTestId("documentation-preview");
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  const [editorBox, previewBox] = await Promise.all([
    editor.boundingBox(),
    preview.boundingBox(),
  ]);
  expect(previewBox?.y ?? 0).toBeGreaterThan(
    (editorBox?.y ?? 0) + (editorBox?.height ?? 0),
  );
  await preview.scrollIntoViewIfNeeded();
  await expect(preview).toBeInViewport();

  for (const route of ["/networks", "/audit-log"]) {
    await page.goto(route);
    const shell = page.locator(".rk-table-shell").first();
    await expect(shell).toBeVisible();
    expect(
      await shell.evaluate((element) => getComputedStyle(element).overflowX),
    ).toBe("auto");
    const scrollState = await shell.evaluate((element) => {
      // Data volume and font metrics can let a table fit exactly on some
      // runners. Add a test-only probe so this verifies both scroll axes
      // without requiring production content to overflow when it already fits.
      const probe = document.createElement("div");
      probe.setAttribute("aria-hidden", "true");
      probe.style.width = `${element.clientWidth + 64}px`;
      probe.style.height = `${element.clientHeight + 64}px`;
      element.append(probe);
      return {
        horizontal: element.scrollWidth > element.clientWidth + 1,
        vertical: element.scrollHeight > element.clientHeight + 1,
      };
    });
    expect(scrollState.horizontal, `${route} had no horizontal overflow`).toBe(
      true,
    );
    expect(scrollState.vertical, `${route} had no vertical overflow`).toBe(
      true,
    );
    await shell.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
    expect(
      await shell.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    expect(
      await shell.evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
  }

  await page.goto("/racks");
  const tiles = page.locator(
    '[data-testid="rack-device-tile"][data-height-u="1"]',
  );
  await expect(tiles.first()).toBeVisible();
  const oneUTileState = await tiles.evaluateAll((elements) =>
    elements.map((element) => ({
      clipped: element.scrollHeight > element.clientHeight + 1,
      hostname: element.getAttribute("data-hostname"),
      text: element.textContent?.trim(),
    })),
  );
  expect(oneUTileState.every((tile) => !tile.clipped)).toBeTruthy();
  expect(
    oneUTileState.every((tile) => tile.hostname === tile.text),
  ).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  const version = page.getByTestId("sidebar-version");
  await expect(version).toBeVisible();
  expect(
    await version.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBeTruthy();

  await page.goto("/ports");
  await expect(page.getByRole("link", { name: "sw-tor-01" })).toBeVisible();
  const inspector = page.getByTestId("ports-inspector");
  await inspector.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.getByText("SFP+1", { exact: true }).first().click();
  await expect
    .poll(() => inspector.evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.getByRole("button", { name: "4x2.5G + 2x10G Firewall" }).click();
  const templateDialog = page.getByTestId("port-template-dialog");
  await expect(templateDialog).toBeVisible();
  const dialogBox = await templateDialog.boundingBox();
  expect(dialogBox?.height ?? 0).toBeLessThanOrEqual(720);
  const templateScroll = page.getByTestId("port-template-scroll-region");
  expect(
    await templateScroll.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 1,
    ),
  ).toBeTruthy();
  await templateScroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    templateDialog.getByRole("button", { name: "Save template" }),
  ).toBeInViewport();
  await templateDialog.getByRole("button", { name: "Close" }).click();

  await page.goto("/devices/d_fw");
  await page.getByRole("tab", { name: "Network" }).click();
  await page.getByLabel("Subnet").selectOption("s_default");
  await expect(page.getByTestId("network-address-input")).toHaveAttribute(
    "placeholder",
    "10.0.10.1",
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBeTruthy();

  await page.getByRole("tab", { name: "Monitoring" }).click();
  const disabledTarget = page.locator(
    '[data-testid="device-monitor-target"][data-monitor-id="mon_fw_https"]',
  );
  await expect(disabledTarget).toContainText("Disabled");
  await disabledTarget.click();
  const monitorEditor = page.getByTestId("device-monitor-editor");
  await expect(
    monitorEditor.getByText("Disabled", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();
  await expect(monitorEditor).toContainText("Firewall UI");
  await expect(monitorEditor).toContainText("History");
  await expect(monitorEditor).toContainText("Last result");
  await expect(monitorEditor).toContainText("online");
  await expect(monitorEditor).toContainText(
    "https://10.0.10.1:443/ returned 200.",
  );
  const monitorUpdateRequest = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      request.url().endsWith("/api/device-monitors/mon_fw_https"),
  );
  await page.getByRole("button", { name: "Save target" }).click();
  expect((await monitorUpdateRequest).postDataJSON()).toMatchObject({
    enabled: false,
    type: "https",
    target: "10.0.10.1",
    port: 443,
    path: "/",
  });

  await page.goto("/devices/d_ups");
  await page.getByRole("tab", { name: "Monitoring" }).click();
  const v3Target = page.locator(
    '[data-testid="device-monitor-target"][data-monitor-id="mon_ups_snmp_v3"]',
  );
  await expect(v3Target).toContainText("Disabled");
  await v3Target.click();
  const v3Editor = page.getByTestId("device-monitor-editor");
  await expect(v3Editor.getByLabel("SNMP version")).toHaveValue("3");
  await expect(
    v3Editor.getByRole("textbox", { name: "Community" }),
  ).toHaveValue("");
  const v3UpdateRequest = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      request.url().endsWith("/api/device-monitors/mon_ups_snmp_v3"),
  );
  await page.getByRole("button", { name: "Save target" }).click();
  expect((await v3UpdateRequest).postDataJSON()).toMatchObject({
    enabled: false,
    type: "snmp",
    snmpVersion: "3",
    snmpCommunity: null,
    snmpOid: "1.3.6.1.2.1.33.1.2.4.0",
    snmpMatchMode: "any",
  });
  const savedUpsMonitors = (await (
    await request.get("/api/device-monitors?deviceId=d_ups", {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as Array<{
    id: string;
    enabled: boolean;
    snmpVersion?: string | null;
    snmpCommunity?: string | null;
  }>;
  expect(
    savedUpsMonitors.find((monitor) => monitor.id === "mon_ups_snmp_v3"),
  ).toMatchObject({
    enabled: false,
    snmpVersion: "3",
    snmpCommunity: null,
  });

  await page.goto("/monitoring");
  const targetStat = page
    .locator(".rk-panel-inset")
    .filter({ has: page.getByText("Targets", { exact: true }) })
    .first();
  await expect(targetStat).toContainText("0 / 11");
  await expect(targetStat).toContainText("Enabled / Configured");
  const firewallMonitoring = page.locator(
    '[data-testid="device-monitor-card"][data-device-id="d_fw"]',
  );
  await expect(firewallMonitoring).toBeVisible();
  await expect(firewallMonitoring.getByText("Disabled")).toHaveCount(2);
  await expect(
    firewallMonitoring.getByRole("button", { name: "Check now" }),
  ).toBeDisabled();
  await expect(firewallMonitoring).not.toContainText("Last checked");
  await page.getByRole("button", { name: "Show compact monitor rows" }).click();
  const firewallMonitorRow = page.locator(
    '[data-testid="device-monitor-row"][data-device-id="d_fw"]',
  );
  await expect(firewallMonitorRow).toContainText("Management ICMP:Disabled");
  await expect(firewallMonitorRow).toContainText("Firewall UI:Disabled");
  await expect(
    firewallMonitorRow.getByText("2 Disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    firewallMonitorRow.getByRole("button", { name: "Check" }),
  ).toBeDisabled();
  await expect(firewallMonitorRow).not.toContainText("online");
  await page.getByRole("button", { name: "Actions" }).click();
  await expect(
    page
      .getByRole("button", { name: "Run all checks" })
      .filter({ visible: true }),
  ).toBeDisabled();

  await page.goto("/ports?deviceId=d_pdu_net&portId=p_d_pdu_net_mgmt");
  await expect(
    page.getByText("Management", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("sw-tor-01", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/ports?deviceId=d_pdu_net&portId=p_d_pdu_net_input");
  await expect(
    page.getByText("Power input", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("ups-01", { exact: true }).first()).toBeVisible();

  await page.goto("/networks");
  const colorInput = page.getByTestId("color-input").first();
  await expect(colorInput).toBeVisible();
  expect(
    await colorInput.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBeTruthy();

  await page.evaluate(() => localStorage.setItem("rackpad.language", "fr"));
  await page.goto("/discovery");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("fr-FR");
  const frenchScheduleRow = page
    .getByRole("row")
    .filter({ hasText: "Sample management scan" });
  await expect(frenchScheduleRow.locator("span[title]")).not.toContainText(
    "ago",
  );

  await page.evaluate(() => localStorage.setItem("rackpad.language", "en"));

  const devicesBefore = (await (
    await request.get("/api/devices?labId=lab_home", {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as unknown[];
  await page.goto("/imports");
  await page.getByRole("button", { name: "Load sample Proxmox" }).click();
  await expect(
    page.getByText("sample-pve-04", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Load sample Hyper-V" }).click();
  await expect(
    page.getByText("sample-hv-01", { exact: true }).first(),
  ).toBeVisible();
  const devicesAfter = (await (
    await request.get("/api/devices?labId=lab_home", {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as unknown[];
  expect(devicesAfter).toHaveLength(devicesBefore.length);

  await page.evaluate(() => localStorage.setItem("rackpad.language", "es"));
  await page.goto("/imports");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("es");
  await expect(
    page.getByRole("button", { name: "Cargar ejemplo de Proxmox" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cargar ejemplo de Hyper-V" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Los ejemplos solo completan esta revisión. No se escribe nada hasta seleccionar «Importar seleccionado».",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBeTruthy();
});

test("duplicate device MACs can be grouped and filtered without blocking inventory", async ({
  page,
  request,
}) => {
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-6);
  const duplicateMac = `02:aa:bb:${suffix.slice(0, 2)}:${suffix.slice(2, 4)}:${suffix.slice(4, 6)}`;
  const deviceNames = [
    `duplicate-mac-a-${suffix}`,
    `duplicate-mac-b-${suffix}`,
    `unique-mac-${suffix}`,
  ];
  const createdDeviceIds: string[] = [];

  try {
    for (const [index, hostname] of deviceNames.entries()) {
      const response = await request.post("/api/devices", {
        headers,
        data: {
          labId: "lab_home",
          hostname,
          deviceType: "endpoint",
          managementIp: `10.254.10.${index + 10}`,
          macAddress:
            index < 2
              ? index === 0
                ? duplicateMac
                : duplicateMac.replaceAll(":", "-").toUpperCase()
              : `02:ff:ee:${suffix.slice(0, 2)}:${suffix.slice(2, 4)}:${suffix.slice(4, 6)}`,
          status: "unknown",
        },
      });
      expect(response.status()).toBe(201);
      createdDeviceIds.push(((await response.json()) as { id: string }).id);
    }

    await page.goto("/devices");
    const filterCount = page.getByTestId("device-filter-count");
    await expect(filterCount).toHaveText(/\d+ of \d+ devices/);
    const totalMatch = (await filterCount.textContent())?.match(
      /(\d+) of (\d+) devices/,
    );
    expect(totalMatch).toBeTruthy();
    const initialTotal = Number(totalMatch?.[2]);
    const search = page.getByPlaceholder(
      "Search hostname, model, IP, MAC, tag...",
    );
    await search.fill(deviceNames[2]);
    await expect(filterCount).toHaveText(`1 of ${initialTotal} devices`);
    await search.clear();
    await expect(filterCount).toHaveText(
      `${initialTotal} of ${initialTotal} devices`,
    );

    await page.getByRole("button", { name: /Duplicate MACs/ }).click();
    await expect(page).toHaveURL(/mac=duplicates/);
    await expect(filterCount).toHaveText(`2 of ${initialTotal} devices`);

    const summary = page.getByTestId("duplicate-mac-summary");
    await expect(summary).toBeVisible();
    let group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toContainText(deviceNames[0]);
    await expect(group).toContainText(deviceNames[1]);
    await expect(group).toContainText("10.254.10.10");
    await expect(group).toContainText("10.254.10.11");

    const table = page.locator("table");
    await expect(
      table.getByRole("link", { name: deviceNames[0], exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("link", { name: deviceNames[1], exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("link", { name: deviceNames[2], exact: true }),
    ).toHaveCount(0);
    await expect(
      table.locator('tr[data-duplicate-mac="true"]').filter({
        hasText: deviceNames[0],
      }),
    ).toContainText("Duplicate");

    await group.getByRole("button", { name: "Ignore duplicate" }).click();
    await expect(
      summary
        .getByTestId("duplicate-mac-group")
        .filter({ hasText: duplicateMac }),
    ).toHaveCount(0);
    await expect(filterCount).toHaveText(`0 of ${initialTotal} devices`);

    const thirdDuplicateName = `duplicate-mac-c-${suffix}`;
    const thirdDuplicateRes = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: thirdDuplicateName,
        deviceType: "endpoint",
        managementIp: "10.254.10.13",
        macAddress: duplicateMac,
        status: "unknown",
      },
    });
    expect(thirdDuplicateRes.status()).toBe(201);
    createdDeviceIds.push(
      ((await thirdDuplicateRes.json()) as { id: string }).id,
    );

    await page.reload();
    const expandedTotal = initialTotal + 1;
    await expect(filterCount).toHaveText(`3 of ${expandedTotal} devices`);
    group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toContainText(thirdDuplicateName);

    await group.getByRole("button", { name: "Ignore duplicate" }).click();
    await expect(group).toHaveCount(0);
    await expect(filterCount).toHaveText(`0 of ${expandedTotal} devices`);

    await summary.getByRole("checkbox", { name: /Show ignored/ }).check();
    group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toHaveAttribute("data-ignored", "true");
    await expect(group).toContainText("Ignored duplicate");
    await expect(filterCount).toHaveText(`3 of ${expandedTotal} devices`);
    await expect(
      table.locator('tr[data-ignored-duplicate-mac="true"]').filter({
        hasText: thirdDuplicateName,
      }),
    ).toContainText("Ignored duplicate");

    await group
      .getByRole("button", { name: "Restore duplicate warning" })
      .click();
    await expect(group).not.toHaveAttribute("data-ignored", "true");
    await expect(
      group.getByRole("button", { name: "Ignore duplicate" }),
    ).toBeVisible();
    await expect(filterCount).toHaveText(`3 of ${expandedTotal} devices`);
  } finally {
    for (const deviceId of createdDeviceIds.reverse()) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
  }
});

test("assigned IPs are searchable and management mismatches link to Network review", async ({
  page,
  request,
}) => {
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-6);
  const subnetOctet = (Number.parseInt(suffix.slice(-2), 16) % 200) + 20;
  const cidr = `198.18.${subnetOctet}.0/24`;
  const managementIp = `198.18.${subnetOctet}.80`;
  const assignedIp = `198.18.${subnetOctet}.96`;
  const unownedIp = `198.18.${subnetOctet}.98`;
  const hostname = `ip-mismatch-${suffix}`;
  let subnetId = "";
  let deviceId = "";
  const assignmentIds: string[] = [];

  try {
    const subnetResponse = await request.post("/api/subnets", {
      headers,
      data: {
        labId: "lab_home",
        cidr,
        name: `IP mismatch E2E ${suffix}`,
      },
    });
    expect(subnetResponse.status()).toBe(201);
    subnetId = ((await subnetResponse.json()) as { id: string }).id;

    const deviceResponse = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname,
        deviceType: "endpoint",
        managementIp,
        status: "unknown",
      },
    });
    expect(deviceResponse.status()).toBe(201);
    deviceId = ((await deviceResponse.json()) as { id: string }).id;

    for (const assignment of [
      {
        ipAddress: assignedIp,
        assignmentType: "device",
        deviceId,
        hostname,
        description: "Recorded device-level assignment",
      },
      {
        ipAddress: unownedIp,
        assignmentType: "reserved",
        hostname: `unowned-${suffix}`,
        description: "Unowned assignment fallback",
      },
    ]) {
      const assignmentResponse = await request.post("/api/ip-assignments", {
        headers,
        data: { subnetId, ...assignment },
      });
      expect(assignmentResponse.status()).toBe(201);
      assignmentIds.push(
        ((await assignmentResponse.json()) as { id: string }).id,
      );
    }

    await page.goto("/devices");
    const search = page.getByPlaceholder(
      "Search hostname, model, IP, MAC, tag...",
    );
    await search.fill(assignedIp);
    const assignedAddressIndicator = page.getByTestId("matched-assigned-ip");
    await expect(assignedAddressIndicator).toContainText(assignedIp);
    const matchingDeviceRow = page.locator("tbody tr").filter({
      hasText: hostname,
    });
    await expect(matchingDeviceRow).toContainText(managementIp);
    await expect(matchingDeviceRow).toContainText(assignedIp);

    await search.clear();
    await page.getByRole("button", { name: /IP mismatches/ }).click();
    await expect(page).toHaveURL(/ip=mismatch/);
    const mismatch = page
      .getByTestId("ip-mismatch-device")
      .filter({ hasText: hostname });
    await expect(mismatch).toContainText(managementIp);
    await expect(mismatch).toContainText(assignedIp);
    await mismatch.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/devices/${deviceId}\\?tab=network`),
    );
    await expect(page.getByRole("tab", { name: /Network/ })).toHaveAttribute(
      "data-state",
      "active",
    );
    await expect(page.getByText(assignedIp, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Search..." }).click();
    const globalSearch = page.getByPlaceholder("Search commands");
    await globalSearch.fill(assignedIp);
    const ownedIpResult = page
      .locator("button")
      .filter({ hasText: assignedIp })
      .filter({ hasText: hostname });
    await expect(ownedIpResult).toBeVisible();
    await ownedIpResult.click();
    await expect(page).toHaveURL(
      new RegExp(`/devices/${deviceId}\\?tab=network`),
    );

    await page.getByRole("button", { name: "Search..." }).click();
    await page.getByPlaceholder("Search commands").fill(unownedIp);
    const unownedIpResult = page
      .locator("button")
      .filter({ hasText: unownedIp })
      .filter({ hasText: `unowned-${suffix}` });
    await expect(unownedIpResult).toBeVisible();
    await unownedIpResult.click();
    await expect(page).toHaveURL(
      new RegExp(`/networks\\?subnetId=${subnetId}`),
    );
  } finally {
    for (const assignmentId of assignmentIds.reverse()) {
      await request.delete(`/api/ip-assignments/${assignmentId}`, { headers });
    }
    if (deviceId) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
    if (subnetId) {
      await request.delete(`/api/subnets/${subnetId}`, { headers });
    }
  }
});

test("HTTPS certificate bypass is explicit in individual and bulk monitor setup", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-6);
  let deviceId = "";

  try {
    const deviceRes = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: `tls-monitor-${suffix}`,
        deviceType: "server",
        managementIp: "10.254.20.20",
        status: "unknown",
      },
    });
    expect(deviceRes.status()).toBe(201);
    deviceId = ((await deviceRes.json()) as { id: string }).id;

    const monitorRes = await request.post("/api/device-monitors", {
      headers,
      data: {
        deviceId,
        name: "Self-signed UI",
        type: "https",
        target: "10.254.20.20",
        port: 8443,
        path: "/health",
        enabled: false,
      },
    });
    expect(monitorRes.status()).toBe(200);
    const monitor = (await monitorRes.json()) as { id: string };

    await page.goto(`/devices/${deviceId}`);
    await page.getByRole("tab", { name: "Monitoring" }).click();
    await page
      .locator(
        `[data-testid="device-monitor-target"][data-monitor-id="${monitor.id}"]`,
      )
      .click();
    const editor = page.getByTestId("device-monitor-editor");
    const tlsToggle = editor.getByRole("checkbox", {
      name: /Ignore TLS certificate errors/,
    });
    await expect(tlsToggle).toBeVisible();
    await expect(tlsToggle).not.toBeChecked();
    await tlsToggle.check();

    const updateRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "PATCH" &&
        candidate.url().endsWith(`/api/device-monitors/${monitor.id}`),
    );
    await page.getByRole("button", { name: "Save target" }).click();
    expect((await updateRequest).postDataJSON()).toMatchObject({
      type: "https",
      ignoreTlsErrors: true,
    });
    await expect(
      page
        .locator(
          `[data-testid="device-monitor-target"][data-monitor-id="${monitor.id}"]`,
        )
        .getByText("TLS verification off"),
    ).toBeVisible();

    await page.goto("/monitoring");
    const deviceCard = page.locator(
      `[data-testid="device-monitor-card"][data-device-id="${deviceId}"]`,
    );
    await expect(deviceCard.getByText("TLS verification off")).toBeVisible();
    await deviceCard
      .getByRole("checkbox", { name: `Select tls-monitor-${suffix}` })
      .check();

    const bulkPanel = page.getByTestId("bulk-monitoring-panel");
    await bulkPanel.getByRole("button").first().click();
    await bulkPanel.getByLabel("Type").selectOption("https");
    await bulkPanel.getByLabel("Port").fill("9443");
    await bulkPanel.getByLabel("Path").fill("/bulk-health");
    await bulkPanel
      .getByRole("checkbox", { name: /Ignore TLS certificate errors/ })
      .check();

    const createRequest = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        candidate.url().endsWith("/api/device-monitors"),
    );
    await bulkPanel
      .getByRole("button", { name: "Add / enable target" })
      .click();
    expect((await createRequest).postDataJSON()).toMatchObject({
      deviceId,
      type: "https",
      port: 9443,
      path: "/bulk-health",
      ignoreTlsErrors: true,
    });
  } finally {
    if (deviceId) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
  }
});

test("legacy enabled none monitors stay effectively disabled", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route("**/api/device-monitors", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const monitors = (await response.json()) as Array<Record<string, unknown>>;
    await route.fulfill({
      response,
      json: [
        ...monitors,
        {
          id: "legacy_none_enabled",
          deviceId: "d_ups",
          name: "Legacy documentation target",
          type: "none",
          target: null,
          enabled: true,
          sortOrder: 99,
          lastCheckAt: "2026-07-20T08:00:00.000Z",
          lastResult: "offline",
          lastMessage: "Historical documentation result.",
        },
      ],
    });
  });

  await page.goto("/devices/d_ups");
  await page.getByRole("tab", { name: "Monitoring" }).click();
  const legacyTarget = page.locator(
    '[data-testid="device-monitor-target"][data-monitor-id="legacy_none_enabled"]',
  );
  await expect(legacyTarget).toContainText("Disabled");
  await expect(legacyTarget).not.toContainText("Offline");
  await legacyTarget.click();
  const editor = page.getByTestId("device-monitor-editor");
  await expect(editor.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();

  await page.goto("/monitoring");
  const upsCard = page.locator(
    '[data-testid="device-monitor-card"][data-device-id="d_ups"]',
  );
  await expect(upsCard.getByText("Disabled", { exact: true })).toHaveCount(2);
  await expect(upsCard.getByText("offline", { exact: true })).toHaveCount(0);
  await expect(
    upsCard.getByRole("button", { name: "Check now" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Show compact monitor rows" }).click();
  const upsRow = page.locator(
    '[data-testid="device-monitor-row"][data-device-id="d_ups"]',
  );
  await expect(upsRow).toContainText("Legacy documentation target:Disabled");
  await expect(upsRow).not.toContainText("offline");
  await expect(upsRow.getByRole("button", { name: "Check" })).toBeDisabled();
});

test("explicit translation never rewrites user-provided hostnames", async ({
  page,
  request,
}) => {
  const create = await request.post("/api/devices", {
    headers: { authorization: `Bearer ${token}` },
    data: {
      labId: "lab_home",
      hostname: "Unknown",
      displayName: "Unknown",
      deviceType: "server",
      placement: "room",
      status: "unknown",
    },
  });
  expect(create.status()).toBe(201);
  await authenticate(page, "fr");
  await page.goto("/devices");
  await expect(
    page.getByText("Unknown", { exact: true }).first(),
  ).toBeVisible();
  expect(await page.locator("text=Inconnu").count()).toBe(0);
});

test("localized Admin controls stay contained and alert counts pluralize", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await authenticate(page, "fr");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  let alertCount = 1;
  await page.route("**/api/audit-log?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("entityType") !== "Alert") {
      await route.continue();
      return;
    }
    const entries = Array.from({ length: alertCount }, (_, index) => ({
      id: `e2e-alert-${index}`,
      ts: new Date(Date.now() - index * 60_000).toISOString(),
      user: "system",
      action: "alert.test",
      entityType: "Alert",
      entityId: `alert-${index}`,
      summary: `Safe intercepted alert ${index + 1}`,
    }));
    await route.fulfill({ json: entries });
  });

  const localizedModes = [
    {
      language: "fr",
      lang: "fr-FR",
      direction: "ltr",
      role: "Éditeur",
      actions: [
        "Enregistrer",
        "Restaurer la sauvegarde",
        "Télécharger la sauvegarde",
        "Envoyer le test",
        "Enregistrer les notifications",
      ],
      channel: "Discord / Telegram / E-mail",
    },
    {
      language: "ar",
      lang: "ar",
      direction: "rtl",
      role: "محرر",
      actions: [
        "حفظ التغييرات",
        "استعادة النسخة الاحتياطية",
        "تنزيل النسخة الاحتياطية",
        "إرسال الاختبار",
        "حفظ الإخطارات",
      ],
      channel: "Discord / Telegram / البريد الإلكتروني",
    },
  ];

  for (const mode of localizedModes) {
    await page.evaluate((language) => {
      localStorage.setItem("rackpad.language", language);
    }, mode.language);
    await page.goto("/admin");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe(mode.lang);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dir))
      .toBe(mode.direction);
    await expect(page.getByText(mode.channel, { exact: true })).toBeVisible();

    const rolePicker = page.getByTestId("admin-role-picker");
    await expect(rolePicker).toBeVisible();
    for (const button of await rolePicker.getByRole("button").all()) {
      const geometry = await button.evaluate((element) => ({
        horizontal: element.scrollWidth <= element.clientWidth + 1,
        vertical: element.scrollHeight <= element.clientHeight + 1,
      }));
      expect(geometry.horizontal).toBeTruthy();
      expect(geometry.vertical).toBeTruthy();
    }

    await rolePicker
      .getByRole("button", { name: mode.role, exact: true })
      .click();
    const assignmentSelects = page
      .locator("select")
      .filter({
        has: page.locator('option[value="none"]'),
      })
      .filter({
        has: page.locator('option[value="viewer"]'),
      });
    await expect(assignmentSelects).toHaveCount(2);
    for (const select of await assignmentSelects.all()) {
      expect(
        await select.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBeTruthy();
    }

    for (const name of mode.actions) {
      const action = page.getByRole("button", { name, exact: true }).first();
      await expect(action).toBeAttached();
      const geometry = await action.evaluate((element) => ({
        horizontal: element.scrollWidth <= element.clientWidth + 1,
        vertical: element.scrollHeight <= element.clientHeight + 1,
        flexShrink: getComputedStyle(element).flexShrink,
      }));
      expect(
        geometry.horizontal,
        `${name} overflowed horizontally`,
      ).toBeTruthy();
      expect(geometry.vertical, `${name} overflowed vertically`).toBeTruthy();
      expect(geometry.flexShrink, `${name} was allowed to shrink`).toBe("0");
    }

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBeTruthy();
  }

  alertCount = 1;
  await page.evaluate(() => localStorage.setItem("rackpad.language", "fr"));
  await page.goto("/admin");
  await expect(page.getByText("1 entrée", { exact: true })).toBeVisible();
  alertCount = 2;
  await page.reload();
  await expect(page.getByText("2 entrées", { exact: true })).toBeVisible();
});

test("the GUI displays the package version", async ({ page }) => {
  await authenticate(page);
  await page.goto("/");
  await expect(
    page.getByText(`v${packageJson.version}`, { exact: true }),
  ).toBeVisible();
});

test("non-English dictionaries load only after selection", async ({ page }) => {
  const localeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/src/i18n/locales/")) {
      localeRequests.push(request.url());
    }
  });
  await authenticate(page);
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  expect(localeRequests).toEqual([]);

  await page.evaluate(() => localStorage.setItem("rackpad.language", "fr"));
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("fr-FR");
  expect(
    localeRequests.some((url) => url.includes("/locales/fr.ts")),
  ).toBeTruthy();
});

test("failed locale loading falls back to bundled English", async ({
  page,
}) => {
  await page.route("**/src/i18n/locales/fr.ts*", (route) => route.abort());
  await authenticate(page, "fr");
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang))
    .toBe("en");
  expect(
    await page.evaluate(() => localStorage.getItem("rackpad.language")),
  ).toBe("en");
  const notice = page.getByRole("status").filter({
    hasText: "Language unavailable",
  });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Dismiss language error" }).click();
  await expect(notice).toBeHidden();
});
