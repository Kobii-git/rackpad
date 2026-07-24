import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
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
  await page.getByRole("button", { name: "Scan subnet" }).filter({ visible: true }).click();
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
    expect(await shell.evaluate((element) => element.scrollLeft)).toBeGreaterThan(
      0,
    );
    expect(await shell.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      0,
    );
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
  await page
    .getByRole("button", { name: "4x2.5G + 2x10G Firewall" })
    .click();
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
  await expect(
    page.getByRole("button", { name: "Run now" }),
  ).toBeDisabled();
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
  await page
    .getByRole("button", { name: "Show compact monitor rows" })
    .click();
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

  await page.goto(
    "/ports?deviceId=d_pdu_net&portId=p_d_pdu_net_mgmt",
  );
  await expect(page.getByText("Management", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("sw-tor-01", { exact: true }).first()).toBeVisible();
  await page.goto(
    "/ports?deviceId=d_pdu_net&portId=p_d_pdu_net_input",
  );
  await expect(page.getByText("Power input", { exact: true }).first()).toBeVisible();
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
    await page
      .getByRole("button", { name: /Duplicate MACs/ })
      .click();
    await expect(page).toHaveURL(/mac=duplicates/);

    const summary = page.getByTestId("duplicate-mac-summary");
    await expect(summary).toBeVisible();
    const group = summary
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
  } finally {
    for (const deviceId of createdDeviceIds.reverse()) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
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
  await expect(upsCard.getByRole("button", { name: "Check now" })).toBeDisabled();
  await page
    .getByRole("button", { name: "Show compact monitor rows" })
    .click();
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
    const assignmentSelects = page.locator("select").filter({
      has: page.locator('option[value="none"]'),
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
      expect(geometry.horizontal, `${name} overflowed horizontally`).toBeTruthy();
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
