import {
  test,
  expect,
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

test("audit history pages, counts distinct actors and filters actions across stored history", async ({
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
  try {
    for (let i = 0; i < 105; i++) {
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
      .getByRole("textbox", { name: "Action", exact: true })
      .fill(action);
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
        .getByText("1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Load more", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(rows).toHaveCount(105);
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
  await page.route(/\/api\/audit-log(?:\?.*)?$/, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (!params.get("labId")) return route.fulfill({ json: [] });
    if (params.get("labId") === other.id)
      return route.fulfill({
        json: [entry("other-lab", "Other lab history", other.id)],
      });
    if (params.get("search") === "slow") {
      slowSeen = true;
      await slow;
      return route.fulfill({
        json: [entry("obsolete-filter", "Obsolete filter response")],
      });
    }
    if (params.get("search") === "lab-delay") {
      labSeen = true;
      await lab;
      return route.fulfill({
        json: [entry("obsolete-lab", "Obsolete lab response")],
      });
    }
    if (params.get("search") === "new")
      return route.fulfill({ json: [entry("new", "Current filter response")] });
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
  });
  try {
    await page.goto("/audit-log");
    const rows = page.getByRole("row").filter({ hasText: "Paged history" });
    await expect(rows).toHaveCount(100);
    await page.getByRole("button", { name: "Load more", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Couldn't load data");
    await expect(rows).toHaveCount(100);
    await page.getByRole("button", { name: "Load more", exact: true }).click();
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
  } finally {
    releaseSlow();
    releaseLab();
    await request.delete(`/api/labs/${other.id}`, { headers });
  }
});
