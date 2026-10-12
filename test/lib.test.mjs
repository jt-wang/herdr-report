import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAgentChrome, buildSessions } from "../core/lib.mjs";

const SEP = "─".repeat(50);

test("stripAgentChrome drops the input box and footer of a Claude Code screen", () => {
  const text = [
    "⏺ The rain check is in the schedule.",
    "",
    "⏺ Next: a sound for reminders.",
    SEP,
    "❯ show me the schedule",
    SEP,
    "  ? for shortcuts",
  ].join("\n");
  assert.equal(stripAgentChrome(text), "⏺ The rain check is in the schedule.\n\n⏺ Next: a sound for reminders.");
});

test("stripAgentChrome leaves a plain shell untouched", () => {
  assert.equal(stripAgentChrome("$ ls\na b\n"), "$ ls\na b");
});

test("buildSessions keeps agent panes in workspace order and lists each workspace's session ids", () => {
  const workspaces = [
    { workspace_id: "w1", label: "garden", number: 2 },
    { workspace_id: "w2", label: "other", number: 1 },
    { workspace_id: "w3", label: "shell-only", number: 3 },
  ];
  const panes = [
    { pane_id: "w1:p1", workspace_id: "w1", label: "shell", agent_status: "unknown" },
    { pane_id: "w1:p2", workspace_id: "w1", label: "watering schedule", agent: "claude", agent_status: "idle", cwd: "/x", agent_session: { value: "s-1" } },
    { pane_id: "w1:p3", workspace_id: "w1", label: "", agent: "claude", agent_status: "working", terminal_title: "claude", terminal_id: "term_9" },
    { pane_id: "w2:p1", workspace_id: "w2", label: "x", agent: "codex", agent_status: "blocked", agent_session: { value: "c-1" } },
    { pane_id: "w3:p1", workspace_id: "w3", label: "shell", agent_status: "unknown" },
  ];
  const out = buildSessions(workspaces, panes, { "w1:p2": "a\nb" });
  assert.deepEqual(out.workspaces, [
    { id: "w2", label: "other", session_ids: ["codex:c-1"] },
    { id: "w1", label: "garden", session_ids: ["claude:s-1", "terminal:term_9"] },
  ]);
  assert.deepEqual(out.sessions.map((s) => s.pane_id), ["w2:p1", "w1:p2", "w1:p3"]);
  const s = out.sessions[1];
  assert.deepEqual(s, {
    id: "claude:s-1", pane_id: "w1:p2", workspace_id: "w1", workspace_label: "garden", label: "watering schedule", title: "",
    agent: "claude", status: "idle", cwd: "/x", tail: "a\nb",
  });
  assert.equal(out.sessions[2].title, "claude");
});

test("parseEnvFile reads KEY=VALUE lines, skipping comments, blanks and surrounding quotes", async () => {
  const { parseEnvFile } = await import("../core/lib.mjs");
  const text = '# summarizer\nSUMMARIZER=openai\n\nOPENAI_BASE_URL="https://api.deepseek.com/v1"\nOPENAI_MODEL=\'deepseek-chat\'\nexport OPENAI_API_KEY=sk-1=2\nbad line\n';
  assert.deepEqual(parseEnvFile(text), {
    SUMMARIZER: "openai",
    OPENAI_BASE_URL: "https://api.deepseek.com/v1",
    OPENAI_MODEL: "deepseek-chat",
    OPENAI_API_KEY: "sk-1=2",
  });
});

test("sessionId: the agent's own session id when Herdr reports one, else the terminal; two panes never share one", async () => {
  const { sessionId } = await import("../core/lib.mjs");
  assert.equal(sessionId({ agent: "claude", agent_session: { value: "abc-1" }, pane_id: "w1:p1" }), "claude:abc-1");
  assert.equal(sessionId({ agent: "opencode", agent_session: { value: "ses_9" }, pane_id: "w1:p1" }), "opencode:ses_9");
  assert.equal(sessionId({ agent: "kimi", terminal_id: "term_3", pane_id: "w1:p1" }), "terminal:term_3");
  assert.equal(sessionId({ agent: "kimi", pane_id: "w1:p4" }), "pane:w1-p4");
  assert.equal(sessionId({ agent: "claude", agent_session: { value: "bad id/../x" }, terminal_id: "term_3", pane_id: "w1:p1" }), "terminal:term_3");
  const { buildSessions } = await import("../core/lib.mjs");
  const same = { workspace_id: "w1", agent: "claude", agent_status: "idle", agent_session: { value: "dup" } };
  const out = buildSessions([{ workspace_id: "w1", label: "a", number: 1 }], [{ ...same, pane_id: "w1:p1" }, { ...same, pane_id: "w1:p2" }], {});
  assert.deepEqual(out.sessions.map((x) => x.id), ["claude:dup", "claude:dup@w1-p2"]);
});
