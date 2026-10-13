// SNMPv3 messages are untrusted UDP input. Each reader is bounded by its
// enclosing TLV, not just the datagram, including nested USM/scoped sequences.
export class SnmpBerReader {
  private offset = 0;

  constructor(private readonly bytes: Buffer) {}

  take(tag?: number) {
    const start = this.offset;
    if (start + 2 > this.bytes.length) throw new Error("Truncated SNMPv3 BER.");
    const actualTag = this.bytes[start]!;
    const lengthByte = this.bytes[start + 1]!;
    let length = lengthByte;
    let valueStart = start + 2;
    if (lengthByte & 0x80) {
      const count = lengthByte & 0x7f;
      if (count === 0 || count > 4 || valueStart + count > this.bytes.length) {
        throw new Error("Invalid SNMPv3 BER length.");
      }
      length = this.bytes.readUIntBE(valueStart, count);
      valueStart += count;
    }
    const end = valueStart + length;
    if (end > this.bytes.length || (tag !== undefined && tag !== actualTag)) {
      throw new Error("Invalid SNMPv3 BER field.");
    }
    this.offset = end;
    return {
      tag: actualTag,
      value: this.bytes.subarray(valueStart, end),
      encoded: this.bytes.subarray(start, end),
      valueStart,
    };
  }

  integer() {
    const value = this.take(0x02).value;
    if (value.length < 1 || value.length > 4) {
      throw new Error("Invalid SNMPv3 integer.");
    }
    return value.readIntBE(0, value.length);
  }

  unsignedInteger() {
    const value = this.integer();
    if (value < 0) throw new Error("Invalid SNMPv3 nonnegative integer.");
    return value;
  }

  more() {
    return this.offset < this.bytes.length;
  }

  done() {
    if (this.offset !== this.bytes.length) {
      throw new Error("Unexpected SNMPv3 trailing fields.");
    }
  }
}

export function snmpSequence(bytes: Buffer) {
  const reader = new SnmpBerReader(bytes);
  const sequence = reader.take(0x30);
  reader.done();
  return new SnmpBerReader(sequence.value);
}

export function parseSnmpV3Envelope(packet: Buffer) {
  const outer = new SnmpBerReader(packet);
  const root = outer.take(0x30);
  outer.done();
  const body = new SnmpBerReader(root.value);
  if (body.integer() !== 3) throw new Error("Invalid SNMPv3 version.");
  const header = new SnmpBerReader(body.take(0x30).value);
  const msgId = header.unsignedInteger();
  if (header.unsignedInteger() < 484)
    throw new Error("Invalid SNMPv3 maximum size.");
  const flagBytes = header.take(0x04).value;
  if (flagBytes.length !== 1 || header.integer() !== 3) {
    throw new Error("Invalid SNMPv3 USM header.");
  }
  header.done();
  const flags = flagBytes[0]!;
  const security = body.take(0x04);
  const usmOuter = new SnmpBerReader(security.value);
  const usmSequence = usmOuter.take(0x30);
  usmOuter.done();
  const usm = new SnmpBerReader(usmSequence.value);
  const engineId = usm.take(0x04).value;
  const engineBoots = usm.unsignedInteger();
  const engineTime = usm.unsignedInteger();
  const userBytes = usm.take(0x04).value;
  const authentication = usm.take(0x04);
  const privacyParameters = usm.take(0x04).value;
  usm.done();
  const msgData = body.take();
  body.done();
  const auth = (flags & 1) !== 0;
  const priv = (flags & 2) !== 0;
  if (
    (engineId.length !== 0 && (engineId.length < 5 || engineId.length > 32)) ||
    userBytes.length > 32 ||
    authentication.value.length !== (auth ? 12 : 0) ||
    privacyParameters.length !== (priv ? 8 : 0) ||
    (priv && !auth) ||
    msgData.tag !== (priv ? 0x04 : 0x30)
  )
    throw new Error("Invalid SNMPv3 security parameters.");
  return {
    msgId,
    flags,
    engineId,
    engineBoots,
    engineTime,
    userBytes,
    user: userBytes.toString("utf8"),
    authParameters: authentication.value,
    authParametersOffset:
      root.valueStart +
      security.valueStart +
      usmSequence.valueStart +
      authentication.valueStart,
    privacyParameters,
    msgData,
  };
}

export function parseSnmpV3ScopedPdu(bytes: Buffer) {
  const scoped = snmpSequence(bytes);
  const contextEngineId = scoped.take(0x04).value;
  const contextName = scoped.take(0x04).value;
  const pdu = scoped.take();
  scoped.done();
  const body = new SnmpBerReader(pdu.value);
  const requestId = body.integer();
  const errorStatus = body.unsignedInteger();
  const errorIndex = body.unsignedInteger();
  const bindings = body.take(0x30).value;
  body.done();
  return {
    contextEngineId,
    contextName,
    tag: pdu.tag,
    requestId,
    errorStatus,
    errorIndex,
    bindings,
  };
}
