import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import type tls from "node:tls";
import {afterEach,test} from "node:test";
import WebSocket from "ws";
import {homeAssistantIntegrationClient,homeAssistantHealth} from "../lib/integrations/providers/home-assistant.js";
import {type HomeAssistantSocketOptions,encodeHomeAssistantReadCommand,readHomeAssistantRegistries,setHomeAssistantSocketFactoryForTests} from "../lib/integrations/home-assistant-websocket.js";
import {setIntegrationHttpTransportForTests} from "../lib/integrations/http.js";
import {setNetworkHostLookupForTests} from "../lib/net-guard.js";
import type {IntegrationConnectionSecrets} from "../lib/integrations/types.js";
const connection:IntegrationConnectionSecrets={id:"ha",labId:"lab",provider:"home-assistant",name:"HA",baseUrl:"https://ha.example:8123/ha",authKind:"api-key",authId:null,authSecret:"synthetic-private-token",verifyTls:true,enabled:true,siteRef:null,scopeRefs:[],syncVlans:true,syncSubnets:true,syncDhcp:true,syncSwitches:true,syncGateways:true,syncAccessPoints:true,syncHosts:true,syncGuests:true,syncWifi:true,autoSyncEnabled:false,autoSyncMode:"merge",autoSyncCron:null,autoSyncLabIds:[],autoSyncFailureCount:0,autoSyncPausedUntil:null};
class FixtureSocket extends EventEmitter {
 readyState:number=WebSocket.OPEN;readonly sent:Record<string,unknown>[]=[];terminated=false;
 constructor(readonly response:(row:Record<string,unknown>,socket:FixtureSocket)=>void){super();}
 send(value:string,callback:(error?:Error)=>void){const row=JSON.parse(value) as Record<string,unknown>;this.sent.push(row);queueMicrotask(()=>this.response(row,this));callback();}
 pong(_data:Buffer,_mask:unknown,callback:(error?:Error)=>void){callback();}
 terminate(){this.terminated=true;this.readyState=WebSocket.CLOSED;}
 message(value:unknown){this.emit("message",Buffer.from(JSON.stringify(value)),false);}
}
const devices=[{id:"d_mqtt",name:"MQTT device",manufacturer:"Fixture",model:"Sensor",serial_number:"synthetic-serial",sw_version:"1",configuration_url:"https://private.example/?token=not-returned",identifiers:[["mqtt","private-identifier"]]},{id:"d_radio",name:"Radio device"},{id:"d_hub",name:"Hub without entities"}];
const entities=[{id:"e_mqtt",entity_id:"sensor.power",device_id:"d_mqtt",platform:"mqtt"},{id:"e_conn",entity_id:"binary_sensor.link",device_id:"d_mqtt",platform:"mqtt"},{id:"e_radio",entity_id:"sensor.temperature",device_id:"d_radio",platform:"zwave_js"}];
function state(entity_id:string,value="12",extra:Record<string,unknown>={}){return {entity_id,state:value,attributes:{friendly_name:entity_id,unit_of_measurement:"W",secret:"private-attribute",entity_picture:"/api/image?token=private-token"},last_reported:new Date().toISOString(),last_updated:"2020-01-01T00:00:00.000Z",...extra};}
function fixture(options:{devices?:Record<string,unknown>[];entities?:Record<string,unknown>[];restricted?:boolean;states?:unknown;response?:(row:Record<string,unknown>,socket:FixtureSocket)=>void}={}){
 const calls:string[]=[];let socket!:FixtureSocket;
 setNetworkHostLookupForTests(async()=>[{address:"192.168.1.60",family:4}]);
 setIntegrationHttpTransportForTests(async request=>{calls.push(request.url.pathname);assert.equal(request.url.pathname,"/ha/api/states");assert.ok(!request.method || request.method==="GET");assert.equal(request.headers?.Authorization,"Bearer synthetic-private-token");return {status:200,headers:{},bodyText:JSON.stringify(options.states??[state("sensor.power"),state("binary_sensor.link","on",{attributes:{device_class:"connectivity"}}),state("sensor.temperature","21")])};});
 const respond=options.response??((row,ws)=>{if(row.type==="auth"){assert.equal(row.access_token,connection.authSecret);ws.message({type:"auth_ok"});}else if(options.restricted)ws.message({type:"result",id:row.id,success:false,error:{code:"unauthorized",message:"private-provider-error"}});else if(row.type==="config/device_registry/list")ws.message({type:"result",id:1,success:true,result:options.devices??devices});else if(row.type==="config/entity_registry/list")ws.message({type:"result",id:2,success:true,result:options.entities??entities});else assert.fail("Unexpected write command");});
 setHomeAssistantSocketFactoryForTests((url,settings)=>{assert.equal(url.hostname,"192.168.1.60");assert.equal(url.protocol,"wss:");assert.equal(url.pathname,"/ha/api/websocket");assert.equal((settings.headers as Record<string,string>).Host,"ha.example:8123");assert.equal(settings.servername,"ha.example");assert.equal(settings.rejectUnauthorized,true);assert.equal(settings.followRedirects,false);assert.equal(settings.maxPayload,8*1024*1024);assert.equal(settings.perMessageDeflate,false);assert.ok(settings.checkServerIdentity!("ignored",{subjectaltname:"DNS:wrong.example"} as tls.PeerCertificate) instanceof Error);socket=new FixtureSocket(respond);queueMicrotask(()=>socket.message({type:"auth_required"}));return socket as unknown as WebSocket;});
 return {calls,socket:()=>socket};
}
afterEach(()=>{setHomeAssistantSocketFactoryForTests(null);setNetworkHostLookupForTests(null);setIntegrationHttpTransportForTests(null);});

test("Home Assistant REST and pinned WebSocket reads group MQTT/radio entities and keep only whitelisted metadata",async()=>{
 const test=fixture();const inventory=await homeAssistantIntegrationClient.fetchInventory(connection);assert.equal(inventory.importableDevices?.length,3);assert.equal(inventory.importableDevices?.find(row=>row.providerRecordId==="device:d_mqtt")?.serial,"synthetic-serial");
 assert.deepEqual(test.socket().sent.map(row=>row.type),["auth","config/device_registry/list","config/entity_registry/list"]);assert.ok(test.socket().terminated);
 const result=await homeAssistantIntegrationClient.fetchReadings!(connection);assert.ok(result.readings.some(row=>row.providerRecordId==="device:d_mqtt"&&row.value===12&&row.unit==="W"));assert.ok(result.readings.some(row=>row.health==="healthy"));assert.ok(result.readings.some(row=>row.key==="registry.presence"&&row.providerRecordId==="device:d_hub"&&row.health==="unknown"));
 for(const secret of ["private-attribute","private-identifier","not-returned","private-provider-error",connection.authSecret!])assert.ok(!JSON.stringify({inventory,result}).includes(secret));
});

test("Home Assistant stable registry identity survives host/entity renames and preserves report times",async()=>{
 const past=new Date(Date.now()-3600000).toISOString();fixture({states:[state("sensor.power","9",{last_reported:past})]});const before=await homeAssistantIntegrationClient.fetchReadings!(connection);assert.equal(before.readings.find(row=>row.value===9)?.observedAt,past);
 fixture({devices:devices.map(row=>row.id==="d_mqtt"?{...row,name:"Renamed hardware"}:row),entities:entities.map(row=>row.id==="e_mqtt"?{...row,entity_id:"sensor.renamed"}:row),states:[state("sensor.renamed","9",{last_reported:past})]});const after=await homeAssistantIntegrationClient.fetchReadings!(connection);
 const a=before.readings.find(row=>row.value===9)!,b=after.readings.find(row=>row.value===9)!;assert.equal(a.key,b.key);assert.equal(a.providerRecordId,b.providerRecordId);assert.equal(b.recordName,"Renamed hardware");
});

test("restricted registries expose entity-only readings with a clear limitation and no guessed grouping",async()=>{
 fixture({restricted:true,states:[state("sensor.one",""),state("sensor.two","off")]});const result=await homeAssistantIntegrationClient.fetchInventory(connection);assert.equal(result.importableDevices?.length,2);assert.ok(result.importableDevices?.every(row=>row.providerRecordId?.startsWith("entity:")));assert.ok(result.warnings[0].includes("registry grouping"));assert.ok(!JSON.stringify(result).includes("private-provider-error"));
 const readings=await homeAssistantIntegrationClient.fetchReadings!(connection);assert.ok(readings.readings.some(row=>row.value===""));assert.ok(readings.readings.every(row=>row.health==="unknown"));
});

test("Home Assistant intentional off, disabled, unavailable and missing timestamps do not become outages",async()=>{
 assert.equal(homeAssistantHealth("off","switch",null),"unknown");assert.equal(homeAssistantHealth("off","light",null),"unknown");assert.equal(homeAssistantHealth("off","binary_sensor","connectivity"),"unhealthy");assert.equal(homeAssistantHealth("on","binary_sensor","battery"),"degraded");assert.equal(homeAssistantHealth("unavailable","binary_sensor","connectivity"),"unknown");
 fixture({entities:[{...entities[1],disabled_by:"user"}],states:[state("binary_sensor.link","off",{attributes:{device_class:"connectivity"}}),state("binary_sensor.notimestamp","off",{last_reported:null,last_updated:null,attributes:{device_class:"connectivity"}})]});const result=await homeAssistantIntegrationClient.fetchReadings!(connection);assert.ok(result.readings.every(row=>row.health==="unknown"));
});

test("Home Assistant malformed identities/payloads and oversized responses reject rather than merge",async()=>{
 for(const states of [[state("sensor.same"),state("sensor.same")],[state("sensor.bad","1",{last_reported:"bad"})],Array(10001).fill(state("sensor.toomany")),[state("Sensor.upper")]]){fixture({states});await assert.rejects(()=>homeAssistantIntegrationClient.fetchInventory(connection));}
 fixture({devices:[devices[0],devices[0]]});await assert.rejects(()=>homeAssistantIntegrationClient.fetchInventory(connection));
 fixture({entities:[entities[0],{...entities[0],entity_id:"sensor.other"}]});await assert.rejects(()=>homeAssistantIntegrationClient.fetchInventory(connection));
});

test("WebSocket encoder cannot emit Home Assistant service calls, writes or subscriptions",()=>{
 assert.deepEqual(JSON.parse(encodeHomeAssistantReadCommand("config/device_registry/list",1)),{id:1,type:"config/device_registry/list"});
 for(const type of ["call_service","fire_event","subscribe_events","config/device_registry/update","set_state","execute_script"]){assert.throws(()=>encodeHomeAssistantReadCommand(type as Parameters<typeof encodeHomeAssistantReadCommand>[0],1));}
 assert.throws(()=>encodeHomeAssistantReadCommand("config/device_registry/list",0));
});

test("WebSocket transport rejects authentication, protocol, binary/oversized frames and obsolete completions without leaking tokens",async()=>{
 for(const response of [(row:Record<string,unknown>,socket:FixtureSocket)=>socket.message({type:"auth_invalid",message:connection.authSecret}),(row:Record<string,unknown>,socket:FixtureSocket)=>socket.message({type:"result",id:999,success:true,result:[]}),(row:Record<string,unknown>,socket:FixtureSocket)=>socket.emit("message",Buffer.from("binary"),true),(row:Record<string,unknown>,socket:FixtureSocket)=>socket.emit("message",Buffer.alloc(8*1024*1024+1),false)]){
  const setup=fixture({response});await assert.rejects(()=>readHomeAssistantRegistries(connection),error=>error instanceof Error&&!error.message.includes(connection.authSecret!));assert.ok(setup.socket().terminated);
 }
 let current=true;const setup=fixture({response:(_row,socket)=>{current=false;socket.message({type:"auth_ok"});}});await assert.rejects(()=>readHomeAssistantRegistries(connection,{isCurrent:()=>current}),/configuration changed/i);assert.deepEqual(setup.socket().sent.map(row=>row.type),["auth"]);
});

test("WebSocket guarded DNS/TLS/redirect failures never silently fall back or send a token",async()=>{
 fixture();setNetworkHostLookupForTests(async()=>[{address:"192.168.1.60",family:4},{address:"127.0.0.1",family:4}]);await assert.rejects(()=>readHomeAssistantRegistries(connection),/blocked/);
 for(const kind of ["certificate","redirect"]){fixture();let socket!:FixtureSocket;
  setHomeAssistantSocketFactoryForTests((_url,options:HomeAssistantSocketOptions)=>{assert.equal(options.followRedirects,false);assert.equal(options.rejectUnauthorized,true);socket=new FixtureSocket(()=>assert.fail("No authentication should be sent"));queueMicrotask(()=>kind==="certificate"?socket.emit("error",new Error("certificate failed private-text")):socket.emit("unexpected-response",{destroy(){}},{statusCode:302,destroy(){}}));return socket as unknown as WebSocket;});
  await assert.rejects(()=>readHomeAssistantRegistries(connection),error=>error instanceof Error&&!error.message.includes("private-text"));assert.equal(socket.sent.length,0);assert.ok(socket.terminated);
 }
});

test("WebSocket registry collection has a deadline and closes a stalled session",async context=>{
 context.mock.timers.enable({apis:["setTimeout"]});let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const setup=fixture({response:(row,socket)=>{if(row.type==="auth")socket.message({type:"auth_ok"});else started();}});
 const pending=readHomeAssistantRegistries(connection,{},Date.now()+1000);await ready;context.mock.timers.tick(1001);await assert.rejects(()=>pending,/timed out|timeout/i);assert.ok(setup.socket().terminated);context.mock.timers.reset();
});


test("registry-only standalone and grouped entities remain available as unknown inventory",async()=>{
 fixture({entities:[...entities,{id:"e_orphan",entity_id:"sensor.disabled",device_id:null,disabled_by:"user"},{id:"e_grouped",entity_id:"sensor.sleeping",device_id:"d_radio"}]});
 const result=await homeAssistantIntegrationClient.fetchInventory(connection);assert.ok(result.importableDevices?.some(row=>row.providerRecordId==="entity:e_orphan"));
 const readings=await homeAssistantIntegrationClient.fetchReadings!(connection);assert.ok(readings.readings.some(row=>row.label==="sensor.sleeping" && row.health==="unknown"));assert.ok(readings.readings.some(row=>row.providerRecordId==="entity:e_orphan" && row.health==="unknown"));
});
test("WebSocket control frames share the bounded count and byte budgets",async()=>{
 const setup=fixture({response:(_row,socket)=>{for(let i=0;i<17;i++)socket.emit("ping",Buffer.from("bounded"));}});
 await assert.rejects(()=>readHomeAssistantRegistries(connection),/invalid|oversized/i);assert.ok(setup.socket().terminated);
});
