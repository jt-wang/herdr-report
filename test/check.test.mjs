import { test } from "node:test";
import assert from "node:assert/strict";
import { checks, versionAtLeast } from "../core/check.mjs";

test("versionAtLeast compares dotted versions", () => {
  assert.equal(versionAtLeast("0.9.0", "0.8.0"), true);
  assert.equal(versionAtLeast("0.10.1", "0.9.9"), true);
  assert.equal(versionAtLeast("0.7.5", "0.8.0"), false);
  assert.equal(versionAtLeast("20.1.0", "20.0.0"), true);
});

const ok = {
  node: "24.13.1",
  herdr: "herdr 0.9.0",
  tailscale: JSON.stringify({ BackendState: "Running", Self: { DNSName: "mac.t.ts.net." }, CertDomains: ["mac.t.ts.net"] }),
  clis: { claude: "/bin/claude" },
  summarizer: null,
};

test("checks: everything in place; summaries off is a suggestion, not a failure", () => {
  const r = checks(ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((i) => i.level), ["ok", "ok", "ok", "note"]);
  assert.match(r.items[3].text, /Claude Code · Haiku/);
});

test("checks: an old Node or Herdr stops the install; Tailscale problems only limit it to this Mac", () => {
  assert.equal(checks({ ...ok, node: "18.19.0" }).ok, false);
  assert.equal(checks({ ...ok, herdr: null }).ok, false);
  assert.equal(checks({ ...ok, herdr: "herdr 0.7.5" }).ok, false);
  const ts = checks({ ...ok, tailscale: "" });
  assert.equal(ts.ok, true);
  assert.equal(ts.items[2].level, "warn");
  assert.match(checks({ ...ok, tailscale: JSON.stringify({ BackendState: "Running", Self: { DNSName: "m." }, CertDomains: [] }) }).items[2].text, /HTTPS/);
});
