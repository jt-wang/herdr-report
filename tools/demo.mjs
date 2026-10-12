#!/usr/bin/env node
// The page with made-up sessions, no Herdr and no model needed:
//
//   npm run demo            then open http://127.0.0.1:8799
//   node tools/demo.mjs --port 9000
//
// It writes made-up agent records and their summaries to a temp folder and runs
// the real server against a stand-in herdr (tools/demo/herdr.mjs). The cached
// summaries match the records, so the summarizer is never called.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSIONS, screen } from "./demo/data.mjs";
import { stripAgentChrome } from "../core/lib.mjs";

const root = new URL("../", import.meta.url).pathname;
const port = process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "8799";
const dir = mkdtempSync(join(tmpdir(), "herdr-report-demo-"));
const d = (...p) => { const f = join(dir, ...p); mkdirSync(f, { recursive: true }); return f; };
const [projects, codex, cache] = [d("projects", "-demo"), d("codex", "2026", "10", "13"), d("cache")];
const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const line = (o) => JSON.stringify(o) + "\n";

SESSIONS.forEach((s, n) => {
  const sid = s.pane.agent_session?.value;
  let key, version, source = "transcript";
  if (sid && s.pane.agent === "claude") {
    const path = join(projects, `${sid}.jsonl`);
    writeFileSync(path, line({ type: "user", message: { role: "user", content: s.summary.goal } })
      + line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: s.said }] } }));
    [key, version] = [sid, statSync(path).mtimeMs];
  } else if (sid && s.pane.agent === "codex") {
    const path = join(codex, `rollout-2026-10-13T09-00-00-${sid}.jsonl`);
    writeFileSync(path, line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: s.said }] } }));
    [key, version] = [`codex-${sid}`, statSync(path).mtimeMs];
  } else {
    // read from the screen, as the server does for agents without a record it knows
    [key, version, source] = [`screen-${s.pane.terminal_id}`, createHash("sha1").update(stripAgentChrome(screen(s) + "\n")).digest("hex"), "screen"];
  }
  const items = Object.fromEntries(["needs_you", "blocked", "doing", "todo", "done"].map((l) =>
    [l, s.summary[l].map(([text, ago], i) => ({ id: `${n}${l[0]}${i}`, text, since: iso(ago) }))]));
  writeFileSync(join(cache, `${key}.json`), JSON.stringify({
    goal: s.summary.goal, now: s.summary.now, ...items,
    source, summarized_by: "claude-code:haiku", at: now - 2 * 60_000, sourceVersion: version,
  }));
});

const server = spawn(process.execPath, ["core/server.mjs"], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"],
  env: {
    ...process.env,
    HOST: "127.0.0.1", PORT: port, HOST_NAME: "demo-mac", SUMMARY_LANG: "en",
    HERDR_BIN: join(root, "tools/demo/herdr.mjs"),
    PROJECTS_DIR: join(dir, "projects"), CODEX_SESSIONS_DIR: join(dir, "codex"), KIMI_SESSIONS_DIR: d("kimi"),
    CACHE_DIR: cache, REPORTS_DIR: d("reports"), SNAPSHOT_FILE: join(dir, "sessions.json"), PUSH_DIR: d("push"),
    CONFIG_FILE: join(dir, "config.env"),
    // a summarizer must be set for summaries to show; it is never called
    SUMMARIZER: "command", SUMMARIZER_CMD: "false",
  },
});
server.stdout.on("data", (b) => {
  if (String(b).includes("listening")) console.log(`demo: http://127.0.0.1:${port}  (made-up sessions in ${dir})`);
});
server.on("exit", (c) => process.exit(c ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill());
