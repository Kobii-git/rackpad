import { externalHttp, basicAuthorization } from "../external-http.js";
import { ExternalProviderError, type ExternalReading } from "../external-health-types.js";
import { externalProvider, hostDevice, object, stableKey, text } from "./external-provider.js";
export const glancesIntegrationClient=externalProvider("glances","Glances",async(connection,context)=>{
  const headers:Record<string,string> = {Accept:"application/json"};
  if(connection.authKind==="username-password") headers.Authorization=basicAuthorization(connection.authId??"",connection.authSecret??"");
  else if(connection.authKind==="api-key")headers.Authorization=`Bearer ${connection.authSecret??""}`;
  else if(connection.authKind!=="anonymous")throw new ExternalProviderError("authentication");
  const http=externalHttp(connection,headers,context);
  // Deliberately avoid /all and process plugins, which may expose command-line secrets.
  const available=await http.json("/api/4/pluginslist");
  if(!Array.isArray(available) || available.length>200 || !available.every(value=>typeof value==="string"))throw new ExternalProviderError("incompatible");
  const system=object(await http.json("/api/4/system"));
  const hostname=text(system.hostname,120);
  if(!hostname)throw new ExternalProviderError("incompatible");
  const id="host:self",observedAt=new Date().toISOString();
  const warnings:string[]=[],readings:ExternalReading[]=[{providerRecordId:id,recordName:hostname,key:"source",label:"Glances API",value:"available",unit:null,health:"unknown",observedAt}];
  const add=(key:string,label:string,value:unknown,unit:string|null)=>{
    if(value==null){warnings.push("Optional Glances values are unavailable.");return;}
    if(typeof value!=="number" || !Number.isFinite(value) || (unit==="%" && (value<0 || value>100)) || ((unit==="B" || unit==="B/s") && value<0))throw new ExternalProviderError("invalid_response");
    readings.push({providerRecordId:id,recordName:hostname,key,label,value,unit,health:"unknown",observedAt});
  };
  for(const plugin of ["cpu","mem","fs","network","sensors"]){
    if(!available.includes(plugin)){warnings.push(`Optional Glances ${plugin} plugin is unavailable.`);continue;}
    let raw:unknown;
    try{raw=await http.json(`/api/4/${plugin}`);}catch(error){if(error instanceof ExternalProviderError && error.category==="incompatible"){warnings.push(`Optional Glances ${plugin} plugin is unavailable.`);continue;}throw error;}
    if(plugin==="cpu" || plugin==="mem") {const row=object(raw);add(`${plugin}.percent`,plugin==="cpu"?"CPU":"Memory",plugin==="cpu"?row.total:row.percent,"%");if(plugin==="mem"){add("mem.used","Memory used",row.used,"B");add("mem.total","Memory total",row.total,"B");}continue;}
    if(!Array.isArray(raw) || raw.length>1000)throw new ExternalProviderError("invalid_response");
    const identity = (row:Record<string,unknown>) => JSON.stringify([plugin === "fs" ? row.mnt_point : plugin === "network" ? row.interface_name : row.label,plugin === "sensors" ? row.type : null]);
    const counts = new Map<string,number>();
    for(const value of raw){const key=identity(object(value));counts.set(key,(counts.get(key)??0)+1);}
    for(const value of raw){const row=object(value);
      if(counts.get(identity(row))!==1){warnings.push(`Ambiguous Glances ${plugin} names were skipped.`);continue;}
      const name=text(plugin==="fs"?row.mnt_point:plugin==="network"?row.interface_name:row.label,2000);
      if(!name){warnings.push(`A Glances ${plugin} reading has no stable name and was skipped.`);continue;}
      const prefix=`${plugin}.${stableKey(name)}`;
      if(plugin==="fs")add(`${prefix}.percent`,`${name.slice(0,120)} usage`,row.percent,"%");
      else if(plugin==="network"){add(`${prefix}.rx`,`${name.slice(0,120)} receive`,row.bytes_recv_rate_per_sec,"B/s");add(`${prefix}.tx`,`${name.slice(0,120)} transmit`,row.bytes_sent_rate_per_sec,"B/s");}
      else {const type=text(row.type);add(`${prefix}.${stableKey(type??"sensor")}`,name.slice(0,160),row.value,typeof row.unit==="string"?text(row.unit,40):type==="temperature"?"°C":type==="fan_speed"?"RPM":null);}
    }
  }
  return {devices:[hostDevice(id,hostname,{model:text(system.hr_name),firmware:text(system.os_version)})],readings,warnings:[...new Set(warnings)]};
});
