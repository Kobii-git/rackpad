import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import packageJson from "../package.json" with { type: "json" };

let token = "";

test.beforeAll(async ({ request }) => {
  const status = await request.get("/api/auth/status");
  const auth = await status.json() as { needsBootstrap: boolean };
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
    token = (await bootstrap.json() as { token: string }).token;
  } else {
    token = await login(request);
  }
});

async function login(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: { username: "e2e-admin", password: "e2e-administrator-password" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json() as { token: string }).token;
}

async function authenticate(page: Page, language = "en") {
  await page.addInitScript(({ authToken, selectedLanguage }) => {
    localStorage.setItem("rackpad.auth.token", authToken);
    if (!localStorage.getItem("rackpad.language")) {
      localStorage.setItem("rackpad.language", selectedLanguage);
    }
  }, { authToken: token, selectedLanguage: language });
}

test("responsive and serious accessibility matrix passes for supported modes", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await authenticate(page);
  await page.goto("/");
  for (const mode of [
    { name: "light", language: "en", theme: "light" },
    { name: "dark", language: "en", theme: "dark" },
    { name: "French", language: "fr", theme: "light" },
    { name: "Arabic RTL", language: "ar", theme: "dark" },
  ]) {
    await page.evaluate(({ language, theme }) => {
      localStorage.setItem("rackpad.language", language);
      localStorage.setItem("rackpad-theme", theme);
    }, mode);
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1280, height: 720 },
      { width: 1920, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      for (const route of ["/", "/devices", "/networks", "/visualizer"]) {
        await page.goto(route);
        await expect(
          page.locator("h1").first(),
          `${route} did not finish loading in ${mode.name} at ${viewport.width}px`,
        ).toBeVisible({ timeout: 15_000 });
        const overflows = await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        );
        expect(
          overflows,
          `${route} overflowed in ${mode.name} at ${viewport.width}px`,
        ).toBeFalsy();
        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations.filter((violation) =>
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

test("explicit translation never rewrites user-provided hostnames", async ({ page, request }) => {
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
  await expect(page.getByText("Unknown", { exact: true }).first()).toBeVisible();
  expect(await page.locator("text=Inconnu").count()).toBe(0);
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
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("fr-FR");
  expect(localeRequests.some((url) => url.includes("/locales/fr.ts"))).toBeTruthy();
});

test("failed locale loading falls back to bundled English", async ({ page }) => {
  await page.route("**/src/i18n/locales/fr.ts*", (route) => route.abort());
  await authenticate(page, "fr");
  await page.goto("/");
  await expect(page.locator("h1").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");
  expect(
    await page.evaluate(() => localStorage.getItem("rackpad.language")),
  ).toBe("en");
});
