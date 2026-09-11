import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
// Only start-e2e's freshly owned temporary database can be used by this fixture.
const file = process.env.DATABASE_PATH ?? "";
assert.equal(path.basename(file), "test.db");
assert.match(path.basename(path.dirname(file)), /^rackpad-e2e-/);
assert.equal(
  realpathSync(path.dirname(path.dirname(file))),
  realpathSync(os.tmpdir()),
);
const { db } = await import("../../server/db.js");
try {
  // Reconstruct schema 50 exactly as the migration suite does, before creating
  // any stack data. The application under test must actually run migration 51.
  db.exec(`
    DROP TRIGGER cable_guide_device_delete;
    DROP TRIGGER cable_guide_device_room;
    DROP TRIGGER cable_guide_rack_room;
    ALTER TABLE portLinks DROP COLUMN routeMode;
    ALTER TABLE portLinks DROP COLUMN routeGuides;
    DROP TRIGGER ports_stack_owner_insert;
    DROP TRIGGER ports_stack_owner_update;
    DROP TRIGGER stack_member_device_immutable;
    DROP TRIGGER stack_device_delete;
    DROP TRIGGER stack_type_guard;
    DROP TRIGGER stack_height_guard;
    DROP INDEX idx_ports_stack_member;
    ALTER TABLE ports DROP COLUMN stackMemberId;
    DROP TABLE deviceStackMemberMacs;
    DROP TABLE deviceStackMembers;
    UPDATE schemaVersion SET version = 50;
  `);
  const sections = [
    {
      name: "Existing bays",
      face: "front",
      layout: "grid",
      columns: 2,
      slots: [
        {
          name: "Existing bay 1",
          slotType: "3.5",
          position: 1,
          row: 1,
          column: 1,
        },
        {
          name: "Existing bay 2",
          slotType: "3.5",
          position: 2,
          row: 1,
          column: 2,
        },
      ],
    },
  ];
  db.prepare(
    "INSERT INTO driveBayTemplates (id,name,description,deviceTypes,sections,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)",
  ).run(
    "storage-upgrade-template",
    "Pre-upgrade storage",
    "Preserved schema-50 template",
    JSON.stringify(["storage"]),
    JSON.stringify(sections),
    "2026-01-01",
    "2026-01-01",
  );
  assert.equal(
    (
      db.prepare("SELECT version FROM schemaVersion").get() as {
        version: number;
      }
    ).version,
    50,
  );
} finally {
  db.close();
}
