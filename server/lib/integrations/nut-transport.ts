import net from "node:net";
import tls from "node:tls";
import { resolveRoutableHost } from "../net-guard.js";
import { ExternalProviderError, externalErrorCategory, type ExternalCollectionContext } from "./external-health-types.js";
import type { IntegrationConnectionSecrets } from "./types.js";

export type NutReadCommand = {kind:"starttls"}|{kind:"username"|"password";value:string}|{kind:"list-ups"}|{kind:"list-vars";ups:string};
function quote(value:string){
  if(!value || value.length>500 || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)>126))throw new ExternalProviderError("invalid_response");
  return `"${value.replaceAll("\\","\\\\").replaceAll('"','\\"').replaceAll('#','\\#')}"`;
}
/** The only outbound protocol encoder. No caller can supply a raw command. */
export function encodeNutReadCommand(command:NutReadCommand){
  switch(command.kind){
    case "starttls":return "STARTTLS\n";
    case "username":return `USERNAME ${quote(command.value)}\n`;
    case "password":return `PASSWORD ${quote(command.value)}\n`;
    case "list-ups":return "LIST UPS\n";
    case "list-vars":return `LIST VAR ${quote(command.ups)}\n`;
    default:throw new ExternalProviderError("invalid_response");
  }
}
export function parseNutLine(line:string):string[]{
  if(line.length>16384 || [...line].some(char=>char.charCodeAt(0)>126 || (char.charCodeAt(0)<32 && char!=="\t")))throw new ExternalProviderError("invalid_response");
  const tokens:string[]=[];let value="",started=false,quoted=false;
  const finish=()=>{if(started){tokens.push(value);value="";started=false;if(tokens.length>64)throw new ExternalProviderError("invalid_response");}};
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(char==="\\"){if(++i>=line.length)throw new ExternalProviderError("invalid_response");value+=line[i];started=true;continue;}
    if(quoted){if(char==='"'){quoted=false;finish();}else value+=char;continue;}
    if(char==="#")break;
    if(char==='"' && !started){started=true;quoted=true;continue;}
    if(char===" " || char==="\t"){finish();continue;}
    if(char==="="){finish();tokens.push("=");continue;}
    value+=char;started=true;
  }
  if(quoted)throw new ExternalProviderError("invalid_response");finish();return tokens;
}
class NutResponseError extends ExternalProviderError {
  constructor(readonly nutCode:string){super(["ACCESS-DENIED","PASSWORD-REQUIRED","USERNAME-REQUIRED","PASSWORD-INCORRECT"].includes(nutCode)?"authentication":"unavailable");}
}
export interface NutUpsSnapshot {name:string;description:string;variables:Map<string,string>;unavailable:boolean}
type Socket=net.Socket|tls.TLSSocket;
type Dial=(options:net.NetConnectOpts)=>net.Socket;
type Secure=(options:tls.ConnectionOptions)=>tls.TLSSocket;
let dial:Dial=options=>net.connect(options),secure:Secure=options=>tls.connect(options);
export function setNutTransportsForTests(overrides:{dial?:Dial;secure?:Secure}|null){dial=overrides?.dial??(options=>net.connect(options));secure=overrides?.secure??(options=>tls.connect(options));}
function connected(socket:Socket,event:"connect"|"secureConnect"){
  if(socket.destroyed || socket.readableEnded)return Promise.reject(new ExternalProviderError("unavailable"));
  return new Promise<void>((resolve,reject)=>{
    const done=()=>{cleanup();resolve();},failed=(error:Error)=>{cleanup();reject(error);},closed=()=>failed(new ExternalProviderError("unavailable"));
    const cleanup=()=>{socket.off(event,done);socket.off("error",failed);socket.off("close",closed);};
    socket.once(event,done);socket.once("error",failed);socket.once("close",closed);
  });
}
function lineReader(socket:Socket,budget:{bytes:number},deadline:number){
  let buffer="",failure:Error|undefined,waiter:{resolve:(line:string)=>void;reject:(error:Error)=>void}|undefined;
  const lines:string[]=[];
  const fail=(error:Error)=>{failure=error;waiter?.reject(error);waiter=undefined;};
  const data=(chunk:Buffer)=>{
    budget.bytes+=chunk.length;
    if(budget.bytes>8*1024*1024 || Date.now()>deadline || [...chunk].some(byte=>byte>127)){fail(new ExternalProviderError(Date.now()>deadline?"timeout":"invalid_response"));socket.destroy();return;}
    buffer+=chunk.toString("ascii");
    let end:number;
    while((end=buffer.indexOf("\n"))>=0){
      let line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.endsWith("\r"))line=line.slice(0,-1);
      if(line.length>16384 || lines.length>=2000){fail(new ExternalProviderError("invalid_response"));socket.destroy();return;}
      if(waiter){const current=waiter;waiter=undefined;current.resolve(line);}else lines.push(line);
    }
    if(buffer.length>16384){fail(new ExternalProviderError("invalid_response"));socket.destroy();}
  };
  const end=()=>fail(new ExternalProviderError("unavailable"));
  socket.on("data",data);socket.on("error",fail);socket.on("end",end);socket.on("close",end);
  if(socket.destroyed || socket.readableEnded)end();
  return {
    abort:fail,
    read:()=>failure?Promise.reject(failure):lines.length?Promise.resolve(lines.shift()!):new Promise<string>((resolve,reject)=>{if(waiter)reject(new ExternalProviderError("invalid_response"));else waiter={resolve,reject};}),
    detach:(requireEmpty=false)=>{socket.off("data",data);socket.off("error",fail);socket.off("end",end);socket.off("close",end);if(requireEmpty && (buffer || lines.length || waiter))throw new ExternalProviderError("invalid_response");},
  };
}
/** One bounded, pinned outbound session. STARTTLS precedes credentials by default. */
export async function readNutUps(connection:IntegrationConnectionSecrets,context:ExternalCollectionContext={}):Promise<NutUpsSnapshot[]>{
  let socket:Socket|undefined,reader:ReturnType<typeof lineReader>|undefined;
  const deadline=Date.now()+15000,budget={bytes:0};
  const current=()=>{if(context.isCurrent && !context.isCurrent())throw new ExternalProviderError("configuration_changed");if(Date.now()>=deadline)throw new ExternalProviderError("timeout");};
  const timeout=setTimeout(()=>{const error=new ExternalProviderError("timeout");reader?.abort(error);socket?.destroy(error);},15000);timeout.unref?.();
  try{
    current();const url=new URL(connection.baseUrl);
    if(url.protocol!=="nut:" || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname!=="/"))throw new ExternalProviderError("incompatible");
    const resolved=await resolveRoutableHost(url,"Provider endpoint resolves to a blocked address.",Math.min(5000,deadline-Date.now()));current();
    socket=dial({host:resolved.address,port:Number(url.port||3493),family:resolved.family});
    await connected(socket,"connect");current();reader=lineReader(socket,budget,deadline);
    const response=async(command:NutReadCommand)=>{current();socket!.write(encodeNutReadCommand(command),"ascii");const tokens=parseNutLine(await reader!.read());current();if(tokens[0]==="ERR")throw new NutResponseError(tokens[1]??"UNKNOWN");return tokens;};
    if(!connection.options?.allowUnencrypted){
      let reply:string[];try{reply=await response({kind:"starttls"});}catch(error){if(error instanceof ExternalProviderError && (error.category==="timeout" || error.category==="configuration_changed"))throw error;throw new ExternalProviderError("tls");}
      if(reply.length!==2 || reply[0]!=="OK" || reply[1]!=="STARTTLS")throw new ExternalProviderError("tls");
      reader.detach(true);reader=undefined;
      socket=secure({socket,servername:net.isIP(resolved.host)?undefined:resolved.host,rejectUnauthorized:connection.verifyTls,minVersion:"TLSv1.2",checkServerIdentity:(_hostname,certificate)=>tls.checkServerIdentity(resolved.host,certificate)});
      try{await connected(socket,"secureConnect");}catch(error){if(error instanceof ExternalProviderError && (error.category==="timeout" || error.category==="configuration_changed"))throw error;throw new ExternalProviderError("tls");}current();reader=lineReader(socket,budget,deadline);
    }
    for(const command of [{kind:"username",value:connection.authId??""},{kind:"password",value:connection.authSecret??""}] as const){const reply=await response(command);if(reply.length!==1 || reply[0]!=="OK")throw new ExternalProviderError("authentication");}
    const header=await response({kind:"list-ups"});if(header.join(" ")!=="BEGIN LIST UPS")throw new ExternalProviderError("invalid_response");
    const records:NutUpsSnapshot[]=[];const names=new Set<string>();
    for(;;){current();const row=parseNutLine(await reader.read());current();if(row.join(" ")==="END LIST UPS")break;
      if(row.length!==3 || row[0]!=="UPS" || !row[1] || row[1].length>160 || row[2].length>2000 || names.has(row[1]) || records.length>=128)throw new ExternalProviderError("invalid_response");
      names.add(row[1]);records.push({name:row[1],description:row[2],variables:new Map(),unavailable:false});
    }
    for(const record of records){
      let header:string[];
      try{header=await response({kind:"list-vars",ups:record.name});}catch(error){if(error instanceof NutResponseError && ["DATA-STALE","DRIVER-NOT-CONNECTED","UNKNOWN-UPS"].includes(error.nutCode)){record.unavailable=true;continue;}throw error;}
      if(header.length!==4 || header.slice(0,3).join(" ")!=="BEGIN LIST VAR" || header[3]!==record.name)throw new ExternalProviderError("invalid_response");
      for(;;){current();const row=parseNutLine(await reader.read());current();
        if(row.length===4 && row.slice(0,3).join(" ")==="END LIST VAR" && row[3]===record.name)break;
        if(row.length!==4 || row[0]!=="VAR" || row[1]!==record.name || !/^[a-zA-Z0-9_.-]{1,100}$/.test(row[2]) || row[3].length>2000 || record.variables.has(row[2]) || record.variables.size>=1000)throw new ExternalProviderError("invalid_response");
        record.variables.set(row[2],row[3]);
      }
    }
    return records;
  }catch(error){if(error instanceof ExternalProviderError)throw error;throw new ExternalProviderError(externalErrorCategory(error));}
  finally{clearTimeout(timeout);reader?.detach();socket?.on("error",()=>{});socket?.destroy();}
}
