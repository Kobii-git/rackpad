import net from "node:net";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export async function smtpTlsFixture(
  mode: "implicit" | "starttls",
  mismatch = false,
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-smtp-tls-"));
  const cert = path.join(directory, "certificate.pem");
  const key = path.join(directory, "private.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      `subjectAltName=${mismatch ? "DNS:wrong.example.test" : "IP:127.0.0.1,DNS:localhost"}`,
    ],
    { stdio: "ignore" },
  );
  const options = { cert: readFileSync(cert), key: readFileSync(key) };
  const sockets = new Set<net.Socket>();
  let messages = 0;
  let upgrades = 0;
  function handle(socket: net.Socket, encrypted: boolean, greet = true) {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(5000, () => socket.destroy());
    socket.setEncoding("utf8");
    if (greet) socket.write("220 localhost ESMTP fixture\r\n");
    let buffer = "";
    let data = false;
    socket.on("data", function receive(chunk: string) {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false;
            messages++;
            socket.write("250 Accepted\r\n");
          }
        } else if (line.startsWith("EHLO")) {
          socket.write(
            `250-localhost\r\n${encrypted ? "" : "250-STARTTLS\r\n"}250 AUTH PLAIN\r\n`,
          );
        } else if (line === "STARTTLS" && !encrypted) {
          socket.write("220 Upgrade\r\n");
          socket.removeListener("data", receive);
          const secure = new tls.TLSSocket(socket, {
            isServer: true,
            secureContext: tls.createSecureContext(options),
          });
          upgrades++;
          handle(secure, true, false);
          return;
        } else if (line.startsWith("AUTH"))
          socket.write("235 Authenticated\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT"))
          socket.write("250 OK\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 Send message\r\n");
        } else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("500 Unsupported\r\n");
      }
    });
  }
  const server =
    mode === "implicit"
      ? tls.createServer(options, (socket) => handle(socket, true))
      : net.createServer((socket) => handle(socket, false));
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as net.AddressInfo;
  return {
    cert,
    port: address.port,
    get messages() {
      return messages;
    },
    get upgrades() {
      return upgrades;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
