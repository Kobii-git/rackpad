import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { bech32m } from "@scure/base";
import { ValidationError } from "./validation.js";

export type ReferenceKind = "device" | "cable";
const prefixes = { device: "rpd", cable: "rpc" } as const;

export function encodePublicReference(
  kind: ReferenceKind,
  payload: Uint8Array,
) {
  if (payload.length !== 10)
    throw new Error("References require 80 random bits.");
  return bech32m.encode(prefixes[kind], bech32m.toWords(payload));
}
export function createPublicReference(kind: ReferenceKind) {
  return encodePublicReference(kind, randomBytes(10));
}
export function parsePublicReference(
  input: unknown,
  kind?: ReferenceKind,
): string {
  if (
    typeof input !== "string" ||
    !/^[A-Za-z0-9-]+$/.test(input) ||
    (input !== input.toLowerCase() && input !== input.toUpperCase())
  ) {
    throw new ValidationError(
      "Invalid reference: use one ASCII letter case and the complete checksum.",
    );
  }
  const lower = input.toLowerCase();
  const canonical =
    /^(rpd|rpc)1-[a-z0-9]{4}(?:-[a-z0-9]{4}){4}-[a-z0-9]{2}$/.test(lower)
      ? lower.replaceAll("-", "")
      : lower;
  if (!/^(rpd|rpc)1[a-z0-9]{22}$/.test(canonical))
    throw new ValidationError("Invalid reference format.");
  try {
    const decoded = bech32m.decode(canonical as `${string}1${string}`);
    if (
      bech32m.fromWords(decoded.words).length !== 10 ||
      (kind && decoded.prefix !== prefixes[kind])
    )
      throw new Error("Wrong reference type.");
  } catch {
    throw new ValidationError("Invalid reference type or checksum.");
  }
  return canonical;
}

export function validatePublicReferenceRows(
  rows: Record<string, unknown>[],
  kind: ReferenceKind,
) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.publicReference == null) continue;
    let reference: string;
    try {
      reference = parsePublicReference(row.publicReference, kind);
    } catch {
      throw new ValidationError(
        "Backup contains an invalid public reference.",
        422,
      );
    }
    if (reference !== row.publicReference || seen.has(reference))
      throw new ValidationError(
        "Backup contains a noncanonical or duplicate public reference.",
        422,
      );
    seen.add(reference);
  }
}

/** Runs inside the caller's audited transaction. Tables are code-controlled. */
export function assignPublicReference(
  database: Database.Database,
  kind: ReferenceKind,
  id: string,
  generate = createPublicReference,
) {
  const table = kind === "device" ? "devices" : "portLinks";
  const existing = database
    .prepare(`SELECT publicReference FROM ${table} WHERE id=?`)
    .get(id) as { publicReference: string | null } | undefined;
  if (!existing) throw new ValidationError("Not found.", 404);
  if (existing.publicReference)
    return { publicReference: existing.publicReference, assigned: false };
  for (let attempt = 0; attempt < 8; attempt++) {
    const publicReference = generate(kind);
    if (
      database
        .prepare(`SELECT 1 FROM ${table} WHERE publicReference=?`)
        .get(publicReference)
    )
      continue;
    database
      .prepare(`UPDATE ${table} SET publicReference=? WHERE id=?`)
      .run(publicReference, id);
    return { publicReference, assigned: true };
  }
  throw new ValidationError("Reference generation failed. Try again.", 503);
}
