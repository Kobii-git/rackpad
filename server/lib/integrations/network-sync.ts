import { db } from "../../db.js";
import { createId } from "../ids.js";
import { applySnmpSyncPreview, buildSnmpSyncPreview } from "../snmp-sync.js";
import type {
  SnmpProfileCollection,
  SnmpSyncPolicy,
  SnmpSyncPreview,
} from "../snmp-profiles/types.js";
import type { IntegrationConnectionSecrets } from "./types.js";

export function integrationSyncProfileId(provider: string) {
  return `integration-${provider}`;
}

// Reuses the SNMP sync engine so integration pulls follow the exact same
// merge/mirror semantics, delete protections, and IPAM safety rules. The
// connection id stands in for the engine's deviceId.
export function buildIntegrationNetworkPreview(input: {
  connection: IntegrationConnectionSecrets;
  collection: SnmpProfileCollection;
  policy: SnmpSyncPolicy;
}): SnmpSyncPreview {
  const filtered: SnmpProfileCollection = {
    vlans: input.connection.syncVlans ? input.collection.vlans : [],
    subnets: input.connection.syncSubnets ? input.collection.subnets : [],
    dhcpScopes: input.connection.syncDhcp ? input.collection.dhcpScopes : [],
  };

  const preview = buildSnmpSyncPreview({
    profileId: integrationSyncProfileId(input.connection.provider),
    deviceId: input.connection.id,
    labId: input.connection.labId,
    target: input.connection.baseUrl,
    policy: input.policy,
    collection: filtered,
  });

  // A disabled pull option means this connection does not manage that
  // object type at all — under mirror an empty source list must not read
  // as "delete everything in the destination", so unmanaged types drop
  // out of the diff entirely.
  if (!input.connection.syncVlans) {
    preview.vlans = [];
    preview.summary.vlanCreates = 0;
    preview.summary.vlanUpdates = 0;
    preview.summary.vlanDeletes = 0;
  }
  if (!input.connection.syncSubnets) {
    preview.subnets = [];
    preview.summary.subnetCreates = 0;
    preview.summary.subnetUpdates = 0;
    preview.summary.subnetDeletes = 0;
  }

  preview.warnings = preview.warnings.map((warning) =>
    warning.startsWith("SNMP walk returned no VLAN or subnet inventory")
      ? "The controller returned no VLAN or subnet inventory for the enabled sync options."
      : warning,
  );

  const skipped: string[] = [];
  if (!input.connection.syncVlans && input.collection.vlans.length > 0) {
    skipped.push(`${input.collection.vlans.length} VLAN(s)`);
  }
  if (!input.connection.syncSubnets && input.collection.subnets.length > 0) {
    skipped.push(`${input.collection.subnets.length} subnet(s)`);
  }
  if (!input.connection.syncDhcp && input.collection.dhcpScopes.length > 0) {
    skipped.push(`${input.collection.dhcpScopes.length} DHCP scope(s)`);
  }
  if (skipped.length > 0) {
    preview.warnings.push(
      `Sync options on this connection skipped ${skipped.join(", ")} reported by the controller.`,
    );
  }

  // When a controller reports a VLAN id for a subnet Rackpad already has
  // without a VLAN link, offer the association even under merge policy.
  // The VLAN may already exist in the lab or be created by this preview.
  if (input.policy === "merge") {
    const previewVlanNumbers = new Set(
      preview.vlans.map((entry) => entry.vlanNumber),
    );
    for (const diff of preview.subnets) {
      if (
        diff.action !== "unchanged" ||
        !diff.existingId ||
        diff.vlanNumber == null
      ) {
        continue;
      }
      const existing = db
        .prepare("SELECT vlanId FROM subnets WHERE id = ?")
        .get(diff.existingId) as { vlanId: string | null } | undefined;
      if (!existing || existing.vlanId != null) continue;
      const vlanKnown =
        previewVlanNumbers.has(diff.vlanNumber) ||
        Boolean(
          db
            .prepare("SELECT id FROM vlans WHERE labId = ? AND vlanId = ?")
            .get(input.connection.labId, diff.vlanNumber),
        );
      if (!vlanKnown) continue;
      diff.action = "update";
      diff.linkOnly = true;
      diff.changes = [`vlan: none -> ${diff.vlanNumber}`];
    }
  }

  return preview;
}

// Merge-policy applies skip update rows in the engine, so link-only VLAN
// associations are applied here: set the subnet's VLAN when it is still
// unlinked, never touching names or other fields.
function applyLinkOnlySubnetUpdates(
  preview: SnmpSyncPreview,
  actor: string,
): string[] {
  const linked: string[] = [];
  if (preview.policy !== "merge") return linked;
  for (const diff of preview.subnets) {
    if (!diff.linkOnly || !diff.existingId || diff.vlanNumber == null) continue;
    const vlan = db
      .prepare("SELECT id FROM vlans WHERE labId = ? AND vlanId = ?")
      .get(preview.labId, diff.vlanNumber) as { id: string } | undefined;
    if (!vlan) continue;
    const result = db
      .prepare("UPDATE subnets SET vlanId = ? WHERE id = ? AND vlanId IS NULL")
      .run(vlan.id, diff.existingId);
    if (result.changes > 0) {
      linked.push(diff.existingId);
      db.prepare(
        `
        INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
        VALUES (?, ?, ?, 'integration.sync.subnet.link', 'IntegrationSync', ?, ?)
      `,
      ).run(
        createId("a"),
        new Date().toISOString(),
        actor,
        diff.existingId,
        `Linked subnet ${diff.cidr} to VLAN ${diff.vlanNumber}.`,
      );
    }
  }
  return linked;
}

export function applyIntegrationNetworkPreview(input: {
  preview: SnmpSyncPreview;
  allowDeletes?: boolean;
  actor: string;
}) {
  const result = applySnmpSyncPreview({
    preview: input.preview,
    allowDeletes: input.allowDeletes,
    actor: input.actor,
    audit: {
      entityType: "IntegrationSync",
      actionPrefix: "integration.sync",
      label: "Integration sync",
    },
  });
  result.updatedSubnetIds.push(
    ...applyLinkOnlySubnetUpdates(input.preview, input.actor),
  );
  return result;
}
