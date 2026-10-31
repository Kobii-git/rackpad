export async function provisionKuma({ password }) {
  const { default: assert } = await import("node:assert/strict");
  // Use the pinned service's own Socket.IO client, including its reconnect
  // handshake while a fresh database finishes migrating.
  const { io } = await import("socket.io-client");
  const socket = io("http://127.0.0.1:3001", {
    transports: ["websocket"],
    reconnection: true,
    timeout: 5000,
  });
  let timer;
  const ready = new Promise((resolve, reject) => {
    socket.once("setup", resolve);
    timer = setTimeout(
      () => reject(new Error("Kuma setup timed out.")),
      90_000,
    );
  });
  const emit = (event, ...args) =>
    socket.timeout(15_000).emitWithAck(event, ...args);
  let stage = "connect";
  try {
    await ready;
    stage = "setup";
    assert.ok(
      (await emit("setup", "fixture", password)).ok,
      "Kuma setup must succeed.",
    );
    stage = "login";
    assert.ok(
      (await emit("login", { username: "fixture", password })).ok,
      "Kuma login must succeed.",
    );
    stage = "monitor";
    const monitor = await emit("add", {
      name: "Fixture HTTP service",
      type: "http",
      url: "http://host-health-peer:8787/health",
      method: "GET",
      interval: 20,
      retryInterval: 20,
      maxretries: 0,
      timeout: 5,
      active: true,
      accepted_statuscodes: ["200-299"],
      notificationIDList: {},
      maxredirects: 0,
      parent: null,
      conditions: [],
      kafkaProducerBrokers: [],
      kafkaProducerSaslOptions: {},
      rabbitmqNodes: [],
    });
    assert.ok(monitor.ok, "Kuma must create a real HTTP monitor.");
    stage = "key";
    const key = await emit("addAPIKey", {
      name: "Rackpad fixture",
      expires: null,
      active: true,
    });
    assert.ok(
      key.ok && typeof key.key === "string",
      "Kuma must create a real metrics API key.",
    );
    return key.key;
  } catch (error) {
    throw new Error(
      `Kuma setup stage=${stage} timedOut=${/timed? ?out/i.test(error instanceof Error ? error.message : "")}`,
    );
  } finally {
    clearTimeout(timer);
    socket.disconnect();
  }
}

export async function exerciseHostProviders({
  credentials,
  glancesPassword,
  kumaKey,
  includeGlances,
  phase,
  state,
}) {
  const { default: assert } = await import("node:assert/strict");
  let token;
  async function call(method, pathname, body, status = 200) {
    const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
      method,
      signal: AbortSignal.timeout(25_000),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(
      (Array.isArray(status) ? status : [status]).includes(response.status),
      `${method} ${pathname} returned HTTP ${response.status}, expected ${status}.`,
    );
    return response.json();
  }
  if (phase === "collect")
    await call(
      "POST",
      "/api/auth/bootstrap",
      {
        ...credentials,
        displayName: "Disposable host providers",
        loadDemoData: false,
      },
      201,
    );
  token = (await call("POST", "/api/auth/login", credentials)).token;
  const endpoint = (id) => `/api/integrations/connections/${id}`;
  async function refresh(id) {
    const response = await call(
      "POST",
      `${endpoint(id)}/refresh`,
      undefined,
      [200, 502],
    );
    return response.code?.startsWith("EXTERNAL_")
      ? call("GET", `${endpoint(id)}/readings`)
      : response;
  }
  async function waitReading(id, predicate) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const view = await refresh(id);
      if (!view.error && predicate(view)) return view;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error("Expected real provider reading did not arrive.");
  }
  function safe(view) {
    const body = JSON.stringify(view);
    for (const secret of [glancesPassword, kumaKey])
      assert.ok(
        !body.includes(secret),
        "Provider diagnostics must omit credentials.",
      );
  }
  if (phase === "collect") {
    const lab = await call(
      "POST",
      "/api/labs",
      { name: "Live provider fixture" },
      201,
    );
    async function connection(
      provider,
      name,
      baseUrl,
      authKind,
      authId,
      authSecret,
    ) {
      return call(
        "POST",
        "/api/integrations/connections",
        {
          labId: lab.id,
          provider,
          name,
          baseUrl,
          authKind,
          authId,
          authSecret,
          verifyTls: true,
        },
        201,
      );
    }
    let glancesId, glancesBinding, glancesDeviceId;
    if (includeGlances) {
      const glances = await connection(
        "glances",
        "Glances fixture",
        "http://glances-fixture:61208",
        "username-password",
        "reader",
        glancesPassword,
      );
      let view = await waitReading(glances.id, (row) =>
        row.readings.some((value) => value.key === "cpu.percent"),
      );
      safe(view);
      assert.ok(
        view.readings.some(
          (row) =>
            row.key === "cpu.percent" &&
            Number.isFinite(row.value) &&
            row.value >= 0 &&
            row.value <= 100,
        ),
      );
      assert.ok(
        view.readings.some(
          (row) =>
            row.key === "mem.percent" &&
            Number.isFinite(row.value) &&
            row.value >= 0 &&
            row.value <= 100,
        ),
      );
      assert.ok(
        view.readings.every(
          (row) =>
            row.providerRecordId === "host:self" && row.health === "unknown",
        ),
      );
      const device = await call(
        "POST",
        "/api/devices",
        {
          labId: lab.id,
          hostname: "Manual host identity",
          deviceType: "server",
        },
        201,
      );
      view = await call("POST", `${endpoint(glances.id)}/bindings`, {
        providerRecordId: "host:self",
        deviceId: device.id,
        sourceIdentity: view.sourceIdentity,
      });
      const binding = view.bindings[0].id;
      view = await refresh(glances.id);
      assert.equal(view.bindings[0].id, binding);
      const wrong = await connection(
        "glances",
        "Wrong credential fixture",
        "http://glances-fixture:61208",
        "username-password",
        "reader",
        "invalid-disposable-password",
      );
      const rejected = await refresh(wrong.id);
      safe(rejected);
      assert.equal(rejected.error, "authentication");
      const response = await fetch("http://glances-fixture:61208/api/4/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "reader", password: glancesPassword }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      const jwt = (await response.json()).access_token;
      assert.ok(typeof jwt === "string");
      const bearer = await connection(
        "glances",
        "Glances JWT fixture",
        "http://glances-fixture:61208",
        "api-key",
        null,
        jwt,
      );
      const bearerView = await refresh(bearer.id);
      assert.ok(!bearerView.error);
      assert.ok(!JSON.stringify(bearerView).includes(jwt));
      const invalidBearer = await connection(
        "glances",
        "Invalid Glances JWT fixture",
        "http://glances-fixture:61208",
        "api-key",
        null,
        "invalid-disposable-token",
      );
      const invalidBearerView = await refresh(invalidBearer.id);
      assert.equal(invalidBearerView.error, "authentication");
      glancesId = glances.id;
      glancesBinding = binding;
      glancesDeviceId = device.id;
    }
    const kuma = await connection(
      "uptime-kuma",
      "Kuma fixture",
      "http://kuma-fixture:3001",
      "api-key",
      null,
      kumaKey,
    );
    const up = await waitReading(kuma.id, (row) =>
      row.readings.some(
        (value) => value.key === "status" && value.health === "healthy",
      ),
    );
    safe(up);
    const record = up.readings.find(
      (row) => row.key === "status",
    ).providerRecordId;
    assert.match(record, /^monitor:[0-9]+$/);
    const target = await call(
      "POST",
      "/api/devices",
      {
        labId: lab.id,
        hostname: "Manual monitored service",
        deviceType: "server",
      },
      201,
    );
    const bound = await call("POST", `${endpoint(kuma.id)}/bindings`, {
      providerRecordId: record,
      deviceId: target.id,
      sourceIdentity: up.sourceIdentity,
    });
    return {
      glancesId,
      glancesBinding,
      glancesDeviceId,
      kumaId: kuma.id,
      kumaBinding: bound.bindings[0].id,
      kumaRecord: record,
    };
  }
  if (phase === "kuma-down") {
    const down = await waitReading(state.kumaId, (row) =>
      row.readings.some(
        (value) =>
          value.providerRecordId === state.kumaRecord &&
          value.key === "status" &&
          value.health === "unhealthy",
      ),
    );
    safe(down);
    assert.equal(down.bindings[0].id, state.kumaBinding);
  } else if (phase === "glances-down") {
    const down = await refresh(state.glancesId);
    safe(down);
    assert.ok(down.error);
    assert.equal(down.bindings[0].id, state.glancesBinding);
    assert.ok(
      down.readings.length > 0 &&
        down.readings.every((row) => row.health === "unknown"),
    );
    const device = await call("GET", `/api/devices/${state.glancesDeviceId}`);
    assert.equal(device.hostname, "Manual host identity");
  } else throw new Error("Unknown host-provider acceptance phase.");
}
