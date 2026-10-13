import assert from "node:assert/strict";
import test from "node:test";
import type {
  Device,
  DeviceTypeDefinition,
  Port,
  PortLink,
  Rack,
  Room,
} from "@/lib/types";
import { buildVisualizerModel, tracePorts } from "./model";
import { buildTraceImageSvg, type TraceImageLabels } from "./trace-image";

const labels: TraceImageLabels = {
  cable: "Cable",
  direction: "ltr",
  front: "Front",
  rear: "Rear",
  internalPassThrough: "Internal pass-through",
  length: "Length",
  rack: "Rack",
  room: "Room",
  unknown: "Unknown",
  deviceType: (type) => type.replaceAll("_", " "),
  hops: (count) => `${count} hops`,
};

function device(id: string, overrides: Partial<Device> = {}): Device {
  return {
    id,
    labId: "lab_trace_image",
    hostname: id,
    deviceType: "endpoint",
    status: "online",
    placement: "room",
    ...overrides,
  };
}

function port(
  id: string,
  deviceId: string,
  name: string,
  overrides: Partial<Port> = {},
): Port {
  return {
    id,
    deviceId,
    name,
    position: 1,
    kind: "rj45",
    linkState: "up",
    mode: "access",
    ...overrides,
  };
}

function buildModel(input: {
  devices: Device[];
  ports: Port[];
  links: PortLink[];
  racks?: Rack[];
  rooms?: Room[];
  deviceTypes?: DeviceTypeDefinition[];
}) {
  return buildVisualizerModel({
    racks: input.racks ?? [],
    rooms: input.rooms ?? [],
    devices: input.devices,
    deviceTypes: input.deviceTypes ?? [],
    ports: input.ports,
    portLinks: input.links,
    deviceMonitors: [],
    subnets: [],
    vlans: [],
    discoveredDevices: [],
    virtualSwitches: [],
    expandedRackRuns: new Set(),
    collapsedGroups: new Set(),
  });
}

test("trace image renders escaped endpoint metadata and a safe filename", () => {
  const devices = [
    device("edge", {
      hostname: "edge<&>",
      deviceType: "firewall",
      manufacturer: "Example & Co",
      model: 'FW "Plus"',
      placement: "rack",
      rackId: "rack_a",
      roomId: "room_a",
      face: "front",
      startU: 12,
    }),
    device("server", {
      hostname: "server-01",
      deviceType: "server",
      placement: "room",
      roomId: "room_a",
    }),
  ];
  const ports = [
    port("edge_port", "edge", "eth/0", { face: "front" }),
    port("server_port", "server", "eno1"),
  ];
  const model = buildModel({
    devices,
    ports,
    rooms: [{ id: "room_a", labId: "lab_trace_image", name: "Room & Lab" }],
    racks: [
      {
        id: "rack_a",
        labId: "lab_trace_image",
        name: "Rack <A>",
        totalU: 24,
        roomId: "room_a",
      },
    ],
    links: [
      {
        id: "direct",
        fromPortId: "edge_port",
        toPortId: "server_port",
        cableType: "Cat6",
        cableLength: "3m",
        color: "blue",
      },
    ],
  });
  const result = tracePorts(model, "edge_port", "server_port");
  assert.ok(result);

  const image = buildTraceImageSvg(model, result, labels, "light");
  assert.equal(image.width, 640);
  assert.equal(
    image.filename,
    "rackpad-trace-edge-eth-0-to-server-01-eno1.png",
  );
  assert.match(image.svg, /edge&lt;&amp;&gt;/);
  assert.match(image.svg, /firewall · Example &amp; Co FW &quot;Plus&quot;/);
  assert.match(image.svg, /Room: Room &amp; Lab/);
  assert.match(image.svg, /Rack: Rack &lt;A&gt; \/ Front \/ U12/);
  assert.match(image.svg, /Cable · Cat6/);
  assert.match(image.svg, /Length: 3m/);
  assert.match(image.svg, /1 hops · Length: 3m/);
  assert.match(image.svg, /data-device-icon="shield"/);
  assert.match(image.svg, /data-device-icon="server"/);
  assert.doesNotMatch(image.svg, /(?:href|src)=/);
});

test("trace image embeds standalone light and dark palettes", () => {
  const devices = [
    device("source", { deviceType: "switch" }),
    device("target", { deviceType: "server" }),
  ];
  const ports = [
    port("source_port", "source", "eth0"),
    port("target_port", "target", "eth0"),
  ];
  const model = buildModel({
    devices,
    ports,
    links: [
      {
        id: "themed_trace",
        fromPortId: "source_port",
        toPortId: "target_port",
        cableLength: "1m",
      },
    ],
  });
  const result = tracePorts(model, "source_port", "target_port");
  assert.ok(result);

  const light = buildTraceImageSvg(model, result, labels, "light");
  const dark = buildTraceImageSvg(model, result, labels, "dark");

  assert.match(light.svg, /data-theme="light"/);
  assert.match(light.svg, /<rect width="640"[^>]+fill="#f8fafc"/);
  assert.match(light.svg, /fill="#ffffff" stroke="#94a3b8"/);
  assert.match(dark.svg, /data-theme="dark"/);
  assert.match(dark.svg, /<rect width="640"[^>]+fill="#070a0f"/);
  assert.match(dark.svg, /fill="#141d2c" stroke="#526071"/);
  assert.match(dark.svg, /fill="#edf2f7"/);
  assert.match(dark.svg, /stroke="#bdc7d2"/);
  assert.notEqual(light.svg, dark.svg);
  assert.doesNotMatch(light.svg, /var\(--/);
  assert.doesNotMatch(dark.svg, /var\(--/);
  assert.doesNotMatch(dark.svg, /(?:href|src)=/);
});

test("trace image icons inherit custom device parents and fall back safely", () => {
  const devices = [
    device("custom-firewall", { deviceType: "edge_security" }),
    device("custom-unknown", { deviceType: "special_appliance" }),
  ];
  const ports = [
    port("custom_firewall_port", "custom-firewall", "wan0"),
    port("custom_unknown_port", "custom-unknown", "eth0"),
  ];
  const model = buildModel({
    devices,
    ports,
    deviceTypes: [
      {
        id: "edge_security",
        label: "Edge security",
        parentType: "firewall",
        builtIn: false,
      },
      {
        id: "special_appliance",
        label: "Special appliance",
        builtIn: false,
      },
    ],
    links: [
      {
        id: "custom_icons",
        fromPortId: "custom_firewall_port",
        toPortId: "custom_unknown_port",
      },
    ],
  });
  const result = tracePorts(
    model,
    "custom_firewall_port",
    "custom_unknown_port",
  );
  assert.ok(result);

  const image = buildTraceImageSvg(model, result, labels, "light");
  assert.equal((image.svg.match(/data-device-icon="shield"/g) ?? []).length, 1);
  assert.equal((image.svg.match(/data-device-icon="boxes"/g) ?? []).length, 1);
  assert.match(image.svg, /^<svg[^>]+>/);
  assert.match(image.svg, /<\/svg>$/);
});

test("trace image uses server and storage icons for custom child types", () => {
  const devices = [
    device("custom-server", { deviceType: "mini_server" }),
    device("custom-storage", { deviceType: "disk_array" }),
  ];
  const ports = [
    port("custom_server_port", "custom-server", "eno1"),
    port("custom_storage_port", "custom-storage", "eth0"),
  ];
  const model = buildModel({
    devices,
    ports,
    deviceTypes: [
      {
        id: "mini_server",
        label: "Mini server",
        parentType: "server",
        builtIn: false,
      },
      {
        id: "disk_array",
        label: "Disk array",
        parentType: "storage",
        builtIn: false,
      },
    ],
    links: [
      {
        id: "custom_server_storage",
        fromPortId: "custom_server_port",
        toPortId: "custom_storage_port",
      },
    ],
  });
  const result = tracePorts(model, "custom_server_port", "custom_storage_port");
  assert.ok(result);

  const image = buildTraceImageSvg(model, result, labels, "light");
  assert.equal((image.svg.match(/data-device-icon="server"/g) ?? []).length, 1);
  assert.equal(
    (image.svg.match(/data-device-icon="storage"/g) ?? []).length,
    1,
  );
});

test("trace image groups a patch-panel pass-through into one device card", () => {
  const devices = [
    device("source", { hostname: "source-01" }),
    device("patch", {
      hostname: "pp-01",
      deviceType: "patch_panel",
      placement: "rack",
    }),
    device("target", { hostname: "target-01" }),
  ];
  const ports = [
    port("source_port", "source", "eth0"),
    port("patch_front", "patch", "Jack 01", { face: "front", position: 1 }),
    port("patch_rear", "patch", "  jack 01  ", {
      face: "rear",
      position: 99,
    }),
    port("target_port", "target", "eth0"),
  ];
  const model = buildModel({
    devices,
    ports,
    links: [
      {
        id: "source_patch",
        fromPortId: "source_port",
        toPortId: "patch_front",
        cableType: "Cat6",
        cableLength: "2m",
        color: "white",
      },
      {
        id: "patch_target",
        fromPortId: "patch_rear",
        toPortId: "target_port",
        cableType: "Cat6",
        cableLength: "5m",
        color: "black",
      },
    ],
  });
  const result = tracePorts(model, "source_port", "target_port");
  assert.ok(result);
  assert.deepEqual(
    result.segments.map((segment) => segment.kind),
    ["cable", "patch", "cable"],
  );

  const image = buildTraceImageSvg(model, result, labels, "light");
  assert.equal((image.svg.match(/>pp-01</g) ?? []).length, 1);
  assert.match(image.svg, /Jack 01 \(Front\)/);
  assert.match(image.svg, /jack 01\s+\(Rear\)/);
  assert.match(image.svg, /Internal pass-through/);
  assert.match(image.svg, /3 hops · Length: 7m/);
  assert.ok(image.height > 800);
});

test("trace image wraps long labels, supports RTL, and rejects unsafe colors", () => {
  const longHostname = `edge-${"very-long-hostname-".repeat(5)}01`;
  const devices = [
    device("long_source", { hostname: longHostname }),
    device("target", { hostname: "target-01" }),
  ];
  const ports = [
    port("source_port", "long_source", "ethernet/uplink/one"),
    port("target_port", "target", "eth0"),
  ];
  const model = buildModel({
    devices,
    ports,
    links: [
      {
        id: "unsafe_color",
        fromPortId: "source_port",
        toPortId: "target_port",
        color: "url(javascript:alert(1))",
      },
    ],
  });
  const result = tracePorts(model, "source_port", "target_port");
  assert.ok(result);

  const image = buildTraceImageSvg(
    model,
    result,
    {
      ...labels,
      direction: "rtl",
    },
    "light",
  );
  assert.match(image.svg, /direction="rtl"/);
  assert.match(image.svg, /direction="ltr" unicode-bidi="embed"/);
  assert.match(image.svg, /<text x="594"[^>]+text-anchor="start"/);
  assert.match(image.svg, /#0f766e/);
  assert.doesNotMatch(image.svg, /javascript/);
  assert.ok((image.svg.match(/<tspan/g) ?? []).length > 8);
});
