import WebSocket,{type ClientOptions,type RawData} from "ws";
import net from "node:net";
import tls from "node:tls";
import { resolveRoutableHost } from "../net-guard.js";
import { buildIntegrationUrl } from "./http.js";
import { ExternalProviderError,externalErrorCategory,type ExternalCollectionContext } from "./external-health-types.js";
import type { IntegrationConnectionSecrets } from "./types.js";
export type HomeAssistantReadCommand="config/device_registry/list"|"config/entity_registry/list";
export function encodeHomeAssistantReadCommand(type:HomeAssistantReadCommand,id:number){
  if(!["config/device_registry/list","config/entity_registry/list"].includes(type) || !Number.isInteger(id) || id<1 || id>2)throw new ExternalProviderError("invalid_response");
  return JSON.stringify({id,type});
}
export interface HomeAssistantRegistries {available:boolean;devices:Record<string,unknown>[];entities:Record<string,unknown>[]}
export type HomeAssistantSocketOptions=Omit<ClientOptions,"agent"|"checkServerIdentity"> & {agent:false;servername?:string;checkServerIdentity:typeof tls.checkServerIdentity};
type SocketFactory=(url:URL,options:HomeAssistantSocketOptions)=>WebSocket;
function createSocket(url:URL,options:HomeAssistantSocketOptions){
  // @types/ws misdeclares Node's agent:false and TLS identity callback. ws passes
  // these options directly to node:https/node:tls, whose contracts apply here.
  return new WebSocket(url,options as unknown as ClientOptions);
}
let socketFactory:SocketFactory=createSocket;
export function setHomeAssistantSocketFactoryForTests(factory:SocketFactory|null){socketFactory=factory??createSocket;}
export async function readHomeAssistantRegistries(connection:IntegrationConnectionSecrets,context:ExternalCollectionContext={},deadline=Date.now()+15000):Promise<HomeAssistantRegistries>{
  const current=()=>{if(context.isCurrent && !context.isCurrent())throw new ExternalProviderError("configuration_changed");if(Date.now()>=deadline)throw new ExternalProviderError("timeout");};
  current();const input=buildIntegrationUrl(connection.baseUrl,"/api/websocket");
  let resolved:Awaited<ReturnType<typeof resolveRoutableHost>>;
  try{resolved=await resolveRoutableHost(input,"Provider endpoint resolves to a blocked address.",Math.min(5000,deadline-Date.now()));}catch(error){throw new ExternalProviderError(externalErrorCategory(error));}
  current();
  const target=new URL(input);target.protocol=input.protocol==="https:"?"wss:":"ws:";target.hostname=resolved.address.includes(":")?`[${resolved.address}]`:resolved.address;
  const options:HomeAssistantSocketOptions={agent:false,autoPong:false,headers:{Host:input.host},family:resolved.family,followRedirects:false,maxRedirects:0,maxPayload:8*1024*1024,maxFragments:1024,maxBufferedChunks:4096,perMessageDeflate:false,skipUTF8Validation:false,handshakeTimeout:Math.max(1,deadline-Date.now()),rejectUnauthorized:connection.verifyTls,minVersion:"TLSv1.2",servername:net.isIP(resolved.host)?undefined:resolved.host,checkServerIdentity:(_hostname,certificate)=>tls.checkServerIdentity(resolved.host,certificate)};
  return new Promise<HomeAssistantRegistries>((resolve,reject)=>{
    let socket:WebSocket|undefined,done=false,phase:"challenge"|"auth"|"devices"|"entities"="challenge",bytes=0,messages=0;
    let devices:Record<string,unknown>[]=[];
    const finish=(result?:HomeAssistantRegistries,error?:ExternalProviderError)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(socket){socket.removeAllListeners("message");socket.removeAllListeners("error");socket.removeAllListeners("close");socket.removeAllListeners("unexpected-response");socket.removeAllListeners("ping");socket.removeAllListeners("pong");socket.on("error",()=>{});socket.terminate();}
      if(error)reject(error);else resolve(result!);
    };
    const fail=(error:unknown)=>finish(undefined,error instanceof ExternalProviderError?error:new ExternalProviderError(externalErrorCategory(error)));
    const unavailable=()=>finish({available:false,devices:[],entities:[]});
    const timer=setTimeout(()=>fail(new ExternalProviderError("timeout")),Math.max(1,deadline-Date.now()));timer.unref?.();
    const send=(value:string)=>{current();if(socket?.readyState!==WebSocket.OPEN)throw new ExternalProviderError("unavailable");socket.send(value,error=>{if(error)fail(error);});};
    const rows=(value:unknown)=>{if(!Array.isArray(value) || value.length>10000 || value.some(row=>!row || typeof row!=="object" || Array.isArray(row)))throw new ExternalProviderError("invalid_response");return value as Record<string,unknown>[];};
    const control=(data:Buffer,ping:boolean)=>{
      if(done)return;
      try{current();bytes+=data.length;if(++messages>16 || data.length>125 || bytes>8*1024*1024)throw new ExternalProviderError("invalid_response");if(ping)socket!.pong(data,undefined,error=>{if(error)fail(error);});}catch(error){fail(error);}
    };
    const message=(data:RawData,binary:boolean)=>{
      if(done)return;
      try{
        current();if(binary || ++messages>16)throw new ExternalProviderError("invalid_response");
        const buffer=Array.isArray(data)?Buffer.concat(data):Buffer.from(data as ArrayBuffer);bytes+=buffer.length;if(bytes>8*1024*1024)throw new ExternalProviderError("invalid_response");
        let value:unknown;try{value=JSON.parse(buffer.toString("utf8"));}catch{throw new ExternalProviderError("invalid_response");}
        if(!value || typeof value!=="object" || Array.isArray(value))throw new ExternalProviderError("invalid_response");
        const row=value as Record<string,unknown>;
        if(row.type==="auth_invalid")throw new ExternalProviderError("authentication");
        if(phase==="challenge"){
          if(row.type!=="auth_required")throw new ExternalProviderError("invalid_response");phase="auth";
          if(!connection.authSecret)throw new ExternalProviderError("authentication");send(JSON.stringify({type:"auth",access_token:connection.authSecret}));return;
        }
        if(phase==="auth"){
          if(row.type!=="auth_ok")throw new ExternalProviderError("invalid_response");phase="devices";send(encodeHomeAssistantReadCommand("config/device_registry/list",1));return;
        }
        const expected=phase==="devices"?1:2;
        if(row.type!=="result" || row.id!==expected || typeof row.success!=="boolean")throw new ExternalProviderError("invalid_response");
        if(!row.success){
          const code=row.error && typeof row.error==="object"?(row.error as Record<string,unknown>).code:null;
          if(["unauthorized","not_allowed","unknown_command","not_supported"].includes(String(code))){unavailable();return;}
          throw new ExternalProviderError("unavailable");
        }
        if(phase==="devices"){devices=rows(row.result);phase="entities";send(encodeHomeAssistantReadCommand("config/entity_registry/list",2));return;}
        finish({available:true,devices,entities:rows(row.result)});
      }catch(error){fail(error);}
    };
    try{
      socket=socketFactory(target,options);
      socket.on("message",message);socket.on("ping",data=>control(data,true));socket.on("pong",data=>control(data,false));socket.on("error",fail);socket.on("close",()=>fail(new ExternalProviderError("unavailable")));
      socket.on("unexpected-response",(request,response)=>{const status=response.statusCode;request.destroy();response.destroy();if(status===403 || status===404 || status===426)unavailable();else fail(new ExternalProviderError(status===401?"authentication":"unavailable"));});
      if(socket.readyState===WebSocket.CLOSED || socket.readyState===WebSocket.CLOSING)fail(new ExternalProviderError("unavailable"));
    }catch(error){fail(error);}
  });
}
