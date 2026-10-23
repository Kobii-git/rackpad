import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function authenticate(page: Page, request: APIRequestContext) {
  const bootstrap = (await (await request.get("/api/auth/status")).json())
    .needsBootstrap;
  const response = await request.post(
    bootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(bootstrap ? { displayName: "Admin", loadDemoData: true } : {}),
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const token = (await response.json()).token as string;
  await page.addInitScript((value) => {
    localStorage.setItem("rackpad.auth.token", value);
    localStorage.setItem("rackpad.language", "en");
  }, token);
  return { Authorization: `Bearer ${token}` };
}

test("template naming makes built-in duplication and custom rename discoverable", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const templates = (
    await (await request.get("/api/hardware-templates", { headers })).json()
  ).templates as Array<{ id: string; name: string; builtIn: boolean }>;
  const original = templates.find((item) => item.builtIn)!;
  expect(original).toBeTruthy();
  const ids: string[] = [];
  try {
    await page.goto("/admin/device-types");
    const builder = page.getByTestId("hardware-template-builder");
    const selector = builder.getByRole("combobox", {
      name: "Templates",
      exact: true,
    });
    const name = builder.getByRole("textbox", {
      name: "Template name",
      exact: true,
    });
    await selector.selectOption(original.id);
    await expect(name).toBeDisabled();
    await expect(
      builder.getByText(
        "Built-in templates are read-only. Duplicate to customize the name and layout.",
      ),
    ).toBeVisible();
    const duplicate = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/duplicate"),
    );
    await builder
      .getByRole("button", { name: "Duplicate to customize", exact: true })
      .click();
    const copy = await (await duplicate).json();
    ids.push(copy.id);
    await expect(name).toBeFocused();
    await expect(name).toBeEnabled();
    await name.fill("5-port switch");
    await builder
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    await expect(selector).toHaveValue(copy.id);
    await page.reload();
    await selector.selectOption(copy.id);
    await expect(name).toHaveValue("5-port switch");
    const unchanged = (
      await (await request.get("/api/hardware-templates", { headers })).json()
    ).templates.find((item: { id: string }) => item.id === original.id);
    expect(unchanged.name).toBe(original.name);
    await selector.selectOption("__new_hardware_template__");
    await builder
      .getByRole("combobox", { name: "Starting layout", exact: true })
      .selectOption("switch-8");
    await name.fill("Custom five-port switch");
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/hardware-templates"),
    );
    await builder
      .getByRole("button", { name: "Save template", exact: true })
      .click();
    const created = await (await saved).json();
    ids.push(created.id);
    await page.reload();
    await selector.selectOption(created.id);
    await expect(name).toHaveValue("Custom five-port switch");
  } finally {
    for (const id of ids)
      await request.delete(`/api/hardware-templates/${id}`, { headers });
  }
});

test("service network ports and safe navigation persist independently of physical ports", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const deviceResponse = await request.post("/api/devices", {
    headers,
    data: {
      labId: "lab_home",
      hostname: `service-fixture-${Date.now()}`,
      deviceType: "server",
    },
  });
  expect(deviceResponse.ok()).toBeTruthy();
  const device = await deviceResponse.json();
  try {
    const port = await (
      await request.post("/api/ports", {
        headers,
        data: { deviceId: device.id, name: "eth0", kind: "rj45" },
      })
    ).json();
    await page.goto(`/devices/${device.id}?tab=services`);
    const panel = page.getByRole("tabpanel", { name: /^Services/ });
    await panel
      .getByRole("textbox", { name: "Name", exact: true })
      .fill("Control panel");
    await panel
      .getByRole("combobox", { name: "Physical port", exact: true })
      .selectOption(port.id);
    await panel
      .getByRole("spinbutton", { name: "Network port", exact: true })
      .fill("3000");
    await panel
      .getByRole("textbox", { name: "URL", exact: true })
      .fill("https://service.example.test:3000/health");
    const create = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/device-services"),
    );
    await panel
      .getByRole("button", { name: "Create service", exact: true })
      .click();
    const service = await (await create).json();
    const summary = panel.getByTestId("service-summary");
    await expect(summary).toContainText("TCP 3000");
    const link = summary.getByRole("link", {
      name: "Open service Control panel",
      exact: true,
    });
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await page
      .context()
      .route("https://service.example.test:3000/**", (route) =>
        route.fulfill({ body: "Fixture service" }),
      );
    await link.focus();
    const opened = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const popup = await opened;
    await popup.waitForLoadState();
    expect(popup.url()).toBe("https://service.example.test:3000/health");
    expect(await popup.evaluate(() => window.opener === null)).toBeTruthy();
    await popup.close();
    await panel
      .getByRole("combobox", { name: "Transport protocol", exact: true })
      .selectOption("udp");
    await panel
      .getByRole("spinbutton", { name: "Network port", exact: true })
      .fill("53");
    const patch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(service.id),
    );
    await panel
      .getByRole("button", { name: "Save service", exact: true })
      .click();
    await patch;
    await page.reload();
    await expect(summary).toContainText("UDP 53");
    await expect(
      panel.getByRole("combobox", { name: "Physical port", exact: true }),
    ).toHaveValue(port.id);
    await panel
      .getByRole("spinbutton", { name: "Network port", exact: true })
      .fill("65536");
    await panel
      .getByRole("button", { name: "Save service", exact: true })
      .click();
    await expect(
      panel.getByText("Network port must be an integer from 1 to 65535."),
    ).toBeVisible();
    await panel
      .getByRole("spinbutton", { name: "Network port", exact: true })
      .fill("");
    await panel
      .getByRole("textbox", { name: "URL", exact: true })
      .fill("javascript:alert(1)");
    const cleared = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(service.id),
    );
    await panel
      .getByRole("button", { name: "Save service", exact: true })
      .click();
    await cleared;
    await expect(summary.getByRole("link")).toHaveCount(0);
    await expect(summary).toContainText("javascript:alert(1)");
    const stored = await (
      await request.get(`/api/device-services/${service.id}`, { headers })
    ).json();
    expect(stored.networkPort).toBeNull();
    expect(stored.transportProtocol).toBeNull();
    expect(stored.portId).toBe(port.id);
    const scan = await new AxeBuilder({ page })
      .include('[role="tabpanel"]')
      .analyze();
    expect(scan.violations).toEqual([]);
  } finally {
    await request.delete(`/api/devices/${device.id}`, { headers });
  }
});

test("SMTP diagnostics are localized and the TLS switch preserves the configured port", async ({
  page,
  request,
}) => {
  await authenticate(page, request);
  await page.addInitScript(() =>
    localStorage.setItem("rackpad.language", "fr"),
  );
  await page.route("**/api/admin/alert-settings/test", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "smtp_tls",
        error:
          "SMTP TLS verification failed. Check the certificate, hostname and TLS mode.",
      }),
    }),
  );
  await page.goto("/admin");
  const port = page.getByRole("spinbutton", { name: "Port SMTP", exact: true });
  await expect(port).toBeEnabled();
  const original = await port.inputValue();
  const secure = page.getByRole("checkbox", {
    name: "TLS implicite",
    exact: true,
  });
  await secure.check();
  await expect(port).toHaveValue(original);
  await secure.uncheck();
  await expect(port).toHaveValue(original);
  await page
    .getByRole("button", { name: "Envoyer le test", exact: true })
    .click();
  await expect(
    page.getByText(
      "Échec de vérification TLS SMTP. Vérifiez le certificat, le nom d’hôte et le mode TLS.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "SMTP TLS verification failed. Check the certificate, hostname and TLS mode.",
      { exact: true },
    ),
  ).toHaveCount(0);
});
