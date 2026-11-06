import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function authenticate(
  page: Page,
  request: APIRequestContext,
  language = "en",
) {
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
  await page.addInitScript(
    (value) => {
      localStorage.setItem("rackpad.auth.token", value.token);
      localStorage.setItem("rackpad.language", value.language);
    },
    { token, language },
  );
  return { Authorization: `Bearer ${token}` };
}

test("discovery freshness updates on navigation, focus and polling without losing drafts", async ({
  page,
  request,
}) => {
  await authenticate(page, request);
  let phase = "initial";
  let requests = 0;
  const observedLabs: Array<string | null> = [];
  await page.route(/\/api\/discovery\/schedules(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    observedLabs.push(url.searchParams.get("labId"));
    requests++;
    await route.fulfill({
      json: [
        {
          id: "freshness",
          labId: "lab_home",
          name: "Freshness fixture",
          cidr: "10.99.0.0/30",
          intervalMs: 3_600_000,
          enabled: true,
          lastRunAt: "2026-01-01T00:00:00.000Z",
          lastResult: "success",
          lastMessage: phase,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });
  await page.route(/\/api\/discovery(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      json: [
        {
          id: "fresh-host",
          labId: "lab_home",
          ipAddress: "10.99.0.2",
          hostname: "fresh-host",
          displayName: phase,
          deviceType: "server",
          placement: "room",
          status: "new",
          lastScannedAt: new Date().toISOString(),
          firstSeenAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator('a[href="/discovery"]')).toBeVisible();
  await expect.poll(() => requests).toBeGreaterThan(0);
  phase = "navigation refreshed";
  await page.locator('a[href="/discovery"]').click();
  const row = page.getByRole("row").filter({ hasText: "Freshness fixture" });
  await expect(row).toContainText(phase);
  expect(observedLabs).toContain("lab_home");
  const inspector = page.getByTestId("discovery-inspector");
  const hostname = inspector.getByRole("textbox").first();
  await hostname.fill("unsaved-hostname");
  phase = "focus refreshed";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(row).toContainText(phase);
  await expect(hostname).toHaveValue("unsaved-hostname");
  phase = "poll refreshed";
  await page.clock.runFor(30_100);
  await expect(row).toContainText(phase);
  await expect(hostname).toHaveValue("unsaved-hostname");
  await page.locator('a[href="/"]').first().click();
  const count = requests;
  await page.clock.runFor(60_100);
  expect(requests).toBe(count);
});

test("audit history counts all matching actors and automatically pages selected actions", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const created = await request.post("/api/devices", {
    headers,
    data: {
      labId: "lab_home",
      hostname: `audit-paging-${Date.now()}`,
      deviceType: "server",
    },
  });
  expect(created.ok()).toBeTruthy();
  const device = await created.json();
  const action = `fixture.audit-paging.${device.id}`;
  const username = `audit-actor-${Date.now()}`;
  const actor = await request.post("/api/users", {
    headers,
    data: {
      username,
      displayName: "Older actor",
      password: "synthetic-audit-actor-password",
      role: "editor",
      labAccess: [{ labId: "lab_home", role: "editor" }],
    },
  });
  expect(actor.ok()).toBeTruthy();
  const actorId = (await actor.json()).id as string;
  try {
    const login = await request.post("/api/auth/login", {
      data: { username, password: "synthetic-audit-actor-password" },
    });
    expect(login.ok()).toBeTruthy();
    const older = await request.post("/api/audit-log", {
      headers: { Authorization: `Bearer ${(await login.json()).token}` },
      data: {
        entityType: "Device",
        entityId: device.id,
        action,
        summary: "Pagination fixture older actor",
      },
    });
    expect(older.ok()).toBeTruthy();
    for (let i = 0; i < 205; i++) {
      const response = await request.post("/api/audit-log", {
        headers,
        data: {
          entityType: "Device",
          entityId: device.id,
          action,
          summary: `Pagination fixture ${String(i).padStart(3, "0")}`,
        },
      });
      expect(response.ok()).toBeTruthy();
    }
    await page.goto("/audit-log");
    await page
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption(action);
    await page
      .getByPlaceholder("Search action, user, entity...")
      .fill(device.id);
    const rows = page
      .getByRole("row")
      .filter({ hasText: "Pagination fixture" });
    await expect(rows).toHaveCount(100);
    await expect(
      page
        .getByRole("group", { name: "Users", exact: true })
        .getByText("2", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("group", { name: "Entries", exact: true })
        .getByText("206", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Recent audit entries", { exact: true }).focus();
    await page.keyboard.press("End");
    await expect(rows).toHaveCount(200);
    await page.keyboard.press("End");
    await expect(rows).toHaveCount(206);
    await expect(
      page.getByRole("button", { name: "Load more", exact: true }),
    ).toHaveCount(0);
    await page
      .getByPlaceholder("Search action, user, entity...")
      .fill("Pagination fixture 000");
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByRole("cell", { name: "Pagination fixture 000", exact: true }),
    ).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  } finally {
    await request.delete(`/api/devices/${device.id}`, { headers });
    await request.delete(`/api/users/${actorId}`, { headers });
  }
});

test("audit history retries failed pages and ignores obsolete filter and lab responses", async ({
  page,
  request,
}) => {
  const headers = await authenticate(page, request);
  const created = await request.post("/api/labs", {
    headers,
    data: { name: `Audit scope ${Date.now()}` },
  });
  expect(created.ok()).toBeTruthy();
  const other = await created.json();
  const entry = (id: string, summary: string, labId = "lab_home") => ({
    id,
    ts: "2026-01-01T00:00:00.000Z",
    user: "alice",
    action: "device.update",
    entityType: "Device",
    entityId: "fixture",
    summary,
    labIds: [labId],
  });
  let failPage = true;
  let failSummary = true;
  let slowSeen = false;
  let labSeen = false;
  let releaseSlow!: () => void;
  let releaseLab!: () => void;
  const slow = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  const lab = new Promise<void>((resolve) => {
    releaseLab = resolve;
  });
  await page.route(
    /\/api\/audit-log(?:\/summary)?(?:\?.*)?$/,
    async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const summary = new URL(route.request().url()).pathname.endsWith(
        "/summary",
      );
      const totals = (entries: number) => ({
        entries,
        users: 2,
        devices: entries,
        ports: 0,
        actions: ["device.update", "port.link"],
      });
      if (!params.get("labId")) return route.fulfill({ json: [] });
      if (summary && failSummary) {
        failSummary = false;
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic summary failure" },
        });
      }
      if (params.get("labId") === other.id)
        return route.fulfill({
          json: summary
            ? totals(1)
            : [entry("other-lab", "Other lab history", other.id)],
        });
      if (params.get("search") === "slow") {
        slowSeen = true;
        await slow;
        return route.fulfill({
          json: summary
            ? totals(999)
            : [entry("obsolete-filter", "Obsolete filter response")],
        });
      }
      if (params.get("search") === "lab-delay") {
        labSeen = true;
        await lab;
        return route.fulfill({
          json: summary
            ? totals(999)
            : [entry("obsolete-lab", "Obsolete lab response")],
        });
      }
      if (params.get("search") === "new")
        return route.fulfill({
          json: summary ? totals(1) : [entry("new", "Current filter response")],
        });
      if (summary) return route.fulfill({ json: totals(101) });
      if (params.has("beforeId")) {
        if (failPage) {
          failPage = false;
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic unavailable fixture" },
          });
        }
        return route.fulfill({ json: [entry("tail", "Paged history tail")] });
      }
      return route.fulfill({
        json: Array.from({ length: 100 }, (_, i) =>
          entry(`page-${i}`, `Paged history ${i}`),
        ),
      });
    },
  );
  try {
    await page.goto("/audit-log");
    const rows = page.getByRole("row").filter({ hasText: "Paged history" });
    await expect(page.getByRole("alert")).toHaveText("Couldn't load data");
    await expect(rows).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(rows).toHaveCount(100);
    await expect(
      page
        .getByRole("group", { name: "Entries", exact: true })
        .getByText("101", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("combobox", { name: "Action", exact: true })
        .locator("option"),
    ).toHaveText(["All", "device.update", "port.link"]);
    await page.getByLabel("Recent audit entries", { exact: true }).focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("alert")).toHaveText("Couldn't load data");
    await expect(rows).toHaveCount(100);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(rows).toHaveCount(101);
    const search = page.getByPlaceholder("Search action, user, entity...");
    await search.fill("slow");
    await expect.poll(() => slowSeen).toBe(true);
    await search.fill("new");
    await expect(
      page.getByRole("cell", { name: "Current filter response", exact: true }),
    ).toBeVisible();
    releaseSlow();
    await expect(
      page.getByRole("cell", { name: "Obsolete filter response", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("group", { name: "Entries", exact: true })
        .getByText("1", { exact: true }),
    ).toBeVisible();
    await search.fill("lab-delay");
    await expect.poll(() => labSeen).toBe(true);
    await page.getByRole("button", { name: /^Lab:/ }).click();
    await page.getByRole("button", { name: new RegExp(other.name) }).click();
    await expect(
      page.getByRole("cell", { name: "Other lab history", exact: true }),
    ).toBeVisible();
    releaseLab();
    await expect(
      page.getByRole("cell", { name: "Obsolete lab response", exact: true }),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("group", { name: "Entries", exact: true })
        .getByText("1", { exact: true }),
    ).toBeVisible();
  } finally {
    releaseSlow();
    releaseLab();
    await request.delete(`/api/labs/${other.id}`, { headers });
  }
});

test("audit history keeps the non-admin global listing empty", async ({
  page,
  request,
  browser,
}) => {
  const headers = await authenticate(page, request);
  const username = `audit-viewer-${Date.now()}`;
  const account = await request.post("/api/users", {
    headers,
    data: {
      username,
      displayName: "Audit viewer",
      password: "synthetic-audit-viewer-password",
      role: "viewer",
      labAccess: [{ labId: "lab_home", role: "viewer" }],
    },
  });
  expect(account.ok()).toBeTruthy();
  const id = (await account.json()).id as string;
  const context = await browser.newContext();
  try {
    const login = await request.post("/api/auth/login", {
      data: { username, password: "synthetic-audit-viewer-password" },
    });
    expect(login.ok()).toBeTruthy();
    const token = (await login.json()).token as string;
    await context.addInitScript((value) => {
      localStorage.setItem("rackpad.auth.token", value);
      localStorage.setItem("rackpad.language", "en");
    }, token);
    const viewer = await context.newPage();
    await viewer.goto("/audit-log");
    await expect(
      viewer.getByText("No matching audit entries", { exact: true }),
    ).toBeVisible();
    await expect(
      viewer
        .getByRole("group", { name: "Entries", exact: true })
        .getByText("0", { exact: true }),
    ).toBeVisible();
    await expect(viewer.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
    await request.delete(`/api/users/${id}`, { headers });
  }
});

for (const mode of [
  { language: "fr", action: "Action" },
  { language: "ar", action: "الإجراء" },
]) {
  test(`audit history localized controls fit narrow layouts in ${mode.language}`, async ({
    page,
    request,
  }, testInfo) => {
    await authenticate(page, request, mode.language);
    const longAction =
      "integration.sync.host-networking-and-physical-inventory";
    await page.route(/\/api\/audit-log(?:\/summary)?(?:\?.*)?$/, (route) => {
      const url = new URL(route.request().url());
      const summary = url.pathname.endsWith("/summary");
      return route.fulfill({
        json: summary
          ? {
              entries: 5798,
              users: 2,
              devices: 5600,
              ports: 198,
              actions: ["device.update", longAction],
            }
          : url.searchParams.has("labId")
            ? [
                {
                  id: "layout",
                  ts: "2026-01-01T00:00:00.000Z",
                  user: "alice",
                  action: "device.update",
                  entityType: "Device",
                  entityId: "layout",
                  summary: "Synthetic audit layout fixture",
                  labIds: ["lab_home"],
                },
              ]
            : [],
      });
    });
    await page.goto("/audit-log");
    const select = page.getByRole("combobox", {
      name: mode.action,
      exact: true,
    });
    await expect(select.locator("option")).toHaveCount(3);
    await select.selectOption(longAction);
    for (const width of [1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await select.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`audit-${mode.language}-${width}.png`),
        fullPage: true,
      });
    }
  });
}
