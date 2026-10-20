import { expect, test } from "@playwright/test";

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
  try {
    await page.goto("/admin/device-types");
    const builder = page.getByTestId("hardware-template-builder");
    await builder
      .getByRole("combobox", { name: "Starting layout", exact: true })
      .selectOption("round-device");
    await expect(
      builder.getByText(
        "Choose a starting layout, then name your template and select its device type.",
      ),
    ).toBeVisible();
    await expect(builder.locator('[data-device-shape="round"]')).toBeVisible();
    await builder
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(templateName);
    await builder
      .getByRole("button", { name: "New device type", exact: true })
      .click();
    const form = page.getByTestId("template-device-type-form");
    await expect(form.getByRole("combobox", {name: "Parent", exact: true})).toHaveValue("other");
    await form.getByRole("button", {name: "Cancel", exact: true}).click();
    await expect(builder.getByRole("textbox", {name: "Name", exact: true})).toHaveValue(templateName);
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
      builder.getByRole("textbox", { name: "Name", exact: true }),
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
    const device = await request.post("/api/devices", {
      headers,
      data: {
        labId: "lab_home",
        hostname: templateName,
        deviceType: typeId,
        placement: "room",
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
    await page.reload();
    await page
      .getByRole("tab", { name: "Physical layout", exact: true })
      .click();
    await expect(
      page.locator('[data-device-shape="round"]').first(),
    ).toBeVisible();
  } finally {
    if (deviceId) await request.delete(`/api/devices/${deviceId}`, { headers });
    if (templateId)
      await request.delete(`/api/hardware-templates/${templateId}`, {
        headers,
      });
    if (typeId)
      await request.delete(`/api/device-types/${typeId}`, { headers });
  }
});
