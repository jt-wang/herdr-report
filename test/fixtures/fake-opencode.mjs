#!/usr/bin/env node
// Stands in for `opencode run --format json`: prints JSON events, and puts what
// it was given (flags, env, stdin) into the summary's `now` so a test can check it.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const flag = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  const cfg = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
  const db = process.env.OPENCODE_DB;
  if (db) writeFileSync(db, "x");
  const seen = {
    model: flag("-m"), pure: args.includes("--pure"), agent: flag("--agent"), title: flag("--title"), format: flag("--format"),
    agentConfig: cfg.agent?.[flag("--agent")] || {}, db, stdin,
  };
  const summary = { goal: "g", now: JSON.stringify(seen), needs_you: [], blocked: [], doing: [], todo: [], done: [] };
  const text = JSON.stringify(summary);
  console.log(JSON.stringify({ type: "step_start", part: { type: "step-start" } }));
  console.log(JSON.stringify({ type: "text", part: { type: "text", text: text.slice(0, 20) } }));
  console.log(JSON.stringify({ type: "text", part: { type: "text", text: text.slice(20) } }));
  console.log(JSON.stringify({ type: "step_finish", part: { type: "step-finish", cost: 0.0023 } }));
});
