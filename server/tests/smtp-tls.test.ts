import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { smtpTlsFixture } from "./helpers/smtp-tls-fixture.js";

// The child uses cwd's implementation, also allowing this fixture to check an unchanged baseline.
for (const scenario of [
  { mode: "implicit", trusted: true, authenticated: false, mismatch: false },
  { mode: "implicit", trusted: true, authenticated: true, mismatch: false },
  { mode: "starttls", trusted: true, authenticated: true, mismatch: false },
  { mode: "implicit", trusted: false, authenticated: false, mismatch: false },
  { mode: "implicit", trusted: true, authenticated: false, mismatch: true },
] as const) {
  test(
    `SMTP TLS ${JSON.stringify(scenario)}`,
    { timeout: 20000 },
    async (context) => {
      const smtp = await smtpTlsFixture(scenario.mode, scenario.mismatch);
      context.after(() => smtp.close());
      const directory = mkdtempSync(
        path.join(os.tmpdir(), "rackpad-smtp-child-"),
      );
      context.after(() => rmSync(directory, { recursive: true, force: true }));
      const script = `
      const {saveAlertSettings, sendTestAlert} = await import('./server/lib/alerts.ts');
      const {db} = await import('./server/db.ts');
      saveAlertSettings({enabled:true,smtpHost:'127.0.0.1',smtpPort:${smtp.port},smtpSecure:${scenario.mode === "implicit"},
        smtpUsername:${scenario.authenticated ? "'fixture-user'" : "null"},smtpPassword:${scenario.authenticated ? "'fixture-password'" : "null"},smtpFrom:'from@example.test',smtpTo:'to@example.test'});
      try { await sendTestAlert(); process.stdout.write(JSON.stringify({delivered:true})); }
      catch(error) { process.stdout.write(JSON.stringify({delivered:false,category:error.category ?? null})); }
      finally {db.close();}
    `;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: {
            ...process.env,
            DATABASE_PATH: path.join(directory, "fixture.db"),
            NODE_ENV: "test",
            NODE_EXTRA_CA_CERTS: scenario.trusted ? smtp.cert : "",
            NODE_TLS_REJECT_UNAUTHORIZED: "1",
          },
          timeout: 15000,
        },
      );
      const result = JSON.parse(stdout);
      const success = scenario.trusted && !scenario.mismatch;
      assert.equal(result.delivered, success);
      assert.equal(smtp.messages, success ? 1 : 0);
      if (scenario.mode === "starttls") assert.equal(smtp.upgrades, 1);
      // Old implementations have no classification; assertions for categories live in alerts.test.ts.
    },
  );
}
