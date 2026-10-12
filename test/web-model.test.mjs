import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { store, fromV1, applySession, removeSession, needsOf, items, summarizerName } from "../web/js/model.js";
import { setLang } from "../web/js/i18n.js";

setLang("en");
const WAITING = "Stopped at a prompt, waiting for you";

const session = (over) => ({
  id: "claude:s1", pane_id: "w1:p1", workspace_id: "w1", workspace_label: "app", label: "", title: "", agent: "claude", status: "idle",
  cwd: "", tail: "", last_message: null, summary: null, summarizing: false, links: {}, ...over,
});
const summary = (over) => ({
  goal: "g", now: "n", needs_you: [], blocked: [], doing: [], todo: [], done: [],
  source: "transcript", summarized_by: "claude-code:haiku", updated_at: "2026-10-13T00:00:00Z", self_report_at: null, ...over,
});

beforeEach(() => {
  store.data = fromV1({
    version: 1, generated_at: "2026-10-13T00:00:00Z",
    workspaces: [{ id: "w1", label: "app", session_ids: ["claude:s1"] }],
    sessions: [session()],
  });
});

test("fromV1 groups sessions under their workspaces, by session id", () => {
  assert.equal(store.data.workspaces[0].panes[0].id, "claude:s1");
});

test("applySession replaces a known session, adds a new one, and makes its workspace if needed", () => {
  applySession(session({ status: "working" }));
  assert.equal(store.data.workspaces[0].panes[0].status, "working");
  applySession(session({ id: "claude:s2", pane_id: "w1:p2" }));
  assert.equal(store.data.workspaces[0].panes.length, 2);
  // a pane that moved keeps its session id: replaced in place, not added
  applySession(session({ pane_id: "w1:p9" }));
  assert.equal(store.data.workspaces[0].panes.length, 2);
  applySession(session({ id: "claude:s3", pane_id: "w2:p1", workspace_id: "w2", workspace_label: "docs" }));
  assert.deepEqual(store.data.workspaces.map((w) => w.label), ["app", "docs"]);
});

test("removeSession drops the session, and the workspace once it is empty", () => {
  removeSession("claude:s1");
  assert.deepEqual(store.data.workspaces, []);
});

test("needsOf: the summary's items, else Herdr seeing the agent stopped at a prompt", () => {
  const ask = { id: "a1", text: "Approve the new pump", since: "2026-10-13T00:00:00Z" };
  assert.deepEqual(needsOf(session({ status: "blocked" })).map((i) => i.text), [WAITING]);
  assert.deepEqual(needsOf(session({ status: "blocked", summary: summary({ needs_you: [ask] }) })), [ask]);
  assert.deepEqual(needsOf(session({ status: "idle" })), []);
  applySession(session({ status: "blocked" }));
  assert.deepEqual(items("needs").map((i) => i.text), [WAITING]);
});

test("summarizerName turns the label into words", () => {
  const agentName = (k) => k[0].toUpperCase() + k.slice(1);
  assert.equal(summarizerName("claude-code:haiku", agentName), "Claude Code · haiku");
  assert.equal(summarizerName("opencode:opencode/claude-haiku-5-5", agentName), "opencode · opencode/claude-haiku-5-5");
  assert.equal(summarizerName("openai-compatible:qwen", agentName), "qwen");
  assert.equal(summarizerName("codex", agentName), "Codex");
});

test("applySession: a session moved to another workspace leaves the old one, which disappears when empty", () => {
  applySession(session({ pane_id: "w2:p1", workspace_id: "w2", workspace_label: "docs" }));
  assert.deepEqual(store.data.workspaces.map((w) => [w.label, w.panes.map((p) => p.pane_id)]), [["docs", ["w2:p1"]]]);
});

test("ago says how long an item has waited, in words", async () => {
  const { ago } = await import("../web/js/dom.js");
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.equal(ago("2026-10-13T11:59:50Z", now), "just now");
  assert.equal(ago("2026-10-13T11:45:00Z", now), "15 min ago");
  assert.equal(ago("2026-10-13T09:00:00Z", now), "3 h ago");
  assert.equal(ago("2026-10-12T12:00:00Z", now), "yesterday");
  assert.equal(ago("2026-10-10T12:00:00Z", now), "3 days ago");
});

test("pushState: iPhone Safari must add to home screen first; then the permission decides", async () => {
  const { pushState } = await import("../web/js/platform.js");
  const iphone = { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", standalone: false, hasPush: false, permission: "default" };
  assert.equal(pushState(iphone), "add-to-home");
  assert.equal(pushState({ ...iphone, standalone: true, hasPush: true }), "ready");
  assert.equal(pushState({ ...iphone, standalone: true, hasPush: true, permission: "denied" }), "denied");
  assert.equal(pushState({ ua: "Mozilla/5.0 (Macintosh)", standalone: false, hasPush: true, permission: "default" }), "ready");
  assert.equal(pushState({ ua: "Mozilla/5.0 (X11; Linux)", standalone: false, hasPush: false, permission: "default" }), "unsupported");
  // iPad Safari reports itself as a Mac but has touch
  assert.equal(pushState({ ua: "Mozilla/5.0 (Macintosh)", touch: true, standalone: false, hasPush: false, permission: "default" }), "add-to-home");
});
