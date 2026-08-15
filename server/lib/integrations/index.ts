import {
  getIntegrationClient,
  registerIntegrationClient,
} from "./inventory.js";
import { proxmoxIntegrationClient } from "./providers/proxmox.js";

registerIntegrationClient(proxmoxIntegrationClient);

export { getIntegrationClient };
