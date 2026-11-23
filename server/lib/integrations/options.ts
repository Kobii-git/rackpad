import { ValidationError } from "../validation.js";
export interface IntegrationConnectionOptions { allowUnencrypted?: boolean }
export function parseIntegrationOptions(value: unknown,provider: string):IntegrationConnectionOptions {
  if(value == null)return {};
  let options:unknown=value;
  if(typeof options==="string")try{options=JSON.parse(options);}catch{throw new ValidationError("Invalid integration options.",422);}
  if(!options || typeof options!=="object" || Array.isArray(options))throw new ValidationError("Invalid integration options.",422);
  const row=options as Record<string,unknown>;
  if(Object.keys(row).some(key=>key!=="allowUnencrypted" || provider!=="nut") || (row.allowUnencrypted!==undefined && typeof row.allowUnencrypted!=="boolean"))throw new ValidationError("Unsupported integration options.",422);
  return row.allowUnencrypted===undefined?{}:{allowUnencrypted:row.allowUnencrypted as boolean};
}
