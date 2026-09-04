import type {
  FastifyInstance,
  FastifyRequest,
  HTTPMethods,
  RouteOptions,
} from "fastify";

export type RouteAuthorization =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "admin"; denialMessage: string }
  | { kind: "lab-read" }
  | { kind: "lab-write" }
  | { kind: "conditional"; reason: string };

export interface RouteAuthorizationInventoryEntry {
  method: string;
  url: string;
  authorization: RouteAuthorization;
}

const definitions = new Map<string, RouteAuthorization>();

function define(
  authorization: RouteAuthorization,
  routeKeys: readonly string[],
) {
  for (const routeKey of routeKeys) {
    if (definitions.has(routeKey)) {
      throw new Error(`Duplicate route authorization definition: ${routeKey}`);
    }
    definitions.set(routeKey, authorization);
  }
}

define({ kind: "public" }, [
  "GET /api/auth/oidc/callback",
  "GET /api/auth/oidc/start",
  "GET /api/auth/status",
  "GET /api/health",
  "GET /api/imports/hyperv-collector",
  "GET /api/imports/proxmox-collector",
  "POST /api/auth/bootstrap",
  "POST /api/auth/login",
  "POST /api/auth/oidc/session",
]);

define({ kind: "authenticated" }, [
  "GET /api/auth/me",
  "GET /api/device-types",
  "GET /api/integrations/providers",
  "GET /api/hardware-templates",
  "GET /api/ports/templates",
  "GET /api/snmp-sync/profiles",
  "GET /api/snmp-traps/status",
  "GET /api/storage/drive-bay-templates",
  "POST /api/auth/logout",
  "POST /api/imports/netbox-device-type/preview",
]);

define({ kind: "admin", denialMessage: "Administrator access required." }, [
  "DELETE /api/admin/native-backups/:name",
  "DELETE /api/integrations/schedules/:id",
  "DELETE /api/labs/:id",
  "DELETE /api/snmp-sync/schedules/:id",
  "DELETE /api/users/:id",
  "GET /api/admin/alert-settings",
  "GET /api/admin/export",
  "GET /api/admin/integrity",
  "GET /api/admin/native-backups",
  "GET /api/admin/native-backups/:name/download",
  "GET /api/admin/operations/status",
  "GET /api/admin/ui-settings",
  "GET /api/users",
  "PATCH /api/integrations/schedules/:id",
  "PATCH /api/labs/:id",
  "PATCH /api/snmp-sync/schedules/:id",
  "PATCH /api/users/:id",
  "POST /api/admin/alert-settings/test",
  "POST /api/admin/native-backups",
  "POST /api/admin/restore",
  "POST /api/integrations/connections/:id/apply",
  "POST /api/integrations/connections/:id/apply-devices",
  "POST /api/integrations/schedules",
  "POST /api/integrations/schedules/:id/run",
  "POST /api/labs",
  "POST /api/snmp-sync/apply",
  "POST /api/snmp-sync/schedules",
  "POST /api/users",
  "PUT /api/admin/alert-settings",
  "PUT /api/admin/native-backups/settings",
  "PUT /api/admin/ui-settings",
]);

define({ kind: "admin", denialMessage: "Administrator access is required." }, [
  "DELETE /api/device-types/:id",
  "DELETE /api/hardware-templates/:id",
  "DELETE /api/hardware-templates/defaults/:deviceType",
  "DELETE /api/ports/templates/:id",
  "DELETE /api/storage/drive-bay-templates/:id",
  "GET /api/device-types/usage",
  "PATCH /api/device-types/:id",
  "PATCH /api/hardware-templates/:id",
  "PATCH /api/ports/templates/:id",
  "PATCH /api/storage/drive-bay-templates/:id",
  "POST /api/device-types",
  "POST /api/hardware-templates",
  "POST /api/hardware-templates/:id/duplicate",
  "POST /api/ports/templates",
  "POST /api/storage/drive-bay-templates",
  "PUT /api/hardware-templates/defaults/:deviceType",
]);

define({ kind: "lab-read" }, [
  "GET /api/device-images",
  "GET /api/device-images/:id",
  "GET /api/device-monitors",
  "GET /api/device-services",
  "GET /api/device-services/:id",
  "GET /api/devices",
  "GET /api/devices/:id",
  "GET /api/dhcp-scopes",
  "GET /api/discovery",
  "GET /api/discovery/scan-jobs/:id",
  "GET /api/discovery/schedules",
  "GET /api/documentation",
  "GET /api/documentation/:id",
  "GET /api/documentation/links",
  "GET /api/imports/docker/sources",
  "GET /api/integrations/connections",
  "GET /api/integrations/schedules",
  "GET /api/ip-assignments",
  "GET /api/ip-assignments/:id",
  "GET /api/ip-zones",
  "GET /api/labs",
  "GET /api/labs/:id",
  "GET /api/port-links",
  "GET /api/port-links/:id",
  "GET /api/physical-layouts",
  "GET /api/physical-layouts/:deviceId",
  "GET /api/ports",
  "GET /api/ports/:id",
  "GET /api/racks",
  "GET /api/racks/:id",
  "GET /api/reference-images",
  "GET /api/reference-images/:id",
  "GET /api/rooms",
  "GET /api/rooms/:id",
  "GET /api/snmp-credentials",
  "GET /api/snmp-sync/schedules",
  "GET /api/snmp-traps/log",
  "GET /api/snmp-traps/sources",
  "GET /api/storage/drive-slots",
  "GET /api/storage/drives",
  "GET /api/storage/pools",
  "GET /api/subnets",
  "GET /api/subnets/:id",
  "GET /api/virtual-switches",
  "GET /api/virtual-switches/:id",
  "GET /api/vlans",
  "GET /api/vlans/:id",
  "GET /api/vlans/ranges",
  "GET /api/wifi/access-points",
  "GET /api/wifi/associations",
  "GET /api/wifi/controllers",
  "GET /api/wifi/radios",
  "GET /api/wifi/ssids",
  "POST /api/device-monitors/run",
]);

define({ kind: "lab-write" }, [
  "DELETE /api/device-images/:id",
  "DELETE /api/device-monitors/:id",
  "DELETE /api/device-services/:id",
  "DELETE /api/devices/:id",
  "DELETE /api/dhcp-scopes/:id",
  "DELETE /api/discovery/:id",
  "DELETE /api/discovery/schedules/:id",
  "DELETE /api/documentation/:id",
  "DELETE /api/documentation/:pageId/device-links/:deviceId",
  "DELETE /api/integrations/connections/:id",
  "DELETE /api/ip-assignments/:id",
  "DELETE /api/ip-zones/:id",
  "DELETE /api/port-aggregates/:id",
  "DELETE /api/port-links/:id",
  "DELETE /api/ports/:id",
  "DELETE /api/racks/:id",
  "DELETE /api/reference-images/:id",
  "DELETE /api/rooms/:id",
  "DELETE /api/snmp-credentials/:id",
  "DELETE /api/storage/drive-slots/:id",
  "DELETE /api/storage/drives/:id",
  "DELETE /api/storage/pools/:id",
  "DELETE /api/subnets/:id",
  "DELETE /api/virtual-switches/:id",
  "DELETE /api/vlans/:id",
  "DELETE /api/vlans/ranges/:id",
  "DELETE /api/wifi/associations/:clientDeviceId",
  "DELETE /api/wifi/controllers/:id",
  "DELETE /api/wifi/radios/:id",
  "DELETE /api/wifi/ssids/:id",
  "PATCH /api/device-images/:id",
  "PATCH /api/device-monitors/:id",
  "PATCH /api/device-services/:id",
  "PATCH /api/devices/:id",
  "PATCH /api/dhcp-scopes/:id",
  "PATCH /api/discovery/:id",
  "PATCH /api/discovery/schedules/:id",
  "PATCH /api/documentation/:id",
  "PATCH /api/imports/docker/sources/:id",
  "PATCH /api/integrations/connections/:id",
  "PATCH /api/ip-assignments/:id",
  "PATCH /api/ip-zones/:id",
  "PATCH /api/port-aggregates/:id",
  "PATCH /api/port-links/:id",
  "PATCH /api/ports/:id",
  "PATCH /api/racks/:id",
  "PATCH /api/reference-images/:id",
  "PATCH /api/rooms/:id",
  "PATCH /api/snmp-credentials/:id",
  "PATCH /api/snmp-traps/sources/:id",
  "PATCH /api/storage/drive-slots/:id",
  "PATCH /api/storage/drives/:id",
  "PATCH /api/storage/pools/:id",
  "PATCH /api/subnets/:id",
  "PATCH /api/virtual-switches/:id",
  "PATCH /api/vlans/:id",
  "PATCH /api/vlans/ranges/:id",
  "PATCH /api/wifi/controllers/:id",
  "PATCH /api/wifi/radios/:id",
  "PATCH /api/wifi/ssids/:id",
  "POST /api/device-images",
  "POST /api/device-monitors",
  "POST /api/device-monitors/:id/run",
  "POST /api/device-monitors/run/:deviceId",
  "POST /api/device-monitors/snmp/discover-interfaces",
  "POST /api/device-monitors/snmp/import-interfaces",
  "POST /api/device-services",
  "POST /api/devices",
  "POST /api/devices/bulk",
  "POST /api/dhcp-scopes",
  "POST /api/discovery/scan",
  "POST /api/discovery/schedules",
  "POST /api/discovery/schedules/:id/run",
  "POST /api/documentation",
  "POST /api/documentation/:pageId/device-links",
  "POST /api/imports/docker/import",
  "POST /api/imports/docker/preview",
  "POST /api/imports/docker/sync",
  "POST /api/integrations/connections",
  "POST /api/integrations/connections/:id/inventory",
  "POST /api/integrations/connections/:id/test",
  "POST /api/integrations/discover-scopes",
  "POST /api/ip-assignments",
  "POST /api/ip-zones",
  "POST /api/networks",
  "POST /api/port-aggregates",
  "POST /api/port-links",
  "POST /api/port-links/bulk",
  "POST /api/physical-layouts/bulk-apply",
  "POST /api/physical-layouts/bulk-preview",
  "POST /api/physical-layouts/:deviceId/apply",
  "POST /api/physical-layouts/:deviceId/preview",
  "POST /api/rack-studio/actions",
  "POST /api/ports",
  "POST /api/racks",
  "POST /api/reference-images",
  "POST /api/rooms",
  "POST /api/snmp-credentials",
  "POST /api/snmp-credentials/:id/test",
  "POST /api/snmp-sync/preview",
  "POST /api/storage/drive-slots",
  "POST /api/storage/drive-slots/apply-template",
  "POST /api/storage/drives",
  "POST /api/storage/drives/:id/duplicate",
  "POST /api/storage/pools",
  "POST /api/storage/pools/:id/replace-drive",
  "POST /api/subnets",
  "POST /api/virtual-switches",
  "POST /api/vlans",
  "POST /api/vlans/ranges",
  "POST /api/wifi/controllers",
  "POST /api/wifi/radios",
  "POST /api/wifi/ssids",
  "PUT /api/wifi/access-points/:deviceId",
  "PUT /api/wifi/associations/:clientDeviceId",
]);

define(
  {
    kind: "conditional",
    reason:
      "Audit access resolves the target entity before applying admin or lab permissions.",
  },
  ["GET /api/audit-log", "POST /api/audit-log"],
);
define(
  {
    kind: "conditional",
    reason:
      "NetBox template imports require global admin while device imports require target-lab write access.",
  },
  ["POST /api/imports/netbox-device-type/import"],
);

function routeKey(method: string, url: string) {
  const canonicalUrl = url.length > 1 ? url.replace(/\/$/, "") : url;
  return `${method.toUpperCase()} ${canonicalUrl}`;
}

function configuredAuthorization(
  method: HTTPMethods | HTTPMethods[],
  url: string,
) {
  const methods = Array.isArray(method) ? method : [method];
  for (const candidate of methods) {
    const normalized = candidate === "HEAD" ? "GET" : candidate;
    const authorization = definitions.get(routeKey(normalized, url));
    if (authorization) return authorization;
  }
  return null;
}

export function configureRouteAuthorization(app: FastifyInstance) {
  const usedDefinitions = new Set<string>();
  const inventory: RouteAuthorizationInventoryEntry[] = [];
  app.decorate("routeAuthorizationInventory", inventory);

  app.addHook("onRoute", (options: RouteOptions) => {
    if (!options.url.startsWith("/api/")) return;
    const methods = Array.isArray(options.method)
      ? options.method
      : [options.method];
    const authorization = configuredAuthorization(options.method, options.url);
    if (!authorization) {
      throw new Error(
        `API route is missing authorization metadata: ${methods.join(",")} ${options.url}`,
      );
    }
    options.config = { ...options.config, authorization };
    for (const method of methods) {
      const normalized = method === "HEAD" ? "GET" : method;
      usedDefinitions.add(routeKey(normalized, options.url));
      inventory.push({ method, url: options.url, authorization });
    }
  });

  app.addHook("onReady", async () => {
    const unused = [...definitions.keys()].filter(
      (key) => !usedDefinitions.has(key),
    );
    if (unused.length > 0) {
      throw new Error(
        `Authorization metadata references unregistered API routes:\n- ${unused.join("\n- ")}`,
      );
    }
    inventory.sort((a, b) =>
      `${a.method} ${a.url}`.localeCompare(`${b.method} ${b.url}`),
    );
  });
}

export function requestRouteAuthorization(req: FastifyRequest) {
  const authorization = req.routeOptions.config.authorization;
  if (!authorization) {
    throw new Error(
      `Matched API route has no authorization metadata: ${req.method} ${req.routeOptions.url ?? req.url}`,
    );
  }
  return authorization;
}
