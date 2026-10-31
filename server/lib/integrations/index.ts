import { redfishIntegrationClient } from "./providers/redfish.js";
import { nutIntegrationClient } from "./providers/nut.js";
import { glancesIntegrationClient } from "./providers/glances.js";
import { patchmonIntegrationClient } from "./providers/patchmon.js";
import { uptimeKumaIntegrationClient } from "./providers/uptime-kuma.js";
import {
  getIntegrationClient,
  registerIntegrationClient,
} from "./inventory.js";
import { dockhandIntegrationClient } from "./providers/dockhand.js";
import { omadaIntegrationClient } from "./providers/omada.js";
import { opnsenseIntegrationClient } from "./providers/opnsense.js";
import { proxmoxIntegrationClient } from "./providers/proxmox.js";
import { unifiIntegrationClient } from "./providers/unifi.js";

registerIntegrationClient(uptimeKumaIntegrationClient);
registerIntegrationClient(glancesIntegrationClient);
registerIntegrationClient(nutIntegrationClient);
registerIntegrationClient(redfishIntegrationClient);
registerIntegrationClient(patchmonIntegrationClient);
registerIntegrationClient(dockhandIntegrationClient);
registerIntegrationClient(omadaIntegrationClient);
registerIntegrationClient(opnsenseIntegrationClient);
registerIntegrationClient(proxmoxIntegrationClient);
registerIntegrationClient(unifiIntegrationClient);

export { getIntegrationClient };
