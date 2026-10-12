import { test } from "node:test";
import assert from "node:assert/strict";
import { LISTS, fromStrings, assignIds, transitions } from "../core/items.mjs";

const T0 = "2026-10-13T00:00:00.000Z", T1 = "2026-10-13T01:00:00.000Z";
let n = 0;
const fresh = () => `n${++n}`;

test("fromStrings turns plain strings (old caches, agents' own reports) into items with stable ids", () => {
  const a = fromStrings({ goal: "g", now: "x", needs_you: ["Approve the new pump"], blocked: [], doing: [], todo: [], done: [] }, T0);
  const b = fromStrings({ goal: "g", now: "x", needs_you: ["Approve the new pump"], blocked: [], doing: [], todo: [], done: [] }, T1);
  assert.equal(a.needs_you[0].text, "Approve the new pump");
  assert.equal(a.needs_you[0].since, T0);
  assert.equal(a.needs_you[0].id, b.needs_you[0].id, "same text, same id");
  assert.equal(a.goal, "g");
});

test("assignIds keeps an item's id and since when the summarizer says it's the same thing, reworded or not", () => {
  const prev = { needs_you: [{ id: "a1", text: "Approve the new pump", since: T0 }], blocked: [], doing: [], todo: [], done: [] };
  const next = { goal: "g", now: "n", needs_you: [{ id: "a1", text: "Please approve replacing the old pump" }, { id: "", text: "Decide whether to include perennials" }], blocked: [], doing: [], todo: [], done: [] };
  const out = assignIds(next, prev, T1, fresh);
  assert.deepEqual(out.needs_you[0], { id: "a1", text: "Please approve replacing the old pump", since: T0 });
  assert.equal(out.needs_you[1].since, T1);
  assert.match(out.needs_you[1].id, /^n\d+$/);
});

test("assignIds: an item that moved lists keeps its id but its since restarts; invented or repeated ids are replaced", () => {
  const prev = { needs_you: [], blocked: [], doing: [{ id: "d1", text: "Import the seed sheet", since: T0 }], todo: [], done: [] };
  const next = { goal: "", now: "", needs_you: [], blocked: [], doing: [{ id: "zz", text: "Something new" }], todo: [], done: [{ id: "d1", text: "Import the seed sheet" }, { id: "d1", text: "Repeated" }] };
  const out = assignIds(next, prev, T1, fresh);
  assert.deepEqual(out.done[0], { id: "d1", text: "Import the seed sheet", since: T1 });
  assert.notEqual(out.done[1].id, "d1");
  assert.notEqual(out.doing[0].id, "zz", "ids the summarizer made up are not trusted");
});

const session = (over) => ({ id: "claude:s1", pane_id: "w1:p1", status: "working", summary: null, ...over });
const sum = (lists) => ({ goal: "g", now: "n", needs_you: [], blocked: [], doing: [], todo: [], done: [], ...lists });

test("transitions: a status change, and each item that entered a list", () => {
  const before = session({ summary: sum({ doing: [{ id: "d1", text: "Import the seed sheet", since: T0 }] }) });
  const after = session({ status: "blocked", summary: sum({ done: [{ id: "d1", text: "Import the seed sheet", since: T1 }], needs_you: [{ id: "q1", text: "Approve", since: T1 }] }) });
  const ev = transitions(before, after);
  assert.deepEqual(ev.find((e) => e.type === "status"), { type: "status", id: "claude:s1", pane_id: "w1:p1", from: "working", to: "blocked" });
  const items = ev.filter((e) => e.type === "item").map((e) => `${e.list}:${e.item.id}`).sort();
  assert.deepEqual(items, ["done:d1", "needs_you:q1"]);
});

test("transitions: nothing for an unchanged session; a first summary counts as items entering", () => {
  const s = session({ summary: sum({ needs_you: [{ id: "q1", text: "Approve", since: T0 }] }) });
  assert.deepEqual(transitions(s, s), []);
  assert.deepEqual(transitions(session(), s).map((e) => e.list), ["needs_you"]);
  assert.deepEqual(LISTS, ["needs_you", "blocked", "doing", "todo", "done"]);
});
