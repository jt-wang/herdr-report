#!/usr/bin/env node
// Publish the local server on the tailnet over HTTPS with `tailscale serve`.
// The server itself only listens on 127.0.0.1; Tailscale terminates TLS, so the
// phone gets an https:// URL, which web push and "Add to Home Screen" need.
//
// A tailnet can have other things mounted, and :443 is the machine's own root
// URL, so this picks a free port, remembers it, and only ever unmounts that one.
//
//   tailnet.mjs publish <local port>   prints the https URL
//   tailnet.mjs unpublish
//   tailnet.mjs url
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function parseStatus(text) {
  let s;
  try { s = JSON.parse(text); } catch { return { ok: false, reason: "stopped" }; }
  if (s.BackendState !== "Running") return { ok: false, reason: "stopped" };
  const host = (s.Self?.DNSName || "").replace(/\.$/, "");
  if (!s.CertDomains?.length) return { ok: false, reason: "no-https", host };
  return { ok: true, host };
}

export function usedPorts(text) {
  let s;
  try { s = JSON.parse(text); } catch { return new Set(); }
  return new Set(Object.keys(s?.TCP || {}).map(Number).filter(Boolean));
}

export function pickPort(used, { keep = null, preferred = null, base = 47900, span = 100 } = {}) {
  if (keep && used.has(keep)) return keep; // ours from the last run
  if (preferred && preferred !== 443 && !used.has(preferred)) return preferred;
  for (let p = base; p < base + span; p++) if (!used.has(p)) return p;
  throw new Error(`no free tailnet port in ${base}..${base + span - 1}`);
}

const ADVICE = {
  missing: "Tailscale is not installed, so the page only works on this Mac. Install it from https://tailscale.com/download.",
  stopped: "Tailscale is not running, so the page only works on this Mac. Start Tailscale, then restart the plugin.",
  "no-https": "HTTPS is off for this tailnet. Turn on HTTPS certificates in the Tailscale admin console (DNS page), then restart the plugin.",
};

async function main() {
  const run = promisify(execFile);
  const bin = process.env.TAILSCALE_BIN;
  const stateFile = process.env.TAILNET_STATE;
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  const url = (s) => `https://${s.host}${s.port === 443 ? "" : `:${s.port}`}`;
  const [verb, localPort] = process.argv.slice(2);

  if (verb === "url") {
    if (!state) process.exit(1);
    return console.log(url(state));
  }
  if (!bin) {
    console.error(ADVICE.missing);
    process.exit(3);
  }
  if (verb === "unpublish") {
    if (state) await run(bin, ["serve", `--https=${state.port}`, "off"]).catch(() => {});
    rmSync(stateFile, { force: true });
    return;
  }
  if (verb === "publish") {
    const status = parseStatus((await run(bin, ["status", "--json"]).catch(() => ({ stdout: "" }))).stdout);
    if (!status.ok) {
      console.error(ADVICE[status.reason]);
      process.exit(3);
    }
    const used = usedPorts((await run(bin, ["serve", "status", "--json"]).catch(() => ({ stdout: "" }))).stdout);
    const port = pickPort(used, { keep: state?.port, preferred: Number(localPort) });
    if (state?.port && state.port !== port && used.has(state.port)) {
      await run(bin, ["serve", `--https=${state.port}`, "off"]).catch(() => {});
    }
    await run(bin, ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${localPort}`]);
    const next = { host: status.host, port };
    writeFileSync(stateFile, JSON.stringify(next));
    return console.log(url(next));
  }
  console.error("usage: tailnet.mjs publish <port> | unpublish | url");
  process.exit(2);
}

// Run as a script, not imported. Compare real paths: under a symlinked folder (macOS /tmp)
// the two spellings differ and the script would quietly do nothing.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(`tailscale serve: ${e.stderr || e.message}`);
    process.exit(1);
  });
}
