import assert from "node:assert/strict";
import test from "node:test";
import {
  commitDriveBaySlotCount,
  deriveOverviewStorage,
  driveBayTemplateDisplayCopy,
  driveFormFactorLabel,
  driveInterfaceLabel,
  driveSecondaryLabel,
  generateDriveBaySection,
  inferDriveBaySlotPrefix,
  isPoolDriveEligible,
  poolColor,
  renameDriveBaySlots,
  resizeDriveBaySlots,
  serializeDriveBayTemplateSection,
  setDriveBaySlotType,
  storagePoolStatusLabel,
  summarizeStorage,
  uniformDriveBaySlotType,
} from "./storage";
import type {
  DriveBayTemplate,
  DriveBayTemplateSlot,
  DriveSlot,
  StorageDrive,
  StoragePool,
} from "./types";
import type { TranslationKey } from "@/i18n/translations";
import {
  localizedDeviceTypeIdLabel,
  localizedDeviceTypeLabel,
} from "./device-types";

const drive = (
  id: string,
  capacityGb: number,
  overrides: Partial<StorageDrive> = {},
): StorageDrive => ({
  id,
  labId: "lab-1",
  capacityGb,
  interface: "sas",
  formFactor: "3.5",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const slot = (id: string, driveId: string | null): DriveSlot => ({
  id,
  deviceId: "device-1",
  name: id,
  sectionName: "Front bays",
  sectionOrder: 0,
  position: Number(id.replace(/\D/g, "")) || 1,
  slotType: "3.5",
  face: "front",
  layout: "grid",
  columns: 4,
  driveId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const pool = (
  id: string,
  driveIds: string[],
  overrides: Partial<StoragePool> = {},
): StoragePool => ({
  id,
  deviceId: "device-1",
  labId: "lab-1",
  name: id,
  poolType: "raidz1",
  usableCapacityGb: 8000,
  status: "healthy",
  driveIds,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("storage summaries separate raw installed capacity from manual pool capacity", () => {
  const drives = [
    drive("drive-1", 6000, { slotId: "slot-1" }),
    drive("drive-2", 6000, { slotId: null, poolId: "pool-1" }),
    drive("drive-3", 2000, { slotId: null }),
  ];
  const result = summarizeStorage(
    drives,
    [slot("slot-1", "drive-1"), slot("slot-2", null)],
    [pool("pool-1", ["drive-1", "drive-2"])],
  );

  assert.equal(result.rawCapacityGb, 6000);
  assert.equal(result.usableCapacityGb, 8000);
  assert.equal(result.occupiedSlots, 1);
  assert.equal(result.unassignedDrives, 2);
  assert.deepEqual(result.missingPoolMemberIds, ["drive-2"]);
});

test("device summaries treat same-lab cross-device members as physically present", () => {
  const localDrive = drive("drive-local", 6000, {
    slotId: "slot-local",
    deviceId: "device-1",
  });
  const remoteDrive = drive("drive-remote", 8000, {
    slotId: "slot-remote",
    deviceId: "device-2",
  });
  const missingDrive = drive("drive-missing", 8000, {
    slotId: null,
    poolId: "pool-1",
  });
  const result = summarizeStorage(
    [localDrive],
    [slot("slot-local", localDrive.id)],
    [pool("pool-1", [localDrive.id, remoteDrive.id, missingDrive.id])],
    [localDrive, remoteDrive, missingDrive],
  );

  assert.equal(result.rawCapacityGb, 6000);
  assert.equal(result.occupiedSlots, 1);
  assert.deepEqual(result.missingPoolMemberIds, [missingDrive.id]);
});

test("overview storage prefers owned usable topology, then installed raw topology, then manual data", () => {
  const drives = [
    drive("drive-local", 600, {
      slotId: "slot-local",
      deviceId: "device-1",
    }),
    drive("drive-other", 900, {
      slotId: "slot-other",
      deviceId: "device-2",
    }),
  ];
  const manualStorageGb = 217;

  assert.deepEqual(
    deriveOverviewStorage(
      "device-1",
      manualStorageGb,
      drives,
      [
        pool("pool-owned-a", ["drive-local"], { usableCapacityGb: 450 }),
        pool("pool-owned-b", [], { usableCapacityGb: 25 }),
        pool("pool-other", ["drive-other"], {
          deviceId: "device-2",
          usableCapacityGb: 800,
        }),
      ],
    ),
    { capacityGb: 475, source: "usable-topology" },
  );
  assert.deepEqual(
    deriveOverviewStorage("device-1", manualStorageGb, drives, []),
    { capacityGb: 600, source: "raw-topology" },
  );
  assert.deepEqual(
    deriveOverviewStorage("device-1", manualStorageGb, [], []),
    { capacityGb: 217, source: "manual-imported" },
  );
  assert.equal(manualStorageGb, 217);
});

test("template generation is ordered and respects dense-grid limits", () => {
  const section = generateDriveBaySection({
    name: "Front",
    count: 24,
    columns: 12,
    slotType: "2.5",
    prefix: "Bay ",
  });
  assert.equal(section.columns, 12);
  assert.equal(section.slots.length, 24);
  assert.deepEqual(section.slots[23], {
    name: "Bay 24",
    position: 24,
    slotType: "2.5",
  });
});

test("template bulk helpers preserve custom slots until explicitly changed", () => {
  const customSlots: DriveBayTemplateSlot[] = [
    { name: "Boot A", position: 10, slotType: "m2" },
    { name: "Archive left", position: 20, slotType: "3.5" },
  ];

  assert.equal(inferDriveBaySlotPrefix(customSlots), null);
  assert.equal(uniformDriveBaySlotType(customSlots), null);

  assert.equal(
    commitDriveBaySlotCount(customSlots, "", {
      prefix: "Slot ",
      slotType: "3.5",
    }),
    null,
  );
  assert.deepEqual(
    commitDriveBaySlotCount(customSlots, "2", {
      prefix: "Slot ",
      slotType: "3.5",
    }),
    customSlots,
  );

  const grown = resizeDriveBaySlots(customSlots, 3, {
    prefix: "Slot ",
    slotType: "3.5",
  });
  assert.deepEqual(grown.slice(0, 2), customSlots);
  assert.deepEqual(grown[2], {
    name: "Slot 3",
    position: 21,
    slotType: "3.5",
  });
  assert.deepEqual(
    resizeDriveBaySlots(grown, 1, {
      prefix: "Slot ",
      slotType: "3.5",
    }),
    [customSlots[0]],
  );

  const renamed = renameDriveBaySlots(customSlots, "Bay ");
  assert.deepEqual(
    renamed.map(({ name, position }) => ({ name, position })),
    [
      { name: "Bay 1", position: 10 },
      { name: "Bay 2", position: 20 },
    ],
  );
  assert.deepEqual(
    setDriveBaySlotType(customSlots, "u2").map((entry) => entry.slotType),
    ["u2", "u2"],
  );

  const metadataOnly = serializeDriveBayTemplateSection({
    name: "Rear archive",
    face: "rear",
    layout: "list",
    columns: null,
    slots: customSlots,
  });
  assert.deepEqual(metadataOnly.slots, customSlots);
  assert.notEqual(metadataOnly.slots, customSlots);
});

test("storage display helpers localize built-ins and preserve custom copy", () => {
  const translations: Partial<Record<TranslationKey, string>> = {
    Healthy: "Sain",
    Front: "Avant",
    "Drive bays": "Baies de disques",
    "Storage enclosure": "Enceinte de stockage",
    Switch: "Commutateur",
    Other: "Autre",
    "4 × 3.5-inch bays": "Quatre baies 3,5 pouces",
    "Four front-facing 3.5-inch drive bays.": "Quatre baies frontales 3,5 pouces.",
    "8 × 3.5-inch bays": "Huit baies 3,5 pouces",
    "Eight front-facing 3.5-inch drive bays in two rows.": "Huit baies frontales 3,5 pouces sur deux rangées.",
    "12 × 3.5-inch bays": "Douze baies 3,5 pouces",
    "Twelve front-facing 3.5-inch drive bays in three rows.": "Douze baies frontales 3,5 pouces sur trois rangées.",
    "24 × 2.5-inch bays": "Vingt-quatre baies 2,5 pouces",
    "Twenty-four front-facing 2.5-inch drive bays in two rows.": "Vingt-quatre baies frontales 2,5 pouces sur deux rangées.",
    "2 × M.2 internal slots": "Deux emplacements M.2 internes",
    "Two internal M.2 storage slots.": "Deux emplacements de stockage M.2 internes.",
  };
  const t = (
    key: TranslationKey,
    values?: Record<string, string | number | null | undefined>,
  ) => {
    let result = translations[key] ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
      result = result.replace(`{${name}}`, String(value ?? ""));
    }
    return result;
  };
  const builtIns = [
    [
      "storage-4x3-5",
      "Quatre baies 3,5 pouces",
      "Quatre baies frontales 3,5 pouces.",
    ],
    [
      "storage-8x3-5",
      "Huit baies 3,5 pouces",
      "Huit baies frontales 3,5 pouces sur deux rangées.",
    ],
    [
      "storage-12x3-5",
      "Douze baies 3,5 pouces",
      "Douze baies frontales 3,5 pouces sur trois rangées.",
    ],
    [
      "storage-24x2-5",
      "Vingt-quatre baies 2,5 pouces",
      "Vingt-quatre baies frontales 2,5 pouces sur deux rangées.",
    ],
    [
      "storage-2xm2",
      "Deux emplacements M.2 internes",
      "Deux emplacements de stockage M.2 internes.",
    ],
  ] as const;
  for (const [id, name, description] of builtIns) {
    const builtIn: DriveBayTemplate = {
      id,
      name: "server copy",
      description: "server description",
      deviceTypes: ["server"],
      sections: [],
      builtIn: true,
    };
    assert.deepEqual(driveBayTemplateDisplayCopy(builtIn, t), {
      name,
      description,
    });
  }
  assert.equal(storagePoolStatusLabel("healthy", t), "Sain");
  assert.equal(driveInterfaceLabel("nvme", t), "NVME");
  assert.equal(driveInterfaceLabel("other", t), "Autre");
  assert.equal(driveFormFactorLabel("m2", t), "M.2");
  assert.equal(driveFormFactorLabel("other", t), "Autre");
  assert.equal(
    driveSecondaryLabel(
      drive("drive-other", 1000, { serial: "OTHER-1", interface: "other" }),
      t,
    ),
    "OTHER-1 · 1 TB · Autre",
  );
  assert.equal(
    localizedDeviceTypeLabel(
      {
        id: "storage_enclosure",
        label: "Storage enclosure",
        builtIn: true,
      },
      t,
    ),
    "Enceinte de stockage",
  );
  assert.equal(
    localizedDeviceTypeLabel(
      { id: "custom-shelf", label: "My literal shelf", builtIn: false },
      t,
    ),
    "My literal shelf",
  );
  assert.equal(
    localizedDeviceTypeIdLabel("storage_enclosure", [], t),
    "Enceinte de stockage",
  );
  assert.equal(localizedDeviceTypeIdLabel("switch", [], t), "Commutateur");
  assert.equal(
    localizedDeviceTypeIdLabel(
      "custom-shelf",
      [
        {
          id: "custom-shelf",
          label: "My literal shelf",
          builtIn: false,
        },
      ],
      t,
    ),
    "My literal shelf",
  );

  const custom: DriveBayTemplate = {
    id: "custom",
    name: "server copy",
    description: "server description",
    deviceTypes: ["server"],
    sections: [],
    builtIn: false,
  };
  assert.deepEqual(driveBayTemplateDisplayCopy(custom, t), {
    name: "server copy",
    description: "server description",
  });
});

test("pool eligibility and highlighting are deterministic", () => {
  assert.equal(
    isPoolDriveEligible(drive("drive-1", 1000, { slotId: "slot-1" })),
    true,
  );
  assert.equal(
    isPoolDriveEligible(
      drive("drive-2", 1000, { slotId: "slot-2", poolId: "pool-2" }),
      "pool-1",
    ),
    false,
  );
  assert.equal(
    isPoolDriveEligible(
      drive("drive-3", 1000, { slotId: "slot-3", poolId: "pool-1" }),
      "pool-1",
    ),
    true,
  );
  assert.equal(poolColor("pool-stable"), poolColor("pool-stable"));
  assert.match(poolColor("pool-stable"), /^#[0-9a-f]{6}$/i);
});
