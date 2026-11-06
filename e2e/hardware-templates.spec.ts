import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createStarterTemplate } from "../src/lib/hardware-template-builder";
import type { HardwareTemplateV1 } from "../src/lib/types";

test("template starting layouts share saved definitions as independently validated library copies", async ({
  page,
  request,
}, testInfo) => {
  const status = await request.get("/api/auth/status");
  const needsBootstrap = ((await status.json()) as { needsBootstrap: boolean })
    .needsBootstrap;
  const auth = await request.post(
    needsBootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(needsBootstrap
          ? { displayName: "E2E Administrator", loadDemoData: true }
          : {}),
      },
    },
  );
  expect(auth.ok(), await auth.text()).toBeTruthy();
  const token = ((await auth.json()) as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}` };
  await page.addInitScript((value) => {
    localStorage.setItem("rackpad.auth.token", value);
    if (!localStorage.getItem("rackpad.language")) {
      localStorage.setItem("rackpad.language", "en");
    }
  }, token);
  const source = createStarterTemplate(
    "round-device",
    `sharing-${Date.now().toString(36)}`,
    `Shared AP ${Date.now().toString(36)}`,
  );
  const ids = [source.id];
  try {
    const created = await request.post("/api/hardware-templates", {
      headers,
      data: source,
    });
    expect(created.status(), await created.text()).toBe(201);
    const before = (await (
      await request.get("/api/hardware-templates", { headers })
    ).json()) as { templates: HardwareTemplateV1[]; defaults: unknown[] };
    await page.goto("/admin/device-types");
    const builder = page.getByTestId("hardware-template-builder");
    await builder
      .getByRole("combobox", { name: "Templates", exact: true })
      .selectOption(source.id);
    await builder
      .getByRole("textbox", { name: "Template name", exact: true })
      .fill("Unsaved draft stays open");
    const downloading = page.waitForEvent("download");
    await builder
      .getByRole("button", { name: "Export saved template", exact: true })
      .click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^rackpad-template-.+\.json$/);
    const exported = JSON.parse(
      await readFile((await download.path())!, "utf8"),
    ) as HardwareTemplateV1;
    expect(exported.name).toBe(source.name);
    expect(exported.builtIn).toBeUndefined();
    expect(exported.front.shape).toBe("round");
    exported.deviceTypes = ["type-on-another-installation"];
    const file = builder.locator('input[type="file"]');
    await builder
      .getByRole("combobox", { name: "Import device type", exact: true })
      .selectOption("other");
    for (const suffix of [" copy", " copy 2"]) {
      const saving = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/hardware-templates") &&
          response.request().method() === "POST",
      );
      await file.setInputFiles({
        name: download.suggestedFilename(),
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(exported)),
      });
      const response = await saving;
      expect(response.status(), await response.text()).toBe(201);
      const imported = (await response.json()) as HardwareTemplateV1;
      ids.push(imported.id);
      expect(imported.id).not.toBe(source.id);
      expect(imported.name).toBe(source.name + suffix);
      expect(imported.deviceTypes).toEqual(["other"]);
      expect(imported.front).toEqual(exported.front);
      expect(imported.portSlots).toEqual(exported.portSlots);
      await expect(
        builder.getByText(`Imported template: ${imported.name}`, {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        builder.getByRole("textbox", { name: "Template name", exact: true }),
      ).toHaveValue("Unsaved draft stays open");
    }
    for (const content of [
      "not JSON",
      JSON.stringify({ ...exported, schemaVersion: 2 }),
    ]) {
      await file.setInputFiles({
        name: "invalid.json",
        mimeType: "application/json",
        buffer: Buffer.from(content),
      });
      await expect(builder.getByRole("alert")).toHaveText(
        "Choose a Rackpad hardware template JSON file (schema version 1).",
      );
    }
    await file.setInputFiles({
      name: "oversized.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(builder.getByRole("alert")).toHaveText(
      "Template files must be 10 MB or smaller.",
    );
    const rejecting = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/hardware-templates") &&
        response.request().method() === "POST",
    );
    await file.setInputFiles({
      name: "bad-geometry.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...exported,
          front: { ...exported.front, width: 500 },
        }),
      ),
    });
    expect((await rejecting).status()).toBe(400);
    await expect(builder.getByRole("alert")).toBeVisible();
    const after = (await (
      await request.get("/api/hardware-templates", { headers })
    ).json()) as typeof before;
    expect(after.templates).toHaveLength(before.templates.length + 2);
    expect(
      after.templates.find((template) => template.id === source.id),
    ).toEqual(before.templates.find((template) => template.id === source.id));
    expect(after.defaults).toEqual(before.defaults);
    await expect(
      builder.getByRole("textbox", { name: "Template name", exact: true }),
    ).toHaveValue("Unsaved draft stays open");
    await builder
      .getByRole("combobox", { name: "Templates", exact: true })
      .selectOption(ids[1]);
    await expect(
      builder.getByRole("textbox", { name: "Template name", exact: true }),
    ).toHaveValue(source.name + " copy");
    await page.reload();
    await builder
      .getByRole("combobox", { name: "Templates", exact: true })
      .selectOption(ids[1]);
    await expect(builder.locator('[data-device-shape="round"]')).toBeVisible();
    for (const language of ["fr", "ar"]) {
      await page.evaluate(
        (value) => localStorage.setItem("rackpad.language", value),
        language,
      );
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        new RegExp(`^${language}(?:-|$)`),
      );
      const sharing = builder.getByTestId("hardware-template-sharing");
      for (const width of [1280, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await sharing.scrollIntoViewIfNeeded();
        expect(
          await sharing.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBeTruthy();
      }
      await sharing.screenshot({
        path: testInfo.outputPath(`template-sharing-${language}.png`),
      });
    }
  } finally {
    for (const id of ids.reverse())
      await request.delete(`/api/hardware-templates/${id}`, { headers });
  }
});

test("template starting layouts support inline custom types and round device persistence", async ({
  page,
  request,
}, testInfo) => {
  const status = await request.get("/api/auth/status");
  const needsBootstrap = ((await status.json()) as { needsBootstrap: boolean })
    .needsBootstrap;
  const auth = await request.post(
    needsBootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(needsBootstrap
          ? { displayName: "E2E Administrator", loadDemoData: true }
          : {}),
      },
    },
  );
  expect(auth.ok(), await auth.text()).toBeTruthy();
  const token = ((await auth.json()) as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}` };
  await page.addInitScript((value) => {
    localStorage.setItem("rackpad.auth.token", value);
    localStorage.setItem("rackpad.language", "en");
  }, token);
  const suffix = Date.now().toString(36);
  const templateName = `Round sensor ${suffix}`;
  const typeName = `Ceiling sensor ${suffix}`;
  let typeId = "";
  let templateId = "";
  let deviceId = "";
  let roomId = "";
  let rackId = "";
  try {
    await page.goto("/admin/device-types");
    const builder = page.getByTestId("hardware-template-builder");
    await builder
      .getByRole("combobox", { name: "Starting layout", exact: true })
      .selectOption("round-device");
    await expect(
      builder.getByText(
        "Starting layouts provide geometry and a default name. Rename your template below.",
      ),
    ).toBeVisible();
    await expect(builder.locator('[data-device-shape="round"]')).toBeVisible();
    await builder
      .getByRole("textbox", { name: "Template name", exact: true })
      .fill(templateName);
    await builder
      .getByRole("button", { name: "New device type", exact: true })
      .click();
    const form = page.getByTestId("template-device-type-form");
    await expect(form.getByRole("combobox", {name: "Parent", exact: true})).toHaveValue("other");
    await form.getByRole("button", {name: "Cancel", exact: true}).click();
    await expect(builder.getByRole("textbox", {name: "Template name", exact: true})).toHaveValue(templateName);
    await builder.getByRole("button", {name: "New device type", exact: true}).click();
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText(
      "Device type name is required.",
    );
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(typeName);
    await form
      .getByRole("combobox", { name: "Parent", exact: true })
      .selectOption("ap");
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/device-types") &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Create", exact: true }).click();
    const created = await creating;
    expect(created.status()).toBe(201);
    typeId = ((await created.json()) as { id: string }).id;
    await expect(form).toBeHidden();
    await expect(page.getByTestId("device-type-editor").getByRole("textbox", {name: "Name", exact: true})).toHaveValue(typeName);
    await builder.getByRole("button", {name: "Undo", exact: true}).click();
    await expect(builder.getByRole("combobox", {name: "Device type", exact: true})).toHaveValue("ap");
    const typesAfterUndo = await request.get("/api/device-types", {headers});
    expect((await typesAfterUndo.json() as Array<{id: string}>).some(type => type.id === typeId)).toBeTruthy();
    await builder.getByRole("button", {name: "Redo", exact: true}).click();
    await expect(
      builder.getByRole("combobox", { name: "Device type", exact: true }),
    ).toHaveValue(typeId);
    await expect(
      builder.getByRole("textbox", { name: "Template name", exact: true }),
    ).toHaveValue(templateName);
    await expect(builder.getByTestId("hardware-template-starter")).toHaveValue(
      "round-device",
    );
    // Duplicate-name failures stay in the form and leave the template draft intact.
    await builder
      .getByRole("button", { name: "New device type", exact: true })
      .click();
    await form
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(typeName);
    const duplicateRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/device-types") &&
        response.request().method() === "POST",
    );
    await form.getByRole("button", { name: "Create", exact: true }).click();
    expect((await duplicateRequest).status()).toBe(409);
    await expect(form.getByRole("alert")).toBeVisible();
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    const controls = builder.getByTestId("template-item-controls");
    const itemSelect = controls.getByRole("combobox", {name: "Physical layout", exact: true});
    const portKey = await itemSelect.locator("option").evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value).find(value => value.startsWith("port::rear:")));
    expect(portKey).toBeTruthy();
    await itemSelect.selectOption(portKey!);
    const color = controls.getByTestId("template-item-color").locator("input:not([type=color])");
    await color.fill("#12ab34");
    await builder.getByRole("button", {name: "Undo", exact: true}).click();
    await expect(color).toHaveValue("");
    await builder.getByRole("button", {name: "Redo", exact: true}).click();
    await expect(color).toHaveValue("#12ab34");
    const width = controls.getByRole("spinbutton", {name: "Width", exact: true});
    const originalWidth = await width.inputValue();
    await width.fill("90");
    await builder.getByRole("button", {name: "Undo", exact: true}).click();
    await expect(width).toHaveValue(originalWidth);
    await builder.getByRole("button", {name: "Redo", exact: true}).click();
    await expect(width).toHaveValue("90");
    const appearance = builder.getByTestId("face-appearance-controls");
    await appearance.getByRole("combobox", {name:"Chassis skin",exact:true}).selectOption("silver");
    await appearance.getByRole("combobox", {name:"Orientation",exact:true}).selectOption("90");
    await builder.getByRole("button", {name:"Undo",exact:true}).click();
    await expect(appearance.getByRole("combobox", {name:"Orientation",exact:true})).toHaveValue("0");
    await builder.getByRole("button", {name:"Redo",exact:true}).click();
    await expect(appearance.getByRole("combobox", {name:"Orientation",exact:true})).toHaveValue("90");
    const rotatedEditor = builder.getByRole("application", {name:"Physical layout",exact:true});
    const editedPort = rotatedEditor.getByRole("button", {name:"1",exact:true});
    await editedPort.scrollIntoViewIfNeeded();
    const beforeKey = await editedPort.boundingBox();
    await editedPort.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await editedPort.boundingBox())!.x).toBeGreaterThan(beforeKey!.x);
    await editedPort.locator("rect").first().scrollIntoViewIfNeeded();
    const beforeDrag = await editedPort.locator("rect").first().boundingBox();
    await page.mouse.move(beforeDrag!.x + beforeDrag!.width/2, beforeDrag!.y + beforeDrag!.height/2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag!.x + beforeDrag!.width/2 + 12, beforeDrag!.y + beforeDrag!.height/2, {steps:4});
    await page.mouse.up();
    await expect.poll(async () => (await editedPort.locator("rect").first().boundingBox())!.x).toBeGreaterThan(beforeDrag!.x + 8);
    const saveRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/hardware-templates") &&
        response.request().method() === "POST",
    );
    await builder
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    const saved = await saveRequest;
    expect(saved.status(), await saved.text()).toBe(201);
    const savedTemplate = await saved.json() as {id: string; portSlots: Array<{color?: string; width: number}>};
    templateId = savedTemplate.id;
    expect(savedTemplate.portSlots[0]).toMatchObject({color: "#12ab34", width: 90});
    expect(await saved.json()).toMatchObject({rear:{skin:"silver",rotation:90}});
    await page.reload();
    await builder
      .getByRole("combobox", { name: "Templates", exact: true })
      .selectOption(templateId);
    await expect(builder.getByTestId("hardware-template-starter")).toBeHidden();
    await expect(builder.locator('[data-device-shape="round"]')).toBeVisible();
    await expect(
      builder.getByRole("combobox", { name: "Device type", exact: true }),
    ).toHaveValue(typeId);
    await builder.getByRole("button", { name: "Front", exact: true }).click();
    await expect(builder.locator('[data-device-shape="round"]')).toBeVisible();
    await builder.screenshot({
      path: testInfo.outputPath("round-template.png"),
    });
    const roomResponse = await request.post("/api/rooms", {headers,data:{labId:"lab_home",name:`Appearance room ${suffix}`}});
    expect(roomResponse.status()).toBe(201);
    roomId = (await roomResponse.json() as {id:string}).id;
    const rackResponse = await request.post("/api/racks", {headers,data:{labId:"lab_home",roomId,name:`Appearance rack ${suffix}`,totalU:12}});
    expect(rackResponse.status()).toBe(201);
    rackId = (await rackResponse.json() as {id:string}).id;
    const device = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: templateName,
        deviceType: typeId,
        placement: "rack",
        roomId,
        rackId,
        startU: 1,
        heightU: 6,
        status: "unknown",
      },
    });
    expect(device.status(), await device.text()).toBe(201);
    deviceId = ((await device.json()) as { id: string }).id;
    const preview = await request.post(
      `/api/physical-layouts/${deviceId}/preview`,
      { headers, data: { templateId } },
    );
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const applied = await request.post(
      `/api/physical-layouts/${deviceId}/apply`,
      { headers, data: await preview.json() },
    );
    expect(applied.ok(), await applied.text()).toBeTruthy();
    await page.goto(`/devices/${deviceId}`);
    await page
      .getByRole("tab", { name: "Physical layout", exact: true })
      .click();
    await expect(
      page.locator('[data-device-shape="round"]').first(),
    ).toBeVisible();
    const devicePanel = page.getByTestId("device-physical-layout");
    await devicePanel.getByRole("button", {name:"Edit",exact:true}).click();
    const deviceAppearance = devicePanel.getByTestId("face-appearance-controls");
    await deviceAppearance.getByRole("combobox", {name:"Chassis skin",exact:true}).selectOption("ivory");
    await deviceAppearance.getByRole("combobox", {name:"Orientation",exact:true}).selectOption("270");
    await devicePanel.getByRole("button", {name:"Preview",exact:true}).click();
    await expect(devicePanel.locator('svg[role="img"][data-face-rotation="270"][data-face-skin="ivory"]')).toBeVisible();
    const applying = page.waitForResponse(response => response.url().endsWith(`/api/physical-layouts/${deviceId}/apply`) && response.request().method()==="POST");
    await devicePanel.getByRole("button", {name:"Apply",exact:true}).click();
    expect((await applying).status()).toBe(200);
    const placement = await (await request.get(`/api/devices/${deviceId}`,{headers})).json() as {rackId:string;startU:number;heightU:number};
    expect(placement).toMatchObject({rackId,startU:1,heightU:6});
    await page.reload();
    await page
      .getByRole("tab", { name: "Physical layout", exact: true })
      .click();
    await expect(
      page.locator('[data-device-shape="round"]').first(),
    ).toBeVisible();
    await expect(page.locator('svg[data-face-rotation="270"][data-face-skin="ivory"]')).toBeVisible();
  } finally {
    if (deviceId) await request.delete(`/api/devices/${deviceId}`, { headers });
    if (rackId) await request.delete(`/api/racks/${rackId}`, {headers});
    if (roomId) await request.delete(`/api/rooms/${roomId}`, {headers});
    if (templateId)
      await request.delete(`/api/hardware-templates/${templateId}`, {
        headers,
      });
    if (typeId)
      await request.delete(`/api/device-types/${typeId}`, { headers });
  }
});
