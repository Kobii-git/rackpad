import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDockerApiUrl,
  buildDockerContainerNotes,
  buildDockerContainerSpecs,
  normalizeDockerEndpoint,
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

test("buildDockerContainerNotes and specs capture image and status", () => {
  const container = parseDockerContainersJson(SAMPLE_RESPONSE)[0]!;
  assert.match(
    buildDockerContainerNotes(container, "http://127.0.0.1:2375"),
    /docker-import \| image: nginx:1.25 \| status: Up 2 hours/,
  );
  assert.equal(buildDockerContainerSpecs(container), "docker-image: nginx:1.25");
});
