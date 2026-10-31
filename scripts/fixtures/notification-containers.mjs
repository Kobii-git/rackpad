// Executed inside the real candidate. Only disposable credentials and provider
// services are used; no transport replacement or production settings are read.
export async function exerciseNotifications({ credentials, smtp, topic, ntfyToken, phase }) {
  const { default: assert } = await import("node:assert/strict");
  let token;
  async function call(method, pathname, body, status = 200) {
    const response = await fetch(`http://127.0.0.1:3000${pathname}`, {
      method, signal: AbortSignal.timeout(25_000),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.ok(response.status === status, `${method} ${pathname} returned HTTP ${response.status}, expected ${status}.`);
    return response.json();
  }
  if (phase === "smtp") await call("POST", "/api/auth/bootstrap", { ...credentials, displayName: "Disposable notification acceptance", loadDemoData: false }, 201);
  token = (await call("POST", "/api/auth/login", credentials)).token;
  assert.ok(typeof token === "string");
  const endpoint = "/api/admin/alert-settings";
  async function save(changes) {
    // This endpoint uses PUT defaults. Model the UI's complete saved snapshot;
    // the write-only ntfy token is omitted unless explicitly replaced.
    const current = await call("GET", endpoint);
    delete current.ntfyTokenConfigured;
    return call("PUT", endpoint, { ...current, ...changes });
  }
  const send = () => call("POST", `${endpoint}/test`);
  async function failed(code) {
    const response = await call("POST", `${endpoint}/test`, undefined, 500);
    assert.equal(response.code, code);
    const serialized = JSON.stringify(response);
    for (const sensitive of [smtp.password, smtp.username, ntfyToken, topic, "mailpit-wrong-host", "ntfy-fixture"])
      assert.ok(!serialized.includes(sensitive), "Notification error must omit private provider details.");
  }
  async function delivered(channel) {
    assert.deepEqual(await send(), { delivered: true, channels: [{ channel, delivered: true }] });
  }
  async function mail(alias, expectedCount) {
    const root = `http://${alias}:8025/api/v1`;
    const listing = await (await fetch(`${root}/messages`, { signal: AbortSignal.timeout(5000) })).json();
    assert.equal(listing.total, expectedCount, "Mailpit must receive the actual SMTP messages.");
    const message = await (await fetch(`${root}/message/${listing.messages[0].ID}`, { signal: AbortSignal.timeout(5000) })).json();
    assert.equal(message.Subject, "Rackpad test alert");
    assert.equal(message.From.Address, "sender@example.test");
    assert.equal(message.To[0].Address, "recipient@example.test");
    assert.ok(message.Text.includes("This confirms notification delivery is working"));
    assert.ok(message.Username === smtp.username, "Mailpit must authenticate the SMTP user.");
  }
  async function ntfyMessages(count) {
    const response = await fetch(`https://ntfy-fixture:8443/${topic}/json?poll=1&since=all`, {
      headers: { authorization: `Bearer ${ntfyToken}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const messages = (await response.text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.equal(messages.length, count, "ntfy must retain the actual delivered messages.");
    assert.ok(messages.every(row => row.event === "message" && row.topic === topic && row.message.includes("This confirms notification delivery is working")));
  }
  if (phase === "smtp") {
    await save({ enabled: false, smtpHost: "mailpit-starttls", smtpPort: 1025, smtpSecure: false, smtpUsername: smtp.username, smtpPassword: smtp.password, smtpFrom: "sender@example.test", smtpTo: "recipient@example.test" });
    await failed("notification_disabled");
    await save({ enabled: true });
    assert.equal((await call("GET", endpoint)).smtpSecure, false);
    await delivered("email");
    await mail("mailpit-starttls", 1);
    await save({ smtpHost: "mailpit-smtps", smtpSecure: true });
    await delivered("email");
    await mail("mailpit-smtps", 1);
    await save({ smtpPassword: "incorrect-disposable-password" });
    await failed("smtp_authentication");
    await save({ smtpHost: "mailpit-wrong-host", smtpPassword: smtp.password });
    await failed("smtp_tls");
    await save({ smtpHost: "mailpit-smtps" });
  } else if (phase === "ntfy") {
    const settings = await call("GET", endpoint);
    assert.equal(settings.smtpHost, "mailpit-smtps");
    assert.equal(settings.smtpSecure, true);
    await delivered("email");
    await mail("mailpit-smtps", 2);
    await save({ enabled: false, smtpHost: null, smtpFrom: null, smtpTo: null, smtpUsername: null, smtpPassword: null, ntfyTopicUrl: `https://ntfy-fixture:8443/${topic}`, ntfyToken });
    await failed("notification_disabled");
    await save({ enabled: true });
    const saved = await call("GET", endpoint);
    assert.equal(saved.ntfyTokenConfigured, true);
    assert.ok(!JSON.stringify(saved).includes(ntfyToken), "Saved ntfy token must stay write-only.");
    await delivered("ntfy");
    await ntfyMessages(1);
  } else if (phase === "persisted-ntfy") {
    const settings = await call("GET", endpoint);
    assert.equal(settings.ntfyTokenConfigured, true);
    assert.equal(settings.enabled, true);
    await delivered("ntfy");
    await ntfyMessages(2);
  } else if (phase === "revoked-ntfy") {
    await failed("ntfy_rejection");
    const history = await call("GET", "/api/audit-log?entityType=Alert");
    assert.ok(history.some(row => row.action === "alert.test"));
    assert.ok(history.some(row => row.action === "alert.error"));
    assert.ok(!JSON.stringify(history).includes(ntfyToken), "Audit history must omit the ntfy token.");
  } else throw new Error("Unknown notification acceptance phase.");
}
