import { test, expect } from "@playwright/test";
import type { DriveBayTemplate } from "../src/lib/types";
let token = "";
test.beforeAll(async ({ request }) => {
  const status = await request.get("/api/auth/status");
  if ((await status.json()).needsBootstrap) {
    const result = await request.post("/api/auth/bootstrap", {
      data: {
        username: "e2e-admin",
        displayName: "E2E Administrator",
        password: "e2e-administrator-password",
        loadDemoData: true,
      },
    });
    expect(result.status()).toBe(201);
    token = (await result.json()).token;
  } else {
    const result = await request.post("/api/auth/login", {
      data: { username: "e2e-admin", password: "e2e-administrator-password" },
    });
    expect(result.ok()).toBeTruthy();
    token = (await result.json()).token;
  }
});
for (const uuidMode of ["native", "missing", "throwing"] as const) {
  test(`Storage renders and preserves independent section edits with ${uuidMode} randomUUID`, async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(
      ({ token, uuidMode }) => {
        localStorage.setItem("rackpad.auth.token", token);
        localStorage.setItem("rackpad.language", "en");
        if (uuidMode !== "native")
          Object.defineProperty(globalThis.crypto, "randomUUID", {
            configurable: true,
            value:
              uuidMode === "missing"
                ? undefined
                : () => {
                    throw new Error("UUID unavailable in this browser context");
                  },
          });
      },
      { token, uuidMode },
    );
    const name = `Storage compatibility ${testInfo.project.name || "chromium"} ${uuidMode}`;
    const headers = { authorization: `Bearer ${token}` };
    let templateId = "";
    try {
      await page.goto("/storage");
      await expect(
        page.getByRole("heading", { name: "Storage", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Raw capacity", { exact: true }),
      ).toBeVisible();
      await page.goto("/storage?tab=templates");
      if (process.env.RACKPAD_TEST_STORAGE_UPGRADE === "1") {
        await page.getByRole("button", { name: /Pre-upgrade storage/ }).click();
        await expect(
          page.getByRole("textbox", { name: "Description", exact: true }),
        ).toHaveValue("Preserved schema-50 template");
        const backup = await request.get("/api/admin/export", { headers });
        expect((await backup.json()).schemaVersion).toBe(52);
      }
      await page
        .getByRole("button", { name: "Custom template", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Name", exact: true })
        .first()
        .fill(name);
      await page
        .getByRole("textbox", { name: "Description", exact: true })
        .fill("Synthetic storage compatibility template");
      await page
        .getByRole("button", { name: "Add section", exact: true })
        .click();
      const names = page.getByRole("textbox", { name: "Name", exact: true });
      await expect(names).toHaveCount(3);
      await names.nth(1).fill("Front bays");
      await names.nth(2).fill("Internal bays");
      await page
        .getByRole("spinbutton", { name: "Slot count", exact: true })
        .nth(0)
        .fill("3");
      await page
        .getByRole("spinbutton", { name: "Slot count", exact: true })
        .nth(1)
        .fill("2");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(
        page.getByRole("button", { name: new RegExp(name) }),
      ).toBeVisible();
      const templates = (await (
        await request.get("/api/storage/drive-bay-templates", { headers })
      ).json()) as DriveBayTemplate[];
      const template = templates.find((row) => row.name === name)!;
      expect(template).toBeTruthy();
      templateId = template.id;
      expect(
        template.sections.map((section) => [
          section.name,
          section.slots.length,
        ]),
      ).toEqual([
        ["Front bays", 3],
        ["Internal bays", 2],
      ]);
      await page.reload();
      await page.getByRole("button", { name: new RegExp(name) }).click();
      await expect(
        page.getByRole("textbox", { name: "Name", exact: true }).nth(1),
      ).toHaveValue("Front bays");
      await page
        .getByRole("textbox", { name: "Name", exact: true })
        .nth(2)
        .fill("Edited internal bays");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect
        .poll(async () => {
          const rows = (await (
            await request.get("/api/storage/drive-bay-templates", { headers })
          ).json()) as DriveBayTemplate[];
          return rows
            .find((row) => row.id === templateId)
            ?.sections.map((section) => section.name);
        })
        .toEqual(["Front bays", "Edited internal bays"]);
      expect(errors).toEqual([]);
    } finally {
      if (templateId)
        expect(
          (
            await request.delete(
              `/api/storage/drive-bay-templates/${templateId}`,
              { headers },
            )
          ).ok(),
        ).toBeTruthy();
    }
  });
}
