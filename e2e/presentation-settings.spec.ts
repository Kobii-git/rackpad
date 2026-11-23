import { expect, test } from "@playwright/test";

test("header colors and device label placement save through real inventory forms", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const status = await request.get("/api/auth/status");
  const bootstrap = ((await status.json()) as { needsBootstrap: boolean })
    .needsBootstrap;
  const auth = await request.post(
    bootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(bootstrap
          ? { displayName: "Administrator", loadDemoData: true }
          : {}),
      },
    },
  );
  expect(auth.ok(), await auth.text()).toBeTruthy();
  const token = ((await auth.json()) as { token: string }).token;
  const headers = { authorization: `Bearer ${token}` };
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const post = async (url: string, data: unknown) => {
    const response = await request.post(url, { headers, data });
    expect(response.ok(), await response.text()).toBeTruthy();
    return (await response.json()) as { id: string };
  };
  const room = await post("/api/rooms", {
    labId: "lab_home",
    name: `Color room ${suffix}`,
  });
  const rack = await post("/api/racks", {
    labId: "lab_home",
    roomId: room.id,
    name: `Color rack ${suffix}`,
    totalU: 12,
  });
  const device = await post("/api/devices", {
    labId: "lab_home",
    rackId: rack.id,
    hostname: `Color-device-${suffix}`,
    deviceType: "server",
    startU: 3,
    heightU: 2,
  });
  await page.addInitScript(
    ({ token, roomId }) => {
      localStorage.setItem("rackpad.auth.token", token);
      if (!localStorage.getItem("rackpad.language"))
        localStorage.setItem("rackpad.language", "en");
      localStorage.setItem(
        "rackpad.visualizer.rack-cabling-rooms",
        JSON.stringify([roomId]),
      );
    },
    { token, roomId: room.id },
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  try {
    for (const [kind, id, color] of [
      ["room", room.id, "#ffffff"],
      ["rack", rack.id, "#001122"],
    ]) {
      await page.goto(`/racks?${kind}Id=${id}`);
      await page
        .getByRole("button", { name: `Edit ${kind}`, exact: true })
        .click();
      await page.getByLabel("Header color", { exact: true }).fill(color);
      await page
        .getByRole("button", { name: `Save ${kind}`, exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              (await (
                await request.get(`/api/${kind}s/${id}`, { headers })
              ).json()) as { headerColor: string }
            ).headerColor,
        )
        .toBe(color);
    }
    for (const theme of ["light", "dark"]) {
      for (const [color, background, foreground] of [
        ["#ffffff", "rgb(255, 255, 255)", "rgb(0, 0, 0)"],
        ["#000000", "rgb(0, 0, 0)", "rgb(255, 255, 255)"],
        ["#ff0000", "rgb(255, 0, 0)", "rgb(0, 0, 0)"],
      ]) {
        for (const [kind, id] of [
          ["room", room.id],
          ["rack", rack.id],
        ]) {
          const response = await request.patch(`/api/${kind}s/${id}`, {
            headers,
            data: { headerColor: color },
          });
          expect(response.ok(), await response.text()).toBeTruthy();
        }
        await page.evaluate(
          ({ theme }) => {
            localStorage.setItem("rackpad-theme", theme);
            localStorage.setItem(
              "rackpad.language",
              theme === "dark" ? "ar" : "en",
            );
          },
          { theme },
        );
        await page.goto(`/racks?rackId=${rack.id}`);
        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          theme === "dark" ? "rtl" : "ltr",
        );
        for (const kind of ["room", "rack"]) {
          const row = page
            .getByTestId(`${kind}-navigation-header`)
            .filter({ hasText: `Color ${kind} ${suffix}` });
          await expect(row).toHaveCSS("background-color", background);
          for (const child of await row.locator(":scope > *").all())
            await expect(child).toHaveCSS("color", foreground);
          const button = row.locator("..");
          await button.focus();
          await expect(button).toBeFocused();
          await expect(button).toHaveCSS("outline-style", "solid");
          await button.click();
          await expect(row).toHaveCSS("background-color", background);
          await expect(button).not.toHaveCSS(
            "border-left-color",
            "rgba(0, 0, 0, 0)",
          );
        }
      }
    }
    await page.evaluate(() => localStorage.setItem("rackpad.language", "en"));
    for (const [kind, id, color] of [
      ["room", room.id, "#ffffff"],
      ["rack", rack.id, "#001122"],
    ]) {
      const response = await request.patch(`/api/${kind}s/${id}`, {
        headers,
        data: { headerColor: color },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    await page.goto(`/devices/${device.id}`);
    await page
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Device name position", { exact: true })
      .selectOption("upper-left");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.get(`/api/devices/${device.id}`, { headers })
            ).json()) as { labelPosition: string }
          ).labelPosition,
      )
      .toBe("upper-left");
    await page.reload();
    await page
      .getByRole("button", { name: "Edit", exact: true })
      .first()
      .click();
    await expect(
      page.getByLabel("Device name position", { exact: true }),
    ).toHaveValue("upper-left");
    await page
      .getByLabel("Device name position", { exact: true })
      .selectOption("upper-right");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.get(`/api/devices/${device.id}`, { headers })
            ).json()) as { labelPosition: string }
          ).labelPosition,
      )
      .toBe("upper-right");
    await page.goto("/visualizer");
    await page
      .getByRole("combobox", { name: "Visualizer layout", exact: true })
      .selectOption("rack");
    await expect(
      page
        .getByTestId("rack-cabling-room-header")
        .filter({ hasText: `Color room ${suffix}` }),
    ).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(
      page
        .getByTestId("rack-cabling-room-header")
        .filter({ hasText: `Color room ${suffix}` }),
    ).toHaveCSS("color", "rgb(0, 0, 0)");
    const rackHeader = page
      .getByTestId("rack-cabling-rack-header")
      .filter({ hasText: `Color rack ${suffix}` });
    await expect(rackHeader).toHaveCSS("background-color", "rgb(0, 17, 34)");
    await expect(rackHeader.locator("div.truncate").first()).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await expect(rackHeader.locator("span").last()).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await page.reload();
    await expect(rackHeader).toHaveCSS("background-color", "rgb(0, 17, 34)");
    await page.screenshot({ path: testInfo.outputPath("header-colors.png") });
    for (const [kind, id] of [
      ["room", room.id],
      ["rack", rack.id],
    ]) {
      await page.goto(`/racks?${kind}Id=${id}`);
      await page
        .getByRole("button", { name: `Edit ${kind}`, exact: true })
        .click();
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await page
        .getByRole("button", { name: `Save ${kind}`, exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              (await (
                await request.get(`/api/${kind}s/${id}`, { headers })
              ).json()) as { headerColor: string | null }
            ).headerColor,
        )
        .toBeNull();
      await page.reload();
      await expect(
        page
          .getByTestId(`${kind}-navigation-header`)
          .filter({ hasText: `Color ${kind} ${suffix}` }),
      ).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  } finally {
    await request.delete(`/api/devices/${device.id}`, { headers });
    await request.delete(`/api/racks/${rack.id}`, { headers });
    await request.delete(`/api/rooms/${room.id}`, { headers });
  }
});
