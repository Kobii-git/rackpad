import {
  expect,
  test,
  type Page,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { rackShelfCableFixture } from "./fixtures/rack-cables";
import {
  createStarterTemplate,
  templateToResolvedLayout,
} from "../src/lib/hardware-template-builder";
import type { Device, Port } from "../src/lib/types";

async function setup(page: Page, request: APIRequestContext) {
  const status = await request.get("/api/auth/status");
  const bootstrap = ((await status.json()) as { needsBootstrap: boolean })
    .needsBootstrap;
  const response = await request.post(
    bootstrap ? "/api/auth/bootstrap" : "/api/auth/login",
    {
      data: {
        username: "e2e-admin",
        password: "e2e-administrator-password",
        ...(bootstrap
          ? { displayName: "E2E Administrator", loadDemoData: true }
          : {}),
      },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
  const token = ((await response.json()) as { token: string }).token;
  const fixture = rackShelfCableFixture();
  fixture.devices[0]!.hostname =
    "A very long switch hostname that must truncate without losing its accessible name";
  fixture.devices[0]!.displayName = "Workshop switch";
  fixture.devices[0]!.manufacturer = "Example Networks";
  fixture.devices[0]!.model = "Switch 24";
  fixture.devices[0]!.managementIp = "192.0.2.42";
  fixture.devices[0]!.macAddress = "02:00:00:00:00:42";
  const stack = fixture.devices.find(
    (device) => device.id === "shelves-server-5",
  )!;
  stack.deviceType = "switch_stack";
  stack.stackMembers = [1, 2].map((position) => ({
    id: `member-${position}`,
    deviceId: stack.id,
    position,
    name: `Member ${position}`,
    heightU: 1,
    manufacturer: null,
    model: null,
    serial: null,
    status: "online",
    notes: null,
    macs: [],
  }));
  const template = createStarterTemplate(
    "round-device",
    "zoom-round",
    "Zoom round device",
  );
  const round: Device = {
    id: "zoom-round",
    labId: "lab_home",
    roomId: fixture.room.id,
    hostname: "Ceiling access point",
    deviceType: "ap",
    status: "online",
    placement: "room",
    rackMountKind: "loose",
  };
  const roundPorts: Port[] = template.portSlots.map((slot, index) => ({
    id: `round-port-${index}`,
    deviceId: round.id,
    name: slot.label ?? "RJ45",
    kind: "rj45",
    face: slot.face,
    portRole: "physical",
    position: index + 1,
    linkState: "up",
    mode: "access",
  }));
  fixture.devices.push(round);
  fixture.ports.push(...roundPorts);
  fixture.layouts.push({
    ...fixture.layouts[0]!,
    deviceId: round.id,
    snapshot: templateToResolvedLayout(template),
    bindings: template.portSlots.map((slot, index) => ({
      slotId: slot.id,
      portId: roundPorts[index]!.id,
    })),
  });
  // Geometry fixture only: backend feature acceptance runs against the real API separately.
  const datasets: Record<string, unknown> = {
    "/api/devices": fixture.devices,
    "/api/rooms": [fixture.room],
    "/api/racks": [fixture.rack],
    "/api/ports": fixture.ports,
    "/api/port-links": fixture.links,
    "/api/physical-layouts": fixture.layouts,
  };
  await page.route("**/api/**", async (route) => {
    const data = datasets[new URL(route.request().url()).pathname];
    if (route.request().method() === "GET" && data !== undefined)
      await route.fulfill({ json: data });
    else await route.continue();
  });
  await page.addInitScript(
    ({ token, roomId }) => {
      localStorage.setItem("rackpad.auth.token", token);
      localStorage.setItem("rackpad.language", "en");
      localStorage.setItem(
        "rackpad.visualizer.rack-cabling-rooms",
        JSON.stringify([roomId]),
      );
      localStorage.setItem("rackpad.visualizer.rack-cabling-room", roomId);
    },
    { token, roomId: fixture.room.id },
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  return fixture;
}

function deviceName(page: Page, name: string) {
  return page.getByTestId("device-name").filter({ hasText: name }).first();
}

async function metrics(label: Locator) {
  return label.evaluate((element) => {
    const host = element.closest<HTMLElement>("[data-device-name-host]")!;
    const hostBox = host.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const scale = hostBox.width / host.offsetWidth;
    return {
      font: parseFloat(getComputedStyle(element).fontSize) * scale,
      localFont: parseFloat(getComputedStyle(element).fontSize),
      height: box.height,
      right: hostBox.right - box.right,
      relativeArea: (box.width * box.height) / (hostBox.width * hostBox.height),
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      clipped: element.scrollWidth > element.clientWidth,
    };
  });
}

async function assertReadable(label: Locator) {
  await expect(label).toHaveAttribute("data-name-visible", "true");
  await expect
    .poll(async () => Math.abs((await metrics(label)).font - 12))
    .toBeLessThan(0.2);
  const value = await metrics(label);
  expect(value.height).toBeLessThan(15);
  expect(value.right).toBeGreaterThanOrEqual(3);
  expect(value.right).toBeLessThan(6);
  return value;
}

test("zoom-aware device names retain screen size across all Visualizer modes", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, request);
  await page.goto("/visualizer");
  const layout = page.getByRole("combobox", {
    name: "Visualizer layout",
    exact: true,
  });
  for (const mode of ["grouped", "pyramid", "diagram", "physical", "rack"]) {
    await layout.selectOption(mode === "physical" ? "diagram" : mode);
    const diagram = mode === "diagram" || mode === "physical";
    if (diagram)
      await page
        .getByRole("combobox", { name: "Physical layout", exact: true })
        .selectOption(mode === "physical" ? "physical" : "compact");
    const label = deviceName(
      page,
      mode === "grouped" || mode === "pyramid"
        ? "Ceiling access point"
        : fixture.devices[0]!.hostname,
    );
    if (mode === "grouped" || mode === "pyramid")
      await page.getByRole("button", { name: "Reset", exact: true }).click();
    else {
      const zoomIn = diagram
        ? page.locator(".react-flow__controls-zoomin")
        : page.getByRole("button", { name: "Zoom in", exact: true });
      for (
        let i = 0;
        i < 12 &&
        (await metrics(label)).localFont > (mode === "rack" ? 10 : 15);
        i++
      )
        await zoomIn.click();
    }
    const before = await assertReadable(label);
    const paths = page.getByTestId("rack-cabling-cable");
    const anchorsBefore = await paths.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("d")),
    );
    if (mode === "grouped" || mode === "pyramid")
      await label.dispatchEvent("wheel", {
        deltaY: -100,
        clientX: 800,
        clientY: 400,
        bubbles: true,
      });
    else
      await (
        diagram
          ? page.locator(".react-flow__controls-zoomin")
          : page.getByRole("button", { name: "Zoom in", exact: true })
      ).click();
    await expect
      .poll(async () => (await metrics(label)).localFont)
      .toBeLessThan(before.localFont);
    const after = await assertReadable(label);
    expect(after.relativeArea).toBeLessThan(before.relativeArea);
    expect([after.hostWidth, after.hostHeight]).toEqual([
      before.hostWidth,
      before.hostHeight,
    ]);
    expect(
      await paths.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("d")),
      ),
    ).toEqual(anchorsBefore);
    if (diagram) {
      for (
        let i = 0;
        i < 20 &&
        (await page.locator(".react-flow__controls-zoomout").isEnabled());
        i++
      )
        await page.locator(".react-flow__controls-zoomout").click();
      await expect(label).toHaveAttribute("data-name-visible", "false");
      const host = label.locator(
        "xpath=ancestor::*[@data-device-name-host][1]",
      );
      await host
        .getByRole("link", { name: "Open device", exact: true })
        .focus();
      await expect(
        page
          .getByTestId("device-name-tooltip")
          .filter({ hasText: fixture.devices[0]!.hostname }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page
          .getByTestId("device-name-tooltip")
          .filter({ hasText: fixture.devices[0]!.hostname }),
      ).toHaveCount(0);
    }
    if (mode === "physical" || mode === "rack") {
      if (mode === "rack") {
        const summaryName = page
          .getByTestId("loose-device-summary")
          .getByTestId("device-name");
        await assertReadable(summaryName);
        // At intermediate zoom, the name yields to the scaled cable count.
        for (let i = 0; i < 7; i++)
          await page
            .getByRole("button", { name: "Zoom out", exact: true })
            .click();
        await expect(summaryName).toHaveAttribute("data-name-visible", "false");
        await page.getByTestId("loose-device-summary").focus();
        await expect(
          page
            .getByTestId("loose-device-details")
            .filter({ hasText: "Ceiling access point" }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        for (let i = 0; i < 7; i++)
          await page
            .getByRole("button", { name: "Zoom in", exact: true })
            .click();
        await assertReadable(summaryName);
        await page.getByRole("button", { name: /^Loose gear/ }).click();
      }
      await page
        .getByRole("combobox", { name: "Face", exact: true })
        .selectOption("both");
      await expect(
        page.locator('[data-device-shape="round"]').first(),
      ).toBeAttached();
      await expect(deviceName(page, "server-5")).toBeAttached();
    }
  }
  const name = deviceName(page, fixture.devices[0]!.hostname);
  const host = name.locator("xpath=ancestor::*[@data-device-name-host][1]");
  await host.focus();
  await page.keyboard.press("Enter");
  await expect(host).toHaveAttribute("data-highlighted", "true");
  // Escape must dismiss a selected tiny-device tooltip even when the canvas
  // also clears selection and leaves keyboard focus on the device.
  for (let i = 0; i < 12; i++)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(name).toHaveAttribute("data-name-visible", "false");
  await host.focus();
  await page.keyboard.press("Enter");
  const tooltip = page
    .getByTestId("device-name-tooltip")
    .filter({ hasText: fixture.devices[0]!.hostname });
  await expect(tooltip.first()).toBeVisible();
  const tooltipBox = (await tooltip.first().boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(8);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(8);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(1592);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(992);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  for (let i = 0; i < 12; i++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const port = host.locator('[data-cabling-selection-id^="port:"]').last();
  await port.click();
  await expect(port).toBeFocused();
});

test("zoom-aware device names cover Studio overviews elevations RTL and exports", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, request);
  await page.goto("/racks");
  const legacy = page
    .getByTestId("rack-device-tile")
    .filter({
      has: page
        .getByTestId("device-name")
        .filter({ hasText: fixture.devices[0]!.hostname }),
    })
    .first();
  await assertReadable(legacy.getByTestId("device-name"));
  await legacy.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    fixture.devices[0]!.hostname,
  );
  await page.getByRole("button", { name: "Studio Beta", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(`${fixture.room.name} 1R`) })
    .click();
  const workspace = page.getByTestId("rack-studio-workspace");
  const focused = workspace
    .locator('[data-testid="rack-studio-device"]')
    .filter({
      has: page
        .getByTestId("device-name")
        .filter({ hasText: fixture.devices[0]!.hostname }),
    })
    .first();
  await assertReadable(focused.getByTestId("device-name").first());
  const tiny = deviceName(page, fixture.devices[0]!.hostname);
  await expect(tiny).toHaveAttribute("data-name-visible", "false");
  const tinyHost = tiny.locator("xpath=ancestor::*[@data-device-name-host][1]");
  await tinyHost.focus();
  const tooltip = page
    .getByTestId("device-name-tooltip")
    .filter({ hasText: fixture.devices[0]!.hostname });
  await expect(tooltip).toBeVisible();
  expect(
    await tooltip.evaluate(
      (element) => element.parentElement === document.body,
    ),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  const round = deviceName(page, "Ceiling access point");
  for (let i = 0; i < 5; i++)
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const before = await assertReadable(round);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => (await metrics(round)).localFont)
    .toBeLessThan(before.localFont);
  await assertReadable(round);
  await page.getByRole("button", { name: "Both", exact: true }).click();
  await expect(
    workspace.locator('[data-device-shape="round"]').first(),
  ).toBeAttached();
  await expect(deviceName(page, "vertical-ups")).toBeAttached();
  await page.evaluate(() => (document.documentElement.dir = "rtl"));
  await assertReadable(focused.getByTestId("device-name").first());
  await page.evaluate(() => (document.documentElement.dir = "ltr"));
  const downloadSvg = async () => {
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download SVG", exact: true })
      .click();
    return readFile((await (await download).path())!, "utf8");
  };
  const svg = await downloadSvg();
  expect(svg).toContain('data-device-name="true" text-anchor="end"');
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  expect(await downloadSvg()).toBe(svg);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG", exact: true }).click();
  const png = await readFile((await (await pngDownload).path())!);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="rack-studio-workspace"]')
    .analyze();
  expect(
    axe.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await workspace.screenshot({
    path: testInfo.outputPath("device-names-studio.png"),
  });
});


test("per-device name placement follows the physical left corner across canvases and exports", async ({page, request}) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, request);
  for (const device of fixture.devices) device.labelPosition = "upper-left";
  fixture.devices.find(device => device.hostname === "server-3")!.labelPosition = "upper-right";
  await page.goto("/visualizer");
  const layout = page.getByRole("combobox", {name: "Visualizer layout", exact: true});
  for (const mode of ["grouped", "pyramid", "diagram", "physical", "rack"]) {
    await layout.selectOption(mode === "physical" ? "diagram" : mode);
    if (mode === "diagram" || mode === "physical")
      await page.getByRole("combobox", {name: "Physical layout", exact: true}).selectOption(mode === "physical" ? "physical" : "compact");
    const label = deviceName(page, mode === "grouped" || mode === "pyramid" ? "Ceiling access point" : fixture.devices[0]!.hostname);
    await expect(label).toHaveAttribute("data-name-position", "upper-left");
    const css = await label.evaluate(element => ({left: (element as HTMLElement).style.left, right: (element as HTMLElement).style.right, align: getComputedStyle(element).textAlign, pointer: getComputedStyle(element).pointerEvents}));
    expect(css.left).not.toBe(""); expect(css.right).toBe(""); expect(css.align).toBe("left"); expect(css.pointer).toBe("none");
    if (mode === "grouped" || mode === "pyramid") {
      await label.dispatchEvent("wheel", {deltaY: -100, clientX: 800, clientY: 400, bubbles: true});
    } else {
      const zoomIn = mode === "diagram" || mode === "physical" ? page.locator(".react-flow__controls-zoomin") : page.getByRole("button", {name: "Zoom in", exact: true});
      await zoomIn.click();
    }
    await expect.poll(async () => Math.abs((await metrics(label)).font - 12)).toBeLessThan(0.2);
    await page.evaluate(() => {document.documentElement.dir = "rtl";});
    await expect(label).toHaveCSS("text-align", "left");
    await page.evaluate(() => {document.documentElement.dir = "ltr";});
  }
  await page.goto(`/racks?rackId=${fixture.rack.id}`);
  await expect(deviceName(page, fixture.devices[0]!.hostname)).toHaveAttribute("data-name-position", "upper-left");
  await expect(deviceName(page, "server-3")).toHaveAttribute("data-name-position", "upper-right");
  await page.getByRole("button", {name: "Studio Beta", exact: true}).click();
  const workspace = page.getByTestId("rack-studio-workspace");
  const label = workspace.getByTestId("device-name").filter({hasText: fixture.devices[0]!.hostname}).first();
  await expect(label).toHaveAttribute("data-name-position", "upper-left");
  await expect(deviceName(page, "vertical-ups")).toHaveAttribute("data-name-position", "upper-left");
  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download SVG", exact: true}).click();
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('data-device-name="true" text-anchor="start"');
  expect(svg).toContain('data-device-name="true" text-anchor="end"');
});


test("device hover details match classic racks across Studio and Visualizer modes", async ({ page, request }) => {
  test.setTimeout(120_000);
  const fixture = await setup(page, request);
  const device = fixture.devices[0]!;
  const checkSummary = async (summary: Locator) => {
    await expect(summary).toBeVisible();
    for (const value of ["Workshop switch", device.hostname, "Example Networks", "Switch 24", "IP: 192.0.2.42", "MAC: 02:00:00:00:00:42"])
      await expect(summary).toContainText(value);
  };
  await page.goto("/racks");
  const classic = page.getByTestId("rack-device-tile").filter({ has: deviceName(page, device.hostname) }).first();
  await classic.hover();
  await checkSummary(page.getByRole("tooltip"));
  await page.keyboard.press("Escape");
  await classic.focus();
  await checkSummary(page.getByRole("tooltip"));
  await page.getByRole("button", { name: "Studio Beta", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`${fixture.room.name} 1R`) }).click();
  const studio = deviceName(page, device.hostname).locator("xpath=ancestor::*[@data-device-name-host][1]");
  await studio.focus();
  await checkSummary(page.getByTestId("device-name-tooltip"));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("device-name-tooltip")).toHaveCount(0);

  await page.goto("/visualizer");
  const layout = page.getByRole("combobox", { name: "Visualizer layout", exact: true });
  for (const mode of ["grouped", "pyramid", "diagram", "physical", "rack"]) {
    await layout.selectOption(mode === "physical" ? "diagram" : mode);
    const diagram = mode === "diagram" || mode === "physical";
    if (diagram) await page.getByRole("combobox", { name: "Physical layout", exact: true }).selectOption(mode === "physical" ? "physical" : "compact");
    const host = deviceName(page, device.hostname).locator("xpath=ancestor::*[@data-device-name-host][1]");
    const focusTarget = diagram ? host.getByRole("link", { name: "Open device", exact: true })
      : (mode === "grouped" || mode === "pyramid") ? host.getByRole("button", { name: `Select ${device.hostname}`, exact: true }) : host;
    await focusTarget.focus();
    const summary = page.getByTestId("device-name-tooltip").filter({ hasText: device.hostname }).first();
    await checkSummary(summary);
    await expect(focusTarget).toHaveAttribute("aria-describedby", new RegExp((await summary.getAttribute("id"))!));
    await expect(summary).toHaveCSS("pointer-events", "none");
    await expect(host).not.toHaveAttribute("title", device.hostname);
    await page.keyboard.press("Escape");
    await expect(summary).toHaveCount(0);
    await focusTarget.blur();
    await host.hover({ force: true });
    await checkSummary(summary);
    await page.keyboard.press("Escape");
    await page.mouse.move(0, 0);
  }
  const loose = page.getByTestId("loose-device-summary");
  await loose.focus();
  const details = page.getByTestId("loose-device-details");
  await expect(details).toContainText("Ceiling access point");
  await expect(details).not.toContainText("IP:");
  await expect(details).not.toContainText("MAC:");
  await expect(page.getByTestId("device-name-tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await loose.blur();
  await page.mouse.move(0, 0);
  await loose.hover();
  await expect(details).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
});

test("device hover details order and personal field preferences include passive devices", async ({ page, request }) => {
  const fixture = await setup(page, request);
  const device = fixture.devices[0]!;
  device.deviceType = "brush_panel";
  device.specs = "Passive brush panel fixture";
  await page.goto("/racks");
  const classic = page.getByTestId("rack-device-tile").filter({ has: deviceName(page, device.hostname) }).first();
  await classic.hover();
  const summary = page.getByTestId("device-summary").first();
  await expect(summary.locator("[data-summary-field]").first()).toHaveText(device.hostname);
  await expect(summary.locator('[data-summary-field="deviceType"]')).toHaveText("Brush panel");
  await expect(summary.locator('[data-summary-field="placement"]')).toHaveText(`${fixture.rack.name} | U${device.startU}`);
  await expect(summary.locator('[data-summary-field="startU"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hover details", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Hover details", exact: true });
  await settings.getByRole("checkbox", { name: "IP", exact: true }).uncheck();
  await settings.getByRole("checkbox", { name: "Specs", exact: true }).check();
  await page.keyboard.press("Escape");
  await classic.hover();
  await expect(summary.locator('[data-summary-field="managementIp"]')).toHaveCount(0);
  await expect(summary.locator('[data-summary-field="specs"]')).toHaveText(device.specs!);
  await page.reload();
  await classic.hover();
  await expect(summary.locator('[data-summary-field="managementIp"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/visualizer");
  await page.getByRole("button", { name: "Hover details", exact: true }).click();
  await expect(settings.getByRole("checkbox", { name: "IP", exact: true })).not.toBeChecked();
  await settings.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(settings.getByRole("checkbox", { name: "IP", exact: true })).toBeChecked();
  await expect(settings.getByRole("checkbox", { name: "Specs", exact: true })).not.toBeChecked();
  await page.screenshot({ path: test.info().outputPath("hover-details-preferences.png") });
  await page.keyboard.press("Escape");
  // A blocked storage API must leave the in-memory controls usable.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Fixture blocked storage"); }; });
  await page.getByRole("button", { name: "Hover details", exact: true }).click();
  await settings.getByRole("checkbox", { name: "MAC", exact: true }).uncheck();
  await expect(settings.getByRole("checkbox", { name: "MAC", exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape");
});
