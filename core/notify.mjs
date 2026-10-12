// Push notifications: which changes are worth waking the phone for, and the
// devices to wake. Fed by the same transitions /v1/events sends (status and
// item events), so the stream and the pushes never disagree.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateVapidKeys, sendPush } from "./push.mjs";

export const DEFAULT_PREFS = {
  needs: true, // something needs the user, or Herdr sees the agent stopped at a prompt
  blocked: true, // something got stuck
  done: false, // something got finished; chatty, so off
  quiet: false, // quiet hours mute everything except what needs the user
  quietFrom: "23:00",
  quietTo: "08:00",
};

// Notification words, in the Mac's language (SUMMARY_LANG).
const WORDS = {
  zh: { waiting: "停在确认或提问的界面，等你回应", waitingSaid: "等你回应：", stuck: "卡住：", done: "做完：", finished: "做完了：", join: "；", test: "通知已开启", session: "会话" },
  en: { waiting: "Stopped at a prompt, waiting for you", waitingSaid: "Waiting for you: ", stuck: "Stuck: ", done: "Done: ", finished: "Finished: ", join: "; ", test: "Notifications are on", session: "Session" },
};
export const WAITING = WORDS.en.waiting;
const WAITING_EVERY_MS = 10 * 60_000;
const BODY_MAX = 150;
const clip = (t) => (t.length > BODY_MAX ? t.slice(0, BODY_MAX - 1) + "…" : t);

const minutes = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

// True when now is inside quiet hours, which may wrap past midnight.
export function inQuietHours(p, now = new Date()) {
  if (!p.quiet) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(p.quietFrom), to = minutes(p.quietTo);
  if (from === to) return false;
  return from < to ? at >= from && at < to : at >= from || at < to;
}

function nameOf(s, w) {
  const label = (s?.label || "").trim();
  if (label && label !== "shell" && label.toLowerCase() !== s.agent) return label;
  return s?.summary?.goal || s?.title || s?.pane_id || w.session;
}

// moves: status and item transitions; sent: { <session id>: ms of the last
// "stopped at a prompt" notice }. Returns one notification per session, tagged
// with the session id so a newer one replaces the older on the lock screen.
export function decide(moves, snap, prefs, sent, now = new Date(), lang = "en") {
  const w = WORDS[lang] || WORDS.en;
  const quiet = inQuietHours(prefs, now);
  const bySession = new Map();
  const add = (id, kind, text) => {
    if (!bySession.has(id)) bySession.set(id, { needs: [], waiting: false, finished: false, blocked: [], done: [] });
    const b = bySession.get(id);
    if (kind === "waiting" || kind === "finished") b[kind] = true;
    else b[kind].push(text);
  };
  for (const m of moves) {
    if (m.type === "status" && m.to === "blocked" && prefs.needs) add(m.id, "waiting");
    if (m.type === "status" && m.to === "done" && prefs.done && !quiet) add(m.id, "finished");
    if (m.type !== "item") continue;
    if (m.list === "needs_you" && prefs.needs) add(m.id, "needs", m.item.text);
    if (m.list === "blocked" && prefs.blocked && !quiet) add(m.id, "blocked", m.item.text);
    if (m.list === "done" && prefs.done && !quiet) add(m.id, "done", m.item.text);
  }
  const nextSent = { ...sent };
  const notes = [];
  const t = now.getTime();
  for (const [id, b] of bySession) {
    const s = snap.sessions.find((x) => x.id === id);
    // The agent's last words cost nothing and usually are the question it is asking.
    const said = s?.last_message ? clip(s.last_message.replace(/\s+/g, " ").trim()) : "";
    const parts = [...b.needs];
    if (!b.needs.length && b.waiting) {
      if (t - (sent[id] || 0) >= WAITING_EVERY_MS) {
        parts.push(said ? `${w.waitingSaid}${said}` : w.waiting);
        nextSent[id] = t;
      }
    }
    if (b.blocked.length) parts.push(w.stuck + b.blocked.join(w.join));
    if (b.done.length) parts.push(w.done + b.done.join(w.join));
    else if (b.finished && said) parts.push(w.finished + said);
    if (!parts.length) continue;
    notes.push({ title: nameOf(s, w), body: parts.join(w.join), tag: id, url: `/#/s/${encodeURIComponent(id)}` });
  }
  return { notes, sent: nextSent };
}

// The devices, keys and settings, kept as files in dir (0600: a subscription
// is a URL that can wake the owner's phone).
export function createNotifier(dir, { lang = "en" } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = (n) => join(dir, n);
  const read = (n, fallback) => {
    try { return JSON.parse(readFileSync(file(n), "utf8")); } catch { return fallback; }
  };
  const write = (n, v) => writeFileSync(file(n), JSON.stringify(v, null, 2), { mode: 0o600 });

  if (!existsSync(file("vapid.json"))) write("vapid.json", generateVapidKeys());
  // Apple refuses a VAPID subject on a host that cannot exist (403 BadJwtToken
  // for @localhost, measured 2026-09-03 in codexbar-pwa); example.com is reserved.
  const vapid = { ...read("vapid.json"), subject: "mailto:herdr-report@example.com" };
  let subs = read("subscriptions.json", []);
  let prefs = { ...DEFAULT_PREFS, ...read("prefs.json", {}) };
  let sent = read("sent.json", {});

  async function deliver(notes) {
    let delivered = 0;
    const gone = new Set();
    for (const note of notes) {
      for (const sub of subs) {
        const r = await sendPush(sub, note, vapid).catch((e) => ({ error: e.message }));
        if (r.ok) delivered++;
        else if (r.gone) gone.add(sub.endpoint);
        else console.error(`push: ${r.error}`);
      }
    }
    if (gone.size) {
      subs = subs.filter((s) => !gone.has(s.endpoint));
      write("subscriptions.json", subs);
    }
    return delivered;
  }

  return {
    info: () => ({ public_key: vapid.publicKey, devices: subs.length, prefs }),
    subscribe(sub) {
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("not a push subscription");
      subs = [...subs.filter((s) => s.endpoint !== sub.endpoint), { endpoint: sub.endpoint, keys: sub.keys }];
      write("subscriptions.json", subs);
      return subs.length;
    },
    unsubscribe(endpoint) {
      subs = subs.filter((s) => s.endpoint !== endpoint);
      write("subscriptions.json", subs);
      return subs.length;
    },
    setPrefs(patch) {
      for (const k of Object.keys(DEFAULT_PREFS)) {
        if (k in patch && typeof patch[k] === typeof DEFAULT_PREFS[k]) prefs[k] = patch[k];
      }
      write("prefs.json", prefs);
      return prefs;
    },
    async handle(moves, snap) {
      if (!subs.length) return 0;
      const out = decide(moves, snap, prefs, sent, new Date(), lang);
      sent = out.sent;
      write("sent.json", sent);
      return deliver(out.notes);
    },
    test: () => deliver([{ title: "Herdr Report", body: (WORDS[lang] || WORDS.en).test, tag: "test", url: "/" }]),
  };
}
