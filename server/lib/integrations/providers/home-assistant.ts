import { externalHttp } from "../external-http.js";
import { readHomeAssistantRegistries } from "../home-assistant-websocket.js";
import { ExternalProviderError,type ExternalHealth,type ExternalReading } from "../external-health-types.js";
import { externalProvider,hostDevice,object,stableKey,text } from "./external-provider.js";
export function homeAssistantHealth(state:string,domain:string,deviceClass:unknown):ExternalHealth {
  if(["unknown","unavailable","pending","maintenance"].includes(state))return "unknown";
  if(domain==="binary_sensor"){
    if(deviceClass==="connectivity")return state==="on"?"healthy":state==="off"?"unhealthy":"unknown";
    if(["problem","safety","smoke","gas","tamper","moisture"].includes(String(deviceClass)))return state==="on"?"unhealthy":state==="off"?"healthy":"unknown";
    if(deviceClass==="battery")return state==="on"?"degraded":state==="off"?"healthy":"unknown";
  }
  if(domain==="update")return state==="on"?"degraded":state==="off"?"healthy":"unknown";
  return "unknown";
}
function registryId(value:unknown){if(typeof value!=="string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value))throw new ExternalProviderError("invalid_response");return value;}
function entityIdentifier(value:unknown){if(typeof value!=="string" || value.length>255 || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(value))throw new ExternalProviderError("invalid_response");return value;}
export const homeAssistantIntegrationClient=externalProvider("home-assistant","Home Assistant",async(connection,context)=>{
  const deadline=Date.now()+15000;
  const http=externalHttp(connection,{Accept:"application/json",Authorization:`Bearer ${connection.authSecret??""}`},context);
  const raw=await http.json("/api/states");if(!Array.isArray(raw) || raw.length>10000)throw new ExternalProviderError("invalid_response");
  const registries=await readHomeAssistantRegistries(connection,context,deadline);
  const warnings:string[]=registries.available?[]:["Home Assistant registry grouping is unavailable for this account or endpoint. Entity-only inventory uses entity IDs; renaming an entity may require explicit rebinding."];
  const deviceRegistry=new Map<string,Record<string,unknown>>(),entityRegistry=new Map<string,Record<string,unknown>>();
  for(const row of registries.devices){const id=registryId(row.id);if(deviceRegistry.has(id))throw new ExternalProviderError("invalid_response");deviceRegistry.set(id,row);}
  const registryIds=new Set<string>();
  for(const row of registries.entities){const id=registryId(row.id),entityId=entityIdentifier(row.entity_id);if(entityRegistry.has(entityId) || registryIds.has(id))throw new ExternalProviderError("invalid_response");registryIds.add(id);entityRegistry.set(entityId,row);}
  const devices=new Map<string,ReturnType<typeof hostDevice>>(),readings:ExternalReading[]=[],seen=new Set<string>();
  for(const [deviceId,device] of deviceRegistry){
    const id=`device:${deviceId}`,name=text(device.name_by_user,120)??text(device.name,120)??deviceId;
    devices.set(id,hostDevice(id,name,{deviceType:"other",model:[text(device.manufacturer),text(device.model)].filter(Boolean).join(" ").slice(0,160)||null,serial:text(device.serial_number),firmware:text(device.sw_version)}));
  }
  for(const value of raw){
    const row=object(value),entityId=entityIdentifier(row.entity_id),state=row.state;
    if(typeof state!=="string" || state.length>1024 || seen.has(entityId))throw new ExternalProviderError("invalid_response");seen.add(entityId);
    const attributes=object(row.attributes??{}),registry=entityRegistry.get(entityId);
    const registeredDeviceId=registry?.device_id==null?null:registryId(registry.device_id),device=registeredDeviceId?deviceRegistry.get(registeredDeviceId):undefined;
    const entityName=text(attributes.friendly_name,120)??entityId.slice(0,120);
    const id=device?`device:${registeredDeviceId}`:`entity:${registry?String(registry.id):stableKey(entityId)}`;
    const name=device?(devices.get(id)?.name??entityName):entityName;
    if(registeredDeviceId && !device)warnings.push("Some Home Assistant entities lack accessible device registry records and are shown separately.");
    if(!devices.has(id))devices.set(id,hostDevice(id,name,{deviceType:"other",model:device?[text(device.manufacturer),text(device.model)].filter(Boolean).join(" ").slice(0,160)||null:null,serial:device?text(device.serial_number):null,firmware:device?text(device.sw_version):null}));
    const timestamp=row.last_reported??row.last_updated;
    if(timestamp!=null && (typeof timestamp!=="string" || !Number.isFinite(Date.parse(timestamp))))throw new ExternalProviderError("invalid_response");
    const observedAt=timestamp==null?new Date().toISOString():new Date(String(timestamp)).toISOString();
    let health=timestamp==null || registry?.disabled_by!=null || device?.disabled_by!=null?"unknown":homeAssistantHealth(state,entityId.split(".")[0],attributes.device_class);
    let normalized:ExternalReading["value"]=state;
    if(/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(state)){normalized=Number(state);if(!Number.isFinite(normalized))throw new ExternalProviderError("invalid_response");health="unknown";}
    // Registry IDs keep grouped reading keys stable across entity renames.
    const key=`entity.${stableKey(registry?String(registry.id):entityId)}`;
    readings.push({providerRecordId:id,recordName:name,key,label:entityName,value:normalized,unit:text(attributes.unit_of_measurement,40),health,observedAt});
  }
  for(const [entityId,registry] of entityRegistry)if(!seen.has(entityId)){
    const deviceId=registry.device_id==null?null:registryId(registry.device_id),device=deviceId?deviceRegistry.get(deviceId):undefined;
    const id=device?`device:${deviceId}`:`entity:${registry.id}`,entityName=text(registry.name,120)??text(registry.original_name,120)??entityId.slice(0,120);
    if(!devices.has(id))devices.set(id,hostDevice(id,entityName,{deviceType:"other"}));
    readings.push({providerRecordId:id,recordName:devices.get(id)!.name,key:`entity.${stableKey(String(registry.id))}`,label:entityName,value:"unavailable",unit:null,health:"unknown",observedAt:new Date().toISOString()});
  }
  const represented=new Set(readings.map(row=>row.providerRecordId));
  for(const [id,device] of devices)if(!represented.has(id))readings.push({providerRecordId:id,recordName:device.name,key:"registry.presence",label:"Registry presence",value:"registered",unit:null,health:"unknown",observedAt:new Date().toISOString()});
  return {devices:[...devices.values()],readings,warnings:[...new Set(warnings)]};
});
