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
  await page.addInitScript(() => Object.defineProperty(globalThis.crypto, "randomUUID", {value: undefined, configurable:true}));
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
    await selector.selectOption(original.id);
    const secondDuplicate = page.waitForResponse(response => response.request().method() === "POST" && response.url().includes("/duplicate"));
    await builder.getByRole("button", { name: "Duplicate to customize", exact: true }).click();
    const secondCopy = await (await secondDuplicate).json();
    ids.push(secondCopy.id);
    expect(secondCopy.id).not.toBe(copy.id);
    expect(secondCopy.deviceTypes).toEqual(copy.deviceTypes);
    await name.fill("Independent switch");
    await builder.getByRole("button", { name: "Save template", exact: true }).click();
    await page.reload();
    await selector.selectOption(secondCopy.id);
    await expect(name).toHaveValue("Independent switch");
    await selector.selectOption(copy.id);
    await expect(name).toHaveValue("5-port switch");
    await selector.selectOption(original.id);
    await page.route("**/api/hardware-templates/*/duplicate", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Fixture duplicate conflict" }) }));
    await builder.getByRole("button", { name: "Duplicate to customize", exact: true }).click();
    await expect(builder.getByRole("alert")).toContainText("Fixture duplicate conflict");
    await expect(selector).toHaveValue(original.id);
    await expect(name).toHaveValue(original.name);
    await page.unroute("**/api/hardware-templates/*/duplicate");
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


test("ntfy token is write-only and partial delivery warns without hiding success", async ({page, request}) => {
  const headers = await authenticate(page, request);
  try {
    await page.goto("/admin");
    const url = page.getByRole("textbox", {name: "ntfy topic URL", exact:true});
    const token = page.getByLabel("ntfy access token", {exact:true});
    await url.fill("https://ntfy.example.test/fixture");
    await token.fill("synthetic-browser-private-token");
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/alert-settings"));
    await page.getByRole("button", {name:"Save notifications",exact:true}).click();
    const result=await (await saved).json();
    expect(result.ntfyTokenConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-browser-private-token");
    await expect(token).toHaveValue("");
    await page.reload();
    await expect(token).toHaveValue("");
    await expect(url).toHaveValue("https://ntfy.example.test/fixture");
    await page.route("**/api/admin/alert-settings/test",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({delivered:true,channels:[{channel:"email",delivered:true},{channel:"ntfy",delivered:false,code:"ntfy_rejection"}]})}));
    await page.getByRole("button",{name:"Send test",exact:true}).click();
    await expect(page.getByText("Delivered via email.",{exact:true})).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Failed channels: ntfy.");
    await page.getByTestId("ntfy-settings").getByRole("button", {name:"Delete",exact:true}).click();
    const cleared = page.waitForResponse(response => response.request().method() === "PUT" && response.url().endsWith("/alert-settings"));
    await page.getByRole("button",{name:"Save notifications",exact:true}).click();
    expect((await cleared).ok()).toBeTruthy();
    await page.reload();
    const configuration=await (await request.get("/api/admin/alert-settings",{headers})).json();
    expect(configuration.ntfyTokenConfigured).toBe(false);
    await expect(url).toHaveValue("https://ntfy.example.test/fixture");
    expect((await new AxeBuilder({page}).include('[data-testid="ntfy-settings"]').analyze()).violations).toEqual([]);
  } finally {
    await request.put("/api/admin/alert-settings",{headers,data:{enabled:false,ntfyTopicUrl:null,ntfyToken:null}});
  }
});

test("MCP token UI revokes, creates again and survives failed refreshes", async ({ page, request }) => {
  const headers = await authenticate(page, request);
  await page.goto("/mcp");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  const create = page.getByRole("button", { name: "Create", exact: true });
  const tokenName = `Token lifecycle ${Date.now()}`;
  const ids: string[] = [];
  try {
    await name.fill(tokenName);
    await page.getByRole("checkbox", { name: "Home Lab", exact: true }).check();
    for (let iteration = 0; iteration < 2; iteration++) {
      const response = page.waitForResponse(response => response.url().endsWith("/api/mcp-tokens") && response.request().method() === "POST");
      await create.click();
      const issued = await (await response).json();
      ids.push(issued.id);
      await expect(page.getByTestId("mcp-issued-token")).toBeVisible();
      const row = page.getByTestId("mcp-token-row").filter({ hasText: tokenName });
      await row.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(row).toHaveCount(0);
      await expect(page.getByTestId("mcp-issued-token")).toHaveCount(0);
      const denied = await request.post("/api/mcp", { headers: { authorization: `Bearer ${issued.token}`, "content-type": "application/json" }, data: { jsonrpc: "2.0", id: 1, method: "ping" } });
      expect(denied.status()).toBe(process.env.MCP_ENABLED === "1" ? 401 : 404);
      await name.fill(tokenName);
      await expect(create).toBeEnabled();
    }
    await page.reload();
    await expect(page.getByTestId("mcp-token-row").filter({ hasText: tokenName })).toHaveCount(0);
    await page.getByRole("checkbox", { name: "History", exact: true }).check();
    const history = page.getByTestId("mcp-token-row").filter({ hasText: tokenName });
    await expect(history).toHaveCount(2);
    await expect(history.first()).toContainText("Revoked");
    await page.route("**/api/mcp-proposals", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture proposals failure" }) }));
    await page.route("**/api/mcp-tokens", route => route.request().method() === "POST" ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Fixture creation failure" }) }) : route.continue());
    await name.fill(`${tokenName} replacement`);
    await page.getByRole("checkbox", { name: "Home Lab", exact: true }).check();
    await create.click();
    await expect(page.getByRole("alert")).toContainText("Fixture creation failure");
    await expect(create).toBeEnabled();
    await page.unroute("**/api/mcp-tokens");
    const replacementResponse = page.waitForResponse(response => response.url().endsWith("/api/mcp-tokens") && response.request().method() === "POST");
    await create.click();
    const replacement = await (await replacementResponse).json();
    ids.push(replacement.id);
    await expect(page.getByTestId("mcp-token-row").filter({ hasText: `${tokenName} replacement` })).toHaveCount(1);
  } finally {
    for (const id of ids) await request.delete(`/api/mcp-tokens/${id}`, { headers });
  }
});

test("host networking imports management IP and adapters idempotently without changing cables", async ({ page, request }) => {
  const headers = await authenticate(page, request);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const suffix = Date.now();
  const subnet = await request.post("/api/subnets", { headers, data: { labId: "lab_home", cidr: "10.234.50.0/24", name: `Host import ${suffix}` } });
  expect(subnet.ok()).toBeTruthy();
  const subnetId = (await subnet.json()).id;
  const host = await (await request.post("/api/devices", { headers, data: { labId: "lab_home", hostname: `pve-import-${suffix}`, deviceType: "server" } })).json();
  const peer = await (await request.post("/api/devices", { headers, data: { labId: "lab_home", hostname: `peer-${suffix}`, deviceType: "switch" } })).json();
  const original = await (await request.post("/api/ports", { headers, data: { deviceId: host.id, name: "eno1", kind: "sfp_plus", macAddress: "02:00:00:00:55:01", position: 1 } })).json();
  const peerPort = await (await request.post("/api/ports", { headers, data: { deviceId: peer.id, name: "test", kind: "sfp_plus", position: 1 } })).json();
  const linkResponse = await request.post("/api/port-links", { headers, data: { fromPortId: original.id, toPortId: peerPort.id } });
  expect(linkResponse.ok(), await linkResponse.text()).toBeTruthy();
  const link = await linkResponse.json();
  const payload = { schema: "rackpad.proxmox.inventory.v1", provider: "proxmox", host: { computerName: host.hostname, hostIpAddresses: ["10.234.50.5"] }, switches: [{ name: "vmbr0", kind: "external" }], hostAdapters: [
    { name: "eno1", macAddress: "02:00:00:00:55:01", status: "UP", linkSpeed: "10000 Mb/s", ipAddresses: [] },
    { name: "vmbr0", macAddress: "02:00:00:00:55:01", status: "UP", ipAddresses: ["10.234.50.5"] },
  ], vms: [] };
  try {
    await page.goto("/imports");
    await page.getByLabel("Choose import JSON").setInputFiles({ name: "proxmox.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    await expect(page.getByRole("combobox", { name: "Management IP", exact: true })).toHaveValue("10.234.50.5");
    await expect(page.getByTestId("host-adapter-preview").getByRole("checkbox")).toHaveCount(2);
    for (let iteration = 0; iteration < 2; iteration++) {
      await page.getByRole("button", { name: "Import selected", exact: true }).click();
      await expect(page.getByRole("button", { name: "Import selected", exact: true })).toBeEnabled();
      await expect.poll(async () => (await (await request.get(`/api/devices/${host.id}`, { headers })).json()).managementIp).toBe("10.234.50.5");
      const ports = await (await request.get(`/api/ports?deviceId=${host.id}`, { headers })).json() as Array<{ id: string; name: string; kind: string; macAddress: string }>;
      expect(ports).toHaveLength(2);
      expect(ports.find(port => port.name === "eno1")).toMatchObject({ id: original.id, kind: "sfp_plus", macAddress: "02:00:00:00:55:01" });
      expect(ports.find(port => port.name === "vmbr0")?.kind).toBe("virtual");
      expect((await (await request.get("/api/port-links", { headers })).json()).find((item: { id: string }) => item.id === link.id)).toMatchObject({ fromPortId: original.id, toPortId: peerPort.id });
      await page.reload();
      await page.getByLabel("Choose import JSON").setInputFiles({ name: "proxmox.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    }
    const conflicting = { ...payload, hostAdapters: [{ ...payload.hostAdapters[0], macAddress: "02:00:00:00:55:09" }, payload.hostAdapters[1]] };
    await page.getByLabel("Choose import JSON").setInputFiles({ name: "conflict.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(conflicting)) });
    await expect(page.getByTestId("host-adapter-preview")).toContainText("Ambiguous adapter match.");
    await page.getByRole("button", { name: "Import selected", exact: true }).click();
    await expect(page.getByText(/Skipped.*eno1: Ambiguous adapter match/)).toBeVisible();
  } finally {
    await request.delete(`/api/port-links/${link.id}`, { headers });
    await request.delete(`/api/devices/${host.id}`, { headers });
    await request.delete(`/api/devices/${peer.id}`, { headers });
    await request.delete(`/api/subnets/${subnetId}`, { headers });
  }
});

test("host networking respects import switches and reports blocked IPs and partial port failures", async ({ page, request }) => {
  const headers = await authenticate(page, request);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const subnetResponse = await request.post("/api/subnets", { headers, data: { labId: "lab_home", cidr: "10.234.60.0/24", name: "Host network choices" } });
  expect(subnetResponse.ok()).toBeTruthy();
  const subnet = await subnetResponse.json();
  const hostname = `hyperv-import-${Date.now()}`;
  const payload = { schema: "rackpad.hyperv.inventory.v1", provider: "hyperv", host: { computerName: hostname, hostIpAddresses: ["10.234.60.5", "10.234.60.6", "10.235.99.5"] }, hostAdapters: [{ name: "failed0", status: "up" }, { name: "ok0", status: "up" }], switches: [], vms: [] };
  let hostId: string | undefined;
  try {
    await page.goto("/imports");
    await page.getByLabel("Choose import JSON").setInputFiles({ name: "hyperv.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    const management = page.getByRole("combobox", { name: "Management IP", exact: true });
    await expect(management).toHaveValue("");
    await expect(management.getByRole("option", { name: /10.235.99.5.*Document a subnet/ })).toHaveAttribute("disabled", "");
    await management.selectOption("10.234.60.5");
    const importButton = page.getByRole("button", { name: "Import selected", exact: true });
    await page.getByRole("checkbox", { name: /^Host record/ }).uncheck();
    await importButton.click();
    await expect(importButton).toBeEnabled();
    expect((await (await request.get("/api/devices?labId=lab_home", { headers })).json()).some((device: { hostname: string }) => device.hostname === hostname)).toBe(false);
    await page.getByRole("checkbox", { name: /^Host record/ }).check();
    await page.getByRole("checkbox", { name: /^IPs Set management/ }).uncheck();
    await page.getByRole("checkbox", { name: /^Ports Import host/ }).uncheck();
    await importButton.click();
    await expect(importButton).toBeEnabled();
    const host = (await (await request.get("/api/devices?labId=lab_home", { headers })).json()).find((device: { hostname: string }) => device.hostname === hostname);
    expect(host).toBeTruthy();
    hostId = host.id;
    expect(host.managementIp).toBeFalsy();
    expect(await (await request.get(`/api/ports?deviceId=${host.id}`, { headers })).json()).toHaveLength(0);
    await page.getByRole("checkbox", { name: /^IPs Set management/ }).check();
    await page.getByRole("checkbox", { name: /^Ports Import host/ }).check();
    await page.route("**/api/ports", route => route.request().method() === "POST" && route.request().postDataJSON()?.name === "failed0"
      ? route.fulfill({ status: 503, json: { error: "Fixture port unavailable" } }) : route.continue());
    await importButton.click();
    await expect(page.getByText(/Failed.*failed0: Fixture port unavailable/)).toBeVisible();
    await expect(importButton).toBeEnabled();
    expect((await (await request.get(`/api/devices/${host.id}`, { headers })).json()).managementIp).toBe("10.234.60.5");
    expect(await (await request.get(`/api/ports?deviceId=${host.id}`, { headers })).json()).toMatchObject([{ name: "ok0" }]);
  } finally {
    if (hostId) await request.delete(`/api/devices/${hostId}`, { headers });
    await request.delete(`/api/subnets/${subnet.id}`, { headers });
  }
});
