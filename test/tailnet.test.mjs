import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, usedPorts, pickPort } from "../core/tailnet.mjs";

test("parseStatus: running with HTTPS certificates gives the machine's tailnet name", () => {
  assert.deepEqual(parseStatus(JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.tail1.ts.net." }, CertDomains: ["mac.tail1.ts.net"] })),
    { ok: true, host: "mac.tail1.ts.net" });
  assert.equal(parseStatus(JSON.stringify({ BackendState: "Stopped", Self: {} })).reason, "stopped");
  assert.equal(parseStatus(JSON.stringify({ BackendState: "Running", Self: { DNSName: "m." }, CertDomains: [] })).reason, "no-https");
  assert.equal(parseStatus("not json").reason, "stopped");
});

test("usedPorts: every port `tailscale serve` already publishes", () => {
  const status = { TCP: { "443": { HTTPS: true }, "8787": { HTTPS: true } }, Web: { "m.ts.net:8787": {} } };
  assert.deepEqual([...usedPorts(JSON.stringify(status))].sort(), [443, 8787]);
  assert.deepEqual([...usedPorts("{}")], []);
  assert.deepEqual([...usedPorts("")], []);
});

test("pickPort: keep our own port, else the local port number, else the first free one; never 443", () => {
  assert.equal(pickPort(new Set([8794]), { keep: 8794, preferred: 8794 }), 8794, "still ours from last time");
  assert.equal(pickPort(new Set([443]), { preferred: 8794 }), 8794);
  assert.equal(pickPort(new Set([8794]), { preferred: 8794, base: 47900 }), 47900, "taken by someone else");
  assert.equal(pickPort(new Set([8794, 47900]), { preferred: 8794, base: 47900 }), 47901);
  assert.equal(pickPort(new Set(), { preferred: 443, base: 47900 }), 47900, "the root URL belongs to the machine");
});
