import { randomInt } from "node:crypto";
import {
  berInteger,
  berObjectIdentifier,
  berOctetString,
  berSequence,
  berTlv,
} from "./snmp.js";
import { SNMP_TRAP_LINK_DOWN_OID } from "./snmp-trap-parser.js";
import {
  buildAuth,
  buildScopedPdu,
  buildSnmpV3Message,
  buildUsmSecurityParameters,
  encryptScopedPdu,
  localizedPrivKey,
  passwordToKey,
  type SnmpV3AuthProtocol,
  type SnmpV3PrivProtocol,
} from "./snmp-v3.js";

export function buildSnmpV2TrapPacket(options: {
  community?: string;
  trapOid?: string;
  ifIndex?: number;
  sysUpTimeTicks?: number;
}) {
  const community = options.community ?? "public";
  const trapOid = options.trapOid ?? SNMP_TRAP_LINK_DOWN_OID;
  const sysUpTime = options.sysUpTimeTicks ?? 12345;

  const varbinds: Buffer[] = [
    berSequence(
      Buffer.concat([
        berObjectIdentifier("1.3.6.1.2.1.1.3.0"),
        berTlv(0x43, berInteger(sysUpTime).subarray(2)),
      ]),
    ),
    berSequence(
      Buffer.concat([
        berObjectIdentifier("1.3.6.1.6.3.1.1.4.1.0"),
        berObjectIdentifier(trapOid),
      ]),
    ),
  ];

  if (options.ifIndex != null) {
    varbinds.push(
      berSequence(
        Buffer.concat([
          berObjectIdentifier(`1.3.6.1.2.1.2.2.1.1.${options.ifIndex}`),
          berInteger(options.ifIndex),
        ]),
      ),
    );
  }

  const pdu = berTlv(
    0xa7,
    Buffer.concat([
      berInteger(1),
      berInteger(0),
      berInteger(0),
      berSequence(Buffer.concat(varbinds)),
    ]),
  );

  return berSequence(
    Buffer.concat([berInteger(1), berOctetString(community), pdu]),
  );
}

export function buildSnmpV3TrapPacket(options: {
  user: string;
  authProtocol?: SnmpV3AuthProtocol;
  authPassword: string;
  privProtocol?: SnmpV3PrivProtocol;
  privPassword?: string;
  contextName?: string;
  engineId?: Buffer;
  engineBoots?: number;
  engineTime?: number;
  trapOid?: string;
  ifIndex?: number;
  sysUpTimeTicks?: number;
}) {
  const authProtocol = options.authProtocol ?? "SHA";
  const privProtocol = options.privProtocol ?? "none";
  const engineId = options.engineId ?? Buffer.from("8000000001020304", "hex");
  const engineBoots = options.engineBoots ?? 7;
  const engineTime = options.engineTime ?? 123;
  const trapOid = options.trapOid ?? SNMP_TRAP_LINK_DOWN_OID;
  const sysUpTime = options.sysUpTimeTicks ?? 12345;
  const msgId = randomInt(1, 0x7fffffff);

  const varbinds: Buffer[] = [
    berSequence(
      Buffer.concat([
        berObjectIdentifier("1.3.6.1.2.1.1.3.0"),
        berTlv(0x43, berInteger(sysUpTime).subarray(2)),
      ]),
    ),
    berSequence(
      Buffer.concat([
        berObjectIdentifier("1.3.6.1.6.3.1.1.4.1.0"),
        berObjectIdentifier(trapOid),
      ]),
    ),
  ];

  if (options.ifIndex != null) {
    varbinds.push(
      berSequence(
        Buffer.concat([
          berObjectIdentifier(`1.3.6.1.2.1.2.2.1.1.${options.ifIndex}`),
          berInteger(options.ifIndex),
        ]),
      ),
    );
  }

  const pdu = berTlv(
    0xa7,
    Buffer.concat([
      berInteger(msgId),
      berInteger(0),
      berInteger(0),
      berSequence(Buffer.concat(varbinds)),
    ]),
  );
  const scopedPdu = buildScopedPdu(engineId, options.contextName ?? "", pdu);
  const authKey = passwordToKey(authProtocol, options.authPassword, engineId);
  let flags = 0x01;
  let privacyParameters = Buffer.alloc(0);
  let msgData = scopedPdu;

  if (privProtocol === "AES128") {
    flags = 0x03;
    const privKey = localizedPrivKey(
      authProtocol,
      options.privPassword ?? "",
      engineId,
    );
    const encrypted = encryptScopedPdu(
      scopedPdu,
      privKey,
      engineBoots,
      engineTime,
    );
    privacyParameters = encrypted.salt;
    msgData = berOctetString(encrypted.encrypted);
  }

  let securityParameters = buildUsmSecurityParameters(
    engineId,
    engineBoots,
    engineTime,
    options.user,
    Buffer.alloc(12),
    privacyParameters,
  );
  let message = buildSnmpV3Message({
    msgId,
    flags,
    securityParameters,
    msgData,
  });
  const authParameters = buildAuth(authProtocol, authKey, message);
  securityParameters = buildUsmSecurityParameters(
    engineId,
    engineBoots,
    engineTime,
    options.user,
    authParameters,
    privacyParameters,
  );
  return buildSnmpV3Message({
    msgId,
    flags,
    securityParameters,
    msgData,
  });
}
