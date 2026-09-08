import assert from "node:assert/strict";
import test from "node:test";
import { boundedSnmpTimeoutMs } from "../lib/snmp.js";
import { passwordToKey } from "../lib/snmp-v3.js";

test("boundedSnmpTimeoutMs returns fixed safe timeout buckets", () => {
  assert.equal(boundedSnmpTimeoutMs(Number.NaN), 8000);
  assert.equal(boundedSnmpTimeoutMs(50), 1000);
  assert.equal(boundedSnmpTimeoutMs(1501), 2000);
  assert.equal(boundedSnmpTimeoutMs(35_000), 30_000);
});

test("passwordToKey rejects empty SNMPv3 passwords", () => {
  assert.throws(
    () => passwordToKey("SHA", "", Buffer.from([0x80, 0x00, 0x00, 0x01])),
    /SNMPv3 password must not be empty/,
  );
});

import { afterEach, mock } from "node:test";
import { EventEmitter } from "node:events";
import type dgram from "node:dgram";
import { createCipheriv } from "node:crypto";
import {
  localizedPrivKey,
  encryptScopedPdu,
  decryptScopedPdu,
  snmpV3Request,
  resetSnmpV3EngineCache,
} from "../lib/snmp-v3.js";
import { parseSnmpV3Envelope } from "../lib/snmp-v3-message.js";
import { setSnmpSocketFactoryForTests } from "../lib/snmp-transport.js";
import { parseSnmpTrapPacket } from "../lib/snmp-trap-parser.js";
import { buildSnmpV3TrapPacket } from "../lib/snmp-trap-build.js";
import {
  wireEngine,
  wireOid,
  referenceKey,
  discoveryPacket,
  inspectRequest,
  wirePacket,
  timeWindowOid,
  type WireOptions,
} from "./fixtures/snmp-v3-wire.js";

const session = {
  host: "10.20.0.5",
  port: 161,
  timeoutMs: 1000,
  version: "3" as const,
  user: "fixture-user",
  authProtocol: "SHA" as const,
  authPassword: "maplesyrup",
  privProtocol: "none" as const,
  privPassword: "priv-maplesyrup",
};
const peer = { address: session.host, port: 161, family: "IPv4", size: 0 };
afterEach(() => {
  setSnmpSocketFactoryForTests(null);
  resetSnmpV3EngineCache();
  mock.restoreAll();
  mock.timers.reset();
});

for (const [protocol, expected] of [
  ["MD5", "526f5eed9fcce26f8964c2930787d82b"],
  ["SHA", "6695febc9288e36282235fc7151f128497b38f3f"],
] as const) {
  test(`RFC 3414 ${protocol} published vector and continuous UTF-8 key expansion`, () => {
    assert.equal(
      passwordToKey(protocol, "maplesyrup", wireEngine).toString("hex"),
      expected,
    );
    for (const password of [
      "a",
      "abcdefgh",
      "12345678901",
      "x".repeat(64),
      "a".repeat(64) + "z",
      "café-密碼🔑".repeat(8),
    ]) {
      assert.deepEqual(
        passwordToKey(protocol, password, wireEngine),
        referenceKey(protocol, password),
      );
      assert.deepEqual(
        localizedPrivKey(protocol, password, wireEngine),
        referenceKey(protocol, password).subarray(0, 16),
      );
    }
  });
}

test("AES uses the full eight-byte salt and interoperable CFB128 without padding", () => {
  const key = Buffer.alloc(16, 7),
    plain = Buffer.from("a non-block-sized scoped payload");
  let previous: bigint | undefined;
  for (let i = 0; i < 20; i++) {
    const { encrypted, salt } = encryptScopedPdu(plain, key, 7, 100);
    assert.equal(salt.length, 8);
    if (previous !== undefined)
      assert.equal(salt.readBigUInt64BE(), BigInt.asUintN(64, previous + 1n));
    previous = salt.readBigUInt64BE();
    const iv = Buffer.alloc(16);
    iv.writeUInt32BE(7);
    iv.writeUInt32BE(100, 4);
    salt.copy(iv, 8);
    const cipher = createCipheriv("aes-128-cfb", key, iv);
    assert.deepEqual(
      encrypted,
      Buffer.concat([cipher.update(plain), cipher.final()]),
    );
    assert.deepEqual(decryptScopedPdu(encrypted, key, 7, 100, salt), plain);
  }
  for (const n of [0, 4, 7, 9, 12])
    assert.throws(
      () => decryptScopedPdu(plain, key, 7, 100, Buffer.alloc(n)),
      /salt/,
    );
});

function transport(
  respond: (packet: Buffer, socket: EventEmitter, send: number) => void,
) {
  let sends = 0,
    closes = 0;
  setSnmpSocketFactoryForTests(() => {
    const socket = new EventEmitter();
    return Object.assign(socket, {
      send: (packet: Buffer, port: number, address: string) => {
        assert.equal(port, 161);
        assert.equal(address, session.host);
        const number = ++sends;
        queueMicrotask(() => respond(packet, socket, number));
      },
      close: () => {
        closes++;
      },
    }) as unknown as dgram.Socket;
  });
  return {
    get sends() {
      return sends;
    },
    get closes() {
      return closes;
    },
  };
}
const emit = (socket: EventEmitter, packet: Buffer) =>
  socket.emit("message", packet, peer);

for (const protocol of ["MD5", "SHA"] as const)
  for (const privacy of ["none", "AES128"] as const)
    for (const mode of ["get", "getNext"] as const) {
      test(`${protocol}/${privacy} ${mode} authenticates independent replies and preserves confirmed flags/context`, async () => {
        const state = transport((packet, socket, send) => {
          const request = inspectRequest(packet, protocol);
          assert.ok(request.flags & 4);
          if (send === 1) {
            assert.equal(request.flags, 4);
            assert.equal(request.user, "");
            emit(socket, discoveryPacket(request.msgId));
            return;
          }
          assert.equal(request.flags, privacy === "AES128" ? 7 : 5);
          assert.equal(request.pduTag, mode === "get" ? 0xa0 : 0xa1);
          assert.equal(request.context, "vrf-blue");
          emit(
            socket,
            wirePacket({
              msgId: request.msgId,
              protocol,
              flags: privacy === "AES128" ? 3 : 1,
              context: "vrf-blue",
            }),
          );
        });
        assert.equal(
          (
            await snmpV3Request(
              {
                ...session,
                authProtocol: protocol,
                privProtocol: privacy,
                context: "vrf-blue",
              },
              wireOid,
              mode,
            )
          ).kind,
          "value",
        );
        assert.equal(state.closes, 2);
      });
    }

test("unrelated peers/ports/IDs and malformed packets do not consume discovery or authenticated requests", async () => {
  const state = transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    const response =
      send === 1 ? discoveryPacket(msgId) : wirePacket({ msgId });
    socket.emit("message", response, { ...peer, address: "10.20.0.9" });
    socket.emit("message", response, { ...peer, port: 162 });
    emit(
      socket,
      send === 1
        ? discoveryPacket(msgId + 1)
        : wirePacket({ msgId: msgId + 1 }),
    );
    emit(socket, Buffer.from([0x30, 0x84, 0xff, 0xff, 0xff, 0xff]));
    socket.emit("message", response, { ...peer, address: "::ffff:10.20.0.5" });
  });
  assert.equal((await snmpV3Request(session, wireOid, "get")).kind, "value");
  assert.equal(state.sends, 2);
  assert.equal(state.closes, 2);
});

for (const [name, overrides] of Object.entries({
  unsigned: { flags: 0 },
  user: { user: "wrong-user" },
  engine: { engine: Buffer.from("000000000000000000000003", "hex") },
  request: { requestId: 0 },
  context: { context: "wrong" },
  contextEngine: {
    contextEngine: Buffer.from("000000000000000000000003", "hex"),
  },
  wrongPassword: { authPassword: "wrong-password" },
  stale: { time: 1 },
  rebootReplay: { boots: 6 },
  oid: { oid: "1.3.6.1.2.1.1.1.0" },
} satisfies Record<string, Partial<WireOptions>>)) {
  test(`rejects ${name} response and never trusts its engine cache`, async () => {
    let discoveries = 0;
    transport((packet, socket) => {
      const { msgId, flags } = inspectRequest(packet);
      if (flags === 4) {
        discoveries++;
        emit(socket, discoveryPacket(msgId));
      } else emit(socket, wirePacket({ msgId, ...overrides }));
    });
    await assert.rejects(snmpV3Request(session, wireOid, "get"));
    await assert.rejects(snmpV3Request(session, wireOid, "get"));
    assert.equal(discoveries, 2);
  });
}

test("tampered encrypted reply fails authentication before attempting decryption", async () => {
  transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    if (send === 1) return emit(socket, discoveryPacket(msgId));
    const reply = wirePacket({ msgId, flags: 3 });
    reply[reply.length - 1] ^= 1;
    emit(socket, reply);
  });
  await assert.rejects(
    snmpV3Request({ ...session, privProtocol: "AES128" }, wireOid, "get"),
    /authentication failed/,
  );
});

test("authPriv data cannot downgrade to an authenticated plaintext response", async () => {
  transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    emit(socket, send === 1 ? discoveryPacket(msgId) : wirePacket({ msgId }));
  });
  await assert.rejects(
    snmpV3Request({ ...session, privProtocol: "AES128" }, wireOid, "get"),
    /security level/,
  );
});

test("authenticated time report permits request ID zero/default context, retries once, and advances cached clock", async () => {
  let now = 1000;
  mock.method(performance, "now", () => now);
  const ids: number[] = [];
  const state = transport((packet, socket, send) => {
    const request = inspectRequest(packet);
    ids.push(request.msgId);
    if (send === 1) return emit(socket, discoveryPacket(request.msgId));
    if (send === 2)
      return emit(
        socket,
        wirePacket({
          msgId: request.msgId,
          requestId: 0,
          flags: 1,
          pdu: 0xa8,
          oid: timeWindowOid,
          valueTag: 0x41,
          value: Buffer.from([1]),
          boots: 8,
          time: 900,
        }),
      );
    assert.equal(request.boots, 8);
    assert.equal(request.time, send === 3 ? 900 : 902);
    emit(
      socket,
      wirePacket({
        msgId: request.msgId,
        flags: 3,
        boots: 8,
        time: request.time,
        context: "vrf-blue",
      }),
    );
  });
  const privateSession = {
    ...session,
    privProtocol: "AES128" as const,
    context: "vrf-blue",
  };
  await snmpV3Request(privateSession, wireOid, "get");
  now += 2500;
  await snmpV3Request(privateSession, wireOid, "get");
  assert.equal(state.sends, 4);
  assert.notEqual(ids[1], ids[2]);
  assert.equal(state.closes, 4);
});

test("a second authenticated time report cannot trigger a third request", async () => {
  const state = transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    emit(
      socket,
      send === 1
        ? discoveryPacket(msgId)
        : wirePacket({
            msgId,
            pdu: 0xa8,
            oid: timeWindowOid,
            valueTag: 0x41,
            value: Buffer.from([1]),
          }),
    );
  });
  await assert.rejects(
    snmpV3Request(session, wireOid, "get"),
    /synchronization/,
  );
  assert.equal(state.sends, 3);
  assert.equal(state.closes, 3);
});

test("time report cannot extend the original deadline", async () => {
  let now = 1000;
  mock.method(performance, "now", () => now);
  const state = transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    if (send === 1) return emit(socket, discoveryPacket(msgId));
    now += 1001;
    emit(
      socket,
      wirePacket({
        msgId,
        pdu: 0xa8,
        oid: timeWindowOid,
        valueTag: 0x41,
        value: Buffer.from([1]),
      }),
    );
  });
  await assert.rejects(snmpV3Request(session, wireOid, "get"), /timed out/);
  assert.equal(state.sends, 2);
  assert.equal(state.closes, 2);
});

test("stalled discovery closes its socket at the bounded timeout", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const state = transport(() => {});
  const rejected = assert.rejects(
    snmpV3Request(session, wireOid, "get"),
    /timed out/,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  mock.timers.tick(1001);
  await rejected;
  assert.equal(state.closes, 1);
});

test("strict envelope accepts BER long lengths and rejects truncation/trailing/overflow", () => {
  const packet = wirePacket({ msgId: 1 });
  assert.equal(parseSnmpV3Envelope(packet).msgId, 1);
  for (let n = 0; n < packet.length; n++)
    assert.throws(() => parseSnmpV3Envelope(packet.subarray(0, n)));
  assert.throws(() =>
    parseSnmpV3Envelope(Buffer.concat([packet, Buffer.from([0])])),
  );
  const overflow = Buffer.from(packet);
  overflow.fill(0xff, 2, 6);
  assert.throws(() => parseSnmpV3Envelope(overflow));
  const indefinite = Buffer.from(packet);
  indefinite[1] = 0x80;
  assert.throws(() => parseSnmpV3Envelope(indefinite));
  assert.throws(() =>
    parseSnmpV3Envelope(
      wirePacket({ msgId: 1, flags: 3, salt: Buffer.alloc(4) }),
    ),
  );
});

for (const protocol of ["MD5", "SHA"] as const)
  for (const privacy of ["none", "AES128"] as const) {
    test(`trap ${protocol}/${privacy} accepts independent crypto and rejects unsigned/privacy downgrades`, () => {
      const credential = {
        id: "fixture-credential",
        user: session.user,
        authProtocol: protocol,
        authPassword: session.authPassword,
        privProtocol: privacy,
        privPassword: session.privPassword,
      };
      const options = { v3Credentials: [credential] };
      const external = wirePacket({
        msgId: 12,
        pdu: 0xa7,
        protocol,
        flags: privacy === "AES128" ? 3 : 1,
      });
      assert.equal(parseSnmpTrapPacket(external, options).authVerified, true);
      const built = buildSnmpV3TrapPacket({
        user: session.user,
        authProtocol: protocol,
        authPassword: session.authPassword,
        privProtocol: privacy,
        privPassword: session.privPassword,
        engineId: wireEngine,
      });
      assert.equal(inspectRequest(built, protocol).pduTag, 0xa7);
      assert.throws(
        () =>
          parseSnmpTrapPacket(
            wirePacket({ msgId: 12, pdu: 0xa7, flags: 0 }),
            options,
          ),
        /security level/,
      );
      if (privacy === "AES128")
        assert.throws(
          () =>
            parseSnmpTrapPacket(
              wirePacket({ msgId: 12, pdu: 0xa7, protocol, flags: 1 }),
              options,
            ),
          /security level/,
        );
    });
  }

test("delayed equal-time responses cannot reset the trusted engine clock", async () => {
  let now = 1000;
  mock.method(performance, "now", () => now);
  transport((packet, socket, send) => {
    const request = inspectRequest(packet);
    if (send === 1) return emit(socket, discoveryPacket(request.msgId));
    if (send === 4) assert.equal(request.time, 520);
    emit(socket, wirePacket({ msgId: request.msgId, time: 500 }));
  });
  await snmpV3Request(session, wireOid, "get");
  now += 20000;
  await snmpV3Request(session, wireOid, "get");
  await snmpV3Request(session, wireOid, "get");
});

test("authenticated traps reject stale clocks and previous engine boots without trusting downgrades", async () => {
  const { resetSnmpV3TrapEngineClocks } =
    await import("../lib/snmp-trap-parser.js");
  resetSnmpV3TrapEngineClocks();
  let now = 1000;
  mock.method(performance, "now", () => now);
  const options = {
    v3Credentials: [
      {
        id: "clock-credential",
        user: session.user,
        authProtocol: session.authProtocol,
        authPassword: session.authPassword,
        privProtocol: session.privProtocol,
        privPassword: session.privPassword,
      },
    ],
  };
  const trap = (boots: number, time: number) =>
    wirePacket({ msgId: 12, pdu: 0xa7, boots, time });
  assert.equal(parseSnmpTrapPacket(trap(8, 1000), options).authVerified, true);
  assert.throws(
    () => parseSnmpTrapPacket(trap(7, 500), options),
    /time window/,
  );
  now += 151000;
  assert.throws(
    () => parseSnmpTrapPacket(trap(8, 1000), options),
    /time window/,
  );
  assert.equal(parseSnmpTrapPacket(trap(9, 1), options).authVerified, true);
  resetSnmpV3TrapEngineClocks();
});

test("concurrent old-engine replies cannot return data after a verified reboot", async () => {
  let held: (() => void) | undefined;
  transport((packet, socket, send) => {
    const { msgId } = inspectRequest(packet);
    if (send === 1) return emit(socket, discoveryPacket(msgId));
    if (send === 3) {
      held = () => emit(socket, wirePacket({ msgId, boots: 7, time: 500 }));
      return;
    }
    emit(
      socket,
      wirePacket({
        msgId,
        boots: send === 2 ? 7 : 8,
        time: send === 2 ? 500 : 10,
      }),
    );
  });
  await snmpV3Request(session, wireOid, "get");
  const oldRequest = snmpV3Request(session, wireOid, "get");
  const rejected = assert.rejects(oldRequest, /time window/);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await snmpV3Request(session, wireOid, "get");
  assert.ok(held);
  held();
  await rejected;
});
