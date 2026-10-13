// Independent test encoder/crypto: deliberately does not call Rackpad's wire
// or cryptographic helpers. Real Net-SNMP interoperability complements it.
import {
  createHash,
  createHmac,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import assert from "node:assert/strict";
export const wireEngine = Buffer.from("000000000000000000000002", "hex");
export const wireOid = "1.3.6.1.2.1.1.5.0";
export const unknownEngineOid = "1.3.6.1.6.3.15.1.1.4.0";
export const timeWindowOid = "1.3.6.1.6.3.15.1.1.2.0";
export function tlv(tag: number, value: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  // RFC 3417 permits non-minimal definite lengths; exercise that on every field.
  return Buffer.concat([Buffer.from([tag, 0x84]), length, value]);
}
export const sequence = (...values: Buffer[]) =>
  tlv(0x30, Buffer.concat(values));
const octets = (value: string | Buffer) => tlv(4, Buffer.from(value));
const integer = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(value);
  return tlv(2, b);
};
function oid(value: string) {
  const parts = value.split(".").map(Number);
  const bytes = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    let n = part;
    const encoded = [n & 127];
    while ((n = Math.floor(n / 128)) > 0) encoded.unshift((n & 127) | 128);
    bytes.push(...encoded);
  }
  return tlv(6, Buffer.from(bytes));
}
export function referenceKey(
  protocol: "MD5" | "SHA",
  password: string,
  engine: Buffer = wireEngine,
) {
  const algorithm = protocol === "MD5" ? "md5" : "sha1";
  const passwordBytes = Buffer.from(password);
  const hash = createHash(algorithm);
  const chunk = Buffer.alloc(64);
  let position = 0;
  for (let count = 0; count < 1048576; count += 64) {
    for (let i = 0; i < 64; i++)
      chunk[i] = passwordBytes[position++ % passwordBytes.length]!;
    hash.update(chunk);
  }
  const ku = hash.digest();
  return createHash(algorithm)
    .update(Buffer.concat([ku, engine, ku]))
    .digest();
}
export interface WireOptions {
  msgId: number;
  requestId?: number;
  flags?: number;
  engine?: Buffer;
  boots?: number;
  time?: number;
  contextEngine?: Buffer;
  context?: string;
  user?: string;
  protocol?: "MD5" | "SHA";
  authPassword?: string;
  privPassword?: string;
  pdu?: number;
  oid?: string;
  value?: Buffer;
  valueTag?: number;
  salt?: Buffer;
  errorStatus?: number;
}
export function wirePacket(options: WireOptions) {
  const engine = options.engine ?? wireEngine,
    boots = options.boots ?? 7,
    time = options.time ?? 500;
  const flags = options.flags ?? 1,
    protocol = options.protocol ?? "SHA";
  const header = sequence(
    integer(options.msgId),
    integer(65507),
    octets(Buffer.from([flags])),
    integer(3),
  );
  let data = sequence(
    octets(options.contextEngine ?? engine),
    octets(options.context ?? ""),
    tlv(
      options.pdu ?? 0xa2,
      Buffer.concat([
        integer(options.requestId ?? options.msgId),
        integer(options.errorStatus ?? 0),
        integer(0),
        sequence(
          sequence(
            oid(options.oid ?? wireOid),
            tlv(
              options.valueTag ?? 4,
              options.value ?? Buffer.from("fixture-switch"),
            ),
          ),
        ),
      ]),
    ),
  );
  const salt = options.salt ?? Buffer.from("0102030405060708", "hex");
  if (flags & 2) {
    const iv = Buffer.alloc(16);
    iv.writeUInt32BE(boots);
    iv.writeUInt32BE(time, 4);
    salt.copy(iv, 8);
    const cipher = createCipheriv(
      "aes-128-cfb",
      referenceKey(
        protocol,
        options.privPassword ?? "priv-maplesyrup",
        engine,
      ).subarray(0, 16),
      iv,
    );
    data = octets(Buffer.concat([cipher.update(data), cipher.final()]));
  }
  const security = (auth: Buffer) =>
    octets(
      sequence(
        octets(engine),
        integer(boots),
        integer(time),
        octets(options.user ?? "fixture-user"),
        octets(auth),
        octets(flags & 2 ? salt : Buffer.alloc(0)),
      ),
    );
  let result = sequence(
    integer(3),
    header,
    security(Buffer.alloc(flags & 1 ? 12 : 0)),
    data,
  );
  if (flags & 1) {
    const mac = createHmac(
      protocol === "MD5" ? "md5" : "sha1",
      referenceKey(protocol, options.authPassword ?? "maplesyrup", engine),
    )
      .update(result)
      .digest()
      .subarray(0, 12);
    result = sequence(integer(3), header, security(mac), data);
  }
  return result;
}
export function discoveryPacket(
  msgId: number,
  overrides: Partial<WireOptions> = {},
) {
  return wirePacket({
    msgId,
    requestId: 0,
    flags: 0,
    user: "",
    pdu: 0xa8,
    oid: unknownEngineOid,
    valueTag: 0x41,
    value: Buffer.from([1]),
    ...overrides,
  });
}
function fields(bytes: Buffer) {
  const result: {
    tag: number;
    value: Buffer;
    start: number;
    encoded: Buffer;
  }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const start = offset,
      tag = bytes[offset++]!;
    let length = bytes[offset++]!;
    if (length & 128) {
      const count = length & 127;
      length = bytes.readUIntBE(offset, count);
      offset += count;
    }
    result.push({
      tag,
      value: bytes.subarray(offset, offset + length),
      start: offset,
      encoded: bytes.subarray(start, offset + length),
    });
    offset += length;
  }
  return result;
}
export function inspectRequest(
  packet: Buffer,
  protocol: "MD5" | "SHA" = "SHA",
  authPassword = "maplesyrup",
  privPassword = "priv-maplesyrup",
) {
  const root = fields(packet)[0]!,
    body = fields(root.value),
    header = fields(body[1]!.value);
  const msgId = header[0]!.value.readIntBE(0, header[0]!.value.length),
    flags = header[2]!.value[0]!;
  const usmRoot = fields(body[2]!.value)[0]!,
    usm = fields(usmRoot.value),
    engine = usm[0]!.value;
  const boots = usm[1]!.value.readIntBE(0, usm[1]!.value.length),
    time = usm[2]!.value.readIntBE(0, usm[2]!.value.length);
  let data = body[3]!.encoded;
  if (flags & 1) {
    const authOffset =
      root.start + body[2]!.start + usmRoot.start + usm[4]!.start;
    const unsigned = Buffer.from(packet);
    unsigned.fill(0, authOffset, authOffset + 12);
    const mac = createHmac(
      protocol === "MD5" ? "md5" : "sha1",
      referenceKey(protocol, authPassword, engine),
    )
      .update(unsigned)
      .digest()
      .subarray(0, 12);
    assert.deepEqual(
      usm[4]!.value,
      mac,
      "outgoing request HMAC must match the independent implementation",
    );
  } else assert.equal(usm[4]!.value.length, 0);
  if (flags & 2) {
    assert.equal(usm[5]!.value.length, 8);
    const iv = Buffer.alloc(16);
    iv.writeUInt32BE(boots);
    iv.writeUInt32BE(time, 4);
    usm[5]!.value.copy(iv, 8);
    const decipher = createDecipheriv(
      "aes-128-cfb",
      referenceKey(protocol, privPassword, engine).subarray(0, 16),
      iv,
    );
    data = Buffer.concat([decipher.update(body[3]!.value), decipher.final()]);
  }
  const scoped = fields(fields(data)[0]!.value);
  return {
    msgId,
    flags,
    engine,
    boots,
    time,
    pduTag: scoped[2]!.tag,
    context: scoped[1]!.value.toString(),
    user: usm[3]!.value.toString(),
  };
}
