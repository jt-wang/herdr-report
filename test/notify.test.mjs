import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, inQuietHours, DEFAULT_PREFS } from "../core/notify.mjs";

const AT = "2026-10-13T12:00:00.000Z";
const snap = { sessions: [
  { id: "claude:s1", pane_id: "w1:p2", label: "watering schedule", last_message: "The reminder text is ready. Turn it on tonight?", summary: { goal: "Remind before frost", needs_you: [] } },
  { id: "claude:s2", pane_id: "w1:p3", label: "", title: "", summary: { goal: "Write the planting guide", needs_you: [{ id: "q9", text: "Pick a cover" }] } },
] };
const item = (id, list, text, itemId = "i1") => ({ type: "item", id, pane_id: "w1:p2", list, item: { id: itemId, text, since: AT }, at: AT });
const status = (id, to, from = "working") => ({ type: "status", id, pane_id: "w1:p2", from, to, at: AT });
const noon = new Date("2026-10-13T12:00:00");

test("a new request for the user becomes one notification per session, opening that session", () => {
  const { notes } = decide([item("claude:s1", "needs_you", "Approve the new pump")], snap, DEFAULT_PREFS, {}, noon);
  assert.deepEqual(notes, [{ title: "watering schedule", body: "Approve the new pump", tag: "claude:s1", url: "/#/s/claude%3As1" }]);
});

test("several new requests in one session are joined; the session's goal names it when the pane has no name", () => {
  const { notes } = decide([item("claude:s2", "needs_you", "Pick a cover", "a"), item("claude:s2", "needs_you", "Pick a title", "b")], snap, DEFAULT_PREFS, {}, noon);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Write the planting guide");
  assert.equal(notes[0].body, "Pick a cover; Pick a title");
});

test("Herdr seeing an agent stop at a prompt notifies with its last words, at most once per 10 minutes per session", () => {
  const first = decide([status("claude:s1", "blocked")], snap, DEFAULT_PREFS, {}, noon);
  assert.equal(first.notes[0].body, "Waiting for you: The reminder text is ready. Turn it on tonight?");
  const quietAgent = { sessions: [{ ...snap.sessions[0], last_message: null }] };
  assert.equal(decide([status("claude:s1", "blocked")], quietAgent, DEFAULT_PREFS, {}, noon).notes[0].body, "Stopped at a prompt, waiting for you");
  const again = decide([status("claude:s1", "blocked")], snap, DEFAULT_PREFS, first.sent, new Date(noon.getTime() + 5 * 60_000));
  assert.deepEqual(again.notes, []);
  const later = decide([status("claude:s1", "blocked")], snap, DEFAULT_PREFS, first.sent, new Date(noon.getTime() + 11 * 60_000));
  assert.equal(later.notes.length, 1);
});

test("stuck and done follow the settings; done is off by default; doing and todo never notify", () => {
  const moves = [item("claude:s1", "blocked", "CI is red"), item("claude:s1", "done", "Merge #8", "d1"), item("claude:s1", "doing", "Import the seed sheet", "x"), status("claude:s1", "working", "idle")];
  assert.deepEqual(decide(moves, snap, DEFAULT_PREFS, {}, noon).notes.map((n) => n.body), ["Stuck: CI is red"]);
  assert.deepEqual(decide(moves, snap, { ...DEFAULT_PREFS, done: true }, {}, noon).notes.map((n) => n.body), ["Stuck: CI is red; Done: Merge #8"]);
  assert.deepEqual(decide(moves, snap, { ...DEFAULT_PREFS, needs: false, blocked: false }, {}, noon).notes, []);
});

test("quiet hours mute everything except what needs the user", () => {
  const prefs = { ...DEFAULT_PREFS, done: true, quiet: true, quietFrom: "23:00", quietTo: "08:00" };
  const night = new Date("2026-10-13T02:00:00");
  const moves = [item("claude:s1", "done", "Merge #8", "d1"), item("claude:s2", "needs_you", "Pick a cover")];
  assert.deepEqual(decide(moves, snap, prefs, {}, night).notes.map((n) => n.body), ["Pick a cover"]);
  assert.equal(inQuietHours(prefs, night), true);
  assert.equal(inQuietHours(prefs, noon), false);
  assert.equal(inQuietHours({ ...prefs, quietFrom: "13:00", quietTo: "15:00" }, new Date("2026-10-13T14:00:00")), true);
});

test("with done turned on, an agent finishing its turn notifies with its last words; long words are cut", () => {
  const long = { sessions: [{ ...snap.sessions[0], last_message: "long ".repeat(200) }] };
  const n = decide([status("claude:s1", "done")], long, { ...DEFAULT_PREFS, done: true }, {}, noon).notes[0];
  assert.match(n.body, /^Finished: long /);
  assert.ok(n.body.length <= 160);
  assert.deepEqual(decide([status("claude:s1", "done")], snap, DEFAULT_PREFS, {}, noon).notes, [], "done is off by default");
});

test("notifications are worded in the Mac's language: Chinese when it is set", () => {
  const zh = decide([status("claude:s1", "blocked"), item("claude:s1", "blocked", "CI is red")], snap, DEFAULT_PREFS, {}, noon, "zh").notes[0];
  assert.equal(zh.body, "等你回应：The reminder text is ready. Turn it on tonight?；卡住：CI is red");
  const quiet = { sessions: [{ ...snap.sessions[0], last_message: null }] };
  assert.equal(decide([status("claude:s1", "blocked")], quiet, DEFAULT_PREFS, {}, noon, "zh").notes[0].body, "停在确认或提问的界面，等你回应");
});
