import { externalHttp,basicAuthorization } from "../external-http.js";
import { ExternalProviderError,type ExternalHealth,type ExternalReading } from "../external-health-types.js";
import { externalProvider,hostDevice,object,stableKey,text } from "./external-provider.js";
export function redfishHealth(value:unknown):ExternalHealth {
  if(!value || typeof value!=="object" || Array.isArray(value))return "unknown";
  const row=value as Record<string,unknown>;
  if(row.State!=null && row.State!=="Enabled")return "unknown";
  const health=row.HealthRollup??row.Health;return health==="OK"?"healthy":health==="Warning"?"degraded":health==="Critical"?"unhealthy":"unknown";
}
export const redfishIntegrationClient=externalProvider("redfish","Redfish",async(connection,context)=>{
  const http=externalHttp(connection,{Accept:"application/json",Authorization:basicAuthorization(connection.authId??"",connection.authSecret??"")},context);
  const base=new URL(connection.baseUrl),prefix=base.pathname.replace(/\/+$/,"");
  const cache=new Map<string,Record<string,unknown>>(),warnings:string[]=[],readings:ExternalReading[]=[];
  let requests=0;
  function link(value:unknown){
    const raw=typeof value==="string"?value:object(value)["@odata.id"];
    if(typeof raw!=="string" || raw.length>2000 || raw.includes("\\"))throw new ExternalProviderError("invalid_response");
    const url=new URL(raw,new URL(`${prefix}/redfish/v1/`,base));
    if(url.origin!==base.origin || url.username || url.password || url.hash || /%(?:2e|2f|5c|25)/i.test(url.pathname))throw new ExternalProviderError("blocked_target");
    let path=url.pathname;if(prefix && path.startsWith(`${prefix}/`))path=path.slice(prefix.length);
    if(!/^\/redfish\/v1\/(?:Systems|Chassis|Managers)(?:\/[^/]+)*\/?$/.test(path))throw new ExternalProviderError("incompatible");
    return {path,query:Object.fromEntries(url.searchParams),identity:path+url.search};
  }
  async function get(target:ReturnType<typeof link>,optional=false){
    if(cache.has(target.identity))return cache.get(target.identity)!;
    if(++requests>200)throw new ExternalProviderError("incompatible","Redfish resource collection exceeds the bounded read limit. Use a smaller scoped service.");
    try {const row=object(await http.json(target.path,target.query));cache.set(target.identity,row);return row;}
    catch(error){if(optional && error instanceof ExternalProviderError && error.category==="incompatible"){warnings.push("An advertised Redfish resource is unavailable on this firmware.");return null;}throw error;}
  }
  async function members(value:unknown){
    let target=link(value);const paths:ReturnType<typeof link>[]=[],pages=new Set<string>();let expected:number|undefined;
    for(;;){
      if(pages.has(target.identity) || pages.size>=20)throw new ExternalProviderError("invalid_response");pages.add(target.identity);
      const row=await get(target,true);if(!row){if(pages.size>1)throw new ExternalProviderError("incompatible","An advertised Redfish continuation page is unavailable; partial inventory was not applied.");return paths;}
      if(!Array.isArray(row.Members) || row.Members.length>1000)throw new ExternalProviderError("invalid_response");
      if(row["Members@odata.count"]!=null){const count=row["Members@odata.count"];if(!Number.isInteger(count) || Number(count)<0 || Number(count)>1000 || (expected!==undefined && expected!==count))throw new ExternalProviderError("invalid_response");expected=Number(count);}
      for(const member of row.Members){const item=link(member);if(paths.some(path=>path.identity===item.identity) || paths.length>=1000)throw new ExternalProviderError("invalid_response");paths.push(item);}
      if(row["Members@odata.nextLink"]==null)break;target=link(row["Members@odata.nextLink"]);
    }
    if(expected!==undefined && expected!==paths.length)throw new ExternalProviderError("invalid_response");return paths;
  }
  const root=object(await http.json("/redfish/v1/"));
  const devices:ReturnType<typeof hostDevice>[]=[];const identities=new Set<string>();
  for(const bucket of ["Systems","Chassis","Managers"]){
    if(root[bucket]==null){warnings.push(`Redfish ${bucket} is unavailable on this service or firmware.`);continue;}
    for(const target of await members(root[bucket])){
      if(identities.has(target.path))throw new ExternalProviderError("invalid_response");identities.add(target.path);
      const row=await get(target,true);if(!row)continue;
      const id=`resource:${target.path}`;if(id.length>200)throw new ExternalProviderError("invalid_response");
      const name=text(row.Name,120)??text(row.Id,120)??target.path.slice(-120),observedAt=new Date().toISOString();
      const firmware=text(row.FirmwareVersion)??text(row.BiosVersion);
      devices.push(hostDevice(id,name,{deviceType:bucket==="Systems"?"server":"other",serial:text(row.SerialNumber),model:[text(row.Manufacturer),text(row.Model)].filter(Boolean).join(" ").slice(0,160)||null,firmware}));
      readings.push({providerRecordId:id,recordName:name,key:"health",label:"Health",value:text(object(row.Status??{}).HealthRollup)??text(object(row.Status??{}).Health)??"unknown",unit:null,health:redfishHealth(row.Status),observedAt});
      if(firmware)readings.push({providerRecordId:id,recordName:name,key:"firmware",label:"Firmware",value:firmware,unit:null,health:"unknown",observedAt});
      const sampleTime=(value:unknown,fallback=observedAt)=>{
        if(value==null)return fallback;
        if(typeof value!=="string" || !Number.isFinite(Date.parse(value)))throw new ExternalProviderError("invalid_response");
        return new Date(value).toISOString();
      };
      const seen=new Set<string>();
      const add=(key:string,label:string,value:unknown,unit:string|null,health:ExternalHealth="unknown",time=observedAt)=>{
        if(value==null)return;
        if(typeof value!=="number" || !Number.isFinite(value))throw new ExternalProviderError("invalid_response");
        readings.push({providerRecordId:id,recordName:name,key,label:label.slice(0,160),value,unit,health,observedAt:time});
      };
      async function metrics(resource:Record<string,unknown>,path:string,depth:number,unitHint?:string){
        if(depth>4)throw new ExternalProviderError("invalid_response");
        const time=sampleTime(resource.ReadingTime);
        const suffix=stableKey(path),label=text(resource.Name,100)??name;
        for(const [field,unit] of [["PowerConsumedWatts","W"],["PowerInputWatts","W"],["PowerOutputWatts","W"],["LineInputVoltage","V"],["ReadingCelsius","°C"]] as const)add(`${suffix}.${field}`,`${label} ${field}`,resource[field],unit,"unknown",time);
        if(resource.Reading!=null)add(`${suffix}.Reading`,label,resource.Reading,text(resource.ReadingUnits,40)??unitHint??null,redfishHealth(resource.Status),time);
        for(const [field,unit] of [["PowerWatts","W"],["TemperatureCelsius","°C"],["FanSpeedPercent","%"],["InputPowerWatts","W"],["OutputPowerWatts","W"],["InputVoltage","V"],["OutputVoltage","V"],["SpeedRPM","RPM"]] as const)if(resource[field]!=null){const value=resource[field];if(typeof value === "number")add(`${suffix}.${field}`,`${label} ${field}`,value,unit,"unknown",time);else {const excerpt=object(value);add(`${suffix}.${field}`,`${label} ${field}`,excerpt.Reading,unit,"unknown",sampleTime(excerpt.ReadingTime,time));}}
        for(const field of ["PowerControl","PowerSupplies","Temperatures","Fans","TemperatureReadingsCelsius","FanSpeedsPercent","RailPowerWatts","RailVoltage","RailCurrentAmps"]){
          const values=resource[field];if(!Array.isArray(values))continue;if(values.length>1000)throw new ExternalProviderError("invalid_response");
          const keys=new Set<string>();
          for(const value of values){const item=object(value),identity=text(String(item.MemberId??item.SensorNumber??item["@odata.id"]??item.DataSourceUri??item.Name??""),200);
            if(!identity){warnings.push("Redfish readings without unique stable identifiers were skipped.");continue;}if(keys.has(identity))throw new ExternalProviderError("invalid_response");keys.add(identity);
            await metrics(item,`${path}/${field}/${identity}`,depth+1,field==="TemperatureReadingsCelsius"?"°C":field==="FanSpeedsPercent"?"%":field==="RailPowerWatts"?"W":field==="RailVoltage"?"V":field==="RailCurrentAmps"?"A":undefined);
          }
        }
        for(const field of ["Power","Thermal","PowerSubsystem","ThermalSubsystem","EnvironmentMetrics","ThermalMetrics","Metrics","PowerSupplies","Fans"]){
          const reference=resource[field];if(!reference || typeof reference!=="object" || Array.isArray(reference) || !("@odata.id" in reference))continue;
          const next=link(reference);if(seen.has(next.identity))continue;seen.add(next.identity);
          const child=await get(next,true);if(!child)continue;
          if(child.Members!=null){for(const member of await members(reference)){const detail=await get(member,true);if(detail)await metrics(detail,member.path,depth+1);}}
          else await metrics(child,next.path,depth+1);
        }
      }
      await metrics(row,target.path,0);
      if(bucket==="Chassis" && !row.Power && !row.Thermal && !row.PowerSubsystem && !row.ThermalSubsystem && !row.EnvironmentMetrics)warnings.push("Redfish power and thermal resources are unavailable on this chassis or firmware.");
    }
  }
  if(!root.Systems && !root.Chassis && !root.Managers)throw new ExternalProviderError("incompatible","Redfish service exposes none of Systems, Chassis or Managers. Check firmware and account capabilities.");
  return {devices,readings,warnings:[...new Set(warnings)]};
});
