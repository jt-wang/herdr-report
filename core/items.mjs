// Items in a summary are { id, text, since }. The id lets a client tell a new
// request from an old one said differently; since is when the item entered its list.
import { createHash, randomBytes } from "node:crypto";

export const LISTS = ["needs_you", "blocked", "doing", "todo", "done"];

const hashId = (list, text) => createHash("sha1").update(`${list}\n${text}`).digest("hex").slice(0, 8);
export const randomId = () => randomBytes(4).toString("hex");

// Items without an id (old caches of plain strings, an agent's own report):
// the id comes from the text, so the same text keeps the same id.
export function fromStrings(s, at) {
  const out = { ...s };
  for (const l of LISTS) {
    out[l] = (s[l] || []).map((x) => {
      const text = typeof x === "string" ? x : x.text;
      return { id: (typeof x === "object" && x.id) || hashId(l, text), text, since: (typeof x === "object" && x.since) || at };
    });
  }
  return out;
}

// next: the summarizer's answer, items as { id, text } where id is an id from
// prev for the same thing, or "" for something new. Only ids that exist in
// prev are kept, and each once; the rest get a fresh one.
export function assignIds(next, prev, now, newId = randomId) {
  const known = new Map(); // id -> { list, since }
  for (const l of LISTS) for (const it of prev?.[l] || []) known.set(it.id, { list: l, since: it.since });
  const used = new Set();
  const out = { ...next };
  for (const l of LISTS) {
    out[l] = (next[l] || []).map((it) => {
      const old = it.id && !used.has(it.id) ? known.get(it.id) : null;
      const id = old ? it.id : newId();
      used.add(id);
      return { id, text: it.text, since: old && old.list === l ? old.since : now };
    });
  }
  return out;
}

// What changed between two versions of one session: Herdr's status, and each
// item that entered a list it wasn't in before.
export function transitions(before, after) {
  const out = [];
  const where = { id: after.id, pane_id: after.pane_id };
  if (before.status !== after.status) out.push({ type: "status", ...where, from: before.status, to: after.status });
  for (const l of LISTS) {
    const had = new Set((before.summary?.[l] || []).map((it) => it.id));
    for (const item of after.summary?.[l] || []) {
      if (!had.has(item.id)) out.push({ type: "item", ...where, list: l, item });
    }
  }
  return out;
}
