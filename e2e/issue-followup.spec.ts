import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
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

test("notification saved settings and real test endpoint show disabled and channel failures", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  await request.put("/api/admin/alert-settings", {
    headers,
    data: {
      enabled: false,
      ntfyTopicUrl: null,
      ntfyToken: null,
      smtpHost: null,
      smtpFrom: null,
      smtpTo: null,
      discordWebhookUrl: null,
      telegramBotToken: null,
    },
  });
  await page.goto("/admin");
  const enabled = page.getByRole("checkbox", {
    name: "Enable notifications",
    exact: true,
  });
  await expect(enabled).not.toBeChecked();
  const send = page.getByRole("button", { name: "Send test", exact: true });
  await send.click();
  await expect(
    page.getByText("Enable notifications before sending a test alert.", {
      exact: true,
    }),
  ).toBeVisible();
  const topic = page.getByRole("textbox", {
    name: "ntfy topic URL",
    exact: true,
  });
  await topic.fill("https://127.0.0.1/private-fixture-topic");
  await page
    .getByLabel("ntfy access token", { exact: true })
    .fill("synthetic-browser-token");
  await enabled.check();
  // The persisted switch is still off until Save; Send test must not use unsaved values.
  const unsaved = page.waitForResponse((response) =>
    response.url().endsWith("/alert-settings/test"),
  );
  await send.click();
  expect((await unsaved).status()).toBe(500);
  await expect(
    page.getByText("Enable notifications before sending a test alert.", {
      exact: true,
    }),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/alert-settings"),
  );
  await page
    .getByRole("button", { name: "Save notifications", exact: true })
    .click();
  expect((await saved).ok()).toBeTruthy();
  await page.reload();
  await expect(enabled).toBeChecked();
  await expect(topic).toHaveValue("https://127.0.0.1/private-fixture-topic");
  const tested = page.waitForResponse((response) =>
    response.url().endsWith("/alert-settings/test"),
  );
  await send.click();
  const result = await tested;
  expect((await result.json()).code).toBe("ntfy_connection");
  await expect(
    page.getByText(
      "Cannot deliver to ntfy. Check the URL, network access and TLS certificate.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("synthetic-browser-token", { exact: true }),
  ).toHaveCount(0);
  const history = await (
    await request.get("/api/audit-log?entityType=Alert", { headers })
  ).json();
  expect(
    history.some((entry: { action: string }) => entry.action === "alert.error"),
  ).toBe(true);
  await request.put("/api/admin/alert-settings", {
    headers,
    data: { enabled: false, ntfyTopicUrl: null, ntfyToken: null },
  });
});

test("audit history retains cable creation and deletion after reload", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const labs = await (await request.get("/api/labs", { headers })).json();
  const labId =
    labs.find((lab: { id: string }) => lab.id === "lab_home")?.id ?? labs[0].id;
  const suffix = Date.now();
  const devices: string[] = [];
  try {
    const ports: string[] = [];
    for (let i = 0; i < 2; i++) {
      const device = await (
        await request.post("/api/devices", {
          headers,
          data: {
            labId,
            hostname: `audit-${suffix}-${i}`,
            deviceType: "server",
          },
        })
      ).json();
      devices.push(device.id);
      const port = await (
        await request.post("/api/ports", {
          headers,
          data: { deviceId: device.id, name: "1", position: 1, kind: "rj45" },
        })
      ).json();
      ports.push(port.id);
    }
    const cableResponse = await request.post("/api/port-links", {
      headers,
      data: { fromPortId: ports[0], toPortId: ports[1] },
    });
    expect(cableResponse.ok()).toBeTruthy();
    const cable = await cableResponse.json();
    await page.goto("/audit-log");
    const search = page.getByPlaceholder("Search action, user, entity...");
    await search.fill(cable.id);
    await expect(
      page.getByRole("cell", { name: "port.link", exact: true }),
    ).toBeVisible();
    expect(
      (
        await request.delete(`/api/port-links/${cable.id}`, { headers })
      ).status(),
    ).toBe(204);
    await page.reload();
    await search.fill(cable.id);
    await expect(
      page.getByRole("cell", { name: "port.link", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "port.unlink", exact: true }),
    ).toBeVisible();
  } finally {
    for (const id of devices)
      await request.delete(`/api/devices/${id}`, { headers });
  }
});

test("audit history refresh failure preserves successful device deletion", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const labs = await (await request.get("/api/labs", { headers })).json();
  const deviceResponse = await request.post("/api/devices", {
    headers,
    data: {
      labId:
        labs.find((lab: { id: string }) => lab.id === "lab_home")?.id ??
        labs[0].id,
      hostname: `audit-refresh-${Date.now()}`,
      deviceType: "server",
    },
  });
  expect(deviceResponse.ok()).toBeTruthy();
  const device = await deviceResponse.json();
  try {
    await page.goto(`/devices/${device.id}`);
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Delete", exact: true }),
    ).toBeVisible();
    await page.route("**/api/audit-log?*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic history failure" }),
      }),
    );
    page.once("dialog", (dialog) => dialog.accept());
    const failedHistory = page.waitForResponse(
      (response) =>
        response.url().includes("/api/audit-log?") && response.status() === 500,
    );
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await failedHistory;
    await expect(page).toHaveURL(/\/devices$/);
    expect(
      (await request.get(`/api/devices/${device.id}`, { headers })).status(),
    ).toBe(404);
    const history = await (
      await request.get(
        `/api/audit-log?entityType=Device&entityId=${device.id}`,
        { headers },
      )
    ).json();
    expect(
      history.filter(
        (entry: { action: string }) => entry.action === "device.delete",
      ),
    ).toHaveLength(1);
  } finally {
    await request.delete(`/api/devices/${device.id}`, { headers });
  }
});
