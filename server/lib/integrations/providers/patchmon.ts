import { externalHttp, basicAuthorization } from "../external-http.js";
import { ExternalProviderError, type ExternalReading } from "../external-health-types.js";
import { externalProvider, hostDevice, object, text } from "./external-provider.js";
export const patchmonIntegrationClient=externalProvider("patchmon","PatchMon",async(connection,context)=>{
  const http=externalHttp(connection,{Accept:"application/json",Authorization:basicAuthorization(connection.authId??"",connection.authSecret??"")},context);
  // Scoped Integration API, host:get only. No enrolment, queue or mutation endpoints.
  const result=object(await http.json("/api/v1/api/hosts",{include:"stats"}));
  if(!Array.isArray(result.hosts) || result.hosts.length>1000 || (result.total!=null && (!Number.isInteger(result.total) || result.total!==result.hosts.length)) || result.next!=null || result.next_page!=null)throw new ExternalProviderError("incompatible","PatchMon must return the complete scoped host list with inline stats. Partial or paginated responses cannot be adopted safely.");
  const readings:ExternalReading[]=[],warnings:string[]=[];
  const devices=result.hosts.map(value=>{
    const row=object(value),rawId=text(row.id,160),name=text(row.hostname,120)??text(row.friendly_name,120);
    if(!rawId || !name)throw new ExternalProviderError("invalid_response");
    const id=`host:${rawId}`;
    const observed=typeof row.last_update==="string" && Number.isFinite(Date.parse(row.last_update))?new Date(row.last_update).toISOString():null;
    if(!observed)warnings.push("PatchMon host timestamps are unavailable; update health remains unknown.");
    readings.push({providerRecordId:id,recordName:name,key:"reporting_state",label:"Reporting state",value:text(row.reporting_state)??"unknown",unit:null,health:"unknown",observedAt:observed??new Date().toISOString()});
    const current=Boolean(observed && row.reporting_state === "reporting" && row.status === "active" && row.effective_status === "active");
    for(const [field,label] of [["updates_count","Package updates"],["security_updates_count","Security updates"],["total_packages","Installed packages"]] as const){
      const count=row[field];if(count==null){warnings.push("Optional PatchMon package summaries are unavailable. Check host:get and inline stats support.");continue;}
      if(!Number.isSafeInteger(count) || Number(count)<0)throw new ExternalProviderError("invalid_response");
      const health=current && field!=="total_packages"?(Number(count)>0?"degraded":"healthy"):"unknown";
      readings.push({providerRecordId:id,recordName:name,key:field,label,value:Number(count),unit:null,health,observedAt:observed??new Date().toISOString()});
    }
    if(typeof row.needs_reboot==="boolean")readings.push({providerRecordId:id,recordName:name,key:"needs_reboot",label:"Reboot pending",value:row.needs_reboot,unit:null,health:current?(row.needs_reboot?"degraded":"healthy"):"unknown",observedAt:observed??new Date().toISOString()});
    return hostDevice(id,name,{ipAddress:text(row.ip),model:text(row.os_type),firmware:text(row.os_version)});
  });
  return {devices,readings,warnings:[...new Set(warnings)]};
});
