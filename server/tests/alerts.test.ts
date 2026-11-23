import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, beforeEach, test, type TestContext } from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-alert-tests-"));
process.env.DATABASE_PATH = path.join(tempDir, "alerts.db");
process.env.NODE_ENV = "test";

const { DEFAULT_ALERT_SETTINGS, saveAlertSettings, sendTestAlert } = await import(
  "../lib/alerts.js"
);
const { db } = await import("../db.js");

beforeEach(() => {
  db.prepare("DELETE FROM auditLog").run();
  saveAlertSettings(DEFAULT_ALERT_SETTINGS);
});

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function startSmtpFixture(
  context: TestContext,
  failure?: "recipient" | "message" | "authentication",
) {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(5000, () => socket.destroy());
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP test fixture\r\n");
    let buffer = "";
    let data: string[] | null = null;

    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let boundary: number;
      while ((boundary = buffer.indexOf("\r\n")) !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (data !== null) {
          if (line !== ".") {
            data.push(line.startsWith("..") ? line.slice(1) : line);
            continue;
          }
          messages.push(data.join("\r\n"));
          data = null;
          socket.write(
            failure === "message"
              ? "554 5.7.1 Message rejected\r\n"
              : "250 2.0.0 Message accepted\r\n",
          );
          continue;
        }

        commands.push(line);
        if (line.startsWith("EHLO ")) {
          socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        } else if (line.startsWith("AUTH PLAIN ")) {
          socket.write(failure === "authentication" ? "535 5.7.8 fixture-secret-auth-rejection\r\n" : "235 2.7.0 Authentication accepted\r\n");
        } else if (line.startsWith("MAIL FROM:")) {
          socket.write("250 2.1.0 Sender accepted\r\n");
        } else if (line.startsWith("RCPT TO:")) {
          socket.write(
            failure === "recipient"
              ? "550 5.1.1 Recipient rejected\r\n"
              : "250 2.1.5 Recipient accepted\r\n",
          );
        } else if (line === "DATA") {
          data = [];
          socket.write("354 End data with <CRLF>.<CRLF>\r\n");
        } else if (line === "QUIT") {
          socket.end("221 2.0.0 Bye\r\n");
        } else {
          socket.write("500 5.5.1 Unsupported command\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { port: address.port, commands, messages };
}

for (const authenticated of [false, true]) {
  test(
    `SMTP test alert preserves delivery ${authenticated ? "with" : "without"} authentication`,
    { timeout: 10_000 },
    async (context) => {
      const smtp = await startSmtpFixture(context);
      saveAlertSettings({
        enabled: true,
        smtpHost: "127.0.0.1",
        smtpPort: smtp.port,
        smtpSecure: false,
        smtpUsername: authenticated ? "rackpad-test" : null,
        smtpPassword: authenticated ? "fixture-password" : null,
        smtpFrom: "Rackpad <rackpad@example.test>",
        smtpTo:
          "ops@example.test; second@example.test,\n third@example.test",
      });

      assert.deepEqual(await sendTestAlert("smtp-test"), {
        delivered: true,
        channels: [{ channel: "email", delivered: true }],
      });
      assert.ok(smtp.commands.includes("MAIL FROM:<rackpad@example.test>"));
      assert.deepEqual(
        smtp.commands.filter((command) => command.startsWith("RCPT TO:")),
        [
          "RCPT TO:<ops@example.test>",
          "RCPT TO:<second@example.test>",
          "RCPT TO:<third@example.test>",
        ],
      );
      const authentication = smtp.commands.find((command) =>
        command.startsWith("AUTH PLAIN "),
      );
      if (authenticated) {
        assert.ok(authentication);
        assert.equal(
          Buffer.from(authentication.slice("AUTH PLAIN ".length), "base64").toString(),
          "\0rackpad-test\0fixture-password",
        );
      } else {
        assert.equal(authentication, undefined);
      }
      assert.equal(smtp.messages.length, 1);
      assert.match(smtp.messages[0], /^Subject: Rackpad test alert$/m);
      assert.match(smtp.messages[0], /^Content-Type: text\/plain;/m);
      assert.match(smtp.messages[0], /This confirms notification delivery/);
      assert.deepEqual(
        db.prepare("SELECT action, user FROM auditLog").all(),
        [{ action: "alert.test", user: "smtp-test" }],
      );
    },
  );
}

for (const failure of ["recipient", "message"] as const) {
  test(
    `SMTP ${failure} rejection fails the test alert without recording delivery`,
    { timeout: 10_000 },
    async (context) => {
      const smtp = await startSmtpFixture(context, failure);
      saveAlertSettings({
        enabled: true,
        smtpHost: "127.0.0.1",
        smtpPort: smtp.port,
        smtpSecure: false,
        smtpFrom: "rackpad@example.test",
        smtpTo: "ops@example.test",
      });

      await assert.rejects(
        sendTestAlert("smtp-test"),
        /SMTP rejected the message/,
      );
      assert.equal(smtp.messages.length, failure === "recipient" ? 0 : 1);
      assert.deepEqual(
        db.prepare("SELECT action, user FROM auditLog").all(),
        [{ action: "alert.error", user: "smtp-test" }],
      );
    },
  );
}

test('SMTP authentication errors redact provider text from errors and audit', async context => {
  const smtp = await startSmtpFixture(context, 'authentication');
  saveAlertSettings({enabled:true,smtpHost:'127.0.0.1',smtpPort:smtp.port,smtpSecure:false,smtpUsername:'fixture-user',smtpPassword:'fixture-password',smtpFrom:'from@example.test',smtpTo:'to@example.test'});
  const { SmtpDeliveryError } = await import('../lib/smtp-error.js');
  await assert.rejects(sendTestAlert(), error => error instanceof SmtpDeliveryError && error.category==='authentication' && !JSON.stringify(error).includes('fixture-secret'));
  const audit=JSON.stringify(db.prepare('SELECT summary FROM auditLog').all());
  assert.match(audit,/SMTP authentication failed/);
  assert.doesNotMatch(audit,/fixture-secret|fixture-password|fixture-user/);
});

test('SMTP failure classifications never retain raw diagnostic data', async () => {
  const { smtpDeliveryError } = await import('../lib/smtp-error.js');
  const cases = [
    ['EDNS','connection'],['ECONNREFUSED','connection'],['ETIMEDOUT','timeout'],['CERT_HAS_EXPIRED','tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID','tls'],['DEPTH_ZERO_SELF_SIGNED_CERT','tls'],['EAUTH','authentication'],['EENVELOPE','rejection'],['EMESSAGE','rejection'],['unexpected','delivery'],
  ];
  for(const [code,category] of cases){
    const result=smtpDeliveryError({code,message:'fixture-private-message',response:'fixture-private-response',password:'fixture-private-password'});
    assert.equal(result.category,category);assert.doesNotMatch(JSON.stringify(result),/fixture-private/);assert.equal(result.cause,undefined);
  }
  assert.equal(smtpDeliveryError({code:'ESOCKET',originalCode:'CERT_HAS_EXPIRED'}).category,'tls');
});

test('SMTP test endpoint is admin-only and returns safe configuration and connection failures', async context => {
  const { createApp } = await import('../app.js');
  const app=await createApp();context.after(()=>app.close());
  const password='fixture-administrator-password';
  const auth=await app.inject({method:'POST',url:'/api/auth/bootstrap',payload:{username:'smtp-admin',displayName:'SMTP admin',password,loadDemoData:false}});
  assert.equal(auth.statusCode,201);
  const headers={authorization:`Bearer ${auth.json().token}`};
  const url='/api/admin/alert-settings/test';
  assert.equal((await app.inject({method:'POST',url})).statusCode,401);
  await app.inject({method:'POST',url:'/api/users',headers,payload:{username:'smtp-viewer',displayName:'Viewer',password,role:'viewer'}});
  const viewer=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'smtp-viewer',password}});
  assert.equal((await app.inject({method:'POST',url,headers:{authorization:`Bearer ${viewer.json().token}`}})).statusCode,403);
  saveAlertSettings({enabled:true,smtpHost:'fixture.invalid'});
  const configuration=await app.inject({method:'POST',url,headers});
  assert.equal(configuration.statusCode,500);assert.equal(configuration.json().code,'smtp_configuration');
  const server=net.createServer();
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  saveAlertSettings({enabled:true,smtpHost:'127.0.0.1',smtpPort:port,smtpFrom:'fixture-private@example.test',smtpTo:'to@example.test'});
  const connection=await app.inject({method:'POST',url,headers});
  assert.equal(connection.statusCode,500);assert.equal(connection.json().code,'smtp_connection');
  assert.doesNotMatch(connection.body,/127\.0\.0\.1|fixture-private|ECONNREFUSED/);
});

test('partial SMTP settings do not change another configured notification channel', async context => {
  const { setNetworkHostLookupForTests, setPinnedRequestTransportForTests } = await import('../lib/net-guard.js');
  setNetworkHostLookupForTests(async()=>[{address:'10.20.30.40',family:4}]);
  setPinnedRequestTransportForTests(async()=>({statusCode:204}));
  context.after(()=>{setNetworkHostLookupForTests(null);setPinnedRequestTransportForTests(null);});
  saveAlertSettings({enabled:true,discordWebhookUrl:'https://discord.example.test/fixture',smtpHost:'partial.example.test'});
  assert.deepEqual(await sendTestAlert(),{delivered:true,channels:[{channel:'discord',delivered:true}]});
});
