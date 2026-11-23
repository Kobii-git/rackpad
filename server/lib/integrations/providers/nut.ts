import { readNutUps } from "../nut-transport.js";
import { ExternalProviderError, type ExternalHealth, type ExternalReading } from "../external-health-types.js";
import { externalProvider, hostDevice, text } from "./external-provider.js";
export function nutStatusHealth(value:string|undefined):ExternalHealth {
  if(!value)return "unknown";const flags=new Set(value.trim().split(/\s+/));
  if([...flags].some(flag=>!["OL","OB","LB","HB","RB","CHRG","DISCHRG","BYPASS","CAL","OFF","OVER","TRIM","BOOST","FSD","ALARM","TEST"].includes(flag)) || flags.has("CAL") || flags.has("TEST"))return "unknown";
  if(["LB","RB","OFF","OVER","FSD","ALARM"].some(flag=>flags.has(flag)))return "unhealthy";
  if(["OB","BYPASS","TRIM","BOOST"].some(flag=>flags.has(flag)))return "degraded";
  return flags.has("OL")?"healthy":"unknown";
}
export const nutIntegrationClient=externalProvider("nut","Network UPS Tools",async(connection,context)=>{
  const records=await readNutUps(connection,context),readings:ExternalReading[]=[],warnings:string[]=[];
  const observedAt=new Date().toISOString();
  const devices=records.map(record=>{
    const id=`ups:${record.name}`,name=text(record.description,120)??record.name;
    const health=record.unavailable?"unknown":nutStatusHealth(record.variables.get("ups.status"));
    readings.push({providerRecordId:id,recordName:name,key:"ups.status",label:"UPS status",value:record.unavailable?"unavailable":record.variables.get("ups.status")??"unknown",unit:null,health,observedAt});
    if(record.unavailable)warnings.push("NUT reports unavailable or stale UPS data. Inventory is retained and readings remain unknown.");
    for(const [key,label,unit] of [["battery.charge","Battery charge","%"],["battery.runtime","Battery runtime","s"],["ups.load","UPS load","%"],["input.voltage","Input voltage","V"],["output.voltage","Output voltage","V"],["input.frequency","Input frequency","Hz"],["battery.voltage","Battery voltage","V"],["ups.realpower","UPS real power","W"]] as const){
      const raw=record.variables.get(key);if(raw===undefined)continue;
      if(!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(raw) || !Number.isFinite(Number(raw)))throw new ExternalProviderError("invalid_response");
      readings.push({providerRecordId:id,recordName:name,key,label,value:Number(raw),unit,health:"unknown",observedAt});
    }
    return hostDevice(id,name,{deviceType:"ups",model:text(record.variables.get("ups.model")),serial:text(record.variables.get("ups.serial")),firmware:text(record.variables.get("ups.firmware"))});
  });
  return {devices,readings,warnings:[...new Set(warnings)]};
});
