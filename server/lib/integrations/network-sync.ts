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

  return preview;
}

export function applyIntegrationNetworkPreview(input: {
  preview: SnmpSyncPreview;
  allowDeletes?: boolean;
  actor: string;
}) {
  return applySnmpSyncPreview({
    preview: input.preview,
    allowDeletes: input.allowDeletes,
    actor: input.actor,
    audit: {
      entityType: "IntegrationSync",
      actionPrefix: "integration.sync",
      label: "Integration sync",
    },
  });
}
