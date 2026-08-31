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
  await expect(
    page.getByRole("button", { name: "Open pool tank", exact: true }),
  ).toBeVisible();
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

test("storage header actions, keyboard rows, duplication, and replacement work end to end", async ({
  page,
  request,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(36);
  const hostname = `storage-workflow-${suffix}`;
  const serial = `STORAGE-OLD-${suffix}`;
  const replacementSerial = `STORAGE-NEW-${suffix}`;
  const poolName = `storage-pool-${suffix}`;
  let deviceId = "";
  let poolId = "";
  let oldDriveId = "";
  let duplicateDriveId = "";
  let replacementDriveId = "";

  try {
    const deviceResponse = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname,
        deviceType: "storage",
        placement: "room",
        status: "online",
        driveBayTemplateId: "storage-4x3-5",
      },
    });
    expect(deviceResponse.status(), await deviceResponse.text()).toBe(201);
    deviceId = ((await deviceResponse.json()) as { id: string }).id;
    const slotsResponse = await request.get(
      `/api/storage/drive-slots?deviceId=${deviceId}`,
      { headers },
    );
    expect(slotsResponse.ok()).toBeTruthy();
    const slots = (await slotsResponse.json()) as Array<{ id: string }>;
    const driveResponse = await request.post("/api/storage/drives", {
      headers,
      data: {
        labId: "lab_home",
        manufacturer: "Seagate",
        model: "Exos E2E",
        serial,
        capacityGb: 6000,
        interface: "sas",
        formFactor: "3.5",
        notes: "Replacement workflow fixture",
        slotId: slots[0].id,
      },
    });
    expect(driveResponse.status(), await driveResponse.text()).toBe(201);
    oldDriveId = ((await driveResponse.json()) as { id: string }).id;
    const poolResponse = await request.post("/api/storage/pools", {
      headers,
      data: {
        deviceId,
        name: poolName,
        poolType: "mirror",
        usableCapacityGb: 6000,
        status: "healthy",
        driveIds: [oldDriveId],
      },
    });
    expect(poolResponse.status(), await poolResponse.text()).toBe(201);
    poolId = ((await poolResponse.json()) as { id: string }).id;

    await page.goto("/storage");
    await page.getByRole("button", { name: "Add drive", exact: true }).click();
    await expect(page).toHaveURL(/tab=drives/);
    await expect(
      page.getByRole("heading", { name: "New drive", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Close", { exact: true }).click();

    const driveRow = page.getByRole("row").filter({ hasText: serial });
    await driveRow.focus();
    await driveRow.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Serial", exact: true }),
    ).toHaveValue(serial);
    const duplicateResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/storage/drives/${oldDriveId}/duplicate`),
    );
    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    const duplicateResponse = await duplicateResponsePromise;
    expect(duplicateResponse.status()).toBe(201);
    duplicateDriveId = ((await duplicateResponse.json()) as { id: string }).id;
    await expect(
      page.getByRole("textbox", { name: "Serial", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("textbox", { name: "Manufacturer", exact: true }),
    ).toHaveValue("Seagate");

    await page.goto("/storage");
    await page.getByRole("button", { name: "Add pool", exact: true }).click();
    await expect(page).toHaveURL(/tab=pools/);
    await expect(
      page.getByRole("heading", { name: "New pool", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: `Open pool ${poolName}`, exact: true })
      .click();
    await page
      .getByRole("button", { name: "Replace drive", exact: true })
      .click();
    const replacement = page.getByRole("group", {
      name: "Replace drive",
      exact: true,
    });
    await expect(
      replacement.getByRole("textbox", { name: "Manufacturer", exact: true }),
    ).toHaveValue("Seagate");
    await expect(
      replacement.getByRole("checkbox", {
        name: "Delete retired drive",
        exact: true,
      }),
    ).not.toBeChecked();
    await replacement
      .getByRole("textbox", { name: "Serial", exact: true })
      .fill(replacementSerial);
    const replacementResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/api/storage/pools/${poolId}/replace-drive`),
    );
    await replacement
      .getByRole("button", { name: "Replace drive", exact: true })
      .click();
    const replacementResponse = await replacementResponsePromise;
    expect(replacementResponse.status()).toBe(201);
    replacementDriveId = (
      (await replacementResponse.json()) as { replacement: { id: string } }
    ).replacement.id;
    await expect(
      page.getByText(replacementSerial, { exact: true }),
    ).toBeVisible();

    const drivesResponse = await request.get(
      "/api/storage/drives?labId=lab_home",
      { headers },
    );
    const drives = (await drivesResponse.json()) as Array<{
      id: string;
      slotId: string | null;
      poolId: string | null;
    }>;
    expect(drives.find((drive) => drive.id === oldDriveId)).toMatchObject({
      slotId: null,
      poolId: null,
    });
    expect(
      drives.find((drive) => drive.id === replacementDriveId),
    ).toMatchObject({ slotId: slots[0].id, poolId });
  } finally {
    if (poolId)
      await request.delete(`/api/storage/pools/${poolId}`, { headers });
    for (const driveId of [duplicateDriveId, oldDriveId, replacementDriveId]) {
      if (driveId)
        await request.delete(`/api/storage/drives/${driveId}`, { headers });
    }
    if (deviceId) await request.delete(`/api/devices/${deviceId}`, { headers });
  }
});

test("native backup admin controls expose status, create, and delete", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/admin");
  const panel = page.getByTestId("native-backup-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Configured", { exact: true })).toBeVisible();
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/admin/native-backups"),
  );
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  const creationResponse = await creationResponsePromise;
  expect(creationResponse.status()).toBe(201);
  const created = (await creationResponse.json()) as { name: string };
  await expect(panel.getByText(created.name, { exact: true })).toBeVisible();
  await expect(panel.getByText(/MB|KB| B/).first()).toBeVisible();

  const backupRow = panel
    .getByText(created.name, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'border-t')][1]");
  const sqliteDownload = backupRow.getByRole("button", {
    name: "Download SQLite backup",
    exact: true,
  });
  await expect(sqliteDownload).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await sqliteDownload.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(created.name);

  page.once("dialog", (dialog) => void dialog.accept());
  const deletionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response
        .url()
        .includes(
          `/api/admin/native-backups/${encodeURIComponent(created.name)}`,
        ),
  );
  await backupRow
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const deletionResponse = await deletionResponsePromise;
  expect(deletionResponse.status()).toBe(204);
  await expect(panel.getByText(created.name, { exact: true })).toHaveCount(0);
});

test("template count editing preserves custom slot metadata", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const templateName = `Lossless template ${suffix}`;
  const headers = { Authorization: `Bearer ${token}` };
  const originalSlots = [
    { name: "Boot A", position: 10, slotType: "m2" },
    { name: "Archive left", position: 20, slotType: "3.5" },
  ];
  let templateId = "";
  try {
    const createResponse = await request.post(
      "/api/storage/drive-bay-templates",
      {
        headers,
        data: {
          name: templateName,
          description: "Mixed custom slots",
          deviceTypes: ["storage"],
          sections: [
            {
              name: "Mixed archive",
              face: "rear",
              layout: "list",
              columns: null,
              slots: originalSlots,
            },
          ],
        },
      },
    );
    const created = (await createResponse.json()) as {
      id?: string;
      error?: string;
    };
    expect(createResponse.status(), created.error).toBe(201);
    templateId = created.id ?? "";
    expect(templateId).not.toBe("");

    await authenticate(page);
    await page.goto("/storage?tab=templates");
    await page.getByRole("button").filter({ hasText: templateName }).click();
    const count = page.getByRole("spinbutton", {
      name: "Slot count",
      exact: true,
    });
    await expect(count).toHaveValue("2");
    await count.fill("");
    await count.pressSequentially("2");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const listResponse = await request.get("/api/storage/drive-bay-templates", {
      headers,
    });
    expect(listResponse.ok()).toBeTruthy();
    const saved = (
      (await listResponse.json()) as Array<{
        id: string;
        sections: Array<{ slots: typeof originalSlots }>;
      }>
    ).find((entry) => entry.id === templateId);
    expect(saved?.sections[0]?.slots).toEqual(originalSlots);
  } finally {
    if (templateId) {
      const response = await request.delete(
        `/api/storage/drive-bay-templates/${templateId}`,
        { headers },
      );
      expect(response.status(), await response.text()).toBe(204);
    }
  }
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

    await page.goto("/visualizer");
    await page
      .getByRole("textbox", { name: "Visualiseur de recherche", exact: true })
      .fill(hostname);
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }).first(),
    ).toBeVisible();

    await page.goto("/storage?tab=drives");
    await page
      .getByRole("button", { name: "Ajouter un disque", exact: true })
      .click();
    const driveInterface = page.getByRole("combobox", {
      name: "Interface",
      exact: true,
    });
    const driveFormFactor = page.getByRole("combobox", {
      name: "Facteur de forme",
      exact: true,
    });
    await driveInterface.selectOption("other");
    await driveFormFactor.selectOption("other");
    await expect(driveInterface.locator("option:checked")).toHaveText("Autre");
    await expect(driveFormFactor.locator("option:checked")).toHaveText("Autre");
    await page.getByRole("button", { name: "Fermer", exact: true }).click();

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
      page
        .getByText("12 × baies de disques de 3,5 pouces", { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Descriptif", exact: true }),
    ).toHaveValue(
      "Douze baies frontales pour disques de 3,5 pouces sur trois rangées.",
    );
    await expect(
      page.getByText("Boîtier de stockage", { exact: true }),
    ).toBeVisible();

    await page.evaluate(() => localStorage.setItem("rackpad.language", "af"));
    await page.goto("/storage");
    await expect(
      page.getByRole("tab", { name: /Logiese bergingspoele/ }),
    ).toBeVisible();
    await expect(
      page.getByText("Ontoegekende skywe", { exact: false }).first(),
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
    await page
      .getByRole("button", { name: "Custom template", exact: true })
      .click();
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
    const storagePageErrors: string[] = [];
    editorPage.on("pageerror", (error) =>
      storagePageErrors.push(error.message),
    );
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
    expect(storagePageErrors).toEqual([]);

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
      editorPage.getByRole("button", {
        name: `Open pool ${poolName}`,
        exact: true,
      }),
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
      "Cross-device demo pool with one disk-shelf member and one pulled member.",
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

test("Rack Studio patches exact ports, saves routes, exports, and traces", async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${token}` };
  const fromPortId = "p_d_srv_backup_4";
  const toPortId = "p_d_srv_pve1_4";
  let linkId = "";

  try {
    await authenticate(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/racks");
    await page.getByRole("button", { name: "Studio Beta", exact: true }).click();
    await page.getByRole("button", { name: "Cables", exact: true }).click();

    const backupDevice = page.getByRole("button", {
      name: "backup-01",
      exact: true,
    });
    const pveDevice = page.getByRole("button", {
      name: "pve-01",
      exact: true,
    });
    await backupDevice
      .getByRole("button", { name: "eno4 · rj45", exact: true })
      .click();
    await pveDevice
      .getByRole("button", { name: "eno4 · rj45", exact: true })
      .click();

    const inspector = page.getByTestId("rack-studio-cable-inspector");
    await expect(inspector).toContainText("From port: backup-01:eno4");
    await expect(inspector).toContainText("To port: pve-01:eno4");

    const linksResponse = await request.get("/api/port-links", { headers });
    expect(linksResponse.status(), await linksResponse.text()).toBe(200);
    const links = (await linksResponse.json()) as Array<{
      id: string;
      fromPortId: string;
      toPortId: string;
    }>;
    linkId =
      links.find(
        (link) =>
          link.fromPortId === fromPortId && link.toPortId === toPortId,
      )?.id ?? "";
    expect(linkId).not.toBe("");

    await backupDevice
      .getByRole("button", { name: "eno3 · rj45", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Outlet 1 · power", exact: true })
      .click();
    await expect(page.getByText("rj45 → power", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await backupDevice
      .getByRole("button", { name: "eno4 · rj45", exact: true })
      .click();
    await inspector
      .getByRole("textbox", { name: "Label", exact: true })
      .fill("Phase 5 QA cable");
    await inspector.getByRole("button", { name: "Add", exact: true }).click();
    await inspector
      .getByRole("spinbutton", { name: "Position: X", exact: true })
      .fill("420");
    await inspector
      .getByRole("spinbutton", { name: "Position: Y", exact: true })
      .fill("280");
    await inspector.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(async () => {
        const response = await request.get(`/api/port-links/${linkId}`, {
          headers,
        });
        if (!response.ok()) return null;
        const link = (await response.json()) as {
          label?: string;
          routeWaypoints?: Array<{ x: number; y: number }>;
        };
        return {
          label: link.label,
          routeWaypoints: link.routeWaypoints,
        };
      })
      .toEqual({
        label: "Phase 5 QA cable",
        routeWaypoints: [expect.objectContaining({ x: 420, y: 280 })],
      });

    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download SVG", exact: true })
      .click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      "lab-server-room-rack-studio.svg",
    );
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expect(await readFile(downloadPath!, "utf8")).toContain("Phase 5 QA cable");

    await inspector.getByRole("link", { name: "Trace", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/visualizer\\?tracePortId=${fromPortId}$`),
    );
    await expect(
      page.getByText("backup-01 / eno4", { exact: true }),
    ).toBeVisible();
  } finally {
    if (linkId) {
      await request.delete(`/api/port-links/${linkId}`, { headers });
    }
  }
});

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

test("Compute host eligibility distinguishes storage from storage enclosures", async ({
  page,
  request,
}) => {
  await authenticate(page);
  const headers = { authorization: `Bearer ${token}` };
  const suffix = Date.now().toString(16).slice(-7);
  const serverTypeId = `e2e_compute_server_${suffix}`;
  const endpointTypeId = `e2e_compute_endpoint_${suffix}`;
  const storageTypeId = `e2e_compute_storage_${suffix}`;
  const enclosureTypeId = `e2e_compute_enclosure_${suffix}`;
  const serverHostname = `compute-host-${suffix}`;
  const endpointHostname = `compute-endpoint-${suffix}`;
  const storageHostname = `compute-storage-${suffix}`;
  const enclosureHostname = `compute-enclosure-${suffix}`;
  const customStorageHostname = `compute-custom-storage-${suffix}`;
  const customEnclosureHostname = `compute-custom-enclosure-${suffix}`;
  const guestHostname = `compute-guest-${suffix}`;
  const containerHostname = `compute-container-${suffix}`;
  const switchName = `compute-switch-${suffix}`;
  const deviceIds: string[] = [];
  const deviceTypeIds: string[] = [];
  let virtualSwitchId = "";
  let viewerId = "";
  let viewerContext: Awaited<ReturnType<typeof page.context>> | null = null;

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
      {
        id: storageTypeId,
        label: `E2E compute storage ${suffix}`,
        parentType: "storage",
      },
      {
        id: enclosureTypeId,
        label: `E2E compute enclosure ${suffix}`,
        parentType: "storage_enclosure",
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
      {
        hostname: storageHostname,
        deviceType: "storage",
      },
      {
        hostname: enclosureHostname,
        deviceType: "storage_enclosure",
      },
      {
        hostname: customStorageHostname,
        deviceType: storageTypeId,
      },
      {
        hostname: customEnclosureHostname,
        deviceType: enclosureTypeId,
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
    await page.goto(`/devices/${hostDeviceId}`);
    await expect(page.getByRole("tab", { name: /Compute/ })).toBeVisible();
    await page.goto(`/devices/${deviceIds[3]}`);
    await expect(page.getByRole("tab", { name: /Compute/ })).toHaveCount(0);

    await page.goto("/compute");
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: serverHostname, exact: true }),
    ).toBeVisible();
    for (const hostname of [storageHostname, customStorageHostname]) {
      const hostCard = page
        .getByRole("link", { name: hostname, exact: true })
        .locator(
          "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rk-panel-inset ')][1]",
        );
      await expect(hostCard).toBeVisible();
      await expect(
        hostCard.getByRole("button", { name: "Add bridge", exact: true }),
      ).toBeVisible();
    }
    for (const hostname of [
      endpointHostname,
      enclosureHostname,
      customEnclosureHostname,
    ]) {
      await expect(page.getByText(hostname, { exact: true })).toHaveCount(0);
    }

    for (const workload of [
      {
        hostname: guestHostname,
        deviceType: "vm",
        cpuCores: 4,
        memoryGb: 8,
        storageGb: 120,
      },
      {
        hostname: containerHostname,
        deviceType: "container",
        cpuCores: 2,
        memoryGb: 4,
        storageGb: 40,
      },
    ]) {
      const workloadResponse = await request.post("/api/devices", {
        headers,
        data: {
          labId: "lab_home",
          ...workload,
          placement: "virtual",
          parentDeviceId: hostDeviceId,
          status: "online",
        },
      });
      expect(workloadResponse.status()).toBe(201);
      deviceIds.unshift(((await workloadResponse.json()) as { id: string }).id);
    }
    const switchResponse = await request.post("/api/virtual-switches", {
      headers,
      data: {
        hostDeviceId,
        name: switchName,
        kind: "internal",
        notes: "Read-only device Compute card",
      },
    });
    expect(switchResponse.status()).toBe(201);
    virtualSwitchId = ((await switchResponse.json()) as { id: string }).id;

    await page.goto("/compute");
    const activeHostCard = page
      .getByRole("heading", { name: serverHostname, exact: true })
      .locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rk-panel ')][1]",
      );
    await expect(activeHostCard).toBeVisible();
    await expect(activeHostCard).toContainText(guestHostname);
    await expect(activeHostCard).toContainText(containerHostname);
    await expect(
      activeHostCard.getByRole("button", { name: "Add VM on host" }),
    ).toBeVisible();

    await page.goto(`/devices/${hostDeviceId}?tab=compute`);
    const deviceCompute = page.getByTestId("device-compute-panel");
    await expect(deviceCompute).toBeVisible();
    await expect(deviceCompute).toContainText(guestHostname);
    await expect(deviceCompute).toContainText(containerHostname);
    await expect(deviceCompute).toContainText(switchName);
    await expect(deviceCompute).toContainText("Memory GB");
    await expect(deviceCompute.getByRole("button")).toHaveCount(0);

    const username = `compute-viewer-${suffix}`;
    const viewerResponse = await request.post("/api/users", {
      headers,
      data: {
        username,
        displayName: "Compute Viewer",
        password: "compute-viewer-password",
        role: "viewer",
      },
    });
    expect(viewerResponse.status()).toBe(201);
    viewerId = ((await viewerResponse.json()) as { id: string }).id;
    const viewerLogin = await request.post("/api/auth/login", {
      data: { username, password: "compute-viewer-password" },
    });
    expect(viewerLogin.ok()).toBeTruthy();
    const viewerToken = ((await viewerLogin.json()) as { token: string }).token;
    viewerContext = await page.context().browser()!.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
    }, viewerToken);
    await viewerPage.goto(
      `http://127.0.0.1:5173/devices/${hostDeviceId}?tab=compute`,
    );
    const viewerPanel = viewerPage.getByTestId("device-compute-panel");
    await expect(viewerPanel).toContainText(guestHostname);
    await expect(viewerPanel).toContainText(containerHostname);
    await expect(viewerPanel.getByRole("button")).toHaveCount(0);
  } finally {
    await viewerContext?.close();
    if (viewerId) await request.delete(`/api/users/${viewerId}`, { headers });
    if (virtualSwitchId) {
      await request.delete(`/api/virtual-switches/${virtualSwitchId}`, {
        headers,
      });
    }
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
  await expect(version).toHaveAttribute(
    "href",
    "https://github.com/Kobii-git/rackpad",
  );
  await expect(version).toHaveAttribute("target", "_blank");
  await expect(version).toHaveAttribute("rel", "noopener noreferrer");
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
    "Historical example.invalid sample: HTTPS returned 200 with its certificate exception.",
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
    target: "firewall.example.invalid",
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

    const summary = page.getByTestId("duplicate-mac-summary");
    const table = page.locator("table");
    await expect(summary).toBeVisible();
    await expect(
      table.getByRole("link", { name: deviceNames[0], exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("link", { name: deviceNames[1], exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("link", { name: deviceNames[2], exact: true }),
    ).toHaveCount(0);

    await expect(filterCount).toHaveText(/\d+ of \d+ devices/);
    const duplicateCountMatch = (await filterCount.textContent())?.match(
      /(\d+) of (\d+) devices/,
    );
    expect(duplicateCountMatch).toBeTruthy();
    expect(Number(duplicateCountMatch?.[2])).toBe(initialTotal);
    const baseDuplicateCount = Number(duplicateCountMatch?.[1]) - 2;
    expect(baseDuplicateCount).toBeGreaterThanOrEqual(2);

    let group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toContainText(deviceNames[0]);
    await expect(group).toContainText(deviceNames[1]);
    await expect(group).toContainText("10.254.10.10");
    await expect(group).toContainText("10.254.10.11");

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
    await expect(filterCount).toHaveText(
      `${baseDuplicateCount} of ${initialTotal} devices`,
    );

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
    await expect(filterCount).toHaveText(
      `${baseDuplicateCount + 3} of ${expandedTotal} devices`,
    );
    group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toContainText(thirdDuplicateName);

    await group.getByRole("button", { name: "Ignore duplicate" }).click();
    await expect(group).toHaveCount(0);
    await expect(filterCount).toHaveText(
      `${baseDuplicateCount} of ${expandedTotal} devices`,
    );

    await summary.getByRole("checkbox", { name: /Show ignored/ }).check();
    group = summary
      .getByTestId("duplicate-mac-group")
      .filter({ hasText: duplicateMac });
    await expect(group).toHaveAttribute("data-ignored", "true");
    await expect(group).toContainText("Ignored duplicate");
    const allDuplicateCountMatch = (await filterCount.textContent())?.match(
      /(\d+) of (\d+) devices/,
    );
    expect(Number(allDuplicateCountMatch?.[1])).toBeGreaterThanOrEqual(
      baseDuplicateCount + 3,
    );
    const allDuplicateCount = Number(allDuplicateCountMatch?.[1]);
    await expect(filterCount).toHaveText(
      `${allDuplicateCount} of ${expandedTotal} devices`,
    );
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
    await expect(filterCount).toHaveText(
      `${allDuplicateCount} of ${expandedTotal} devices`,
    );
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
    page.getByRole("link", { name: "Unknown", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Inconnu", exact: true }),
  ).toHaveCount(0);
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
        "Télécharger la sauvegarde JSON",
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
        "تنزيل نسخة JSON الاحتياطية",
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

test("beta feedback relationships and JSON snapshot action are visible", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "Download JSON backup", exact: true }),
  ).toHaveCount(1);

  await page.goto("/devices/d_vm_gitea");
  const hostedBy = page.getByTestId("device-host-relationship");
  await expect(hostedBy).toContainText("Hosted by");
  await expect(hostedBy.getByRole("link", { name: "pve-01" })).toHaveAttribute(
    "href",
    "/devices/d_srv_pve1",
  );
  await expect(
    page.getByText("Host device", { exact: true }).locator(".."),
  ).toContainText("pve-01");

  await page.route("**/api/devices", async (route) => {
    const response = await route.fetch();
    const devices = (await response.json()) as Array<{
      id: string;
      parentDeviceId?: string | null;
    }>;
    const staleDevices = devices.map((device) =>
      device.id === "d_vm_gitea"
        ? { ...device, parentDeviceId: "d_missing_host" }
        : device,
    );
    await route.fulfill({ response, json: staleDevices });
  });
  await page.reload();
  await expect(page.getByTestId("device-host-relationship")).toContainText(
    "Host unavailable",
  );
  await page.unroute("**/api/devices");

  await page.goto("/devices/d_srv_nas?tab=storage");
  const internalMember = page
    .locator("[data-pool-member-row]")
    .filter({ hasText: "DEMO-STORE-01" })
    .first();
  await expect(internalMember).toContainText("Internal");
  const attachedMember = page
    .locator("[data-pool-member-row]")
    .filter({ hasText: "DEMO-STORE-05" })
    .first();
  await expect(attachedMember).toContainText("External / attached");
  await expect(
    attachedMember.getByRole("link", { name: "shelf-storage-01" }),
  ).toHaveAttribute("href", "/devices/d_disk_shelf?tab=storage");
  const unassignedMember = page
    .locator("[data-pool-member-row]")
    .filter({ hasText: "DEMO-STORE-06" })
    .first();
  await expect(unassignedMember).toContainText("Unassigned");
  await expect(unassignedMember).toContainText("Missing");

  await page.goto("/devices/d_disk_shelf?tab=storage");
  const attachedPools = page.getByTestId("attached-storage-pools");
  await expect(attachedPools).toContainText("External / attached");
  await expect(
    attachedPools.getByRole("link", { name: "truenas-01", exact: true }),
  ).toHaveAttribute("href", "/devices/d_srv_nas?tab=storage");

  await page.goto("/devices/d_srv_nas");
  const source = page.getByTestId("device-overview-storage-source");
  await expect(source).toHaveText("Usable topology");
  await expect(source.locator("..")).toContainText("48000 GB");
});

test("documentation images open safely with mouse and keyboard", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/documentation?pageId=doc_home_runbook");
  const imageControl = page.getByRole("button", {
    name: "Open image CMP-01 rack front reference in a new tab",
    exact: true,
  });
  await expect(imageControl).toBeVisible();

  await imageControl.focus();
  const keyboardPopupPromise = page.waitForEvent("popup");
  await imageControl.press("Enter");
  const keyboardPopup = await keyboardPopupPromise;
  await expect.poll(() => keyboardPopup.url()).toMatch(/^blob:/);
  await keyboardPopup.close();

  const mousePopupPromise = page.waitForEvent("popup");
  await imageControl.click();
  const mousePopup = await mousePopupPromise;
  await expect.poll(() => mousePopup.url()).toMatch(/^blob:/);
  await mousePopup.close();
});

test("device overview storage follows topology precedence without rewriting manual storage", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const headers = { Authorization: `Bearer ${token}` };
  const deviceIds: string[] = [];
  const driveIds: string[] = [];
  let poolId = "";

  try {
    const createDevice = async (
      hostname: string,
      storageGb: number,
      withSlots: boolean,
    ) => {
      const response = await request.post("/api/devices", {
        headers,
        data: {
          labId: "lab_home",
          hostname,
          deviceType: "storage",
          placement: "room",
          status: "unknown",
          storageGb,
          ...(withSlots ? { driveBayTemplateId: "storage-4x3-5" } : {}),
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      const device = (await response.json()) as { id: string };
      deviceIds.push(device.id);
      return device.id;
    };
    const createInstalledDrive = async (
      deviceId: string,
      serial: string,
      capacityGb: number,
    ) => {
      const slotsResponse = await request.get(
        `/api/storage/drive-slots?deviceId=${deviceId}`,
        { headers },
      );
      expect(slotsResponse.ok()).toBeTruthy();
      const slots = (await slotsResponse.json()) as Array<{ id: string }>;
      const driveResponse = await request.post("/api/storage/drives", {
        headers,
        data: {
          labId: "lab_home",
          serial,
          capacityGb,
          interface: "sas",
          formFactor: "3.5",
          slotId: slots[0].id,
        },
      });
      expect(driveResponse.status(), await driveResponse.text()).toBe(201);
      const drive = (await driveResponse.json()) as { id: string };
      driveIds.push(drive.id);
      return drive.id;
    };

    const usableDeviceId = await createDevice(
      `overview-usable-${suffix}`,
      111,
      true,
    );
    const rawDeviceId = await createDevice(
      `overview-raw-${suffix}`,
      222,
      true,
    );
    const manualDeviceId = await createDevice(
      `overview-manual-${suffix}`,
      333,
      false,
    );
    const usableDriveId = await createInstalledDrive(
      usableDeviceId,
      `OVERVIEW-USABLE-${suffix}`,
      600,
    );
    await createInstalledDrive(
      rawDeviceId,
      `OVERVIEW-RAW-${suffix}`,
      700,
    );
    const poolResponse = await request.post("/api/storage/pools", {
      headers,
      data: {
        deviceId: usableDeviceId,
        name: `overview-pool-${suffix}`,
        poolType: "mirror",
        usableCapacityGb: 450,
        status: "healthy",
        driveIds: [usableDriveId],
      },
    });
    expect(poolResponse.status(), await poolResponse.text()).toBe(201);
    poolId = ((await poolResponse.json()) as { id: string }).id;

    await authenticate(page);
    for (const [deviceId, source, capacity] of [
      [usableDeviceId, "Usable topology", "450 GB"],
      [rawDeviceId, "Raw topology", "700 GB"],
      [manualDeviceId, "Manual / imported", "333 GB"],
    ] as const) {
      await page.goto(`/devices/${deviceId}`);
      const sourceIndicator = page.getByTestId(
        "device-overview-storage-source",
      );
      await expect(sourceIndicator).toHaveText(source);
      await expect(sourceIndicator.locator("..")).toContainText(capacity);
    }

    for (const [deviceId, storedStorageGb] of [
      [usableDeviceId, 111],
      [rawDeviceId, 222],
      [manualDeviceId, 333],
    ] as const) {
      const response = await request.get(`/api/devices/${deviceId}`, {
        headers,
      });
      expect(response.ok()).toBeTruthy();
      expect(
        ((await response.json()) as { storageGb: number }).storageGb,
      ).toBe(storedStorageGb);
    }
  } finally {
    if (poolId) await request.delete(`/api/storage/pools/${poolId}`, { headers });
    for (const driveId of driveIds) {
      await request.delete(`/api/storage/drives/${driveId}`, { headers });
    }
    for (const deviceId of deviceIds) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
  }
});

test("unmanaged status is selectable, bulk editable, filterable, and reported", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const suffix = Date.now().toString(36);
  const headers = { Authorization: `Bearer ${token}` };
  const hostnames = [
    `unmanaged-manual-${suffix}`,
    `unmanaged-bulk-${suffix}`,
  ];
  const deviceIds: string[] = [];

  try {
    for (const hostname of hostnames) {
      const response = await request.post("/api/devices", {
        headers,
        data: {
          labId: "lab_home",
          hostname,
          deviceType: "server",
          placement: "room",
          status: "online",
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      deviceIds.push(((await response.json()) as { id: string }).id);
    }

    await authenticate(page);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/devices");
    await page.getByRole("button", { name: "Add device", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Unmanaged", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Close", { exact: true }).click();

    await page.goto(`/devices/${deviceIds[0]}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Unmanaged", exact: true }).click();
    const editResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/devices/${deviceIds[0]}`),
    );
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    const editResponse = await editResponsePromise;
    expect(editResponse.status(), await editResponse.text()).toBe(200);
    expect(((await editResponse.json()) as { status: string }).status).toBe(
      "unmanaged",
    );

    await page.goto("/devices");
    for (const hostname of hostnames) {
      await page.getByRole("checkbox", { name: `Select ${hostname}` }).check();
    }
    const bulkStatusField = page
      .locator("label")
      .filter({ hasText: "Status" })
      .last();
    await bulkStatusField.getByRole("checkbox").check();
    await bulkStatusField.getByRole("combobox").selectOption("unmanaged");
    const bulkResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/devices/bulk"),
    );
    await page
      .getByRole("button", { name: "Apply changes", exact: true })
      .click();
    const bulkResponse = await bulkResponsePromise;
    expect(bulkResponse.status(), await bulkResponse.text()).toBe(200);
    expect(
      (
        (await bulkResponse.json()) as {
          devices: Array<{ status: string }>;
        }
      ).devices.every((device) => device.status === "unmanaged"),
    ).toBeTruthy();

    const statusFilter = page.getByRole("combobox", {
      name: "Status",
      exact: true,
    });
    await statusFilter.selectOption("unmanaged");
    await expect(statusFilter).toHaveValue("unmanaged");
    for (const hostname of hostnames) {
      await expect(page.getByText(hostname, { exact: true })).toBeVisible();
    }

    await page.goto("/reports");
    await expect(page.getByText("Unmanaged", { exact: true })).toBeVisible();
  } finally {
    for (const deviceId of deviceIds) {
      await request.delete(`/api/devices/${deviceId}`, { headers });
    }
  }
});

test("Device Types workspace supports CRUD, usage, and admin-only access", async ({
  browser,
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const typeId = `e2e_device_type_${suffix}`;
  const username = `device-type-viewer-${suffix}`;
  const headers = { Authorization: `Bearer ${token}` };
  let viewerId = "";
  let deviceId = "";
  let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    await authenticate(page);
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto("/admin/device-types");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Device types",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("device-type-section-built-in")).toBeVisible();
    await expect(page.getByTestId("device-type-section-custom")).toBeVisible();
    const deviceTypeEditor = page.getByTestId("device-type-editor");
    await deviceTypeEditor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(`E2E appliance ${suffix}`);
    await deviceTypeEditor
      .getByRole("textbox", { name: "ID", exact: true })
      .fill(typeId);
    await deviceTypeEditor
      .getByRole("combobox", { name: "Parent", exact: true })
      .selectOption("server");
    await expect(
      page.getByTestId("device-type-inheritance-summary"),
    ).toContainText(
      "Inherits parent behavior for placement, ports and templates, Compute, WiFi, Storage, and imports.",
    );
    await deviceTypeEditor
      .getByRole("button", { name: "Create", exact: true })
      .click();
    await expect(page.getByTestId("device-type-usage")).toContainText(
      "Devices",
    );
    await expect(page.getByTestId("device-type-usage")).toContainText(
      "Port templates",
    );
    await expect(
      deviceTypeEditor.getByRole("textbox", { name: "ID", exact: true }),
    ).toBeDisabled();

    const updatedLabel = `E2E managed appliance ${suffix}`;
    await deviceTypeEditor
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(updatedLabel);
    await deviceTypeEditor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByText(updatedLabel, { exact: true }).first(),
    ).toBeVisible();

    const deviceResponse = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: `device-type-usage-${suffix}`,
        deviceType: typeId,
        status: "unknown",
        placement: "room",
      },
    });
    expect(deviceResponse.status(), await deviceResponse.text()).toBe(201);
    deviceId = ((await deviceResponse.json()) as { id: string }).id;
    await page.reload();
    await page.getByText(updatedLabel, { exact: true }).first().click();
    await expect(page.getByTestId("device-type-deletion-reason")).toContainText(
      "Devices 1",
    );
    await expect(
      deviceTypeEditor.getByRole("button", { name: "Delete", exact: true }),
    ).toBeDisabled();

    const viewerResponse = await request.post("/api/users", {
      headers,
      data: {
        username,
        displayName: "Device Type Viewer",
        password: "device-type-viewer-password",
        role: "viewer",
      },
    });
    expect(viewerResponse.status()).toBe(201);
    viewerId = ((await viewerResponse.json()) as { id: string }).id;
    const viewerLogin = await request.post("/api/auth/login", {
      data: { username, password: "device-type-viewer-password" },
    });
    expect(viewerLogin.ok()).toBeTruthy();
    const viewerToken = ((await viewerLogin.json()) as { token: string }).token;
    const generalTypes = await request.get("/api/device-types", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(generalTypes.status()).toBe(200);
    const usage = await request.get("/api/device-types/usage", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(usage.status()).toBe(403);

    viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
    }, viewerToken);
    await viewerPage.goto("http://127.0.0.1:5173/admin/device-types");
    await expect(
      viewerPage.getByRole("heading", {
        name: "Administrator access required",
        exact: true,
      }),
    ).toBeVisible();

    await request.delete(`/api/devices/${deviceId}`, { headers });
    deviceId = "";
    await page.reload();
    await page.getByText(updatedLabel, { exact: true }).first().click();

    page.once("dialog", (dialog) => dialog.accept());
    await deviceTypeEditor
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByText(updatedLabel, { exact: true })).toHaveCount(0);
  } finally {
    await viewerContext?.close();
    if (viewerId) await request.delete(`/api/users/${viewerId}`, { headers });
    if (deviceId) await request.delete(`/api/devices/${deviceId}`, { headers });
    await request.delete(`/api/device-types/${typeId}`, { headers });
  }
});

test("integration previews expose safe modes, UTC schedules, and viewer read-only state", async ({
  browser,
  page,
  request,
}) => {
  const suffix = Date.now().toString(36);
  const headers = { Authorization: `Bearer ${token}` };
  const connectionResponse = await request.post(
    "/api/integrations/connections",
    {
      headers,
      data: {
        labId: "lab_home",
        provider: "opnsense",
        name: `E2E firewall ${suffix}`,
        baseUrl: "https://8.8.8.8",
        authKind: "key-secret",
        authId: "e2e-key",
        authSecret: "e2e-secret",
      },
    },
  );
  expect(connectionResponse.status(), await connectionResponse.text()).toBe(
    201,
  );
  const connection = (await connectionResponse.json()) as {
    id: string;
    name: string;
  } & Record<string, unknown>;
  let scheduleId = "";
  let viewerId = "";
  let deviceApplyCount = 0;
  const submittedDeviceSelections: string[][] = [];
  let viewerContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    const scheduleResponse = await request.post("/api/integrations/schedules", {
      headers,
      data: {
        connectionId: connection.id,
        name: `Nightly safe sync ${suffix}`,
        enabled: true,
        mode: "skip",
        cron: "0 2 * * *",
        labIds: ["lab_home"],
      },
    });
    expect(scheduleResponse.status(), await scheduleResponse.text()).toBe(201);
    scheduleId = ((await scheduleResponse.json()) as { id: string }).id;

    await authenticate(page);
    await page.route(
      `**/api/integrations/connections/${connection.id}/inventory`,
      async (route) => {
        await route.fulfill({
          json: {
            connection,
            mode: "merge",
            networkPreviewToken: "e2e-network-preview-token",
            networkPreviewExpiresAt: new Date(
              Date.now() + 60_000,
            ).toISOString(),
            deviceSnapshotToken: "e2e-device-snapshot-token",
            deviceSnapshotExpiresAt: new Date(
              Date.now() + 60_000,
            ).toISOString(),
            preview: {
              profileId: "integration:opnsense",
              deviceId: connection.id,
              labId: "lab_home",
              target: "E2E firewall",
              collectedAt: new Date().toISOString(),
              policy: "merge",
              vlans: [
                {
                  action: "create",
                  vlanNumber: 321,
                  name: "E2E preview VLAN",
                },
              ],
              subnets: [],
              dhcp: {
                supported: true,
                message: "",
                scopes: [],
                conflicts: [],
              },
              summary: {
                vlanCreates: 1,
                vlanUpdates: 0,
                vlanDeletes: 0,
                subnetCreates: 0,
                subnetUpdates: 0,
                subnetDeletes: 0,
                dhcpCreates: 0,
                dhcpConflicts: 0,
              },
              warnings: [],
            },
            devices: [
              {
                name: "e2e-firewall",
                kind: "firewall",
                model: "OPNsense",
                macAddress: "02:00:00:00:03:21",
                ipAddress: "10.0.10.254",
                status: "online",
                detail: null,
              },
            ],
            deviceSync: {
              labId: "lab_home",
              devices: [
                {
                  providerRecordId: "device:e2e-host",
                  action: "create",
                  name: "e2e-host",
                  deviceType: "server",
                  parentName: null,
                  model: "Proxmox host",
                  macAddress: "02:00:00:00:03:22",
                  ipAddress: "10.0.10.22",
                  portCount: 0,
                  reason: null,
                  proposedUpdates: [],
                },
                {
                  providerRecordId: "device:e2e-guest",
                  action: "create",
                  name: "e2e-guest",
                  deviceType: "vm",
                  parentName: "e2e-host",
                  model: "Virtual machine",
                  macAddress: "02:00:00:00:03:23",
                  ipAddress: "10.0.10.23",
                  portCount: 1,
                  reason: null,
                  proposedUpdates: [],
                },
                {
                  providerRecordId: "device:e2e-conflict",
                  action: "conflict",
                  name: "e2e-ambiguous",
                  deviceType: "switch",
                  parentName: null,
                  model: null,
                  macAddress: null,
                  ipAddress: null,
                  portCount: 0,
                  reason:
                    "Multiple controller records named e2e-ambiguous cannot be distinguished without a MAC address.",
                  proposedUpdates: [],
                },
              ],
              ssids: [],
              virtualSwitches: [
                {
                  providerRecordId: "virtual-switch:e2e-vmbr0",
                  action: "create",
                  name: "e2e-vmbr0",
                  hostName: "e2e-host",
                  reason: null,
                },
              ],
              controllerName: null,
            },
            importableDevices: [],
            virtualSwitches: [],
            wifi: null,
            warnings: [],
          },
        });
      },
    );
    await page.route(
      `**/api/integrations/connections/${connection.id}/apply-devices`,
      async (route) => {
        const body = route.request().postDataJSON() as {
          selectedProviderRecordIds: string[];
        };
        submittedDeviceSelections.push(body.selectedProviderRecordIds);
        deviceApplyCount += 1;
        const skipped =
          deviceApplyCount === 1
            ? []
            : deviceApplyCount === 2
              ? ["e2e-guest: parent host changed after preview."]
              : ["e2e-host: controller identity became ambiguous."];
        const created = deviceApplyCount === 3 ? 0 : 1;
        await route.fulfill({
          json: {
            createdDeviceIds: created
              ? [`device-created-${deviceApplyCount}`]
              : [],
            createdPortCount: created,
            createdSsidIds: [],
            createdVirtualSwitchIds: [],
            createdIpAssignmentIds: [],
            linkedAccessPoints: 0,
            skipped,
          },
        });
      },
    );
    await page.goto("/imports");
    await page.getByRole("tab", { name: "Integrations", exact: true }).click();
    await expect(
      page.getByText(connection.name, { exact: true }),
    ).toBeVisible();
    const connectionPanel = page
      .getByText(connection.name, { exact: true })
      .locator(
        "xpath=ancestor::div[.//button[normalize-space()='Pull inventory']][1]",
      );
    const pullInventory = connectionPanel.getByRole("button", {
      name: "Pull inventory",
      exact: true,
    });
    await pullInventory.click();
    await expect(
      page.getByText("Inventory preview", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("E2E preview VLAN", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply networks", exact: true }),
    ).toBeEnabled();
    await expect(page.locator('option[value="mirror"]')).toHaveCount(0);
    await page.getByLabel("Close", { exact: true }).click();

    const openImportPreview = async () => {
      await pullInventory.click();
      await page.getByRole("tab", { name: /^Import \(4\)$/ }).click();
    };

    await openImportPreview();
    const hostSelection = page.getByLabel("Select e2e-host", { exact: true });
    const guestSelection = page.getByLabel("Select e2e-guest", { exact: true });
    const switchSelection = page.getByLabel("Select e2e-vmbr0", {
      exact: true,
    });
    await expect(
      page.getByLabel("Select e2e-ambiguous", { exact: true }),
    ).toBeDisabled();
    await hostSelection.uncheck();
    await expect(guestSelection).not.toBeChecked();
    await expect(switchSelection).not.toBeChecked();
    await guestSelection.check();
    await expect(hostSelection).toBeChecked();
    await switchSelection.check();
    await page.getByRole("button", { name: "Import devices" }).click();
    await expect(page.getByText(/^Imported 1 device/)).toBeVisible();
    expect(submittedDeviceSelections[0].sort()).toEqual(
      [
        "device:e2e-guest",
        "device:e2e-host",
        "virtual-switch:e2e-vmbr0",
      ].sort(),
    );

    await openImportPreview();
    await page.getByRole("button", { name: "Import devices" }).click();
    await expect(
      page.getByText("Some selected records were not imported.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/e2e-guest: parent host changed/),
    ).toBeVisible();
    await expect(page.getByText(/^Imported 1 device/)).toBeVisible();

    await openImportPreview();
    await page.getByRole("button", { name: "Import devices" }).click();
    await expect(page.getByText(/e2e-host: controller identity/)).toBeVisible();
    await expect(page.getByText(/^Imported \d+ device/)).toHaveCount(0);

    await connectionPanel
      .getByRole("button", { name: /Auto-sync \(1\)/, exact: true })
      .click();
    await expect(
      page.getByText("When to sync (UTC)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Nightly safe sync ${suffix}`, { exact: true }),
    ).toBeVisible();
    await expect(page.locator('option[value="merge"]')).not.toHaveCount(0);
    await expect(page.locator('option[value="skip"]')).not.toHaveCount(0);
    await expect(page.locator('option[value="mirror"]')).toHaveCount(0);

    const viewerResponse = await request.post("/api/users", {
      headers,
      data: {
        username: `integration-viewer-${suffix}`,
        displayName: "Integration Viewer",
        password: "integration-viewer-password",
        role: "viewer",
      },
    });
    expect(viewerResponse.status()).toBe(201);
    viewerId = ((await viewerResponse.json()) as { id: string }).id;
    const viewerLogin = await request.post("/api/auth/login", {
      data: {
        username: `integration-viewer-${suffix}`,
        password: "integration-viewer-password",
      },
    });
    expect(viewerLogin.ok()).toBeTruthy();
    const viewerToken = ((await viewerLogin.json()) as { token: string }).token;
    viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();
    await viewerPage.addInitScript((authToken) => {
      localStorage.setItem("rackpad.auth.token", authToken);
    }, viewerToken);
    await viewerPage.goto("http://127.0.0.1:5173/imports");
    await viewerPage
      .getByRole("tab", { name: "Integrations", exact: true })
      .click();
    const viewerConnectionPanel = viewerPage
      .getByText(connection.name, { exact: true })
      .locator(
        "xpath=ancestor::div[.//button[normalize-space()='Pull inventory']][1]",
      );
    await expect(
      viewerConnectionPanel.getByRole("button", {
        name: "Pull inventory",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      viewerConnectionPanel.getByRole("button", {
        name: "Edit",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await viewerContext?.close();
    if (viewerId) await request.delete(`/api/users/${viewerId}`, { headers });
    if (scheduleId) {
      await request.delete(`/api/integrations/schedules/${scheduleId}`, {
        headers,
      });
    }
    await request.delete(`/api/integrations/connections/${connection.id}`, {
      headers,
    });
  }
});
