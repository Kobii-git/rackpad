import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPinnedRequestOptions,
  ensureRoutableHost,
  requestPinnedUrl,
  requestPinnedUrlWithBody,
  setNetworkHostLookupForTests,
  setPinnedRequestTransportForTests,
} from "../lib/net-guard.js";
import { integrationHttpRequest } from "../lib/integrations/http.js";

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
  for (const address of [
    "0.0.0.0",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "203.0.113.10",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "100::1",
    "2001:2::1",
    "2001:20::1",
    "2001:db8::1",
    "64:ff9b:1::1",
    "fec0::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ]) {
    await assert.rejects(
      () => ensureRoutableHost(address),
      /reserved ranges/,
      address,
    );
  }
});

test("ensureRoutableHost recursively accepts mapped private IPv4", async () => {
  assert.equal(
    await ensureRoutableHost("::ffff:10.20.30.40"),
    "::ffff:10.20.30.40",
  );
});

test("ensureRoutableHost rejects DNS answers mixed with blocked destinations", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  try {
    await assert.rejects(
      () => ensureRoutableHost("mixed.example"),
      /reserved ranges/,
    );
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
  assert.equal(options.rejectUnauthorized, true);
  assert.deepEqual(options.headers, {
    Accept: "application/json",
    Host: "monitor.example:8443",
  });
});

test("pinned HTTPS requests can explicitly disable certificate verification", () => {
  const options = buildPinnedRequestOptions(
    new URL("https://monitor.example/health"),
    { address: "10.20.30.40", family: 4 },
    {},
    "GET",
    false,
  );

  assert.equal(options.rejectUnauthorized, false);
});

test("redirects are re-resolved and revalidated before connecting", async () => {
  const resolvedHosts: string[] = [];
  const requestedHosts: string[] = [];
  const methods: Array<{ method: string; body?: string }> = [];
  const certificateChecks: boolean[] = [];
  setNetworkHostLookupForTests(async (host) => {
    resolvedHosts.push(host);
    return [{ address: "10.20.30.40", family: 4 }];
  });
  setPinnedRequestTransportForTests(async (url, _resolved, options) => {
    requestedHosts.push(url.hostname);
    methods.push({ method: options.method, body: options.body });
    certificateChecks.push(options.rejectUnauthorized);
    return url.hostname === "first.example"
      ? { statusCode: 302, location: "https://second.example/final" }
      : { statusCode: 204 };
  });

  try {
    const result = await requestPinnedUrl(
      new URL("https://first.example/start"),
      {
        method: "POST",
        body: "payload",
        rejectUnauthorized: false,
      },
    );
    assert.equal(result.url.toString(), "https://second.example/final");
    assert.deepEqual(resolvedHosts, ["first.example", "second.example"]);
    assert.deepEqual(requestedHosts, ["first.example", "second.example"]);
    assert.deepEqual(methods, [
      { method: "POST", body: "payload" },
      { method: "GET", body: undefined },
    ]);
    assert.deepEqual(certificateChecks, [false, false]);
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("redirects cannot switch to a blocked destination", async () => {
  setNetworkHostLookupForTests(async (host) => [
    {
      address: host === "metadata.example" ? "169.254.169.254" : "8.8.8.8",
      family: 4,
    },
  ]);
  setPinnedRequestTransportForTests(async () => ({
    statusCode: 302,
    location: "http://metadata.example/latest/meta-data",
  }));
  try {
    await assert.rejects(
      () => requestPinnedUrl(new URL("https://public.example/start")),
      /reserved ranges/,
    );
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("credentialed and explicitly same-origin requests reject cross-origin redirects", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  setPinnedRequestTransportForTests(async () => ({
    statusCode: 302,
    location: "https://other.example/final",
  }));
  try {
    await assert.rejects(
      () =>
        requestPinnedUrl(new URL("https://controller.example/start"), {
          headers: { Authorization: "Bearer secret" },
        }),
      /redirected credentials to a different origin/,
    );
    await assert.rejects(
      () =>
        requestPinnedUrl(new URL("https://controller.example/start"), {
          sameOriginRedirects: true,
        }),
      /redirected credentials to a different origin/,
    );
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("same-origin redirects are capped and revalidated on every hop", async () => {
  const resolvedHosts: string[] = [];
  let requestCount = 0;
  setNetworkHostLookupForTests(async (host) => {
    resolvedHosts.push(host);
    return [{ address: "10.20.30.40", family: 4 }];
  });
  setPinnedRequestTransportForTests(async () => {
    requestCount += 1;
    return {
      statusCode: 302,
      location: `/redirect-${requestCount}`,
    };
  });
  try {
    await assert.rejects(
      () =>
        requestPinnedUrl(new URL("https://controller.example/start"), {
          maxRedirects: 3,
          sameOriginRedirects: true,
        }),
      /too many redirects/,
    );
    assert.equal(requestCount, 4);
    assert.deepEqual(resolvedHosts, Array(4).fill("controller.example"));
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("body requests enforce the supplied TLS, timeout, and response bounds", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  let seenOptions:
    | {
        timeoutMs: number;
        rejectUnauthorized: boolean;
        captureBody?: boolean;
        maxResponseBytes?: number;
      }
    | undefined;
  setPinnedRequestTransportForTests(async (_url, _resolved, options) => {
    seenOptions = options;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      bodyText: '{"ok":true}',
    };
  });
  try {
    const result = await requestPinnedUrlWithBody(
      new URL("https://controller.example/api"),
      {
        timeoutMs: 9_000,
        maxResponseBytes: 8 * 1024 * 1024,
      },
    );
    assert.equal(result.bodyText, '{"ok":true}');
    assert.deepEqual(seenOptions, {
      timeoutMs: 9_000,
      headers: {},
      method: "GET",
      body: undefined,
      rejectUnauthorized: true,
      captureBody: true,
      maxResponseBytes: 8 * 1024 * 1024,
    });
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("integration HTTP uses the shared pinned guard with secure bounds", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  let seenOptions:
    | {
        timeoutMs: number;
        headers: Record<string, string>;
        rejectUnauthorized: boolean;
        captureBody?: boolean;
        maxResponseBytes?: number;
      }
    | undefined;
  setPinnedRequestTransportForTests(async (_url, _resolved, options) => {
    seenOptions = options;
    return { statusCode: 200, bodyText: '{"ok":true}' };
  });
  try {
    const response = await integrationHttpRequest(
      {
        url: new URL("https://controller.example/api"),
        headers: { Authorization: "Bearer secret" },
      },
      "Test controller",
    );
    assert.equal(response.bodyText, '{"ok":true}');
    assert.equal(seenOptions?.timeoutMs, 15_000);
    assert.equal(seenOptions?.rejectUnauthorized, true);
    assert.equal(seenOptions?.captureBody, true);
    assert.equal(seenOptions?.maxResponseBytes, 8 * 1024 * 1024);
    assert.deepEqual(seenOptions?.headers, {
      Accept: "application/json",
      Authorization: "Bearer secret",
    });
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});

test("body requests reject transport timeout, size, abort, and response errors", async () => {
  setNetworkHostLookupForTests(async () => [
    { address: "10.20.30.40", family: 4 },
  ]);
  try {
    for (const message of [
      "Request timed out.",
      "Response exceeded the allowed size.",
      "Response was aborted.",
      "Socket failed.",
    ]) {
      setPinnedRequestTransportForTests(async () => {
        throw new Error(message);
      });
      await assert.rejects(
        () =>
          requestPinnedUrlWithBody(
            new URL("https://controller.example/api"),
          ),
        new RegExp(message.replaceAll(".", "\\.")),
      );
    }
  } finally {
    setPinnedRequestTransportForTests(null);
    setNetworkHostLookupForTests(null);
  }
});
