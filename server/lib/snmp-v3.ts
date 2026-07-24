import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";
import dgram from "node:dgram";
import {
  berInteger,
  berObjectIdentifier,
  berOctetString,
  berSequence,
  berTlv,
  boundedSnmpTimeoutMs,
  decodeInteger,
  decodeObjectIdentifier,
  decodeSnmpResponseValue,
  normalizeOid,
  readTlv,
  type SnmpResponse,
} from "./snmp.js";

export const SNMP_V3_AUTH_PROTOCOLS = ["MD5", "SHA"] as const;
export type SnmpV3AuthProtocol = (typeof SNMP_V3_AUTH_PROTOCOLS)[number];
export const SNMP_V3_PRIV_PROTOCOLS = ["none", "AES128"] as const;
export type SnmpV3PrivProtocol = (typeof SNMP_V3_PRIV_PROTOCOLS)[number];

export interface SnmpV3Session {
  host: string;
  port: number;
  timeoutMs: number;
  version: "3";
  user: string;
  authProtocol: SnmpV3AuthProtocol;
  authPassword: string;
  privProtocol: SnmpV3PrivProtocol;
  privPassword: string;
  context?: string;
}

interface SnmpEngineState {
  id: Buffer;
  boots: number;
  time: number;
}

const engineCache = new Map<string, SnmpEngineState>();

function cacheKey(session: SnmpV3Session) {
  return `${session.host}:${session.port}:${session.user}:${session.authProtocol}:${session.privProtocol}`;
}

export function passwordToKey(
  protocol: SnmpV3AuthProtocol,
  password: string,
  engineId: Buffer,
) {
  const passwordBytes = Buffer.from(password, "utf8");
  if (passwordBytes.length === 0) {
    throw new Error("SNMPv3 password must not be empty.");
  }
  const buffer: Buffer[] = [];
  let count = 0;
  const chunkSize = protocol === "MD5" ? 64 : 64;
  const targetLength = 1048576;

  while (count < targetLength) {
    const size = Math.min(chunkSize, passwordBytes.length);
    const chunk = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) {
      chunk[index] = passwordBytes[index % passwordBytes.length]!;
    }
    buffer.push(chunk);
    count += size;
  }

  const digestInput = Buffer.concat(buffer);

  let hash: Buffer;
  if (protocol === "MD5") {
    // SNMPv3 USM password-to-key localization is defined by the configured
    // device auth protocol; MD5 remains here only for legacy device support.
    hash = createHash("md5").update(digestInput).digest();
  } else {
    // SNMPv3 USM password-to-key localization is defined by the configured
    // device auth protocol; SHA1 remains here only for legacy device support.
    hash = createHash("sha1").update(digestInput).digest();
  }

  let localized: Buffer;
  if (protocol === "MD5") {
    // SNMPv3 USM localizes the derived key with the engine ID using the same
    // configured auth protocol, so stronger password hashing is not applicable.
    localized = createHash("md5")
      .update(Buffer.concat([hash, engineId, hash]))
      .digest();
  } else {
    // SNMPv3 USM localizes the derived key with the engine ID using the same
    // configured auth protocol, so stronger password hashing is not applicable.
    localized = createHash("sha1")
      .update(Buffer.concat([hash, engineId, hash]))
      .digest();
  }

  return localized;
}

export function localizedPrivKey(
  protocol: SnmpV3AuthProtocol,
  password: string,
  engineId: Buffer,
) {
  // Privacy keys are derived from the SNMPv3 USM localized auth key.
  const localized = passwordToKey(protocol, password, engineId);

  if (protocol === "MD5") {
    // SNMPv3 AES privacy key material follows the USM auth protocol derivation.
    return createHash("md5").update(localized).digest().subarray(0, 16);
  }

  // SNMPv3 AES privacy key material follows the USM auth protocol derivation.
  return createHash("sha1").update(localized).digest().subarray(0, 16);
}

export function buildAuth(
  protocol: SnmpV3AuthProtocol,
  key: Buffer,
  wholeMessage: Buffer,
) {
  // SNMPv3 USM authenticates messages with the device-selected legacy HMAC.
  // codeql[js/weak-cryptographic-algorithm]
  const mac =
    protocol === "MD5"
      ? createHmac("md5", key).update(wholeMessage).digest()
      : createHmac("sha1", key).update(wholeMessage).digest();
  return mac.subarray(0, 12);
}

export function encryptScopedPdu(
  scopedPdu: Buffer,
  privKey: Buffer,
  engineBoots: number,
  engineTime: number,
) {
  const salt = randomBytes(4);
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(engineBoots, 0);
  iv.writeUInt32BE(engineTime, 4);
  salt.copy(iv, 8);
  const cipher = createCipheriv("aes-128-cfb", privKey, iv);
  const encrypted = Buffer.concat([cipher.update(scopedPdu), cipher.final()]);
  return { encrypted, salt };
}

export function decryptScopedPdu(
  encrypted: Buffer,
  privKey: Buffer,
  engineBoots: number,
  engineTime: number,
  salt: Buffer,
) {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(engineBoots, 0);
  iv.writeUInt32BE(engineTime, 4);
  salt.copy(iv, 8);
  const decipher = createDecipheriv("aes-128-cfb", privKey, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function buildScopedPdu(
  contextEngineId: Buffer,
  contextName: string,
  pdu: Buffer,
) {
  return berSequence(
    Buffer.concat([
      berOctetString(contextEngineId),
      berOctetString(contextName),
      pdu,
    ]),
  );
}

function buildPdu(oid: string, requestId: number, pduTag: number) {
  const variableBinding = berSequence(
    Buffer.concat([berObjectIdentifier(oid), Buffer.from([0x05, 0x00])]),
  );
  return berTlv(
    pduTag,
    Buffer.concat([
      berInteger(requestId),
      berInteger(0),
      berInteger(0),
      berSequence(variableBinding),
    ]),
  );
}

export function buildUsmSecurityParameters(
  engineId: Buffer,
  boots: number,
  time: number,
  user: string,
  authParams: Buffer,
  privSalt: Buffer,
) {
  return berSequence(
    Buffer.concat([
      berOctetString(engineId),
      berInteger(boots),
      berInteger(time),
      berOctetString(user),
      berOctetString(authParams),
      berOctetString(privSalt),
    ]),
  );
}

export function buildSnmpV3Message(options: {
  msgId: number;
  flags: number;
  securityParameters: Buffer;
  msgData: Buffer;
}) {
  const globalData = berSequence(
    Buffer.concat([
      berInteger(options.msgId),
      berInteger(65507),
      berOctetString(Buffer.from([options.flags])),
      berInteger(3),
    ]),
  );

  return berSequence(
    Buffer.concat([
      berInteger(3),
      globalData,
      berOctetString(options.securityParameters),
      options.msgData,
    ]),
  );
}

function encodeSnmpV3Request(
  session: SnmpV3Session,
  engine: SnmpEngineState,
  oid: string,
  requestId: number,
  discovery: boolean,
  mode: "get" | "getNext" = "get",
) {
  const contextName = session.context?.trim() ?? "";
  const pduTag = mode === "getNext" ? 0xa1 : 0xa0;
  const getPdu = buildPdu(oid, requestId, pduTag);
  const scopedPdu = buildScopedPdu(engine.id, contextName, getPdu);
  const user = session.user;

  let flags = 0;
  let authParams = Buffer.alloc(12);
  let privSalt = Buffer.alloc(0);
  let msgData = scopedPdu;

  const useAuth = !discovery && session.authPassword.trim().length > 0;
  const usePriv = useAuth && session.privProtocol === "AES128";

  if (usePriv) {
    flags |= 0x03;
    const authKey = passwordToKey(
      session.authProtocol,
      session.authPassword,
      engine.id,
    );
    const privKey = localizedPrivKey(
      session.authProtocol,
      session.privPassword,
      engine.id,
    );
    const encrypted = encryptScopedPdu(
      scopedPdu,
      privKey,
      engine.boots,
      engine.time,
    );
    privSalt = encrypted.salt;
    msgData = berOctetString(encrypted.encrypted);

    let authParams = Buffer.alloc(12);
    let securityParameters = buildUsmSecurityParameters(
      engine.id,
      engine.boots,
      engine.time,
      user,
      authParams,
      privSalt,
    );
    let message = buildSnmpV3Message({
      msgId: requestId,
      flags,
      securityParameters,
      msgData,
    });
    authParams = buildAuth(session.authProtocol, authKey, message);
    securityParameters = buildUsmSecurityParameters(
      engine.id,
      engine.boots,
      engine.time,
      user,
      authParams,
      privSalt,
    );
    return buildSnmpV3Message({
      msgId: requestId,
      flags,
      securityParameters,
      msgData,
    });
  }

  if (useAuth) {
    flags |= 0x01;
    const authKey = passwordToKey(
      session.authProtocol,
      session.authPassword,
      engine.id,
    );
    let authParams = Buffer.alloc(12);
    let securityParameters = buildUsmSecurityParameters(
      engine.id,
      engine.boots,
      engine.time,
      user,
      authParams,
      privSalt,
    );
    let message = buildSnmpV3Message({
      msgId: requestId,
      flags,
      securityParameters,
      msgData,
    });
    authParams = buildAuth(session.authProtocol, authKey, message);
    securityParameters = buildUsmSecurityParameters(
      engine.id,
      engine.boots,
      engine.time,
      user,
      authParams,
      privSalt,
    );
    return buildSnmpV3Message({
      msgId: requestId,
      flags,
      securityParameters,
      msgData,
    });
  }

  flags = discovery ? 0x04 : 0x00;
  const securityParameters = buildUsmSecurityParameters(
    engine.id,
    engine.boots,
    engine.time,
    user,
    authParams,
    privSalt,
  );
  return buildSnmpV3Message({
    msgId: requestId,
    flags,
    securityParameters,
    msgData,
  });
}

function parseEngineFromResponse(packet: Buffer): SnmpEngineState | null {
  const root = readTlv(packet, 0);
  let offset = root.valueStart;
  offset = readTlv(packet, offset).nextOffset;
  const globalData = readTlv(packet, offset);
  const securityParameters = readTlv(packet, globalData.nextOffset);
  const usm = readTlv(securityParameters.value, 0);
  let usmOffset = usm.valueStart;
  const engineId = readTlv(securityParameters.value, usmOffset);
  usmOffset = engineId.nextOffset;
  const boots = readTlv(securityParameters.value, usmOffset);
  usmOffset = boots.nextOffset;
  const time = readTlv(securityParameters.value, usmOffset);

  if (engineId.tag !== 0x04 || boots.tag !== 0x02 || time.tag !== 0x02) {
    return null;
  }
  if (engineId.value.length === 0) return null;

  return {
    id: Buffer.from(engineId.value),
    boots: decodeInteger(boots.value),
    time: decodeInteger(time.value),
  };
}

function parseSnmpV3ResponsePacket(
  packet: Buffer,
  session: SnmpV3Session,
  engine: SnmpEngineState,
  expectedRequestId: number,
): SnmpResponse {
  const root = readTlv(packet, 0);
  let offset = root.valueStart;
  offset = readTlv(packet, offset).nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  const securityParameters = readTlv(packet, offset);
  offset = securityParameters.nextOffset;
  const msgData = readTlv(packet, offset);

  let scopedPduValue = msgData.value;
  if (msgData.tag === 0x04 && session.privProtocol === "AES128") {
    const usm = readTlv(securityParameters.value, 0);
    let usmOffset = usm.valueStart;
    usmOffset = readTlv(securityParameters.value, usmOffset).nextOffset;
    usmOffset = readTlv(securityParameters.value, usmOffset).nextOffset;
    usmOffset = readTlv(securityParameters.value, usmOffset).nextOffset;
    usmOffset = readTlv(securityParameters.value, usmOffset).nextOffset;
    const privSalt = readTlv(securityParameters.value, usmOffset);
    const privKey = localizedPrivKey(
      session.authProtocol,
      session.privPassword,
      engine.id,
    );
    scopedPduValue = decryptScopedPdu(
      msgData.value,
      privKey,
      engine.boots,
      engine.time,
      privSalt.value,
    );
  }

  const scopedPdu = readTlv(scopedPduValue, 0);
  let scopedOffset = scopedPdu.valueStart;
  scopedOffset = readTlv(scopedPduValue, scopedOffset).nextOffset;
  scopedOffset = readTlv(scopedPduValue, scopedOffset).nextOffset;
  const pdu = readTlv(scopedPduValue, scopedOffset);

  if (pdu.tag === 0xa8) {
    const discovered = parseEngineFromResponse(packet);
    if (discovered) {
      engineCache.set(cacheKey(session), discovered);
    }
    throw new Error("SNMPv3 agent returned a report PDU during discovery.");
  }

  if (pdu.tag !== 0xa2) {
    throw new Error("SNMPv3 response did not contain a response PDU.");
  }

  let pduOffset = pdu.valueStart;
  const requestId = readTlv(scopedPduValue, pduOffset);
  pduOffset = requestId.nextOffset;
  const errorStatus = readTlv(scopedPduValue, pduOffset);
  pduOffset = errorStatus.nextOffset;
  const errorIndex = readTlv(scopedPduValue, pduOffset);
  pduOffset = errorIndex.nextOffset;

  if (decodeInteger(requestId.value) !== expectedRequestId) {
    throw new Error("SNMPv3 response request id did not match.");
  }

  const status = decodeInteger(errorStatus.value);
  if (status !== 0) {
    throw new Error(
      `SNMP agent returned error status ${status} at index ${decodeInteger(errorIndex.value)}.`,
    );
  }

  const variableBindings = readTlv(scopedPduValue, pduOffset);
  const variableBinding = readTlv(scopedPduValue, variableBindings.valueStart);
  const oid = readTlv(scopedPduValue, variableBinding.valueStart);
  const value = readTlv(scopedPduValue, oid.nextOffset);

  return decodeSnmpResponseValue(
    decodeObjectIdentifier(oid.value),
    value.tag,
    value.value,
  );
}

function sendSnmpV3(
  session: SnmpV3Session,
  message: Buffer,
  requestId: number,
  engine: SnmpEngineState,
): Promise<SnmpResponse> {
  const socket = dgram.createSocket("udp4");
  const timeoutMs = boundedSnmpTimeoutMs(session.timeoutMs);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            `SNMPv3 ${session.host}:${session.port} timed out from the Rackpad server.`,
          ),
        );
      });
    }, timeoutMs);

    socket.once("error", (error) => finish(() => reject(error)));
    socket.once("message", (packet) => {
      finish(() => {
        try {
          const discovered = parseEngineFromResponse(packet);
          if (discovered) {
            engineCache.set(cacheKey(session), discovered);
          }
          resolve(
            parseSnmpV3ResponsePacket(
              packet,
              session,
              discovered ?? engine,
              requestId,
            ),
          );
        } catch (error) {
          reject(error);
        }
      });
    });

    socket.send(message, session.port, session.host, (error) => {
      if (error) finish(() => reject(error));
    });
  });
}

async function discoverEngine(session: SnmpV3Session) {
  const requestId = randomInt(1, 0x7fffffff);
  const engine = { id: Buffer.alloc(0), boots: 0, time: 0 };
  const discoveryMessage = encodeSnmpV3Request(
    session,
    engine,
    "1.3.6.1.2.1.1.5.0",
    requestId,
    true,
  );

  const packet = await new Promise<Buffer>((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const timeoutMs = boundedSnmpTimeoutMs(session.timeoutMs);
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() =>
        reject(
          new Error(`SNMPv3 engine discovery timed out for ${session.host}.`),
        ),
      );
    }, timeoutMs);
    socket.once("error", (error) => finish(() => reject(error)));
    socket.once("message", (message) => finish(() => resolve(message)));
    socket.send(discoveryMessage, session.port, session.host, (error) => {
      if (error) finish(() => reject(error));
    });
  });

  const discovered = parseEngineFromResponse(packet);
  if (!discovered) {
    throw new Error(
      "SNMPv3 engine discovery did not return an authoritative engine ID.",
    );
  }
  engineCache.set(cacheKey(session), discovered);
  return discovered;
}

export async function snmpV3Request(
  session: SnmpV3Session,
  oid: string,
  mode: "get" | "getNext",
): Promise<SnmpResponse> {
  const normalizedOid = normalizeOid(oid);
  let engine = engineCache.get(cacheKey(session));
  if (!engine) {
    engine = await discoverEngine(session);
  }

  const requestId = randomInt(1, 0x7fffffff);
  const message = encodeSnmpV3Request(
    session,
    engine,
    normalizedOid,
    requestId,
    false,
    mode,
  );
  try {
    return await sendSnmpV3(session, message, requestId, engine);
  } catch (error) {
    engineCache.delete(cacheKey(session));
    throw error;
  }
}

export function snmpV3Get(
  session: SnmpV3Session,
  oid: string,
): Promise<SnmpResponse> {
  return snmpV3Request(session, oid, "get");
}

export function snmpV3GetNext(
  session: SnmpV3Session,
  oid: string,
): Promise<SnmpResponse> {
  return snmpV3Request(session, oid, "getNext");
}

export function resetSnmpV3EngineCache() {
  engineCache.clear();
}
