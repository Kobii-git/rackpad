import {
  decodeInteger,
  decodeObjectIdentifier,
  decodeSnmpValue,
  normalizeOid,
  readTlv,
} from "./snmp.js";
import {
  buildAuth,
  decryptScopedPdu,
  localizedPrivKey,
  passwordToKey,
  type SnmpV3AuthProtocol,
  type SnmpV3PrivProtocol,
} from "./snmp-v3.js";
import { timingSafeEqual } from "node:crypto";

export interface SnmpTrapVarbind {
  oid: string;
  value: string;
}

export interface ParsedSnmpTrap {
  snmpVersion: "1" | "2c" | "3" | "unknown";
  community?: string;
  credentialId?: string;
  username?: string;
  contextName?: string;
  authVerified?: boolean;
  privacyUsed?: boolean;
  trapOid?: string;
  genericTrap?: number;
  ifIndex?: number;
  varbinds: SnmpTrapVarbind[];
}

export interface SnmpV3TrapCredential {
  id: string;
  user: string;
  authProtocol: SnmpV3AuthProtocol;
  authPassword: string;
  privProtocol: SnmpV3PrivProtocol;
  privPassword: string;
  context?: string;
}

export interface ParseSnmpTrapOptions {
  v3Credentials?: SnmpV3TrapCredential[];
}

export const SNMP_TRAP_LINK_DOWN_OID = "1.3.6.1.6.3.1.1.5.3";
export const SNMP_TRAP_LINK_UP_OID = "1.3.6.1.6.3.1.1.5.4";
export const IF_INDEX_COLUMN_OID = "1.3.6.1.2.1.2.2.1.1";

export function parseSnmpTrapPacket(
  packet: Buffer,
  options: ParseSnmpTrapOptions = {},
): ParsedSnmpTrap {
  const root = readTlv(packet, 0);
  if (root.tag !== 0x30) {
    throw new Error("SNMP trap packet was not a sequence.");
  }

  let offset = root.valueStart;
  const versionTlv = readTlv(packet, offset);
  offset = versionTlv.nextOffset;
  const version = decodeInteger(versionTlv.value);
  if (version === 3) {
    return parseSnmpV3TrapPdu(packet, root, options.v3Credentials ?? []);
  }

  const communityTlv = readTlv(packet, offset);
  offset = communityTlv.nextOffset;

  const community = communityTlv.value.toString("utf8");
  const pdu = readTlv(packet, offset);

  if (pdu.tag === 0xa4) {
    return parseSnmpV1TrapPdu(version, community, packet, pdu);
  }

  if (pdu.tag === 0xa7) {
    return parseSnmpV2TrapPdu(version, community, packet, pdu);
  }

  throw new Error(`Unsupported SNMP trap PDU tag 0x${pdu.tag.toString(16)}.`);
}

function parseSnmpV3TrapPdu(
  packet: Buffer,
  root: ReturnType<typeof readTlv>,
  credentials: SnmpV3TrapCredential[],
): ParsedSnmpTrap {
  const envelope = parseSnmpV3Envelope(packet, root);
  const candidates = credentials.filter(
    (credential) => credential.user === envelope.user,
  );
  if (candidates.length === 0) {
    throw new Error(
      `No SNMPv3 trap credential matched user ${envelope.user || "(empty)"}.`,
    );
  }

  const errors: string[] = [];
  for (const credential of candidates) {
    try {
      const scoped = decodeSnmpV3TrapScopedPdu(packet, envelope, credential);
      const parsed = parseScopedTrapPdu(scoped.scopedPdu);
      return {
        snmpVersion: "3",
        credentialId: credential.id,
        username: envelope.user,
        contextName: scoped.contextName,
        authVerified: scoped.authVerified,
        privacyUsed: scoped.privacyUsed,
        trapOid: parsed.trapOid,
        ifIndex: extractIfIndex(parsed.varbinds),
        varbinds: parsed.varbinds,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "unknown failure");
    }
  }

  throw new Error(
    `SNMPv3 trap did not validate against configured credentials: ${errors[0]}`,
  );
}

function parseSnmpV3Envelope(packet: Buffer, root: ReturnType<typeof readTlv>) {
  let offset = root.valueStart;
  const versionTlv = readTlv(packet, offset);
  offset = versionTlv.nextOffset;
  const headerTlv = readTlv(packet, offset);
  offset = headerTlv.nextOffset;
  const securityParametersTlv = readTlv(packet, offset);
  offset = securityParametersTlv.nextOffset;
  const msgDataOffset = offset;
  const msgDataTlv = readTlv(packet, offset);

  if (decodeInteger(versionTlv.value) !== 3) {
    throw new Error("SNMPv3 trap packet version was invalid.");
  }
  if (headerTlv.tag !== 0x30 || securityParametersTlv.tag !== 0x04) {
    throw new Error("SNMPv3 trap packet header was invalid.");
  }

  let headerOffset = headerTlv.valueStart;
  headerOffset = readTlv(packet, headerOffset).nextOffset;
  headerOffset = readTlv(packet, headerOffset).nextOffset;
  const flagsTlv = readTlv(packet, headerOffset);
  headerOffset = flagsTlv.nextOffset;
  const securityModelTlv = readTlv(packet, headerOffset);
  const flags = flagsTlv.value[0] ?? 0;
  if (
    securityModelTlv.tag !== 0x02 ||
    decodeInteger(securityModelTlv.value) !== 3
  ) {
    throw new Error("SNMPv3 trap packet did not use USM security.");
  }

  const usm = readTlv(securityParametersTlv.value, 0);
  if (usm.tag !== 0x30) {
    throw new Error("SNMPv3 trap USM parameters were invalid.");
  }
  let usmOffset = usm.valueStart;
  const engineIdTlv = readTlv(securityParametersTlv.value, usmOffset);
  usmOffset = engineIdTlv.nextOffset;
  const engineBootsTlv = readTlv(securityParametersTlv.value, usmOffset);
  usmOffset = engineBootsTlv.nextOffset;
  const engineTimeTlv = readTlv(securityParametersTlv.value, usmOffset);
  usmOffset = engineTimeTlv.nextOffset;
  const userTlv = readTlv(securityParametersTlv.value, usmOffset);
  usmOffset = userTlv.nextOffset;
  const authParametersTlv = readTlv(securityParametersTlv.value, usmOffset);
  usmOffset = authParametersTlv.nextOffset;
  const privacyParametersTlv = readTlv(securityParametersTlv.value, usmOffset);

  if (
    engineIdTlv.tag !== 0x04 ||
    engineBootsTlv.tag !== 0x02 ||
    engineTimeTlv.tag !== 0x02 ||
    userTlv.tag !== 0x04 ||
    authParametersTlv.tag !== 0x04 ||
    privacyParametersTlv.tag !== 0x04
  ) {
    throw new Error("SNMPv3 trap USM fields were invalid.");
  }

  return {
    flags,
    engineId: Buffer.from(engineIdTlv.value),
    engineBoots: decodeInteger(engineBootsTlv.value),
    engineTime: decodeInteger(engineTimeTlv.value),
    user: userTlv.value.toString("utf8"),
    authParameters: Buffer.from(authParametersTlv.value),
    authParametersOffset:
      securityParametersTlv.valueStart + authParametersTlv.valueStart,
    privacyParameters: Buffer.from(privacyParametersTlv.value),
    msgDataOffset,
    msgDataTlv,
  };
}

function decodeSnmpV3TrapScopedPdu(
  packet: Buffer,
  envelope: ReturnType<typeof parseSnmpV3Envelope>,
  credential: SnmpV3TrapCredential,
) {
  const authRequired = (envelope.flags & 0x01) !== 0;
  const privacyRequired = (envelope.flags & 0x02) !== 0;

  if (authRequired) {
    if (!credential.authPassword.trim()) {
      throw new Error(
        "SNMPv3 trap requires authentication but credential has no auth password.",
      );
    }
    if (envelope.authParameters.length !== 12) {
      throw new Error("SNMPv3 trap authentication parameters were invalid.");
    }
    const authMessage = Buffer.from(packet);
    Buffer.alloc(12).copy(authMessage, envelope.authParametersOffset);
    const authKey = passwordToKey(
      credential.authProtocol,
      credential.authPassword,
      envelope.engineId,
    );
    const expectedAuth = buildAuth(
      credential.authProtocol,
      authKey,
      authMessage,
    );
    if (
      expectedAuth.length !== envelope.authParameters.length ||
      !timingSafeEqual(expectedAuth, envelope.authParameters)
    ) {
      throw new Error("SNMPv3 trap authentication failed.");
    }
  }

  let scopedPdu: Buffer;
  if (privacyRequired) {
    if (
      credential.privProtocol !== "AES128" ||
      !credential.privPassword.trim()
    ) {
      throw new Error(
        "SNMPv3 trap requires AES privacy but credential has no privacy password.",
      );
    }
    if (envelope.msgDataTlv.tag !== 0x04) {
      throw new Error("SNMPv3 encrypted trap payload was invalid.");
    }
    const privKey = localizedPrivKey(
      credential.authProtocol,
      credential.privPassword,
      envelope.engineId,
    );
    scopedPdu = decryptScopedPdu(
      envelope.msgDataTlv.value,
      privKey,
      envelope.engineBoots,
      envelope.engineTime,
      envelope.privacyParameters,
    );
  } else {
    if (envelope.msgDataTlv.tag !== 0x30) {
      throw new Error("SNMPv3 plaintext trap payload was invalid.");
    }
    scopedPdu = packet.subarray(
      envelope.msgDataOffset,
      envelope.msgDataTlv.nextOffset,
    );
  }

  const scoped = readTlv(scopedPdu, 0);
  if (scoped.tag !== 0x30) {
    throw new Error("SNMPv3 scoped PDU was invalid.");
  }
  let scopedOffset = scoped.valueStart;
  scopedOffset = readTlv(scopedPdu, scopedOffset).nextOffset;
  const contextNameTlv = readTlv(scopedPdu, scopedOffset);
  scopedOffset = contextNameTlv.nextOffset;
  const contextName = contextNameTlv.value.toString("utf8");
  const configuredContext = credential.context?.trim() ?? "";
  if (configuredContext && configuredContext !== contextName) {
    throw new Error("SNMPv3 trap context did not match the credential.");
  }

  return {
    scopedPdu,
    pduOffset: scopedOffset,
    contextName,
    authVerified: authRequired,
    privacyUsed: privacyRequired,
  };
}

function parseScopedTrapPdu(scopedPdu: Buffer) {
  const scoped = readTlv(scopedPdu, 0);
  let offset = scoped.valueStart;
  offset = readTlv(scopedPdu, offset).nextOffset;
  offset = readTlv(scopedPdu, offset).nextOffset;
  const pdu = readTlv(scopedPdu, offset);
  if (pdu.tag !== 0xa7) {
    throw new Error(
      `Unsupported SNMPv3 trap PDU tag 0x${pdu.tag.toString(16)}.`,
    );
  }
  const parsed = parseSnmpV2TrapPdu(3, "", scopedPdu, pdu);
  return {
    trapOid: parsed.trapOid,
    varbinds: parsed.varbinds,
  };
}

function parseSnmpV1TrapPdu(
  version: number,
  community: string,
  packet: Buffer,
  pdu: ReturnType<typeof readTlv>,
): ParsedSnmpTrap {
  let offset = pdu.valueStart;
  offset = readTlv(packet, offset).nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  const genericTrap = readTlv(packet, offset);
  offset = genericTrap.nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  const varbindsTlv = readTlv(packet, offset);
  const varbinds = parseVarbinds(packet, varbindsTlv);

  const generic = decodeInteger(genericTrap.value);
  const trapOid =
    generic === 2
      ? SNMP_TRAP_LINK_DOWN_OID
      : generic === 3
        ? SNMP_TRAP_LINK_UP_OID
        : undefined;

  return {
    snmpVersion: version === 0 ? "1" : "unknown",
    community,
    trapOid,
    genericTrap: generic,
    ifIndex: extractIfIndex(varbinds),
    varbinds,
  };
}

function parseSnmpV2TrapPdu(
  version: number,
  community: string,
  packet: Buffer,
  pdu: ReturnType<typeof readTlv>,
): ParsedSnmpTrap {
  let offset = pdu.valueStart;
  offset = readTlv(packet, offset).nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  offset = readTlv(packet, offset).nextOffset;
  const varbindsTlv = readTlv(packet, offset);
  const varbinds = parseVarbinds(packet, varbindsTlv);

  const trapVarbind = varbinds.find(
    (entry) => entry.oid === "1.3.6.1.6.3.1.1.4.1.0",
  );
  const trapOid = trapVarbind?.value
    ? normalizeOid(trapVarbind.value)
    : undefined;

  return {
    snmpVersion: version === 1 ? "2c" : "unknown",
    community,
    trapOid,
    ifIndex: extractIfIndex(varbinds),
    varbinds,
  };
}

function parseVarbinds(
  packet: Buffer,
  varbindsTlv: ReturnType<typeof readTlv>,
) {
  const varbinds: SnmpTrapVarbind[] = [];
  let offset = varbindsTlv.valueStart;

  while (offset < varbindsTlv.nextOffset) {
    const binding = readTlv(packet, offset);
    offset = binding.nextOffset;
    if (binding.tag !== 0x30) continue;

    const oidTlv = readTlv(packet, binding.valueStart);
    const valueTlv = readTlv(packet, oidTlv.nextOffset);
    varbinds.push({
      oid: decodeObjectIdentifier(oidTlv.value),
      value: decodeSnmpValue(valueTlv.tag, valueTlv.value),
    });
  }

  return varbinds;
}

export function extractIfIndex(varbinds: SnmpTrapVarbind[]) {
  for (const entry of varbinds) {
    const normalized = normalizeOid(entry.oid);
    if (normalized.startsWith(`${IF_INDEX_COLUMN_OID}.`)) {
      const suffix = normalized.slice(IF_INDEX_COLUMN_OID.length + 1);
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10);
      }
    }
    if (normalized.startsWith("1.3.6.1.2.1.2.2.1.8.")) {
      const suffix = normalized.slice("1.3.6.1.2.1.2.2.1.8.".length);
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10);
      }
    }
    if (normalized.startsWith("1.3.6.1.2.1.2.2.1.2.")) {
      const suffix = normalized.slice("1.3.6.1.2.1.2.2.1.2.".length);
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10);
      }
    }
  }

  for (const entry of varbinds) {
    const parsed = Number.parseInt(entry.value, 10);
    if (
      entry.oid === "1.3.6.1.2.1.2.2.1.1.0" &&
      Number.isInteger(parsed) &&
      parsed >= 0
    ) {
      return parsed;
    }
  }

  return undefined;
}

export function trapOidToLinkResult(
  trapOid: string | undefined,
  genericTrap?: number,
) {
  const normalized = trapOid ? normalizeOid(trapOid) : "";
  if (
    normalized === SNMP_TRAP_LINK_DOWN_OID ||
    normalized.endsWith(".1.3.6.1.6.3.1.1.5.3") ||
    genericTrap === 2
  ) {
    return "offline" as const;
  }
  if (
    normalized === SNMP_TRAP_LINK_UP_OID ||
    normalized.endsWith(".1.3.6.1.6.3.1.1.5.4") ||
    genericTrap === 3
  ) {
    return "online" as const;
  }
  return null;
}
