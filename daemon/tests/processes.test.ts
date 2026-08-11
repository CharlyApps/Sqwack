import test from "node:test";
import assert from "node:assert/strict";
import { categorize } from "../src/processes/discovery.ts";

test("detects compiled .NET development listeners", () => {
  assert.equal(
    categorize(
      "/Users/carlosbastida/Repos/Butik/butik-api/src/Butik.Api/bin/Debug/net10.0/Butik.Api",
      "/Users/carlosbastida/Repos/Butik/butik-api/src/Butik.Api/bin/Debug/net10.0/Butik.Api",
    ),
    "other",
  );
});
