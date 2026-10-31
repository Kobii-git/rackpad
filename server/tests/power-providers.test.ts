import assert from "node:assert/strict";
import {Duplex} from "node:stream";
import type net from "node:net";
import type tls from "node:tls";
import {afterEach,test} from "node:test";
import {encodeNutReadCommand,parseNutLine,readNutUps,setNutTransportsForTests,type NutReadCommand} from "../lib/integrations/nut-transport.js";
import {nutIntegrationClient,nutStatusHealth} from "../lib/integrations/providers/nut.js";
import {redfishIntegrationClient,redfishHealth} from "../lib/integrations/providers/redfish.js";
import {setNetworkHostLookupForTests} from "../lib/net-guard.js";
import {setIntegrationHttpTransportForTests} from "../lib/integrations/http.js";
import type {IntegrationConnectionSecrets} from "../lib/integrations/types.js";
function connection(provider:"nut"|"redfish"="nut",extra:Partial<IntegrationConnectionSecrets>={}):IntegrationConnectionSecrets{return {id:"fixture",labId:"fixture",provider,name:"Fixture",baseUrl:provider==="nut"?"nut://ups.example:3493":"https://bmc.example",authKind:"username-password",authId:"reader",authSecret:"synthetic#secret",verifyTls:true,enabled:true,siteRef:null,scopeRefs:[],syncVlans:true,syncSubnets:true,syncDhcp:true,syncSwitches:true,syncGateways:true,syncAccessPoints:true,syncHosts:true,syncGuests:true,syncWifi:true,autoSyncEnabled:false,autoSyncMode:"merge",autoSyncCron:null,autoSyncLabIds:[],autoSyncFailureCount:0,autoSyncPausedUntil:null,...extra};}
class FixtureSocket extends Duplex {
  readonly commands:string[]=[];
  constructor(readonly respond:(tokens:string[],socket:FixtureSocket)=>void){super();}
  _read(){}
  _write(chunk:Buffer,_encoding:BufferEncoding,callback:(error?:Error|null)=>void){const line=chunk.toString("ascii");this.commands.push(line);queueMicrotask(()=>{if(!this.destroyed)this.respond(parseNutLine(line.trimEnd()),this);});callback();}
  reply(value:string){for(let i=0;i<value.length;i+=7)this.push(Buffer.from(value.slice(i,i+7),"ascii"));}
}
function standard(tokens:string[],socket:FixtureSocket){
  if(tokens[0]==="STARTTLS")socket.reply("OK STARTTLS\n");
  else if(tokens[0]==="USERNAME" || tokens[0]==="PASSWORD")socket.reply("OK\n");
  else if(tokens.join(" ")==="LIST UPS")socket.reply('BEGIN LIST UPS\nUPS "ups#one" "Fixture UPS"\nEND LIST UPS\n');
  else if(tokens[0]==="LIST" && tokens[1]==="VAR")socket.reply('BEGIN LIST VAR "ups#one"\nVAR "ups#one" ups.status "OL"\nVAR "ups#one" battery.charge "95"\nVAR "ups#one" battery.runtime "300"\nVAR "ups#one" ups.load "20"\nVAR "ups#one" input.voltage "230.5"\nVAR "ups#one" ups.model "Fixture"\nVAR "ups#one" driver.parameter.secret "must-not-be-returned"\nEND LIST VAR "ups#one"\n');
  else assert.fail("Unexpected outbound NUT operation");
}
function nativeFixture(respond=standard,secure=true){
  setNetworkHostLookupForTests(async()=>[{address:"192.168.1.50",family:4}]);
  const socket=new FixtureSocket(respond);let upgrades=0;
  setNutTransportsForTests({dial:options=>{assert.equal((options as net.TcpNetConnectOpts).host,"192.168.1.50");assert.equal((options as net.TcpNetConnectOpts).port,3493);queueMicrotask(()=>socket.emit("connect"));return socket as unknown as net.Socket;},secure:options=>{upgrades++;assert.equal(options.servername,"ups.example");assert.equal(options.rejectUnauthorized,true);assert.equal(options.minVersion,"TLSv1.2");assert.ok(options.checkServerIdentity!("ignored",{subjectaltname:"DNS:wrong.example"} as tls.PeerCertificate) instanceof Error);queueMicrotask(()=>socket.emit(secure?"secureConnect":"error",new Error("certificate rejected private-response")));return socket as unknown as tls.TLSSocket;}});
  return {socket,upgrades:()=>upgrades};
}
afterEach(()=>{setNetworkHostLookupForTests(null);setNutTransportsForTests(null);setIntegrationHttpTransportForTests(null);});

test("NUT framing/escaping and strict outbound allowlist cannot emit mutation commands",()=>{
 assert.deepEqual(parseNutLine('VAR "ups\\#one" ups.note "quote\\" and slash\\\\ and \\#"'),["VAR","ups#one","ups.note",'quote" and slash\\ and #']);
 assert.deepEqual(parseNutLine('"one"two bare\\ token #comment'),["one","two","bare token"]);
 assert.match(encodeNutReadCommand({kind:"password",value:'pass#"\\word'}),/pass\\#/);
 for(const kind of ["set","instcmd","fsd","shutdown","login","master","primary"]){assert.throws(()=>encodeNutReadCommand({kind} as unknown as NutReadCommand));}
 for(const value of ["reader\nFSD ups","reader\rPASSWORD x","unicode-ａ"]){assert.throws(()=>encodeNutReadCommand({kind:"username",value}));}
 for(const line of ['"unterminated','trailing\\','bad\u0000value','x'.repeat(16385)])assert.throws(()=>parseNutLine(line));
});

test("NUT pins DNS, negotiates verified STARTTLS before credentials, normalizes UPS values and omits private variables",async()=>{
 const fixture=nativeFixture();const result=await nutIntegrationClient.fetchReadings!(connection());
 assert.equal(fixture.upgrades(),1);assert.equal(fixture.socket.commands[0],"STARTTLS\n");assert.equal(fixture.socket.commands[1],'USERNAME "reader"\n');assert.equal(fixture.socket.commands[2],'PASSWORD "synthetic\\#secret"\n');
 assert.ok(fixture.socket.commands.every(line=>/^(?:STARTTLS|USERNAME |PASSWORD |LIST UPS|LIST VAR )/.test(line)));
 assert.equal(result.readings.find(row=>row.key==="ups.status")?.health,"healthy");assert.equal(result.readings.find(row=>row.key==="battery.runtime")?.unit,"s");assert.equal(result.readings.find(row=>row.key==="input.voltage")?.value,230.5);assert.ok(!JSON.stringify(result).includes("must-not-be-returned"));
});

test("NUT plaintext is explicit, stale UPS data is unknown, and TLS failures never send credentials",async()=>{
 let fixture=nativeFixture(standard,false);await assert.rejects(()=>readNutUps(connection()),/TLS/);assert.deepEqual(fixture.socket.commands,["STARTTLS\n"]);
 nativeFixture((tokens,socket)=>{if(tokens[0]==="LIST" && tokens[1]==="VAR")socket.reply("ERR DATA-STALE\n");else standard(tokens,socket);});
 const result=await nutIntegrationClient.fetchReadings!(connection());assert.equal(result.readings[0].health,"unknown");assert.ok(result.warnings.length);
 fixture=nativeFixture();await readNutUps(connection("nut",{options:{allowUnencrypted:true}}));assert.equal(fixture.upgrades(),0);assert.match(fixture.socket.commands[0],/^USERNAME /);
 for(const [status,health] of [["OL","healthy"],["OB","degraded"],["OB LB","unhealthy"],["OL TEST","unknown"],["OL FUTURE","unknown"],["CAL","unknown"]])assert.equal(nutStatusHealth(status),health);
});

test("NUT blocked/mixed DNS answers, malformed frames, auth errors and obsolete requests reject safely",async()=>{
 const fixture=nativeFixture();setNetworkHostLookupForTests(async()=>[{address:"192.168.1.50",family:4},{address:"127.0.0.1",family:4}]);await assert.rejects(()=>readNutUps(connection()),/blocked/);assert.equal(fixture.socket.commands.length,0);
 for(const response of ['ERR ACCESS-DENIED\n','x'.repeat(17000)+'\n','BEGIN LIST UPS\nUPS x X\nUPS x X\nEND LIST UPS\n']){
  nativeFixture((tokens,socket)=>{if(tokens[0]==="LIST" && tokens[1]==="UPS")socket.reply(response);else standard(tokens,socket);});await assert.rejects(()=>readNutUps(connection("nut",{options:{allowUnencrypted:true}})));
 }
 nativeFixture();await assert.rejects(()=>readNutUps(connection(),{isCurrent:()=>false}),/configuration changed/i);
});

test("NUT native session has a total timeout even if a server stops replying",async context=>{
 context.mock.timers.enable({apis:["setTimeout"]});
 let started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 nativeFixture((tokens,socket)=>{if(tokens[0]==="LIST"){started();return;}standard(tokens,socket);});
 const result=readNutUps(connection());await ready;context.mock.timers.tick(15001);await assert.rejects(()=>result,/timed out|timeout/i);context.mock.timers.reset();
});

function redfishFixture(extra:Record<string,unknown>={}){
 const root="/redfish/v1",map:Record<string,unknown>={
  [`${root}/`]:{Systems:{"@odata.id":`${root}/Systems`},Chassis:{"@odata.id":`${root}/Chassis`},Managers:{"@odata.id":`${root}/Managers`}},
  [`${root}/Systems`]:{Members:[{"@odata.id":`${root}/Systems/1`}],"Members@odata.count":1},
  [`${root}/Systems/1`]:{Id:"1",Name:"Server",Manufacturer:"Fixture",Model:"Hardware",SerialNumber:"synthetic-serial",BiosVersion:"1",Status:{State:"Enabled",Health:"OK"},Actions:{"#ComputerSystem.Reset":{target:"https://must-never-contact.example"}}},
  [`${root}/Chassis`]:{Members:[{"@odata.id":`${root}/Chassis/1`}]},
  [`${root}/Chassis/1`]:{Name:"Chassis",Status:{State:"Enabled",Health:"Warning"},Power:{"@odata.id":`${root}/Chassis/1/Power`},Thermal:{"@odata.id":`${root}/Chassis/1/Thermal`}},
  [`${root}/Chassis/1/Power`]:{PowerControl:[{MemberId:"0",Name:"Power",PowerConsumedWatts:123,OutputVoltage:12}]},
  [`${root}/Chassis/1/Thermal`]:{Temperatures:[{MemberId:"0",Name:"CPU",ReadingCelsius:42,Status:{State:"Enabled",Health:"OK"}}]},
  [`${root}/Managers`]:{Members:[{"@odata.id":`${root}/Managers/1`}]},
  [`${root}/Managers/1`]:{Name:"BMC",FirmwareVersion:"2",Status:{State:"Enabled",Health:"OK"}},...extra};
 const calls:string[]=[];setIntegrationHttpTransportForTests(async request=>{const path=request.url.pathname+decodeURIComponent(request.url.search);calls.push(path);assert.ok(!request.method || request.method==="GET");assert.equal(request.headers?.Authorization,`Basic ${Buffer.from("reader:synthetic#secret").toString("base64")}`);assert.equal(request.verifyTls,true);assert.ok(request.timeoutMs!<=15000);return path in map?{status:200,headers:{},bodyText:JSON.stringify(map[path])}:{status:404,headers:{},bodyText:"unavailable"};});return {map,calls};
}
test("Redfish discovers hardware identity, health, firmware, legacy power/thermal using GET only",async()=>{
 const fixture=redfishFixture();const result=await redfishIntegrationClient.fetchInventory(connection("redfish"));assert.equal(result.importableDevices?.length,3);assert.equal(result.importableDevices?.[0].serial,"synthetic-serial");
 const readings=(await redfishIntegrationClient.fetchReadings!(connection("redfish"))).readings;assert.ok(readings.some(row=>row.value===123&&row.unit==="W"));assert.ok(readings.some(row=>row.value===42&&row.unit==="°C"));assert.ok(readings.some(row=>row.key==="firmware"&&row.value==="2"));assert.ok(readings.some(row=>row.key==="health"&&row.health==="degraded"));assert.ok(!fixture.calls.some(path=>path.includes("Actions")||path.includes("Reset")));
 for(const state of ["InTest","Updating","Absent","Disabled"]){assert.equal(redfishHealth({State:state,Health:"Critical"}),"unknown");}
});

test("Redfish modern metrics preserve ReadingTime and bounded pagination",async()=>{
 const root="/redfish/v1",past=new Date(Date.now()-3600000).toISOString();
 const fixture=redfishFixture({[`${root}/Chassis/1`]:{Name:"Modern",PowerSubsystem:{"@odata.id":`${root}/Chassis/1/PowerSubsystem`}},[`${root}/Chassis/1/PowerSubsystem`]:{PowerSupplies:{"@odata.id":`${root}/Chassis/1/PowerSubsystem/PowerSupplies`}},[`${root}/Chassis/1/PowerSubsystem/PowerSupplies`]:{Members:[{"@odata.id":`${root}/Chassis/1/PowerSubsystem/PowerSupplies/1`}],"Members@odata.count":1},[`${root}/Chassis/1/PowerSubsystem/PowerSupplies/1`]:{Name:"PSU",Metrics:{"@odata.id":`${root}/Chassis/1/PowerSubsystem/PowerSupplies/1/Metrics`}},[`${root}/Chassis/1/PowerSubsystem/PowerSupplies/1/Metrics`]:{Name:"PSU metrics",InputPowerWatts:{Reading:90,ReadingTime:past},InputVoltage:{Reading:230},OutputVoltage:{Reading:12},TemperatureCelsius:{Reading:40}},[`${root}/Systems`]:{Members:[],"Members@odata.count":1,"Members@odata.nextLink":`${root}/Systems?$skip=1`},[`${root}/Systems?$skip=1`]:{Members:[{"@odata.id":`${root}/Systems/1`}],"Members@odata.count":1}});
 const result=await redfishIntegrationClient.fetchReadings!(connection("redfish"));assert.ok(fixture.calls.includes(`${root}/Systems?$skip=1`));assert.ok(result.readings.some(row=>row.providerRecordId.endsWith("/Systems/1")));const power=result.readings.find(row=>row.value===90);assert.equal(power?.observedAt,past);assert.equal(power?.unit,"W");assert.ok(result.readings.some(row=>row.value===230&&row.unit==="V"));assert.ok(result.readings.some(row=>row.value===12&&row.unit==="V"));
});

test("Redfish rejects origin/path escape, pagination loops, malformed metrics and reports capability limits",async()=>{
 const root="/redfish/v1";
 for(const target of ["https://foreign.example/redfish/v1/Systems","http://169.254.169.254/redfish/v1/Systems","/admin","/redfish/v1/Systems/%252e%252e/admin"]){const fixture=redfishFixture({[`${root}/`]:{Systems:{"@odata.id":target}}});await assert.rejects(()=>redfishIntegrationClient.fetchInventory(connection("redfish")));assert.deepEqual(fixture.calls,[`${root}/`]);}
 for(const values of [[{MemberId:"same",Reading:50,Status:{State:"Enabled",Health:"OK"}},{MemberId:"same",Reading:60,Status:{State:"Enabled",Health:"Critical"}}],[{MemberId:"same",Reading:60,Status:{State:"Enabled",Health:"Critical"}},{MemberId:"same",Reading:50,Status:{State:"Enabled",Health:"OK"}}]]){redfishFixture({[`${root}/Chassis/1/Thermal`]:{Fans:values}});await assert.rejects(()=>redfishIntegrationClient.fetchReadings!(connection("redfish")));}
 for(const count of [undefined,2]){redfishFixture({[`${root}/Systems`]:{Members:[{"@odata.id":`${root}/Systems/1`}],"Members@odata.count":count,"Members@odata.nextLink":`${root}/Systems?$skip=1`}});await assert.rejects(()=>redfishIntegrationClient.fetchInventory(connection("redfish")),/continuation page/);}
 redfishFixture({[`${root}/Systems`]:{Members:[],"Members@odata.nextLink":`${root}/Systems`}});await assert.rejects(()=>redfishIntegrationClient.fetchInventory(connection("redfish")));
 redfishFixture({[`${root}/Chassis/1/Thermal`]:{Temperatures:[{MemberId:"0",ReadingCelsius:42,ReadingTime:"bad"}]}});await assert.rejects(()=>redfishIntegrationClient.fetchInventory(connection("redfish")));
 redfishFixture({[`${root}/`]:{Systems:{"@odata.id":`${root}/Systems`}}});const limited=await redfishIntegrationClient.fetchInventory(connection("redfish"));assert.ok(limited.warnings.some(value=>value.includes("Managers")));assert.equal(limited.importableDevices?.length,1);
});
