import { createHash } from "node:crypto";
import type { IntegrationClient, IntegrationImportableDevice } from "../inventory.js";
import type { IntegrationProvider, IntegrationConnectionSecrets } from "../types.js";
import type { ExternalCollectionContext, ExternalHealthCollection } from "../external-health-types.js";
import { ExternalProviderError, validateExternalReadings } from "../external-health-types.js";
export interface ExternalSnapshot extends ExternalHealthCollection { devices: IntegrationImportableDevice[] }
export function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExternalProviderError("invalid_response");
  return value as Record<string,unknown>;
}
export function text(value:unknown,max=160):string|null {
  if(value==null)return null;
  if(typeof value!=="string" || value.length>2000 || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127))throw new ExternalProviderError("invalid_response");
  return value.trim().slice(0,max)||null;
}
export function stableKey(value:string) { return createHash("sha256").update(value).digest("hex").slice(0,24); }
export function hostDevice(id:string,name:string,extra:Partial<IntegrationImportableDevice>={}):IntegrationImportableDevice {
  return {providerRecordId:id,name,deviceType:"server",model:null,macAddress:null,ipAddress:null,serial:null,firmware:null,online:null,ports:[],...extra};
}
export function externalProvider(provider: IntegrationProvider, product:string, collect:(connection:IntegrationConnectionSecrets,context?:ExternalCollectionContext)=>Promise<ExternalSnapshot>):IntegrationClient {
  async function snapshot(connection:IntegrationConnectionSecrets, context?:ExternalCollectionContext) {
    const result=await collect(connection,context);validateExternalReadings(result.readings);
    if(result.devices.length>10000 || new Set(result.devices.map(device=>device.providerRecordId)).size!==result.devices.length)throw new ExternalProviderError("invalid_response");
    return result;
  }
  return {provider,fetchReadings:snapshot,
    async test(connection,context){const result=await snapshot(connection,context);return {product,version:null,summary:{devices:result.devices.length,externalWarnings:result.warnings.slice(0,100).map(value=>value.slice(0,300))}};},
    async fetchInventory(connection,context){const result=await snapshot(connection,context);return {
      collection:{vlans:[],subnets:[],dhcpScopes:[],warnings:[]},
      importableDevices:result.devices,
      devices:result.devices.map(row=>({name:row.name,kind:"other",model:row.model,macAddress:row.macAddress,ipAddress:row.ipAddress,status:null,detail:null})),warnings:result.warnings};}
  };
}
