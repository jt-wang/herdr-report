#!/usr/bin/env node
// Preflight: can Herdr Report run here, and what will be limited. Run before
// installing (`node core/check.mjs`) or as the plugin's `check` action. Exits 1
// only when something required is missing; Tailscale problems just keep the
// page on this machine.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { parseStatus } from "./tailnet.mjs";
import { recommend, costPerSummary } from "./catalog.mjs";

const NEED = { node: "20.0.0", herdr: "0.8.0" };

export function versionAtLeast(v, min) {
  const a = v.split(".").map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

// facts: { node, herdr: `herdr --version` output or null, tailscale: `tailscale status --json`
// output or "", clis: found summarizer CLIs, summarizer: the configured label or null }
export function checks(f) {
  const items = [];
  const nodeOk = versionAtLeast(f.node, NEED.node);
  items.push({ level: nodeOk ? "ok" : "fail", text: nodeOk ? `Node ${f.node}` : `Node ${f.node} is too old; install Node ${NEED.node.split(".")[0]}+ from https://nodejs.org` });
  const hv = f.herdr?.match(/(\d+\.\d+\.\d+)/)?.[1];
  const herdrOk = Boolean(hv && versionAtLeast(hv, NEED.herdr));
  items.push({ level: herdrOk ? "ok" : "fail",
    text: herdrOk ? `Herdr ${hv}` : hv ? `Herdr ${hv} is too old; need ${NEED.herdr}+` : "Herdr not found; install it from https://herdr.dev" });
  const ts = f.tailscale ? parseStatus(f.tailscale) : { ok: false, reason: "missing" };
  items.push({ level: ts.ok ? "ok" : "warn", text: ts.ok ? `Tailscale with HTTPS (${ts.host})`
    : { missing: "Tailscale not running: the page will only open on this machine. https://tailscale.com/download",
        stopped: "Tailscale not running: the page will only open on this machine",
        "no-https": "Tailscale HTTPS certificates are off: turn them on in the admin console (DNS), or the phone can't reach the page" }[ts.reason] });
  if (f.summarizer) items.push({ level: "ok", text: `Summaries by ${f.summarizer}` });
  else {
    const rec = recommend(f.clis);
    items.push({ level: "note", text: rec
      ? `Summaries are off. Suggested: ${rec.label}, about $${costPerSummary(rec.price).toFixed(4)} per summary (action: use-recommended)`
      : "Summaries are off. No tested agent CLI found; set SUMMARIZER=openai or command in config.env to use a key or a local model" });
  }
  return { ok: items.every((i) => i.level !== "fail"), items };
}

// Run as a script, not imported. Compare real paths: under a symlinked folder (macOS /tmp)
// the two spellings differ and the script would quietly do nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const out = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
  const { findClis } = await import("./clis.mjs");
  const { summarizerFromEnv, backendLabel } = await import("./summarizer.mjs");
  const { parseEnvFile } = await import("./lib.mjs");
  const { existsSync, readFileSync } = await import("node:fs");
  const conf = process.env.CONFIG_FILE;
  const env = { ...process.env, ...(conf && existsSync(conf) ? parseEnvFile(readFileSync(conf, "utf8")) : {}) };
  const clis = findClis(env);
  let summarizer = null;
  try { const b = summarizerFromEnv(env, clis); summarizer = b && backendLabel(b); } catch {}
  const r = checks({
    node: process.versions.node,
    herdr: out(process.env.HERDR_BIN || "herdr", ["--version"]),
    tailscale: process.env.TAILSCALE_BIN ? out(process.env.TAILSCALE_BIN, ["status", "--json"]) || "" : "",
    clis,
    summarizer,
  });
  const mark = { ok: "✓", warn: "!", fail: "✗", note: "·" };
  for (const i of r.items) console.log(`${mark[i.level]} ${i.text}`);
  process.exit(r.ok ? 0 : 1);
}
