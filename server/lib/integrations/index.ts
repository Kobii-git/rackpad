import {
  getIntegrationClient,
  registerIntegrationClient,
} from "./inventory.js";
import { opnsenseIntegrationClient } from "./providers/opnsense.js";
import { proxmoxIntegrationClient } from "./providers/proxmox.js";

registerIntegrationClient(opnsenseIntegrationClient);
registerIntegrationClient(proxmoxIntegrationClient);

export { getIntegrationClient };
