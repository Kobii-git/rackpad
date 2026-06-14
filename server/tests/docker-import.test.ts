import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import {
  buildDockerApiUrl,
  buildDockerContainerNotes,
  buildDockerContainerSpecs,
  fetchDockerContainersPreview,
  normalizeDockerEndpoint,
  normalizeDockerEndpointText,
  normalizeDockerSocketEndpoint,
  parseDockerContainersJson,
} from "../lib/docker-import.js";

const SAMPLE_RESPONSE = [
  {
    Id: "abc123def456",
    Names: ["/web-01"],
    Image: "nginx:1.25",
    State: "running",
    Status: "Up 2 hours",
  },
  {
    Id: "fed987cba654",
    Names: ["/db-01"],
    Image: "postgres:16",
    State: "exited",
    Status: "Exited (0) 10 minutes ago",
  },
];

test("parseDockerContainersJson maps Docker Engine list payloads", () => {
  const containers = parseDockerContainersJson(SAMPLE_RESPONSE);
  assert.equal(containers.length, 2);
  assert.deepEqual(containers[0], {
    id: "abc123def456",
    name: "web-01",
    image: "nginx:1.25",
    state: "running",
    status: "Up 2 hours",
  });
  assert.equal(containers[1]?.state, "exited");
});

test("normalizeDockerEndpoint rejects reserved hosts and accepts routable hosts", async () => {
  await assert.rejects(
    () => normalizeDockerEndpoint("http://169.254.169.254:2375"),
    /Docker endpoint must be a routable public\/LAN host outside reserved ranges\./,
  );
  await assert.rejects(
    () => normalizeDockerEndpoint("http://127.0.0.1:2375"),
    /Docker endpoint must be a routable public\/LAN host outside reserved ranges\./,
  );

  const url = await normalizeDockerEndpoint("https://8.8.8.8:2375");
  assert.equal(url.hostname, "8.8.8.8");
});

test("buildDockerApiUrl preserves Portainer proxy base paths", async () => {
  const url = await buildDockerApiUrl(
    "https://8.8.8.8/api/endpoints/2/docker/",
    "/containers/json",
  );
  url.searchParams.set("all", "1");
  assert.equal(
    url.toString(),
    "https://8.8.8.8/api/endpoints/2/docker/containers/json?all=1",
  );
});

test("normalizeDockerEndpointText accepts unix socket endpoints", async () => {
  assert.deepEqual(normalizeDockerSocketEndpoint("unix:///var/run/docker.sock"), {
    endpoint: "unix:///var/run/docker.sock",
    socketPath: "/var/run/docker.sock",
  });
  assert.equal(
    await normalizeDockerEndpointText("unix:///var/run/docker.sock"),
    "unix:///var/run/docker.sock",
  );
  assert.throws(
    () => normalizeDockerSocketEndpoint("unix://var/run/docker.sock"),
    /Docker socket endpoint must use unix:\/\/\/absolute\/path\.sock\./,
  );
});

test("fetchDockerContainersPreview reads Docker JSON through a unix socket", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rackpad-docker-"));
  const socketPath = path.join(dir, "docker.sock");
  const server = http.createServer((req, res) => {
    assert.equal(req.url, "/containers/json?all=1");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(SAMPLE_RESPONSE));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  try {
    const containers = await fetchDockerContainersPreview(`unix://${socketPath}`);
    assert.equal(containers.length, 2);
    assert.equal(containers[0]?.name, "web-01");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildDockerContainerNotes and specs capture image and status", () => {
  const container = parseDockerContainersJson(SAMPLE_RESPONSE)[0]!;
  assert.match(
    buildDockerContainerNotes(container, "http://127.0.0.1:2375"),
    /docker-import \| image: nginx:1.25 \| status: Up 2 hours/,
  );
  assert.equal(buildDockerContainerSpecs(container), "docker-image: nginx:1.25");
});
