import {
  getIntegrationClient,
  registerIntegrationClient,
} from "./inventory.js";
import { opnsenseIntegrationClient } from "./providers/opnsense.js";
import { proxmoxIntegrationClient } from "./providers/proxmox.js";
import { unifiIntegrationClient } from "./providers/unifi.js";

registerIntegrationClient(opnsenseIntegrationClient);
registerIntegrationClient(proxmoxIntegrationClient);
registerIntegrationClient(unifiIntegrationClient);

export { getIntegrationClient };
