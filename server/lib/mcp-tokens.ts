import { createHash, randomBytes } from "node:crypto";
import { db } from "../db.js";
import { getPublicUserById, type AuthUser } from "./auth.js";
import { canReadLab, canWriteLab, fetchUserLabAccess } from "./lab-access.js";
import { createId } from "./ids.js";
import { ValidationError } from "./validation.js";

export type McpCapability = "read" | "write";

export interface McpTokenAccess {
  id: string;
  owner: AuthUser;
  capability: McpCapability;
  labIds: string[];
}

interface McpTokenRow {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  capability: McpCapability;
  labIds: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const MAX_TOKEN_DAYS = 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function currentAllowedLabs(owner: AuthUser, capability: McpCapability) {
  const access = owner.role === "admin" ? [] : fetchUserLabAccess(owner.id);
  const labs = db.prepare("SELECT id FROM labs ORDER BY id").all() as Array<{ id: string }>;
  return labs.map(({ id }) => id).filter((id) =>
    capability === "write"
      ? canWriteLab(owner, id, access)
      : canReadLab(owner, id, access),
  );
}

export function createMcpToken(input: {
  owner: AuthUser;
  name: string;
  capability: McpCapability;
  labIds: string[];
  expiresInDays: number;
}) {
  const { owner, capability } = input;
  const name = input.name.trim();
  if (owner.disabled || !name || name.length > 120) {
    throw new ValidationError("A token name between 1 and 120 characters is required.");
  }
  if (capability !== "read" && capability !== "write") {
    throw new ValidationError("Invalid MCP token capability.");
  }
  if (capability === "write" && owner.role === "viewer") {
    throw new ValidationError("Viewers can only create read tokens.", 403);
  }
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > MAX_TOKEN_DAYS) {
    throw new ValidationError("MCP tokens must expire within 30 days.");
  }
  const labIds = [...new Set(input.labIds)];
  const allowedLabs = new Set(currentAllowedLabs(owner, capability));
  if (!labIds.length || labIds.length > 100 || labIds.some((id) => !allowedLabs.has(id))) {
    throw new ValidationError("Token labs must be a nonempty subset of accessible labs.", 403);
  }
  const token = `rpmcp_${randomBytes(32).toString("base64url")}`;
  const id = createId("mcp");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  db.prepare(`INSERT INTO mcpTokens
    (id, userId, name, tokenHash, capability, labIds, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, owner.id, name, hashToken(token), capability, JSON.stringify(labIds), createdAt, expiresAt);
  return { id, name, token, capability, labIds, createdAt, expiresAt };
}

export function listMcpTokens(ownerId: string) {
  return db.prepare(`SELECT id, name, capability, labIds, createdAt, expiresAt, revokedAt
    FROM mcpTokens WHERE userId = ? ORDER BY createdAt DESC`).all(ownerId)
    .map((row) => {
      const token = row as Pick<McpTokenRow, "id" | "name" | "capability" | "labIds" | "createdAt" | "expiresAt" | "revokedAt">;
      return { ...token, labIds: JSON.parse(token.labIds) as string[] };
    });
}

export function revokeMcpToken(ownerId: string, tokenId: string) {
  return db.prepare(`UPDATE mcpTokens SET revokedAt = ?
    WHERE id = ? AND userId = ? AND revokedAt IS NULL`)
    .run(new Date().toISOString(), tokenId, ownerId).changes > 0;
}

export function lookupMcpToken(rawToken: string): McpTokenAccess | null {
  if (!/^rpmcp_[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const row = db.prepare("SELECT * FROM mcpTokens WHERE tokenHash = ?")
    .get(hashToken(rawToken)) as McpTokenRow | undefined;
  if (!row || row.revokedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
  const owner = getPublicUserById(row.userId);
  if (!owner || owner.disabled) return null;
  if (row.capability === "write" && owner.role === "viewer") return null;
  const granted = new Set(currentAllowedLabs(owner, row.capability));
  const labIds = (JSON.parse(row.labIds) as string[]).filter((id) => granted.has(id));
  if (!labIds.length) return null;
  return { id: row.id, owner, capability: row.capability, labIds };
}

export function assertMcpLab(access: McpTokenAccess, labId: string, write = false) {
  if (!access.labIds.includes(labId) || (write && access.capability !== "write")) {
    throw new ValidationError("MCP token does not have access to this lab.", 403);
  }
}
