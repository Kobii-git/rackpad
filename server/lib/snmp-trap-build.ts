import {
  berInteger,
  berObjectIdentifier,
  berOctetString,
  berSequence,
  berTlv,
} from './snmp.js'
import { SNMP_TRAP_LINK_DOWN_OID } from './snmp-trap-parser.js'

export function buildSnmpV2TrapPacket(options: {
  community?: string
  trapOid?: string
  ifIndex?: number
  sysUpTimeTicks?: number
}) {
  const community = options.community ?? 'public'
  const trapOid = options.trapOid ?? SNMP_TRAP_LINK_DOWN_OID
  const sysUpTime = options.sysUpTimeTicks ?? 12345

  const varbinds: Buffer[] = [
    berSequence(
      Buffer.concat([
        berObjectIdentifier('1.3.6.1.2.1.1.3.0'),
        berTlv(0x43, berInteger(sysUpTime).subarray(2)),
      ]),
    ),
    berSequence(
      Buffer.concat([
        berObjectIdentifier('1.3.6.1.6.3.1.1.4.1.0'),
        berObjectIdentifier(trapOid),
      ]),
    ),
  ]

  if (options.ifIndex != null) {
    varbinds.push(
      berSequence(
        Buffer.concat([
          berObjectIdentifier(`1.3.6.1.2.1.2.2.1.1.${options.ifIndex}`),
          berInteger(options.ifIndex),
        ]),
      ),
    )
  }

  const pdu = berTlv(
    0xa7,
    Buffer.concat([
      berInteger(1),
      berInteger(0),
      berInteger(0),
      berSequence(Buffer.concat(varbinds)),
    ]),
  )

  return berSequence(Buffer.concat([berInteger(1), berOctetString(community), pdu]))
}
