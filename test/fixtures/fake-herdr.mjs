#!/usr/bin/env node
// Stands in for the herdr CLI in the server test.
import { existsSync, readFileSync } from "node:fs";
const [group, cmd, id] = process.argv.slice(2);
// A test can make every call fail, as Herdr does when the machine is overloaded.
if (process.env.FAKE_FAIL_FILE && existsSync(process.env.FAKE_FAIL_FILE)) process.exit(1);
// ...or slow, as on a machine under heavy load.
if (process.env.FAKE_SLOW_FILE && existsSync(process.env.FAKE_SLOW_FILE)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
const SEP = "─".repeat(40);
if (group === "workspace" && cmd === "list") {
  console.log(JSON.stringify({ result: { workspaces: [{ workspace_id: "w1", label: "garden", number: 1 }] } }));
} else if (group === "pane" && cmd === "list") {
  // A test can change a pane's status by writing {"w1:p2": "blocked"} to FAKE_STATUS_FILE.
  let over = {};
  try { over = JSON.parse(readFileSync(process.env.FAKE_STATUS_FILE, "utf8")); } catch {}
  const withStatus = (p) => (over[p.pane_id] ? { ...p, agent_status: over[p.pane_id] } : p);
  console.log(JSON.stringify({ result: { panes: [
    { pane_id: "w1:p1", workspace_id: "w1", label: "shell", agent_status: "unknown" },
    { pane_id: "w1:p2", workspace_id: "w1", label: "watering schedule", agent: "claude", agent_status: "working", agent_session: { value: "sess1" } },
    { pane_id: "w1:p3", workspace_id: "w1", label: "b", agent: "claude", agent_status: "idle", agent_session: { value: "sess2" } },
    { pane_id: "w1:p4", workspace_id: "w1", label: "c", agent: "claude", agent_status: "idle", agent_session: { value: "sess3" } },
    { pane_id: "w1:p5", workspace_id: "w1", label: "oc", agent: "opencode", agent_status: "idle", terminal_id: "term_oc1" },
    { pane_id: "w1:p6", workspace_id: "w1", label: "cx", agent: "codex", agent_status: "idle", terminal_id: "term_cx1", agent_session: { value: "cdx1" } },
    { pane_id: "w1:p7", workspace_id: "w1", label: "km", agent: "kimi", agent_status: "idle", terminal_id: "term_km1", agent_session: { value: "session_k1" } },
  ].map(withStatus) } }));
} else if (group === "agent" && cmd === "focus") {
  console.log(JSON.stringify({ result: { type: "ok", focused: id } }));
} else if (group === "pane" && cmd === "read") {
  console.log(["Read the weather forecast", "⏺ Merging #7", SEP, "❯ draft", SEP, "footer"].join("\n"));
} else {
  process.exit(2);
}
