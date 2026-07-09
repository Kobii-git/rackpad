import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPinnedRequestOptions,
  ensureRoutableHost,
  requestPinnedUrl,
  setNetworkHostLookupForTests,
  setPinnedRequestTransportForTests,
} from "../lib/net-guard.js";

test("ensureRoutableHost rejects reserved address ranges", async () => {
  await assert.rejects(
    () => ensureRoutableHost("127.0.0.1"),
    /reserved ranges/,
  );
  await assert.rejects(
    () => ensureRoutableHost("169.254.169.254"),
    /reserved ranges/,
  );
  await assert.rejects(() => ensureRoutableHost("[::1]"), /reserved ranges/);
});

test("ensureRoutableHost accepts routable literal addresses", async () => {
  assert.equal(await ensureRoutableHost("8.8.8.8"), "8.8.8.8");
  assert.equal(await ensureRoutableHost("10.20.30.40"), "10.20.30.40");
  assert.equal(await ensureRoutableHost("192.168.1.50"), "192.168.1.50");
  assert.equal(await ensureRoutableHost("fd00::50"), "fd00::50");
});

test("ensureRoutableHost rejects multicast, benchmarking, and documentation ranges", async () => {
  await assert.rejects(() => ensureRoutableHost("224.0.0.1"), /reserved ranges/);
  await assert.rejects(() => ensureRoutableHost("198.18.0.1"), /reserved ranges/);
  await assert.rejects(() => ensureRoutableHost("203.0.113.10"), /reserved ranges/);
  await assert.rejects(() => ensureRoutableHost("2001:db8::1"), /reserved ranges/);
});

test("ensureRoutableHost rejects DNS answers mixed with blocked destinations", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  try {
    await assert.rejects(() => ensureRoutableHost("mixed.example"), /reserved ranges/);
  } finally {
    setNetworkHostLookupForTests(null);
  }
});

test("pinned HTTP requests preserve Host and TLS SNI", () => {
  const options = buildPinnedRequestOptions(
    new URL("https://monitor.example:8443/health?full=1"),
    { address: "10.20.30.40", family: 4 },
    { Accept: "application/json" },
  );

  assert.equal(options.hostname, "10.20.30.40");
  assert.equal(options.port, 8443);
  assert.equal(options.path, "/health?full=1");
  assert.equal(options.servername, "monitor.example");
  assert.deepEqual(options.headers, {
    Accept: "application/json",
    Host: "monitor.example:8443",
  });
});

test("redirects are re-resolved and revalidated before connecting", async () => {
  const resolvedHosts: string[] = [];
  const requestedHosts: string[] = [];
  const methods: Array<{ method: string; body?: string }> = [];
  setNetworkHostLookupForTests(async (host) => {
    resolvedHosts.push(host);
    return [{ address: "10.20.30.40", family: 4 }];
  });
  setPinnedRequestTransportForTests(async (url, _resolved, options) => {
    requestedHosts.push(url.hostname);
    methods.push({ method: options.method, body: options.body });
    return url.hostname === "first.example"
      ? { statusCode: 302, location: "https://second.example/final" }
      : { statusCode: 204 };
  });

  try {
    const result = await requestPinnedUrl(new URL("https://first.example/start"), {
      method: "POST",
      body: "payload",
    });
    assert.equal(result.url.toString(), "https://second.example/final");
    assert.deepEqual(resolvedHosts, ["first.example", "second.example"]);
    assert.deepEqual(requestedHosts, ["first.example", "second.example"]);
    assert.deepEqual(methods, [
      { method: "POST", body: "payload" },
      { method: "GET", body: undefined },
    ]);
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});
