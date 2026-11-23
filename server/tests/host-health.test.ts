import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {after,before,beforeEach,test} from "node:test";
import {glancesIntegrationClient} from "../lib/integrations/providers/glances.js";
import {patchmonIntegrationClient} from "../lib/integrations/providers/patchmon.js";
const directory=mkdtempSync(path.join(os.tmpdir(),"rackpad-host-health-"));
process.env.DATABASE_PATH=path.join(directory,"fixture.db");process.env.NODE_ENV="test";process.env.RACKPAD_SECRET_KEY="synthetic-host-health-key";
const {db}=await import("../db.js"),{createApp}=await import("../app.js");
const {setIntegrationHttpTransportForTests}=await import("../lib/integrations/http.js");
const {loadIntegrationConnectionSecrets}=await import("../lib/integrations/connections.js");
const {validateRackpadSqliteDatabase}=await import("../lib/native-backup-validation.js");
const app=await createApp();let headers:Record<string,string>;
const password="synthetic-host-health-password";
async function call(method:"GET"|"POST"|"PATCH",url:string,payload?:Record<string,unknown>,expected=200){const result=await app.inject({method,url,headers,payload});assert.equal(result.statusCode,expected,result.body);return result.json();}
let connectionSequence=0;
async function create(provider="glances",authKind="anonymous",extra:Record<string,unknown>={}){return call("POST","/api/integrations/connections",{labId:"lab",name:`${provider}-${connectionSequence+1}`,provider,authKind,baseUrl:`https://provider-${++connectionSequence}.example`,...extra},201);}
before(async()=>{const auth=await app.inject({method:"POST",url:"/api/auth/bootstrap",payload:{username:"admin",password,displayName:"Admin",loadDemoData:false}});assert.equal(auth.statusCode,201,auth.body);headers={authorization:`Bearer ${auth.json().token}`};});
beforeEach(async()=>{setIntegrationHttpTransportForTests(null);db.exec("DELETE FROM labs; INSERT INTO labs(id,name) VALUES('lab','Lab');");const auth=await app.inject({method:"POST",url:"/api/auth/login",payload:{username:"admin",password}});assert.equal(auth.statusCode,200,auth.body);headers={authorization:`Bearer ${auth.json().token}`};});
after(async()=>{await app.close();db.close();rmSync(directory,{recursive:true,force:true});});
function glancesTransport(hostname="original",expectedAuthorization?:string,plugins=["cpu","mem","fs","network","sensors"]){
 const calls:string[]=[];
 setIntegrationHttpTransportForTests(async request=>{
  assert.equal(request.headers?.Authorization,expectedAuthorization);assert.ok(!request.method || request.method==="GET");assert.equal(request.verifyTls,true);assert.ok(request.timeoutMs!>0 && request.timeoutMs!<=15000);
  const route=request.url.pathname;calls.push(route);
  const body:Record<string,unknown>={"/api/4/pluginslist":plugins,"/api/4/system":{hostname,hr_name:"Fixture Linux",os_version:"1"},"/api/4/cpu":{total:12.5},"/api/4/mem":{percent:33,used:100,total:300},"/api/4/fs":[{mnt_point:"/",percent:24}],"/api/4/network":[{interface_name:"eth0",bytes_recv_rate_per_sec:10,bytes_sent_rate_per_sec:20}],"/api/4/sensors":[{label:"CPU",type:"temperature_core",unit:"C",value:45}]};
  assert.ok(route in body,`Unexpected provider operation ${route}`);return {status:200,headers:{},bodyText:JSON.stringify(body[route])};
 });return calls;
}
test("Glances v4 authentication, read-only plugin selection and normalized latest values",async()=>{
 for(const [kind,authId,secret,expected] of [["anonymous",null,null,undefined],["username-password","reader","password",`Basic ${Buffer.from("reader:password").toString("base64")}`],["api-key",null,"jwt","Bearer jwt"]] as const){
 const connection=await create("glances",kind,{authId,authSecret:secret});const calls=glancesTransport("host",expected);
 const result=await glancesIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));
 assert.equal(result.readings.find(row=>row.key==="cpu.percent")?.value,12.5);assert.equal(result.readings.find(row=>row.label==="eth0 receive")?.unit,"B/s");assert.ok(result.readings.some(row=>row.label==="CPU" && row.unit==="C"));assert.equal(result.warnings.length,0);assert.ok(calls.every(route=>!route.includes("all")&&!route.includes("process")));
 }
});
test("Glances optional/ambiguous plugins warn without inventing readings",async()=>{
 const connection=await create();glancesTransport("host",undefined,["cpu"]);
 let result=await glancesIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));assert.equal(result.warnings.length,4);assert.equal(result.readings.length,2);
 await call("POST",`/api/integrations/connections/${connection.id}/refresh`,{});
 await call("POST",`/api/integrations/connections/${connection.id}/test`,{});
 assert.equal((await call("GET",`/api/integrations/connections/${connection.id}/readings`)).warnings.length,4);
 setIntegrationHttpTransportForTests(async request=>({status:200,headers:{},bodyText:JSON.stringify(request.url.pathname.endsWith("pluginslist")?["sensors"]:request.url.pathname.endsWith("system")?{hostname:"host"}:[{label:"CPU",type:"temperature_core",value:50},{label:"CPU",type:"temperature_core",value:60}])}));
 result=await glancesIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));assert.ok(result.warnings.some(value=>value.includes("Ambiguous")));assert.equal(result.readings.length,1);
});
test("Glances anonymous is explicit, clears both credentials and survives complete recovery",async()=>{
 const first=await create("glances","username-password",{authId:"reader",authSecret:"private-synthetic-password"});
 await call("PATCH",`/api/integrations/connections/${first.id}`,{authKind:"anonymous"});
 const row=db.prepare("SELECT authId,authSecretEnc FROM integrationConnections WHERE id=?").get(first.id);assert.deepEqual(row,{authId:null,authSecretEnc:null});
 const second=await create("glances","anonymous",{authId:"ignored-reader",authSecret:"ignored-secret"});assert.equal(second.hasSecret,false);assert.equal(second.authId,null);
 await create("patchmon","anonymous",{}).then(()=>assert.fail("Anonymous PatchMon must be rejected"),error=>assert.match(String(error),/400/));
 assert.ok(validateRackpadSqliteDatabase(db,"Fixture"));
 const snapshot=await call("GET","/api/admin/export");await call("POST","/api/admin/restore",snapshot);
 const login=await app.inject({method:"POST",url:"/api/auth/login",payload:{username:"admin",password}});headers={authorization:`Bearer ${login.json().token}`};assert.equal((await call("GET","/api/integrations/connections")).find((row:{id:string})=>row.id===first.id).hasSecret,false);
});
test("Glances adopt then rename retains binding, monitor identity and manual inventory",async()=>{
 const connection=await create();glancesTransport();
 let preview=await call("POST",`/api/integrations/connections/${connection.id}/inventory`,{});assert.equal(preview.deviceSync.devices[0].providerRecordId,"host:self");
 await call("POST",`/api/integrations/connections/${connection.id}/apply-devices`,{snapshotToken:preview.deviceSnapshotToken,selectedProviderRecordIds:["host:self"]});
 const created=db.prepare("SELECT id,hostname,status FROM devices WHERE labId='lab'").get() as {id:string;hostname:string;status:string};assert.equal(created.status,"unknown");
 await call("POST",`/api/integrations/connections/${connection.id}/refresh`,{});
 const bound=await call("GET",`/api/integrations/connections/${connection.id}/readings`);
 const monitored=await call("POST",`/api/integrations/connections/${connection.id}/external-monitors`,{bindingId:bound.bindings[0].id,readingKey:"cpu.percent",enabled:true});
 const monitorId=monitored.monitors[0].id;
 glancesTransport("renamed");preview=await call("POST",`/api/integrations/connections/${connection.id}/inventory`,{});assert.equal(preview.deviceSync.devices[0].action,"exists");assert.equal(preview.deviceSync.devices[0].existingId,created.id);
 const refreshed=await call("POST",`/api/integrations/connections/${connection.id}/refresh`,{});assert.equal(refreshed.monitors[0].id,monitorId);assert.equal(refreshed.bindings[0].deviceId,created.id);assert.equal((db.prepare("SELECT count(*) AS n FROM devices WHERE labId='lab'").get() as {n:number}).n,1);assert.equal((db.prepare("SELECT hostname FROM devices WHERE id=?").get(created.id) as {hostname:string}).hostname,"original");
});
function patchHost(extra:Record<string,unknown>={}){return {id:"stable-host",hostname:"patch-host",ip:"192.168.1.2",os_type:"Linux",os_version:"1",last_update:new Date().toISOString(),status:"active",effective_status:"active",reporting_state:"reporting",updates_count:3,security_updates_count:1,total_packages:30,needs_reboot:false,...extra};}
test("PatchMon scoped Basic GET host summaries preserve agent timestamps and never mutate",async()=>{
 const connection=await create("patchmon","key-secret",{authId:"token-key",authSecret:"token-secret"});const host=patchHost();
 setIntegrationHttpTransportForTests(async request=>{assert.equal(request.url.pathname,"/api/v1/api/hosts");assert.equal(request.url.searchParams.get("include"),"stats");assert.ok(!request.method || request.method==="GET");assert.equal(request.headers?.Authorization,`Basic ${Buffer.from("token-key:token-secret").toString("base64")}`);return {status:200,headers:{},bodyText:JSON.stringify({hosts:[host],total:1})};});
 const result=await patchmonIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));assert.equal(result.readings.find(row=>row.key==="security_updates_count")?.health,"degraded");assert.ok(result.readings.every(row=>row.observedAt===host.last_update));assert.equal((await patchmonIntegrationClient.fetchInventory(loadIntegrationConnectionSecrets(connection.id))).importableDevices?.[0].providerRecordId,"host:stable-host");
});
test("PatchMon stale/pending/missing reports stay unknown; partial and malformed payloads reject",async()=>{
 const connection=await create("patchmon","key-secret",{authId:"key",authSecret:"secret"});
 const payload=(body:unknown)=>setIntegrationHttpTransportForTests(async()=>({status:200,headers:{},bodyText:JSON.stringify(body)}));
 for(const extra of [{reporting_state:"stale"},{status:"pending"},{effective_status:"inactive"},{last_update:null},{reporting_state:undefined}]){payload({hosts:[patchHost(extra)],total:1});const result=await patchmonIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));assert.ok(result.readings.every(row=>row.health==="unknown"));}
 for(const body of [{hosts:[patchHost()],total:2},{hosts:[patchHost(),patchHost()],total:2},{hosts:[patchHost({security_updates_count:-1})],total:1},{hosts:"invalid"}]){payload(body);await assert.rejects(()=>patchmonIntegrationClient.fetchInventory(loadIntegrationConnectionSecrets(connection.id)));}
 payload({hosts:[{id:"sparse",hostname:"sparse"}],total:1});const result=await patchmonIntegrationClient.fetchReadings!(loadIntegrationConnectionSecrets(connection.id));assert.ok(result.warnings.length>0);assert.equal(result.readings.length,1);
});
test("host adapters reject authentication, rate limit, TLS, blocked targets and cancelled collections without leaking provider text",async()=>{
 const connection=await create();const secrets=loadIntegrationConnectionSecrets(connection.id);
 for(const [status,expected] of [[401,/authentication/i],[429,/rate/i],[404,/compatible/i]] as const){setIntegrationHttpTransportForTests(async()=>({status,headers:{},bodyText:"synthetic-private-response"}));await assert.rejects(()=>glancesIntegrationClient.test(secrets),expected);}
 for(const [message,expected] of [["certificate failed private-text",/TLS/],["reserved address private-text",/blocked/],["timed out private-text",/timed out|timeout/i]] as const){setIntegrationHttpTransportForTests(async()=>{throw new Error(message);});await assert.rejects(()=>glancesIntegrationClient.test(secrets),error=>error instanceof Error && expected.test(error.message) && !error.message.includes("private-text"));}
 glancesTransport();await assert.rejects(()=>glancesIntegrationClient.fetchInventory(secrets,{isCurrent:()=>false}),/configuration changed/i);
});
