import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

async function fixture(page: Page, request: APIRequestContext) {
  const needsBootstrap = (await (await request.get("/api/auth/status")).json())
    .needsBootstrap;
  const auth = await request.post(
    needsBootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(needsBootstrap
          ? { displayName: "Admin", loadDemoData: false }
          : {}),
      },
    },
  );
  expect(auth.ok()).toBeTruthy();
  const token = (await auth.json()).token as string;
  const headers = { Authorization: `Bearer ${token}` };
  async function create(path: string, data: Record<string, unknown>) {
    const response = await request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  }
  const lab = await create("/api/labs", { name: `Standalone ${Date.now()}` });
  const device = await create("/api/devices", {
    labId: lab.id,
    hostname: "standalone-one",
    deviceType: "switch",
    placement: "room",
  });
  const peer = await create("/api/devices", {
    labId: lab.id,
    hostname: "standalone-two",
    deviceType: "server",
    placement: "room",
  });
  const ports = [];
  for (const [index, state] of [
    "disabled",
    "down",
    "unknown",
    "up",
  ].entries()) {
    const port = await create("/api/ports", {
      deviceId: device.id,
      name: `test-${state}`,
      kind: "rj45",
      position: index + 1,
    });
    const response = await request.patch(`/api/ports/${port.id}`, {
      headers,
      data: { linkState: state },
    });
    expect(response.ok()).toBeTruthy();
    ports.push(port);
  }
  const peerPort = await create("/api/ports", {
    deviceId: peer.id,
    name: "peer",
    kind: "rj45",
  });
  await page.addInitScript(
    ({ token, labId }) => {
      localStorage.setItem("rackpad.auth.token", token);
      localStorage.setItem("rackpad.language", "en");
      localStorage.setItem("rackpad.active.lab", labId);
    },
    { token, labId: lab.id },
  );
  return { headers, create, lab, device, peer, ports, peerPort };
}

test("standalone disabled filter clears both creation endpoints and retains existing cable editing", async ({
  page,
  request,
}) => {
  const { ports, peerPort, headers, create } = await fixture(page, request);
  await page.goto("/cables");
  const from = page
    .getByRole("combobox", { name: "From port", exact: true })
    .first();
  const to = page
    .getByRole("combobox", { name: "To port", exact: true })
    .first();
  const hide = page.getByRole("checkbox", {
    name: "Hide Disabled Ports",
    exact: true,
  });
  await expect(hide).not.toBeChecked();
  await from.selectOption(ports[0].id);
  await hide.check();
  await expect(from).toHaveValue("");
  await expect(from.locator(`option[value="${ports[0].id}"]`)).toHaveCount(0);
  await expect(to.locator(`option[value="${ports[0].id}"]`)).toHaveCount(0);
  for (const port of ports.slice(1)) {
    await expect(from.locator(`option[value="${port.id}"]`)).toHaveCount(1);
    await expect(to.locator(`option[value="${port.id}"]`)).toHaveCount(1);
  }
  await hide.uncheck();
  await to.selectOption(ports[0].id);
  await hide.check();
  await expect(to).toHaveValue("");
  const cable = await create("/api/port-links", {
    fromPortId: ports[0].id,
    toPortId: peerPort.id,
  });
  await request.patch(`/api/ports/${ports[0].id}`, {
    headers,
    data: { linkState: "disabled" },
  });
  await page.reload();
  await hide.check();
  const editFrom = page
    .getByRole("combobox", { name: "From port", exact: true })
    .last();
  await expect(editFrom.locator(`option[value="${ports[0].id}"]`)).toHaveCount(
    1,
  );
  await expect(editFrom).toHaveValue(cable.fromPortId);
});

test("standalone reference labels generate print reload and navigate across labs", async ({
  page,
  request,
}) => {
  const { lab, create, device, ports, peerPort } = await fixture(page, request);
  await create("/api/port-links", {
    fromPortId: ports[1].id,
    toPortId: peerPort.id,
    label: "Standalone label cable",
  });
  await page.goto("/labels");
  await page
    .getByRole("checkbox", {
      name: "Select Standalone label cable",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Generate references", exact: true })
    .click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("link", {
      name: "Standalone label cable",
      exact: true,
    }),
  });
  await expect(row.locator("td").nth(3)).toHaveText(/^rpc1[a-z0-9]{22}$/);
  const reference = await row.locator("td").nth(3).innerText();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".reference-label-sheet")).toBeVisible();
  await expect(page.locator(".reference-label")).toHaveCount(1);
  await expect(page.locator("#root")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("link", { name: "Standalone label cable", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Cable: Standalone label cable",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cable: Standalone label cable", exact: true })
    .click();
  await expect(page).toHaveURL(`/cables?reference=${reference}`);
  await expect(
    page.getByPlaceholder("Search by device, port, type, color...", {
      exact: true,
    }),
  ).toHaveValue(reference);
  await expect(page.getByRole("row")).toHaveCount(2);
  await page.goto("/labels");
  await expect(
    page.getByText(reference, { exact: true }).first(),
  ).toBeVisible();
  const otherLab = await create("/api/labs", { name: "Other reference lab" });
  const otherDevice = await create("/api/devices", {
    labId: otherLab.id,
    hostname: "other-lab-device",
    deviceType: "server",
    placement: "room",
  });
  const otherReference = (
    await create(`/api/references/device/${otherDevice.id}`, {})
  ).publicReference;
  const lookup = page.getByRole("textbox", { name: "Reference", exact: true });
  await lookup.fill(otherReference.toUpperCase());
  await page
    .getByRole("button", { name: "Find reference", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Device: other-lab-device", exact: true })
    .click();
  await expect(page).toHaveURL(`/devices/${otherDevice.id}`);
  await expect(page.getByText("Device not found", { exact: true })).toHaveCount(
    0,
  );
  // Cross-lab cable has an authenticated details view and device navigation.
  const otherPort = await create("/api/ports", {
    deviceId: otherDevice.id,
    name: "other-port",
    kind: "rj45",
  });
  const freePort = await create("/api/ports", {
    deviceId: device.id,
    name: "cross-lab-port",
    kind: "rj45",
  });
  const cross = await create("/api/port-links", {
    fromPortId: freePort.id,
    toPortId: otherPort.id,
    label: "Cross-lab cable",
  });
  const crossReference = (await create(`/api/references/cable/${cross.id}`, {}))
    .publicReference;
  await page.goto(`/labels/${crossReference}`);
  await expect(
    page.getByRole("heading", { name: "Cable: Cross-lab cable", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "standalone-one: cross-lab-port",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(`/devices/${device.id}`);
  expect(lab.id).not.toEqual(otherLab.id);
  const rtl = await page.context().newPage();
  try {
    await rtl.addInitScript(() => localStorage.setItem("rackpad.language", "ar"));
    await rtl.setViewportSize({ width: 1024, height: 768 });
    await rtl.goto("/labels");
    await expect(rtl.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(rtl.getByRole("heading", { name: "التسميات", exact: true })).toBeVisible();
    const selected = rtl.getByRole("checkbox", { name: "حدد standalone-one", exact: true });
    await selected.focus();
    await rtl.keyboard.press("Space");
    await expect(selected).toBeChecked();
    const generate = rtl.getByRole("button", { name: "إنشاء المراجع", exact: true });
    await generate.focus();
    await rtl.keyboard.press("Enter");
    const deviceRow = rtl.getByRole("row").filter({ has: selected });
    await expect(deviceRow.locator("td").nth(3)).toHaveText(/^rpd1[a-z0-9]{22}$/);
    const deviceReference = await deviceRow.locator("td").nth(3).innerText();
    await expect(rtl.getByRole("button", { name: "طباعة الملصقات", exact: true })).toBeEnabled();
    expect(await rtl.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page: rtl }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    const referenceInput = rtl.getByRole("textbox", { name: "مرجع", exact: true });
    await expect(referenceInput).toHaveAttribute("dir", "ltr");
    await referenceInput.fill(deviceReference.toUpperCase());
    await referenceInput.press("Enter");
    await expect(rtl).toHaveURL(`/labels/${deviceReference}`);
    await expect(rtl.locator("main code")).toHaveText(deviceReference);
    expect((await new AxeBuilder({ page: rtl }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
  } finally { await rtl.close(); }
});
