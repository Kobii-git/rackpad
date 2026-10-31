import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { ExternalReading } from "../lib/integrations/external-health-types.js";
import { parseKumaMetrics, uptimeKumaIntegrationClient } from "../lib/integrations/providers/uptime-kuma.js";
const directory = mkdtempSync(path.join(os.tmpdir(),"rackpad-external-"));
process.env.DATABASE_PATH = path.join(directory,"fixture.db");
process.env.NODE_ENV = "test";
process.env.RACKPAD_SECRET_KEY = "synthetic-external-health-key";
const {db} = await import("../db.js");
const {createApp} = await import("../app.js");
const {storeExternalReadings,externalMonitorResult,requireFreshExternalReadings,listExternalReadings} = await import("../lib/integrations/external-health.js");
const {refreshExternalHealth,runExternalHealthPollingTick} = await import("../lib/integrations/external-health-polling.js");
const {setIntegrationClientOverrideForTests} = await import("../lib/integrations/inventory.js");
const {setIntegrationHttpTransportForTests} = await import("../lib/integrations/http.js");
const {loadIntegrationConnectionSecrets} = await import("../lib/integrations/connections.js");
const {runMonitorCheck} = await import("../lib/monitoring.js");
const {validateRackpadSqliteDatabase} = await import("../lib/native-backup-validation.js");
const app = await createApp();
let headers: Record<string,string>;
const password = "synthetic-external-password";
async function request(method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",url:string,payload?:Record<string,unknown>,auth=headers) {
 return app.inject({method,url,headers:auth,payload});
}
async function health(method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",suffix:string,payload?:Record<string,unknown>,expected=200,auth=headers) {
 const result = await request(method,`/api/integrations/connections/c/${suffix}`,payload,auth);assert.equal(result.statusCode,expected,result.body);return result.json();
}
function sample(health:ExternalReading["health"]="healthy",observedAt=new Date().toISOString()):ExternalReading { return {providerRecordId:"1",recordName:"Service",key:"status",label:"Status",value:health,unit:null,health,observedAt}; }
async function mapped(enabled=true) {
 storeExternalReadings("c",[sample()]);
 const view = await health("GET","readings");
 const bound = await health("POST","bindings",{providerRecordId:"1",deviceId:"d",sourceIdentity:view.sourceIdentity});
 const next = await health("POST","external-monitors",{bindingId:bound.bindings[0].id,readingKey:"status",enabled});
 return next.monitors[0].id as string;
}
before(async () => {
 const auth=await request("POST","/api/auth/bootstrap",{username:"admin",password,displayName:"Admin",loadDemoData:false},{});assert.equal(auth.statusCode,201,auth.body);headers={authorization:`Bearer ${auth.json().token}`};
});
beforeEach(async () => {
 requireFreshExternalReadings();setIntegrationClientOverrideForTests("uptime-kuma",null);setIntegrationHttpTransportForTests(null);
 db.exec("DELETE FROM labs; DELETE FROM auditLog; DELETE FROM users WHERE username!='admin'; INSERT INTO labs(id,name) VALUES('a','A'),('b','B'); INSERT INTO devices(id,labId,hostname,deviceType) VALUES('d','a','Manual','server'),('other','a','Other','server'),('foreign','b','Foreign','server'); INSERT INTO integrationConnections(id,labId,provider,name,baseUrl,authKind,createdAt,updatedAt) VALUES('c','a','uptime-kuma','Kuma','https://kuma.example','api-key','2026-10-30T00:00:00Z','2026-10-30T00:00:00Z');");
 const login=await request("POST","/api/auth/login",{username:"admin",password},{});assert.equal(login.statusCode,200,login.body);headers={authorization:`Bearer ${login.json().token}`};
});
after(async () => {await app.close();db.close();rmSync(directory,{recursive:true,force:true});});

test("Kuma stable identifiers, metric values, pending/maintenance and malformed payloads",()=>{
 const rows=parseKumaMetrics('monitor_status{monitor_id="12",monitor_name="UPS"} 2\nmonitor_cert_is_valid{monitor_id="12",monitor_name="UPS"} 0\nmonitor_response_time{monitor_id="12"} 1.25');
 assert.equal(rows.length,3);assert.equal(rows[0].value,"pending");assert.ok(rows.every(row=>row.health==="unknown"));assert.equal(rows[2].unit,"ms");
 for(const body of ['monitor_status{monitor_name="unstable"} 1','monitor_status{monitor_id="1"} 7','monitor_status{monitor_id="1"} 0x1','monitor_status{monitor_id="1"} 1\nmonitor_status{monitor_id="1"} 0','not metrics']) assert.throws(()=>parseKumaMetrics(body));
 assert.equal(parseKumaMetrics('monitor_status{monitor_id="1"} 3')[0].health,"unknown");
});

test("Kuma authentication uses only GET metrics and returns actionable compatibility/rate/auth errors",async()=>{
 const saved=await request("PATCH","/api/integrations/connections/c",{authSecret:"synthetic-key"});assert.equal(saved.statusCode,200,saved.body);
 const secrets=loadIntegrationConnectionSecrets("c");let calls=0;
 setIntegrationHttpTransportForTests(async input=>{calls++;assert.equal(input.url.pathname,"/metrics");assert.ok(!input.method || input.method==="GET");assert.equal(input.headers?.Authorization,`Basic ${Buffer.from(":synthetic-key").toString("base64")}`);return {status:200,headers:{},bodyText:'monitor_status{monitor_id="1",monitor_name="Service"} 1'};});
 assert.equal((await uptimeKumaIntegrationClient.fetchInventory(secrets)).importableDevices?.[0].providerRecordId,"monitor:1");assert.equal(calls,1);
 for(const [status,category] of [[401,"authentication"],[429,"rate_limited"],[404,"incompatible"]] as const){setIntegrationHttpTransportForTests(async()=>({status,headers:{},bodyText:"private-provider-response"}));await assert.rejects(()=>uptimeKumaIntegrationClient.test(secrets),new RegExp(category==="authentication"?"authentication":category==="rate_limited"?"rate": "compatible","i"));}
});

test("readings are independent, polling defaults off, monitor/degraded alerts require explicit opt-in",async()=>{
 storeExternalReadings("c",[sample("unhealthy")]);
 assert.equal((db.prepare("SELECT status FROM devices WHERE id='d'").get() as {status:string}).status,"unknown");
 const view=await health("GET","readings");assert.equal(view.pollingEnabled,false);assert.equal(view.intervalSeconds,60);
 await health("PUT","health-polling",{enabled:true,intervalSeconds:59},400);
 const id=await mapped(false);assert.equal(externalMonitorResult(id).result,"unknown");
 await health("PATCH",`external-monitors/${id}`,{enabled:true});
 storeExternalReadings("c",[sample("degraded")]);assert.equal(externalMonitorResult(id).result,"online");
 await health("PATCH",`external-monitors/${id}`,{alertOnDegraded:true});assert.equal(externalMonitorResult(id).result,"offline");
 assert.equal((await health("GET","readings")).readings[0].health,"degraded");
});

test("stale, missing, failure and older samples never become false outages",async()=>{
 const id=await mapped();const latest=new Date().toISOString();storeExternalReadings("c",[sample("healthy",latest)]);
 storeExternalReadings("c",[sample("unhealthy",new Date(Date.now()-10000).toISOString())]);assert.equal(externalMonitorResult(id).result,"online");
 db.prepare("UPDATE integrationLatestReadings SET observedAt=?").run(new Date(Date.now()-301000).toISOString());assert.equal(externalMonitorResult(id).result,"unknown");assert.equal(listExternalReadings("c")[0].health,"unknown");
 storeExternalReadings("c",[sample()]);storeExternalReadings("c",[]);assert.equal(externalMonitorResult(id).result,"unknown");assert.equal((await health("GET","readings")).readings[0].collectionError,"missing");
 storeExternalReadings("c",[sample()]);requireFreshExternalReadings();assert.equal(externalMonitorResult(id).result,"unknown");
});

test("explicit binding preimages, cross-lab denial, redaction and monitor deletion clear health",async()=>{
 const id=await mapped();storeExternalReadings("c",[sample("unhealthy")]);await runMonitorCheck(id);
 assert.equal((db.prepare("SELECT status FROM devices WHERE id='d'").get() as {status:string}).status,"offline");
 db.prepare("UPDATE deviceMonitors SET snmpCommunityEnc='synthetic-ciphertext' WHERE id=?").run(id);
 const view=await health("GET","readings");assert.ok(!JSON.stringify(view).includes("synthetic-ciphertext"));assert.equal(view.monitors[0].enabled,true);
 await health("POST","bindings",{providerRecordId:"1",deviceId:"foreign",sourceIdentity:view.sourceIdentity},422);
 await health("POST","bindings",{providerRecordId:"1",deviceId:"other",sourceIdentity:view.sourceIdentity},409);
 const deleted=await request("DELETE",`/api/device-monitors/${id}`);assert.equal(deleted.statusCode,204,deleted.body);
 assert.equal((db.prepare("SELECT status FROM devices WHERE id='d'").get() as {status:string}).status,"unknown");
});

test("rebind, lab move and connection deletion disable monitors while retaining local inventory",async()=>{
 const id=await mapped();const view=await health("GET","readings");
 await health("POST","bindings",{providerRecordId:"1",deviceId:"other",expectedDeviceId:"d",sourceIdentity:view.sourceIdentity});
 assert.equal((db.prepare("SELECT enabled FROM deviceMonitors WHERE id=?").get(id) as {enabled:number}).enabled,0);
 assert.equal((db.prepare("SELECT bindingId FROM externalMonitorMappings WHERE monitorId=?").get(id) as {bindingId:null}).bindingId,null);
 db.prepare("UPDATE devices SET labId='b' WHERE id='other'").run();assert.equal((await health("GET","readings")).bindings.length,0);
 await request("DELETE","/api/integrations/connections/c");assert.ok(db.prepare("SELECT id FROM devices WHERE id='d'").get());
});

test("logical/native recovery validates bindings/readings atomically and refreshes after restore",async()=>{
 const id=await mapped();storeExternalReadings("c",[sample("unhealthy")]);await runMonitorCheck(id);
 assert.ok(validateRackpadSqliteDatabase(db,"Fixture"));
 const exported=await request("GET","/api/admin/export");assert.equal(exported.statusCode,200,exported.body);const snapshot=exported.json();
 type Snapshot = {data:Record<string,Record<string,unknown>[]>};
 for(const mutate of [(s:Snapshot)=>s.data.integrationRecordBindings[0].deviceId="foreign",(s:Snapshot)=>s.data.integrationLatestReadings[0].value='{"object":1}',(s:Snapshot)=>s.data.externalMonitorMappings[0].readingKey="",(s:Snapshot)=>s.data.integrationConnections[0].healthIntervalSeconds=1]){
 const bad=structuredClone(snapshot);mutate(bad);const result=await request("POST","/api/admin/restore",bad);assert.equal(result.statusCode,422,result.body);assert.equal((await health("GET","readings")).bindings.length,1);}
 const result=await request("POST","/api/admin/restore",snapshot);assert.equal(result.statusCode,200,result.body); const login=await request("POST","/api/auth/login",{username:"admin",password},{});headers={authorization:`Bearer ${login.json().token}`};assert.equal(externalMonitorResult(id).result,"unknown");assert.equal((await health("GET","readings")).readings[0].collectionError,"refresh_required");
 db.prepare("UPDATE integrationRecordBindings SET sourceIdentity=?").run("z".repeat(64));assert.throws(()=>validateRackpadSqliteDatabase(db,"Invalid"));
});

test("all health routes enforce authentication, lab grants and viewer read-only permissions",async()=>{
 const id=await mapped();const user=await request("POST","/api/users",{username:"viewer",password,displayName:"Viewer",role:"viewer",labAccess:[{labId:"a",role:"viewer"}]});assert.equal(user.statusCode,201,user.body);
 const login=await request("POST","/api/auth/login",{username:"viewer",password});const auth={authorization:`Bearer ${login.json().token}`};
 await health("GET","readings",undefined,200,auth);await health("GET","readings",undefined,401,{});
 for(const [method,url,payload] of [["POST","refresh",{}],["PUT","health-polling",{enabled:true,intervalSeconds:60}],["POST","bindings",{}],["DELETE","bindings/missing",{}],["POST","external-monitors",{}],["PATCH",`external-monitors/${id}`,{enabled:true}]] as const) await health(method,url,payload,403,auth);
 db.prepare("DELETE FROM userLabAccess WHERE userId=?").run(user.json().id);await health("GET","readings",undefined,403,auth);
});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
test("obsolete refresh, preview/test/discovery and polling completions cannot apply after changes",async()=>{
 await request("PATCH","/api/integrations/connections/c",{authSecret:"synthetic-key"});
 for(const suffix of ["test","inventory","discover-scopes","refresh"]){
 await request("PATCH","/api/integrations/connections/c",{enabled:true});
 const started=deferred<void>(), release=deferred<void>();
 setIntegrationClientOverrideForTests("uptime-kuma",{...uptimeKumaIntegrationClient,async test(){started.resolve();await release.promise;return {product:"Fixture",version:null,summary:{}};},async fetchInventory(){started.resolve();await release.promise;return {collection:{vlans:[],subnets:[],dhcpScopes:[],warnings:[]},devices:[],warnings:[]};},async fetchReadings(){started.resolve();await release.promise;return {readings:[sample()],warnings:[]};}});
 const pending=request("POST",suffix==="discover-scopes"?"/api/integrations/discover-scopes":`/api/integrations/connections/c/${suffix}`,suffix==="discover-scopes"?{connectionId:"c"}:{});
 await started.promise;await request("PATCH","/api/integrations/connections/c",{enabled:false});release.resolve();const result=await pending;
 assert.equal(result.statusCode,suffix==="refresh"?200:409,result.body);assert.equal((db.prepare("SELECT count(*) AS n FROM integrationLatestReadings").get() as {n:number}).n,0);
 }
 await request("PATCH","/api/integrations/connections/c",{enabled:true});
 db.exec("UPDATE integrationConnections SET healthPollingEnabled=1; INSERT INTO integrationConnections(id,labId,provider,name,baseUrl,authKind,enabled,healthPollingEnabled,createdAt,updatedAt) VALUES('z','a','uptime-kuma','Later','https://other.example','api-key',1,1,'2026-10-30T00:00:00Z','2026-10-30T00:00:00Z');");
 const started=deferred<void>(),release=deferred<void>();const calls:string[]=[];
 setIntegrationClientOverrideForTests("uptime-kuma",{...uptimeKumaIntegrationClient,async fetchReadings(connection){calls.push(connection.id);started.resolve();await release.promise;return {readings:[],warnings:[]};}});
 const polling=runExternalHealthPollingTick();await started.promise;await request("PUT","/api/integrations/connections/z/health-polling",{enabled:false,intervalSeconds:60});release.resolve();await polling;assert.deepEqual(calls,["c"]);
});

test("refresh reloads grants after collection and failure stores only sanitized categories",async()=>{
 await request("PATCH","/api/integrations/connections/c",{authSecret:"synthetic-key"});
 const created=await request("POST","/api/users",{username:"editor",password,displayName:"Editor",role:"editor",labAccess:[{labId:"a",role:"editor"}]});
 const login=await request("POST","/api/auth/login",{username:"editor",password});const auth={authorization:`Bearer ${login.json().token}`};
 const started=deferred<void>(),release=deferred<void>();setIntegrationClientOverrideForTests("uptime-kuma",{...uptimeKumaIntegrationClient,async fetchReadings(){started.resolve();await release.promise;return {readings:[sample()],warnings:[]};}});
 const pending=health("POST","refresh",{},403,auth);await started.promise;db.prepare("DELETE FROM userLabAccess WHERE userId=?").run(created.json().id);release.resolve();await pending;
 setIntegrationClientOverrideForTests("uptime-kuma",{...uptimeKumaIntegrationClient,async fetchReadings(){throw new Error("private-key-response");}});await assert.rejects(()=>refreshExternalHealth("c"));const view=await health("GET","readings");assert.ok(!JSON.stringify(view).includes("private-key-response"));assert.equal(view.error,"unavailable");
});
