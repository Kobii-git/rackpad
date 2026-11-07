import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const staticRequire = createRequire(require.resolve("@fastify/static"));
const globRequire = createRequire(staticRequire.resolve("glob"));
const { glob } = globRequire("glob");
const consumers = [
  ["static glob", globRequire],
  ...["eslint", "@eslint/config-array", "@typescript-eslint/typescript-estree"].map(
    (name) => [name, createRequire(require.resolve(name))],
  ),
];

// Resolve through each consumer so a nested vulnerable copy cannot be hidden by
// a patched top-level package. Small caps exercise GHSA-g3hv-75wg-m249 safely.
for (const [name, consumerRequire] of consumers) {
  const { Minimatch, minimatch } = consumerRequire("minimatch");

  test(`${name}: rejects globstar-parent expansion beyond the configured bound`, () => {
    for (const pattern of [
      "a/**/../".repeat(8) + "target",
      "x/**/../y/**/../".repeat(4) + "target",
    ]) {
      assert.throws(
        () => new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 32 }),
        RangeError,
      );
    }
  });

  test(`${name}: preserves file selection, ignores, roots and partial traversal`, () => {
    const cases = [
      ["src/App.tsx", "**/*.{ts,tsx}", {}, true],
      ["server/app.ts", "**/*.{ts,tsx}", {}, true],
      ["src/app.js", "**/*.{ts,tsx}", {}, false],
      ["scripts/check.mjs", "**/*.{js,mjs,cjs}", {}, true],
      ["server/fixtures/sample.ts", "**/fixtures/**", {}, true],
      ["server/routes/app.ts", "**/fixtures/**", {}, false],
      ["src/.hidden.ts", "**/*.ts", { dot: true }, true],
      ["src/.hidden.ts", "**/*.ts", {}, false],
      ["src/app.ts", "!**/*.ts", { flipNegate: true }, true],
      ["C:/src/app.ts", "C:/**/*.ts", { platform: "win32" }, true],
      ["D:/src/app.ts", "C:/**/*.ts", { platform: "win32" }, false],
      ["//host/share/app.ts", "//host/share/**/*.ts", { platform: "win32" }, true],
    ];
    for (const [file, pattern, options, expected] of cases) {
      assert.equal(minimatch(file, pattern, options), expected, `${file}: ${pattern}`);
    }
    const matcher = new Minimatch("src/**/*.{ts,tsx}", { dot: true });
    assert.equal(matcher.match("src", true), true);
    assert.equal(matcher.match("src/pages", true), true);
    assert.equal(matcher.match("server", true), false);
    // Parent traversal is still accepted below the expansion limit.
    assert.doesNotThrow(
      () => new Minimatch("a/**/../target", {
        optimizationLevel: 2,
        braceExpandMax: 32,
      }),
    );
  });
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "rackpad-dependency-globs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "server"));
  await writeFile(path.join(root, "src/App.tsx"), "export {};");
  await writeFile(path.join(root, "server/app.ts"), "export {};");
  await writeFile(path.join(root, "src/ignored.js"), "export {};");
  async function tree(parent, depth) {
    if (depth === 0) return;
    for (let i = 0; i < 4; i += 1) {
      const child = path.join(parent, `dir-${i}`);
      await mkdir(child);
      await tree(child, depth - 1);
    }
  }
  await tree(root, 3);
  return root;
}

test("static glob: selects ordinary assets", async (t) => {
  const cwd = await fixture(t);
  assert.deepEqual(
    (await glob("**/*.{ts,tsx}", { cwd })).sort(),
    ["server/app.ts", "src/App.tsx"],
  );
});

// GHSA-3g3m-2fjr-6pw4: rejection must also stop traversal. Cancel with a
// completed directory read and while a read is pending to cover both lifecycles.
for (const mode of ["completed read", "pending read timeout"]) {
  test(`static glob: stops directory reads after cancellation (${mode})`, async (t) => {
    const cwd = await fixture(t);
    const controller = new AbortController();
    const reason = new Error(`synthetic cancellation: ${mode}`);
    let reads = 0;
    let pending = 0;
    const instrumentedFs = {
      ...fs,
      readdir(directory, options, callback) {
        reads += 1;
        pending += 1;
        if (reads === 1 && mode === "pending read timeout") {
          setTimeout(() => controller.abort(reason), 1);
        }
        fs.readdir(directory, options, (error, entries) => {
          const finish = () => {
            pending -= 1;
            if (mode === "completed read" && !controller.signal.aborted) {
              controller.abort(reason);
            }
            callback(error, entries);
          };
          if (mode === "pending read timeout") setTimeout(finish, 10);
          else finish();
        });
      },
    };
    await assert.rejects(
      glob("**/*", { cwd, fs: instrumentedFs, signal: controller.signal }),
      (error) => error === reason,
    );
    const readsAtRejection = reads;
    assert.ok(readsAtRejection > 0, "cancellation must interrupt actual traversal");
    // Let outstanding callbacks and any incorrectly continuing traversal drain.
    await delay(150);
    assert.equal(pending, 0, "fixture directory reads must finish");
    assert.equal(reads, readsAtRejection, "traversal continued after rejection");
  });
}

test("TypeScript project service: preserves allowDefaultProject matching and validation", () => {
  const parser = require("@typescript-eslint/parser");
  function parse(allowDefaultProject) {
    try {
      return parser.parseForESLint("export const probe: number = 1;", {
        filePath: path.join(process.cwd(), "dependency-probe.ts"),
        tsconfigRootDir: process.cwd(),
        projectService: { allowDefaultProject },
      });
    } finally {
      parser.clearCaches();
    }
  }
  assert.ok(parse(["dependency-probe.ts"]).services.program);
  assert.throws(() => parse(["other-probe.ts"]), /not found by the project service/);
  assert.throws(() => parse(["**/*.ts"]), /disallowed '\*\*'/);
  assert.throws(() => parse(["*"]), /overly wide '\*'/);
});
