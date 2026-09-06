import test from "node:test";
import assert from "node:assert/strict";
import { categorize, parseDockerContainer } from "../src/processes/discovery.ts";

test("detects compiled .NET development listeners", () => {
  assert.equal(
    categorize(
      "/Users/carlosbastida/Repos/Butik/butik-api/src/Butik.Api/bin/Debug/net10.0/Butik.Api",
      "/Users/carlosbastida/Repos/Butik/butik-api/src/Butik.Api/bin/Debug/net10.0/Butik.Api",
    ),
    "other",
  );
});

test("parses running containers from Docker-compatible runtimes", () => {
  const container = parseDockerContainer(
    JSON.stringify({ ID: "abc123", Names: "api", Image: "example/api:dev", Ports: "0.0.0.0:8080->3000/tcp, :::8080->3000/tcp" }),
    "mac",
  );
  assert.deepEqual(container, {
    id: "docker:abc123",
    machineId: "mac",
    pid: 0,
    name: "api",
    command: "example/api:dev",
    port: 8080,
    protocol: "tcp",
    category: "container",
    containerRuntime: "docker",
    killable: false,
  });
  assert.equal(parseDockerContainer("not json", "mac"), undefined);
});
