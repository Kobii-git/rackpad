import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {after,before,beforeEach,test} from "node:test";
const directory=mkdtempSync(path.join(os.tmpdir(),"rackpad-power-health-"));process.env.DATABASE_PATH=path.join(directory,"fixture.db");process.env.NODE_ENV="test";process.env.RACKPAD_SECRET_KEY="synthetic-power-health-key";
const {db}=await import("../db.js"),{createApp}=await import("../app.js"),{updateIntegrationConnection}=await import("../lib/integrations/connections.js"),{validateRackpadSqliteDatabase}=await import("../lib/native-backup-validation.js");
const {externalConfigurationRevision}=await import("../lib/integrations/external-health.js");
const app=await createApp();let headers:Record<string,string>;const password="synthetic-power-health-password";
async function request(method:"GET"|"POST"|"PATCH",url:string,payload?:Record<string,unknown>,expected=200){const result=await app.inject({method,url,headers,payload});assert.equal(result.statusCode,expected,result.body);return result.json();}
async function create(extra:Record<string,unknown>={},expected=201){return request("POST","/api/integrations/connections",{labId:"lab",name:"NUT",provider:"nut",baseUrl:"nut://ups.example",authKind:"username-password",authId:"reader",authSecret:"synthetic-secret",...extra},expected);}
before(async()=>{const auth=await app.inject({method:"POST",url:"/api/auth/bootstrap",payload:{username:"admin",password,displayName:"Admin",loadDemoData:false}});assert.equal(auth.statusCode,201,auth.body);headers={authorization:`Bearer ${auth.json().token}`};});
beforeEach(async()=>{db.exec("DELETE FROM labs; INSERT INTO labs(id,name) VALUES('lab','Lab');");const auth=await app.inject({method:"POST",url:"/api/auth/login",payload:{username:"admin",password}});headers={authorization:`Bearer ${auth.json().token}`};});
after(async()=>{await app.close();db.close();rmSync(directory,{recursive:true,force:true});});
test("NUT endpoint/options defaults require TLS; invalid create/update stays atomic",async()=>{
 const connection=await create();assert.equal(connection.baseUrl,"nut://ups.example:3493");assert.deepEqual(connection.options,{});assert.equal(connection.verifyTls,true);assert.equal(connection.healthPollingEnabled,false);
 const row=db.prepare("SELECT * FROM integrationConnections WHERE id=?").get(connection.id) as Record<string,unknown>;const revision=externalConfigurationRevision(row);
 await request("PATCH",`/api/integrations/connections/${connection.id}`,{options:{allowUnencrypted:true}});const current=db.prepare("SELECT * FROM integrationConnections WHERE id=?").get(connection.id) as Record<string,unknown>;assert.notEqual(externalConfigurationRevision(current),revision);assert.deepEqual(JSON.parse(String(current.options)),{allowUnencrypted:true});
 for(const extra of [{name:"Invalid",options:{allowUnencrypted:"yes"}},{name:"Invalid",provider:"redfish",baseUrl:"https://bmc.example",options:{allowUnencrypted:true}},{name:"Invalid",baseUrl:"http://ups.example"},{name:"Invalid",baseUrl:"nut://user:password@ups.example"}]){const before=(db.prepare("SELECT count(*) AS n FROM integrationConnections").get() as {n:number}).n;await create(extra,extra.options?422:400);assert.equal((db.prepare("SELECT count(*) AS n FROM integrationConnections").get() as {n:number}).n,before);}
 const before=db.prepare("SELECT * FROM integrationConnections WHERE id=?").get(connection.id);
 assert.throws(()=>updateIntegrationConnection(connection.id,{name:"Changed",options:{unsupported:true} as unknown as {allowUnencrypted:boolean}}));assert.deepEqual(db.prepare("SELECT * FROM integrationConnections WHERE id=?").get(connection.id),before);
});
test("power integration options and credential ciphertext survive native/logical recovery; malformed restores reject atomically",async()=>{
 const connection=await create({options:{allowUnencrypted:true}});assert.ok(validateRackpadSqliteDatabase(db,"Fixture"));const snapshot=await request("GET","/api/admin/export");
 const secret=(db.prepare("SELECT authSecretEnc FROM integrationConnections WHERE id=?").get(connection.id) as {authSecretEnc:string}).authSecretEnc;assert.ok(secret);assert.ok(!JSON.stringify(await request("GET","/api/integrations/connections")).includes(secret));
 for(const options of [{allowUnencrypted:"yes"},{header:"secret"},[]]){const bad=structuredClone(snapshot);bad.data.integrationConnections[0].options=JSON.stringify(options);await request("POST","/api/admin/restore",bad,422);assert.equal((db.prepare("SELECT options FROM integrationConnections WHERE id=?").get(connection.id) as {options:string}).options,'{"allowUnencrypted":true}');}
 await request("POST","/api/admin/restore",snapshot);const row=db.prepare("SELECT authSecretEnc,options FROM integrationConnections WHERE id=?").get(connection.id);assert.deepEqual(row,{authSecretEnc:secret,options:'{"allowUnencrypted":true}'});assert.ok(validateRackpadSqliteDatabase(db,"Restored"));
 db.prepare("UPDATE integrationConnections SET options=? WHERE id=?").run('{"header":"unsupported"}',connection.id);assert.throws(()=>validateRackpadSqliteDatabase(db,"Invalid"));
});

test("NUT UPS adoption keeps its stable identity/type and obeys explicit inventory selection",async()=>{
 const {setIntegrationClientOverrideForTests}=await import("../lib/integrations/inventory.js");
 const {nutIntegrationClient}=await import("../lib/integrations/providers/nut.js");
 const connection=await create();
 setIntegrationClientOverrideForTests("nut",{...nutIntegrationClient,async fetchInventory(){return {collection:{vlans:[],subnets:[],dhcpScopes:[],warnings:[]},devices:[],warnings:[],importableDevices:[{providerRecordId:"ups:fixture",name:"UPS fixture",deviceType:"ups",model:"Fixture",serial:"synthetic-serial",firmware:null,macAddress:null,ipAddress:null,online:null,ports:[]}]};}});
 try {
  const preview=await request("POST",`/api/integrations/connections/${connection.id}/inventory`,{});assert.equal(preview.deviceSync.devices[0].providerRecordId,"ups:fixture");
  await request("POST",`/api/integrations/connections/${connection.id}/apply-devices`,{snapshotToken:preview.deviceSnapshotToken,selectedProviderRecordIds:["ups:fixture"]});
  assert.deepEqual(db.prepare("SELECT deviceType,status FROM devices WHERE hostname='UPS fixture'").get(),{deviceType:"ups",status:"unknown"});assert.ok(db.prepare("SELECT id FROM integrationRecordBindings WHERE providerRecordId='ups:fixture'").get());
  await request("PATCH",`/api/integrations/connections/${connection.id}`,{syncHosts:false});const filtered=await request("POST",`/api/integrations/connections/${connection.id}/inventory`,{});assert.equal(filtered.importableDevices.length,0);assert.ok(db.prepare("SELECT id FROM devices WHERE hostname='UPS fixture'").get());
 } finally {setIntegrationClientOverrideForTests("nut",null);}
});
