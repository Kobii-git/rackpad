#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(
  readFileSync(path.join(dist, ".vite", "manifest.json"), "utf8"),
);
const entry = Object.values(manifest).find((item) => item.isEntry);
if (!entry) throw new Error("Vite manifest does not contain an entry chunk.");

const files = new Set();
function visit(item) {
  if (!item || files.has(item.file)) return;
  files.add(item.file);
  for (const imported of item.imports ?? []) visit(manifest[imported]);
}
visit(entry);

let gzipBytes = 0;
for (const file of files) {
  gzipBytes += gzipSync(readFileSync(path.join(dist, file))).byteLength;
}
const limitBytes = 300 * 1024;
if (gzipBytes > limitBytes) {
  throw new Error(
    `Initial JavaScript is ${(gzipBytes / 1024).toFixed(1)} KB gzip; budget is 300 KB.`,
  );
}

const eagerLocales = [...files].filter((file) =>
  /assets\/(?:af|ar|bn|de|es|fa|fr|he|hi|id|it|ja|ko|nl|pl|pt|ru|th|tr|uk|vi|zh)(?:-|_)/.test(file),
);
if (eagerLocales.length > 0) {
  throw new Error(`Non-English locales are eagerly loaded: ${eagerLocales.join(", ")}`);
}

console.log(`Initial JavaScript: ${(gzipBytes / 1024).toFixed(1)} KB gzip (300 KB budget).`);
