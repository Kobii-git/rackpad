import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import net from "node:net";
import type { RemoteInfo } from "node:dgram";
import ipaddr from "ipaddr.js";
import {
  SnmpBerReader,
  parseSnmpV3Envelope,
  parseSnmpV3ScopedPdu,
} from "./snmp-v3-message.js";
import { resolveRoutableHost } from "./net-guard.js";
import { createSnmpSocket } from "./snmp-transport.js";
import {
  berInteger,
  berObjectIdentifier,
  berOctetString,
  berSequence,
  berTlv,
  boundedSnmpTimeoutMs,
  decodeObjectIdentifier,
  decodeSnmpResponseValue,
  normalizeOid,
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
  syncedAt: number;
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
  // RFC 3414: repeat continuously and stop at exactly one mebibyte.
  const digestInput = Buffer.alloc(1048576).fill(passwordBytes);

  let hash: Buffer;
  if (protocol === "MD5") {
    // RFC 3414 A.2.1 requires this hash for wire interoperability, not password
    // storage. Credential storage remains separately encrypted. The configured
    // device auth protocol requires MD5 for legacy device support.
    // Owner: @Kobii-git; review legacy interoperability by 2026-11-30.
    // codeql[js/weak-cryptographic-algorithm,js/insufficient-password-hash]
    hash = createHash("md5").update(digestInput).digest();
  } else {
    // RFC 3414 A.2.2 requires this hash for wire interoperability, not password
    // storage. Credential storage remains separately encrypted. The configured
    // device auth protocol requires SHA1 for legacy device support.
    // Owner: @Kobii-git; review legacy interoperability by 2026-11-30.
    // codeql[js/weak-cryptographic-algorithm,js/insufficient-password-hash]
    hash = createHash("sha1").update(digestInput).digest();
  }

  let localized: Buffer;
  if (protocol === "MD5") {
    // SNMPv3 USM localizes the derived key with the engine ID using the same
    // configured auth protocol, so stronger password hashing is not applicable.
    // Owner: @Kobii-git; review legacy interoperability by 2026-11-30.
    // codeql[js/weak-cryptographic-algorithm]
    localized = createHash("md5")
      .update(Buffer.concat([hash, engineId, hash]))
      .digest();
  } else {
    // SNMPv3 USM localizes the derived key with the engine ID using the same
    // configured auth protocol, so stronger password hashing is not applicable.
    // Owner: @Kobii-git; review legacy interoperability by 2026-11-30.
    // codeql[js/weak-cryptographic-algorithm]
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
  return passwordToKey(protocol, password, engineId).subarray(0, 16);
}

export function buildAuth(
  protocol: SnmpV3AuthProtocol,
  key: Buffer,
  wholeMessage: Buffer,
) {
  // SNMPv3 USM authenticates messages with the device-selected legacy HMAC.
  // Owner: @Kobii-git; review legacy interoperability by 2026-11-30.
  // codeql[js/weak-cryptographic-algorithm]
  const mac =
    protocol === "MD5"
      ? createHmac("md5", key).update(wholeMessage).digest()
      : createHmac("sha1", key).update(wholeMessage).digest();
  return mac.subarray(0, 12);
}

// RFC 3826: one process-wide 64-bit sequence, including concurrent walks/traps.
let privacySalt = randomBytes(8).readBigUInt64BE();

export function encryptScopedPdu(
  scopedPdu: Buffer,
  privKey: Buffer,
  engineBoots: number,
  engineTime: number,
) {
  const salt = Buffer.alloc(8);
  salt.writeBigUInt64BE(privacySalt);
  privacySalt = BigInt.asUintN(64, privacySalt + 1n);
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
  if (salt.length !== 8) throw new Error("Invalid SNMPv3 AES privacy salt.");
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
  const user = discovery ? "" : session.user;

  // GET and GETNEXT are confirmed-class PDUs, including authenticated requests.
  let flags = 0x04;
  const authParams = Buffer.alloc(0);
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
    const message = buildSnmpV3Message({
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
    const message = buildSnmpV3Message({
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

  flags = 0x04;
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

const NOT_IN_TIME_WINDOW = "1.3.6.1.6.3.15.1.1.2.0";
const UNKNOWN_ENGINE = "1.3.6.1.6.3.15.1.1.4.0";

function engineFromEnvelope(
  envelope: ReturnType<typeof parseSnmpV3Envelope>,
): SnmpEngineState {
  if (!envelope.engineId.length || envelope.engineBoots === 0x7fffffff) {
    throw new Error("Invalid SNMPv3 authoritative engine.");
  }
  return {
    id: Buffer.from(envelope.engineId),
    boots: envelope.engineBoots,
    time: envelope.engineTime,
    syncedAt: performance.now(),
  };
}

function currentEngine(engine: SnmpEngineState): SnmpEngineState {
  return {
    ...engine,
    time: Math.min(
      0x7fffffff,
      engine.time +
        Math.max(0, Math.floor((performance.now() - engine.syncedAt) / 1000)),
    ),
  };
}

function rememberEngine(session: SnmpV3Session, engine: SnmpEngineState) {
  const previous = engineCache.get(cacheKey(session));
  // Concurrent IF-MIB walks must not move the trusted clock backwards.
  if (
    !previous ||
    !previous.id.equals(engine.id) ||
    engine.boots > previous.boots ||
    (engine.boots === previous.boots && engine.time > previous.time)
  ) {
    engineCache.set(cacheKey(session), engine);
  }
}

function singleBinding(bytes: Buffer) {
  const bindings = new SnmpBerReader(bytes);
  const binding = new SnmpBerReader(bindings.take(0x30).value);
  bindings.done();
  const oid = binding.take(0x06).value;
  if (!oid.length || oid[oid.length - 1]! & 0x80) {
    throw new Error("Invalid SNMPv3 response OID.");
  }
  const value = binding.take();
  binding.done();
  return { oid: decodeObjectIdentifier(oid), ...value };
}

class SnmpTimeReport extends Error {
  constructor(readonly engine: SnmpEngineState) {
    super("SNMPv3 agent requested engine time synchronization.");
  }
}

function parseSnmpV3ResponsePacket(
  packet: Buffer,
  session: SnmpV3Session,
  engine: SnmpEngineState,
  expectedRequestId: number,
  expectedOid: string,
  mode: "get" | "getNext",
): SnmpResponse {
  const envelope = parseSnmpV3Envelope(packet);
  if (
    envelope.msgId !== expectedRequestId ||
    !envelope.engineId.equals(engine.id) ||
    !envelope.userBytes.equals(Buffer.from(session.user)) ||
    !(envelope.flags & 1)
  ) {
    throw new Error(
      "SNMPv3 response identity or authentication level did not match.",
    );
  }
  const authMessage = Buffer.from(packet);
  authMessage.fill(
    0,
    envelope.authParametersOffset,
    envelope.authParametersOffset + 12,
  );
  const expectedAuth = buildAuth(
    session.authProtocol,
    passwordToKey(session.authProtocol, session.authPassword, engine.id),
    authMessage,
  );
  if (!timingSafeEqual(expectedAuth, envelope.authParameters)) {
    throw new Error("SNMPv3 response authentication failed.");
  }
  const privacyUsed = (envelope.flags & 2) !== 0;
  if (privacyUsed && session.privProtocol !== "AES128") {
    throw new Error("Unexpected SNMPv3 response privacy level.");
  }
  const plaintext = privacyUsed
    ? decryptScopedPdu(
        envelope.msgData.value,
        localizedPrivKey(session.authProtocol, session.privPassword, engine.id),
        envelope.engineBoots,
        envelope.engineTime,
        envelope.privacyParameters,
      )
    : envelope.msgData.encoded;
  const scoped = parseSnmpV3ScopedPdu(plaintext);
  const receivedEngine = engineFromEnvelope(envelope);
  const trusted = engineCache.get(cacheKey(session));
  if (trusted && !trusted.id.equals(engine.id)) {
    throw new Error("SNMPv3 authoritative engine changed during the request.");
  }
  const timeReference = trusted ?? engine;
  const binding = singleBinding(scoped.bindings);
  if (scoped.tag === 0xa8) {
    // RFC 3412 Reports can use request-id zero and default context. USM time
    // Reports use authNoPriv even for an authPriv request (RFC 3414 3.2.7a).
    if (
      (scoped.requestId !== 0 && scoped.requestId !== expectedRequestId) ||
      !scoped.contextEngineId.equals(engine.id) ||
      scoped.errorStatus !== 0 ||
      scoped.errorIndex !== 0 ||
      binding.tag !== 0x41 ||
      binding.value.length < 1 ||
      binding.value.length > 5
    )
      throw new Error("Invalid SNMPv3 report.");
    if (
      binding.oid === NOT_IN_TIME_WINDOW &&
      (receivedEngine.boots > timeReference.boots ||
        (receivedEngine.boots === timeReference.boots &&
          receivedEngine.time >= currentEngine(timeReference).time - 150))
    ) {
      throw new SnmpTimeReport(receivedEngine);
    }
    throw new Error("SNMPv3 agent returned an authenticated error report.");
  }
  if (
    scoped.tag !== 0xa2 ||
    scoped.requestId !== expectedRequestId ||
    !scoped.contextEngineId.equals(engine.id) ||
    !scoped.contextName.equals(Buffer.from(session.context?.trim() ?? "")) ||
    privacyUsed !== (session.privProtocol === "AES128")
  ) {
    throw new Error("SNMPv3 response PDU or security level did not match.");
  }
  if (
    receivedEngine.boots < timeReference.boots ||
    (receivedEngine.boots === timeReference.boots &&
      receivedEngine.time < currentEngine(timeReference).time - 150)
  ) {
    throw new Error("SNMPv3 response is outside the engine time window.");
  }
  if (scoped.errorStatus !== 0) {
    throw new Error(
      `SNMP agent returned error status ${scoped.errorStatus} at index ${scoped.errorIndex}.`,
    );
  }
  if (mode === "get" && binding.oid !== expectedOid) {
    throw new Error("SNMPv3 response OID did not match.");
  }
  const response = decodeSnmpResponseValue(
    binding.oid,
    binding.tag,
    binding.value,
  );
  rememberEngine(session, receivedEngine);
  return response;
}

function samePeer(peer: RemoteInfo, session: SnmpV3Session) {
  try {
    return (
      peer.port === session.port &&
      ipaddr.process(peer.address).toString() ===
        ipaddr.process(session.host).toString()
    );
  } catch {
    return false;
  }
}

function exchange<T>(
  session: SnmpV3Session,
  message: Buffer,
  msgId: number,
  deadline: number,
  parse: (packet: Buffer) => T,
): Promise<T> {
  const remaining = deadline - performance.now();
  if (remaining <= 0)
    return Promise.reject(new Error("SNMPv3 request timed out."));
  const socket = createSnmpSocket(net.isIP(session.host));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `SNMPv3 ${session.host}:${session.port} timed out from the Rackpad server.`,
            ),
          ),
        ),
      remaining,
    );
    socket.once("error", (error) => finish(() => reject(error)));
    socket.on("message", (packet: Buffer, peer: RemoteInfo) => {
      if (settled || !samePeer(peer, session)) return;
      // Malformed or unrelated datagrams cannot consume the pending request.
      try {
        if (parseSnmpV3Envelope(packet).msgId !== msgId) return;
      } catch {
        return;
      }
      if (performance.now() >= deadline) {
        finish(() => reject(new Error("SNMPv3 request timed out.")));
        return;
      }
      try {
        const response = parse(packet);
        finish(() => resolve(response));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    try {
      socket.send(message, session.port, session.host, (error) => {
        if (error) finish(() => reject(error));
      });
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

async function discoverEngine(session: SnmpV3Session) {
  const requestId = randomInt(1, 0x7fffffff);
  const engine = {
    id: Buffer.alloc(0),
    boots: 0,
    time: 0,
    syncedAt: performance.now(),
  };
  const message = encodeSnmpV3Request(
    session,
    engine,
    "1.3.6.1.2.1.1.5.0",
    requestId,
    true,
  );
  return exchange(
    session,
    message,
    requestId,
    performance.now() + boundedSnmpTimeoutMs(session.timeoutMs),
    (packet) => {
      const envelope = parseSnmpV3Envelope(packet);
      if ((envelope.flags & 3) !== 0)
        throw new Error("Invalid SNMPv3 discovery security level.");
      const scoped = parseSnmpV3ScopedPdu(envelope.msgData.encoded);
      const binding = singleBinding(scoped.bindings);
      if (
        scoped.tag !== 0xa8 ||
        (scoped.requestId !== 0 && scoped.requestId !== requestId) ||
        scoped.errorStatus !== 0 ||
        scoped.errorIndex !== 0 ||
        binding.tag !== 0x41 ||
        binding.oid !== UNKNOWN_ENGINE ||
        !scoped.contextEngineId.equals(envelope.engineId)
      ) {
        throw new Error(
          "SNMPv3 discovery did not contain a correlated engine report.",
        );
      }
      // Discovery is unauthenticated: never publish it into the trusted cache.
      return engineFromEnvelope(envelope);
    },
  );
}

export async function snmpV3Request(
  session: SnmpV3Session,
  oid: string,
  mode: "get" | "getNext",
): Promise<SnmpResponse> {
  if (
    !session.authPassword.trim() ||
    (session.privProtocol === "AES128" && !session.privPassword.trim())
  ) {
    throw new Error(
      "SNMPv3 requires configured authentication and privacy passwords.",
    );
  }
  const resolved = await resolveRoutableHost(session.host);
  session = { ...session, host: resolved.address };
  const normalizedOid = normalizeOid(oid);
  const cached = engineCache.get(cacheKey(session));
  let engine = cached ?? (await discoverEngine(session));
  // One request deadline is shared by the original request and any time retry.
  const deadline = performance.now() + boundedSnmpTimeoutMs(session.timeoutMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestId = randomInt(1, 0x7fffffff);
      const message = encodeSnmpV3Request(
        session,
        currentEngine(engine),
        normalizedOid,
        requestId,
        false,
        mode,
      );
      try {
        return await exchange(session, message, requestId, deadline, (packet) =>
          parseSnmpV3ResponsePacket(
            packet,
            session,
            engine,
            requestId,
            normalizedOid,
            mode,
          ),
        );
      } catch (error) {
        if (!(error instanceof SnmpTimeReport) || attempt !== 0) throw error;
        engine = error.engine;
        rememberEngine(session, engine);
      }
    }
    throw new Error("SNMPv3 synchronization failed.");
  } catch (error) {
    // A failing concurrent walk must not evict a newer verified engine state.
    if (engineCache.get(cacheKey(session)) === cached)
      engineCache.delete(cacheKey(session));
    throw error;
  }
}

export function snmpV3Get(session: SnmpV3Session, oid: string) {
  return snmpV3Request(session, oid, "get");
}

export function snmpV3GetNext(session: SnmpV3Session, oid: string) {
  return snmpV3Request(session, oid, "getNext");
}

export function resetSnmpV3EngineCache() {
  engineCache.clear();
}
