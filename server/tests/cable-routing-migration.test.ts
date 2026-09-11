import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { validateRackpadSqliteDatabase } from "../lib/native-backup-validation.js";

test("schema 51 upgrades routing metadata, validates native backups, and cleans guides transactionally", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rackpad-routing-migration-"));
  const file = path.join(dir, "fixture.db");
  const migrate = () =>
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const { db } = await import('./server/db.ts'); db.close();",
      ],
      {
        env: {
          ...process.env,
          DATABASE_PATH: file,
          NODE_ENV: "test",
          RACKPAD_SECRET_KEY: "synthetic-routing-test-key",
        },
        stdio: "pipe",
      },
    );
  try {
    migrate();
    const legacy = new Database(file);
    legacy.pragma("foreign_keys=ON");
    legacy.exec(`DROP TRIGGER cable_guide_device_delete; DROP TRIGGER cable_guide_device_room; DROP TRIGGER cable_guide_rack_room;
      ALTER TABLE portLinks DROP COLUMN routeMode; ALTER TABLE portLinks DROP COLUMN routeGuides; UPDATE schemaVersion SET version=51;
      INSERT INTO labs(id,name) VALUES ('test','Test');
      INSERT INTO rooms(id,labId,name) VALUES ('room','test','Room');
      INSERT INTO devices(id,labId,roomId,hostname,deviceType) VALUES ('a','test','room','a','server'),('b','test','room','b','server'),('guide','test','room','Brush','blanking_panel');
      INSERT INTO ports(id,deviceId,name,position,kind) VALUES ('p1','a','NIC1',1,'rj45'),('p2','b','NIC2',1,'rj45'),('p3','a','NIC3',2,'rj45'),('p4','b','NIC4',2,'rj45');
      INSERT INTO portLinks(id,fromPortId,toPortId,routeWaypoints) VALUES ('auto','p1','p2','[]'),('manual','p3','p4','[{"id":"w","roomId":"room","face":"rear","x":80,"y":150}]');`);
    assert.equal(validateRackpadSqliteDatabase(legacy, "Legacy fixture"), 51);
    const links = legacy
      .prepare("SELECT * FROM portLinks ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    legacy.close();
    migrate();
    migrate();
    const db = new Database(file);
    db.pragma("foreign_keys=ON");
    try {
      assert.equal(validateRackpadSqliteDatabase(db, "Upgraded fixture"), 52);
      assert.deepEqual(
        db
          .prepare(
            "SELECT id, routeMode, routeGuides FROM portLinks ORDER BY id",
          )
          .all(),
        [
          { id: "auto", routeMode: "auto", routeGuides: "[]" },
          { id: "manual", routeMode: "manual", routeGuides: "[]" },
        ],
      );
      for (const before of links) {
        const after = db
          .prepare("SELECT * FROM portLinks WHERE id=?")
          .get(before.id) as Record<string, unknown>;
        for (const [key, value] of Object.entries(before))
          assert.deepEqual(after[key], value);
      }
      const guides = [
        {
          id: "g",
          deviceId: "guide",
          roomId: "room",
          entryFace: "front",
          exitFace: "rear",
          x: 400,
          y: 500,
        },
      ];
      db.prepare(
        "UPDATE portLinks SET routeMode='managed', routeGuides=? WHERE id='auto'",
      ).run(JSON.stringify(guides));
      assert.equal(validateRackpadSqliteDatabase(db, "Guided fixture"), 52);
      db.prepare("UPDATE portLinks SET routeGuides=? WHERE id='auto'").run(
        JSON.stringify([{ ...guides[0], deviceId: "missing" }]),
      );
      assert.throws(
        () => validateRackpadSqliteDatabase(db, "Invalid guide fixture"),
        /guide/i,
      );
      db.prepare("UPDATE portLinks SET routeGuides=? WHERE id='auto'").run(
        JSON.stringify(guides),
      );
      assert.throws(
        () =>
          db.transaction(() => {
            db.prepare("DELETE FROM devices WHERE id='guide'").run();
            throw new Error("rollback");
          })(),
        /rollback/,
      );
      assert.deepEqual(
        JSON.parse(
          (
            db
              .prepare("SELECT routeGuides FROM portLinks WHERE id='auto'")
              .get() as { routeGuides: string }
          ).routeGuides,
        ),
        guides,
      );
      db.prepare("DELETE FROM devices WHERE id='guide'").run();
      assert.equal(
        (
          db
            .prepare("SELECT routeGuides FROM portLinks WHERE id='auto'")
            .get() as { routeGuides: string }
        ).routeGuides,
        "[]",
      );
      assert.equal(
        (
          db.prepare("SELECT COUNT(*) AS count FROM portLinks").get() as {
            count: number;
          }
        ).count,
        2,
      );
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
