import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { summarizerFromEnv, backendLabel, validateSummary, summarize } from "../core/summarizer.mjs";

const fixtures = new URL("./fixtures/", import.meta.url).pathname;
const both = { claude: "/bin/claude", codex: "/bin/codex" };

test("summarizerFromEnv: off unless the user chose one, so nobody's quota is spent without asking", () => {
  assert.equal(summarizerFromEnv({}, both), null);
  assert.equal(summarizerFromEnv({ SUMMARIZER: "off" }, both), null);
});

test("summarizerFromEnv: an agent CLI with the model the user picked", () => {
  assert.deepEqual(summarizerFromEnv({ SUMMARIZER: "claude", SUMMARY_MODEL: "haiku" }, both), { kind: "claude", bin: "/bin/claude", model: "haiku" });
  assert.deepEqual(summarizerFromEnv({ SUMMARIZER: "codex" }, both), { kind: "codex", bin: "/bin/codex", model: null });
  // chosen but not installed
  assert.equal(summarizerFromEnv({ SUMMARIZER: "codex" }, { claude: "/bin/claude" }), null);
  assert.equal(summarizerFromEnv({ SUMMARIZER: "nonsense" }, both), null);
});

test("summarizerFromEnv: an OpenAI-compatible endpoint; a local server needs no key, extra request fields pass through", () => {
  const b = summarizerFromEnv({
    SUMMARIZER: "openai", OPENAI_BASE_URL: "http://127.0.0.1:8080/v1/", OPENAI_MODEL: "qwen",
    OPENAI_EXTRA_BODY: '{"chat_template_kwargs":{"enable_thinking":false}}', SUMMARY_MAX_TOKENS: "3000",
  }, {});
  assert.equal(b.kind, "openai");
  assert.equal(b.baseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(b.apiKey, "");
  assert.deepEqual(b.extraBody, { chat_template_kwargs: { enable_thinking: false }, max_tokens: 3000 });
  assert.equal(summarizerFromEnv({ SUMMARIZER: "openai", OPENAI_MODEL: "m" }, {}), null, "needs a base URL");
  assert.throws(() => summarizerFromEnv({ SUMMARIZER: "openai", OPENAI_BASE_URL: "http://x", OPENAI_MODEL: "m", OPENAI_EXTRA_BODY: "{bad" }, {}), /OPENAI_EXTRA_BODY/);
});

test("summarizerFromEnv: any command that reads stdin and prints the JSON", () => {
  assert.deepEqual(summarizerFromEnv({ SUMMARIZER: "command", SUMMARIZER_CMD: "my-llm --json" }, {}), { kind: "command", cmd: "my-llm --json" });
  assert.equal(summarizerFromEnv({ SUMMARIZER: "command" }, {}), null);
});

test("backendLabel names the tool and the model", () => {
  assert.equal(backendLabel({ kind: "claude", model: "haiku" }), "claude-code:haiku");
  assert.equal(backendLabel({ kind: "codex", model: null }), "codex");
  assert.equal(backendLabel({ kind: "openai", model: "qwen" }), "openai-compatible:qwen");
  assert.equal(backendLabel({ kind: "command", cmd: "x" }), "command");
});

test("summarize passes the chosen model to claude -p, and an update gets the update instructions", async () => {
  const b = { kind: "claude", bin: `${fixtures}fake-claude.mjs`, model: "haiku" };
  const s = await summarize("record #7", b, { cwd: fixtures });
  assert.match(s.now, /model=haiku/);
  assert.match(s.now, /prompt=full/);
  const u = await summarize("record #7", b, { cwd: fixtures, mode: "update" });
  assert.match(u.now, /prompt=update/);
});

test("summarize with a command gets the instructions and the text on stdin", async () => {
  const s = await summarize("record #7", { kind: "command", cmd: `node ${fixtures}fake-command.mjs` }, { cwd: fixtures });
  assert.match(s.now, /has-rules/);
  assert.match(s.now, /#7/);
});

test("validateSummary keeps items as { id, text }, turns plain strings into items with no id, rejects a broken one", () => {
  const ok = { goal: "g", now: "n", needs_you: [{ id: "a1", text: "a" }], blocked: [], doing: [], todo: [], done: [] };
  assert.deepEqual(validateSummary(ok), ok);
  assert.deepEqual(validateSummary({ ...ok, needs_you: ["a"] }).needs_you, [{ id: "", text: "a" }]);
  assert.throws(() => validateSummary({ ...ok, done: "x" }), /done/);
  assert.throws(() => validateSummary({ ...ok, done: [{ id: "x" }] }), /done/);
  assert.throws(() => validateSummary({ ...ok, goal: undefined }), /goal/);
});

test("the summarizer is asked for items with ids, and to keep an id for the same thing", async () => {
  const { SCHEMA, PROMPT, UPDATE_PROMPT } = await import("../core/summarizer.mjs");
  assert.deepEqual(SCHEMA.properties.needs_you.items.required, ["id", "text"]);
  for (const p of [PROMPT, UPDATE_PROMPT]) assert.match(p, /\bid\b/);
  assert.match(UPDATE_PROMPT, /keep its id/);
});

test("summarize with the codex backend reads the schema-shaped answer", async () => {
  const s = await summarize("the record has #7", { kind: "codex", bin: `${fixtures}fake-codex.mjs` }, { cwd: fixtures });
  assert.equal(s.goal, "codex goal");
  assert.equal(s.now, "Merge #7");
});

test("summarize with an OpenAI-compatible key sends the text and parses the JSON reply", async () => {
  let seen;
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen = { auth: req.headers.authorization, path: req.url, body: JSON.parse(body) };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        goal: "g", now: "n", needs_you: [], blocked: [], doing: ["d"], todo: [], done: [] }) } }] }));
    });
  }).listen(0);
  const port = srv.address().port;
  try {
    const s = await summarize("dialog text", { kind: "openai", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "sk-test", model: "m1", extraBody: { max_tokens: 3000 } });
    assert.deepEqual(s.doing, [{ id: "", text: "d" }]);
    assert.equal(seen.auth, "Bearer sk-test");
    assert.equal(seen.path, "/v1/chat/completions");
    assert.equal(seen.body.model, "m1");
    assert.equal(seen.body.max_tokens, 3000);
    assert.ok(seen.body.messages.some((m) => m.content.includes("dialog text")));
  } finally {
    srv.close();
  }
});

test("summarizerFromEnv / backendLabel: opencode with the model the user picked", () => {
  const b = summarizerFromEnv({ SUMMARIZER: "opencode", SUMMARY_MODEL: "opencode/claude-haiku-5-5" }, { opencode: "/bin/opencode" });
  assert.deepEqual(b, { kind: "opencode", bin: "/bin/opencode", model: "opencode/claude-haiku-5-5" });
  assert.equal(backendLabel(b), "opencode:opencode/claude-haiku-5-5");
  assert.equal(summarizerFromEnv({ SUMMARIZER: "opencode" }, {}), null);
});

test("summarize with opencode: no tools, its own throwaway session store, the chosen model; reads the text events", async () => {
  const b = { kind: "opencode", bin: `${fixtures}fake-opencode.mjs`, model: "opencode/claude-haiku-5-5" };
  const s = await summarize("record #7", b, { cwd: fixtures });
  const seen = JSON.parse(s.now);
  assert.equal(seen.model, "opencode/claude-haiku-5-5");
  assert.ok(seen.pure && seen.agent === "summarize" && seen.title && seen.format === "json");
  assert.deepEqual(seen.agentConfig.permission, { "*": "deny" });
  assert.deepEqual(seen.agentConfig.tools, { "*": false });
  assert.ok(seen.db && !seen.db.includes(".local/share"), "sessions go to a temp file, not the user's history");
  assert.ok(seen.stdin.includes("#7"));
  assert.equal(existsSync(seen.db), false, "the temp session store is deleted afterwards");
});

test("the goal is asked for short, since a session without a pane name uses it as its title", async () => {
  const { PROMPT } = await import("../core/summarizer.mjs");
  assert.match(PROMPT, /goal: [^\n]*at most 30 Chinese characters or 12 English words/);
});

test("the summarizer is told the record's requests are for that session's agent, not for it", async () => {
  const { PROMPT, UPDATE_PROMPT } = await import("../core/summarizer.mjs");
  for (const p of [PROMPT, UPDATE_PROMPT]) assert.match(p, /not to you/);
});

test("summaries are written in the language asked for", async () => {
  const { promptsFor } = await import("../core/summarizer.mjs");
  assert.match(promptsFor("zh").full, /Write in Simplified Chinese/);
  assert.match(promptsFor("en").full, /Write in English/);
  assert.match(promptsFor("en").update, /Write in English/);
  const b = { kind: "claude", bin: `${fixtures}fake-claude.mjs`, model: "haiku" };
  const s = await summarize("record #7", b, { cwd: fixtures, lang: "en" });
  assert.match(s.now, /lang=en/);
});

test("a summarizer killed by a signal (the service stopping) is reported as interrupted, not as a failure", async () => {
  const err = await summarize("x", { kind: "claude", bin: `${fixtures}fake-killed.mjs`, model: "haiku" }, { cwd: fixtures }).catch((e) => e);
  assert.equal(err.interrupted, true);
  const hard = await summarize("x", { kind: "command", cmd: "kill -9 $$" }, { cwd: fixtures }).catch((e) => e);
  assert.equal(hard.interrupted, true, "SIGKILL from outside counts too");
  const slow = await summarize("x", { kind: "command", cmd: "sleep 5" }, { cwd: fixtures, timeoutMs: 300 }).catch((e) => e);
  assert.equal(slow.interrupted, undefined, "our own timeout is a real failure");
  const bad = await summarize("x", { kind: "command", cmd: "echo not-json" }, { cwd: fixtures }).catch((e) => e);
  assert.equal(bad.interrupted, undefined);
});
