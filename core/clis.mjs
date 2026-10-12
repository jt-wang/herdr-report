// The agent CLIs on this machine that can write summaries.
// <NAME>_BIN overrides the PATH lookup; set it empty to treat the CLI as missing.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const SUMMARY_CLIS = ["claude", "codex", "opencode"];

export function findInPath(name, path) {
  for (const d of (path || "").split(delimiter)) {
    const p = join(d, name);
    if (d && existsSync(p)) return p;
  }
  return null;
}

export function findClis(env) {
  const out = {};
  for (const name of SUMMARY_CLIS) {
    const set = env[`${name.toUpperCase()}_BIN`];
    const p = set !== undefined ? set || null : findInPath(name, env.PATH);
    if (p) out[name] = p;
  }
  return out;
}
