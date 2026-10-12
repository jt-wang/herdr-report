import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractDialog, extractCodexDialog, needsRefresh, lastAssistantText, dialogTurns, codexTurns, buildInput } from "../core/transcript.mjs";

const line = (o) => JSON.stringify(o);
const user = (text, extra = {}) => line({ type: "user", message: { role: "user", content: text }, ...extra });
const asst = (...blocks) => line({ type: "assistant", message: { role: "assistant", content: blocks } });

test("extractDialog keeps user text and assistant prose, and only the names of tools used", () => {
  const lines = [
    user("Skip watering when it rains"),
    asst({ type: "thinking", thinking: "hmm" }, { type: "tool_use", name: "Bash", input: {} }),
    line({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "lots of output" }] } }),
    asst({ type: "text", text: "Rain skip is done, #7 merged." }),
    line({ type: "attachment" }),
    "not json",
  ];
  // the tool's input and output are dropped; only its name is noted
  assert.equal(extractDialog(lines), "User: Skip watering when it rains\n\nAssistant used tools: Bash\n\nAssistant: Rain skip is done, #7 merged.");
});

test("extractDialog starts from the latest compaction summary", () => {
  const lines = [
    user("first schedule"),
    user("Summary: the goal is garden watering reminders", { isCompactSummary: true }),
    asst({ type: "text", text: "On to frost reminders" }),
  ];
  assert.equal(extractDialog(lines), "Summary of the earlier conversation: Summary: the goal is garden watering reminders\n\nAssistant: On to frost reminders");
});

test("extractDialog skips sidechain and meta messages", () => {
  const lines = [
    user("<command-name>/clear</command-name>", { isMeta: true }),
    user("subagent prompt", { isSidechain: true }),
    user("Water by soil moisture instead"),
  ];
  assert.equal(extractDialog(lines), "User: Water by soil moisture instead");
});

test("extractDialog shrinks task notifications to their summary and drops system reminders", () => {
  const lines = [
    user("<task-notification> <task-id>b1</task-id> <output-file>/tmp/x</output-file> <status>completed</status> <summary>Agent \"weather API research\" finished</summary> </task-notification>"),
    user("Add a manual watering button<system-reminder>noise</system-reminder>"),
  ];
  assert.equal(extractDialog(lines), "Background task: Agent \"weather API research\" finished\n\nUser: Add a manual watering button");
});

test("extractDialog keeps the head (goal) and the most recent tail when too long", () => {
  const lines = [user("Goal: A"), ...Array.from({ length: 50 }, (_, i) => asst({ type: "text", text: `step ${i} ` + "x".repeat(50) }))];
  const out = extractDialog(lines, { maxChars: 600 });
  assert.ok(out.startsWith("User: Goal: A"));
  assert.ok(out.includes("step 49"));
  assert.ok(!out.includes("step 10 "));
  assert.ok(out.includes("(middle omitted)"));
});

test("needsRefresh: summarize when there is no cache or the source changed after the throttle window", () => {
  const min = 10 * 60_000;
  assert.equal(needsRefresh({ version: 100, cached: null, now: 1000, minIntervalMs: min }), true);
  assert.equal(needsRefresh({ version: 100, cached: { sourceVersion: 100, at: 0 }, now: 10 * min, minIntervalMs: min }), false);
  assert.equal(needsRefresh({ version: 200, cached: { sourceVersion: 100, at: 0 }, now: min - 1, minIntervalMs: min }), false);
  assert.equal(needsRefresh({ version: 200, cached: { sourceVersion: 100, at: 0 }, now: min, minIntervalMs: min }), true);
  assert.equal(needsRefresh({ version: "b", cached: { sourceVersion: "a", at: 0 }, now: min, minIntervalMs: min }), true);
});

const codex = (type, payload) => JSON.stringify({ type, payload });
const cmsg = (role, text) => codex("response_item", {
  type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
});

test("extractCodexDialog keeps user requests and assistant text, drops injected context, notes tool calls by name", () => {
  const lines = [
    codex("session_meta", { id: "x" }),
    cmsg("developer", "system rules"),
    cmsg("user", "<environment_context>cwd</environment_context>"),
    cmsg("user", "Fix the photo upload timeout"),
    codex("response_item", { type: "function_call", name: "shell" }),
    cmsg("assistant", "Timeout fixed, #9 closed"),
  ];
  assert.equal(extractCodexDialog(lines), "User: Fix the photo upload timeout\n\nAssistant used tools: shell\n\nAssistant: Timeout fixed, #9 closed");
});

test("extractCodexDialog restarts from a compaction's replacement history", () => {
  const lines = [
    cmsg("user", "old"),
    codex("compacted", { message: "", replacement_history: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "Goal: compress photos" }] },
    ] }),
    cmsg("assistant", "Go on"),
  ];
  assert.equal(extractCodexDialog(lines), "User: Goal: compress photos\n\nAssistant: Go on");
});

test("needsRefresh: an urgent change (agent now waits on the user or just finished) skips the long throttle", () => {
  const min = 10 * 60_000;
  const cached = { sourceVersion: 100, at: 0 };
  assert.equal(needsRefresh({ version: 200, cached, now: 60_000, minIntervalMs: min, urgent: true, urgentMinMs: 30_000 }), true);
  assert.equal(needsRefresh({ version: 200, cached, now: 10_000, minIntervalMs: min, urgent: true, urgentMinMs: 30_000 }), false);
  assert.equal(needsRefresh({ version: 100, cached, now: 60_000, minIntervalMs: min, urgent: true, urgentMinMs: 30_000 }), false);
});

test("lastAssistantText returns the agent's last words in Claude Code and Codex transcripts", () => {
  const claude = [
    user("request"),
    asst({ type: "text", text: "first line" }),
    asst({ type: "tool_use", name: "Bash" }),
    asst({ type: "text", text: "  Merge #7? " }),
    user("<task-notification><summary>x</summary></task-notification>"),
  ];
  assert.equal(lastAssistantText(claude, "claude"), "Merge #7?");
  const codex = [cmsg("assistant", "Reading files first"), cmsg("user", "Go on"), cmsg("assistant", "Compression done, #9")];
  assert.equal(lastAssistantText(codex, "codex"), "Compression done, #9");
  assert.equal(lastAssistantText([user("only the user spoke")], "claude"), null);
});

// ---- incremental summaries ----------------------------------------------------

const it = (id, text) => ({ id, text, since: "2026-10-13T00:00:00.000Z" });
const prevSummary = { goal: "Skip watering on rainy days", now: "Merge #7", needs_you: [], blocked: [], doing: [it("d1", "Merge #7")], todo: [it("t1", "Add a sound to reminders")], done: [it("o1", "Read the weather forecast")] };

test("dialogTurns and codexTurns return the turns that extractDialog joins", () => {
  const lines = [user("Add a moisture sensor"), asst({ type: "text", text: "OK" })];
  assert.deepEqual(dialogTurns(lines), ["User: Add a moisture sensor", "Assistant: OK"]);
  assert.equal(extractDialog(lines), dialogTurns(lines).join("\n\n"));
  const cx = [line({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "done" }] } })];
  assert.deepEqual(codexTurns(cx), ["Assistant: done"]);
});

test("buildInput: the first summary reads the whole dialog and remembers where it stopped", () => {
  const r = buildInput({ turns: ["User: a", "Assistant: b"], prev: null });
  assert.equal(r.mode, "full");
  assert.equal(r.text, "User: a\n\nAssistant: b");
  assert.equal(r.mark.count, 2);
  assert.equal(typeof r.mark.last, "string");
});

test("buildInput: later summaries send the previous summary plus only the new turns", () => {
  const first = buildInput({ turns: ["User: a", "Assistant: b"], prev: null });
  const prev = { ...prevSummary, mark: first.mark, updates: 0 };
  const r = buildInput({ turns: ["User: a", "Assistant: b", "User: c", "Assistant: d"], prev });
  assert.equal(r.mode, "update");
  assert.match(r.text, /"goal":"Skip watering on rainy days"/);
  assert.match(r.text, /\{"id":"d1","text":"Merge #7"\}/, "items go with their ids, without since");
  assert.doesNotMatch(r.text, /"since"/);
  assert.match(r.text, /User: c\n\nAssistant: d$/);
  assert.doesNotMatch(r.text, /User: a/);
  assert.equal(r.mark.count, 4);
  assert.equal(r.updates, 1);
});

test("buildInput: no new turns means nothing to send", () => {
  const first = buildInput({ turns: ["User: a"], prev: null });
  assert.equal(buildInput({ turns: ["User: a"], prev: { ...prevSummary, mark: first.mark } }).mode, "same");
});

test("buildInput: falls back to the whole dialog after a compaction, after many updates, or when the new part is too long", () => {
  const first = buildInput({ turns: ["User: a", "Assistant: b"], prev: null });
  const prev = { ...prevSummary, mark: first.mark, updates: 0 };
  // compaction rewrote the start, so the remembered last turn no longer matches
  assert.equal(buildInput({ turns: ["Summary of the earlier conversation: x", "Assistant: y", "User: z"], prev }).mode, "full");
  assert.equal(buildInput({ turns: ["User: a"], prev }).mode, "full");
  const r = buildInput({ turns: ["User: a", "Assistant: b", "User: c"], prev: { ...prev, updates: 8 }, maxUpdates: 8 });
  assert.equal(r.mode, "full");
  assert.equal(r.updates, 0);
  assert.equal(buildInput({ turns: ["User: a", "Assistant: b", "User: " + "x".repeat(500)], prev, maxChars: 300 }).mode, "full");
  // a previous attempt that failed has no summary to build on
  assert.equal(buildInput({ turns: ["User: a", "Assistant: b", "User: c"], prev: { mark: first.mark, error: "x" } }).mode, "full");
});

test("buildInput: a full re-read still gets the previous items, so their ids can carry over", () => {
  const first = buildInput({ turns: ["User: a"], prev: null });
  const r = buildInput({ turns: ["Summary of the earlier conversation: x", "Assistant: y"], prev: { ...prevSummary, mark: first.mark } });
  assert.equal(r.mode, "full");
  assert.match(r.text, /Items from the last summary/);
  assert.match(r.text, /"id":"d1"/);
  assert.match(r.text, /Summary of the earlier conversation: x\n\nAssistant: y$/);
});

test("dialogTurns notes the tools the agent used, run together, so a turn that is only tool calls still shows", () => {
  const tool = (name) => ({ type: "tool_use", name, input: {} });
  const lines = [
    user("Change the watering times"),
    asst(tool("Read")), asst(tool("Bash")), asst(tool("Bash")),
    asst({ type: "text", text: "Changed" }),
    user("Make a plant list"),
    asst(tool("Write")),
  ];
  assert.deepEqual(dialogTurns(lines), ["User: Change the watering times", "Assistant used tools: Read, Bash ×2", "Assistant: Changed", "User: Make a plant list", "Assistant used tools: Write"]);
});

test("codexTurns notes function calls the same way", () => {
  const call = (name) => line({ type: "response_item", payload: { type: "function_call", name, arguments: "{}" } });
  const say = (role, text) => line({ type: "response_item", payload: { type: "message", role, content: [{ text }] } });
  assert.deepEqual(codexTurns([say("user", "Run the tests"), call("shell"), call("shell"), say("assistant", "Passing")]),
    ["User: Run the tests", "Assistant used tools: shell ×2", "Assistant: Passing"]);
});

test("buildInput starts with Herdr's current status, so the summarizer knows the agent is waiting", () => {
  const r = buildInput({ turns: ["User: Make a plant list", "Assistant used tools: Write"], prev: null, status: "blocked" });
  assert.match(r.text, /^Herdr status now: stopped at an approval or question, waiting for the user\n\n/);
  assert.doesNotMatch(buildInput({ turns: ["User: a"], prev: null }).text, /Herdr/);
});

test("kimiTurns reads kimi's wire.jsonl: what the user typed, the agent's text, its tools by name", async () => {
  const { kimiTurns } = await import("../core/transcript.mjs");
  const lines = readFileSync(new URL("./fixtures/kimi/wd_demo_1/session_k1/agents/main/wire.jsonl", import.meta.url), "utf8").split("\n");
  assert.deepEqual(kimiTurns(lines), ["User: Add Latin names to the plants", "Assistant used tools: Bash", "Assistant: Added the Latin names. Sync them to search?"]);
  assert.equal(lastAssistantText(lines, "kimi"), "Added the Latin names. Sync them to search?");
});
