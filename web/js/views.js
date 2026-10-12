// The three pages: home (lists and workspaces), one list, one session.
import { el, time, ago, GLYPH, ICON, pie, mark, agentName } from "./dom.js";
import { store, STATES, statusText, sessions, nameOf, needsOf, openCount, frac, rank, items, summarizerName } from "./model.js";
import { t } from "./i18n.js";

const expanded = new Set(); // "show all" pressed, per session and state
export const ui = { openItem: null, stale: false, render: () => {}, back: () => {} };

/* ---------- pieces ---------- */

function agentLine(p) {
  const s = p.summary;
  return el("div", { class: "a" }, mark(p.agent),
    el("span", {}, [agentName(p.agent), statusText(p.status), s?.at ? t("summarizedAt", { time: time(s.at) }) : null].filter(Boolean).join(" · ")));
}

// Switch Herdr on the Mac to the pane.
function openActs(p, cls = "act") {
  const focus = el("button", { class: cls }, t("focus"));
  focus.onclick = async (e) => {
    e.stopPropagation();
    try {
      const r = await fetch(`/v1/sessions/${encodeURIComponent(p.id)}/focus`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error);
      focus.textContent = t("focused");
      focus.classList.add("ok");
    } catch (err) { focus.textContent = t("focusFailed", { e: err.message }); }
  };
  return [focus];
}

// A section for one state: its header, then its items on that state's surface.
// Items that belong to a session unfold in place into a card when tapped.
function section(key, list, { showHeader = true, foldId = null } = {}) {
  const S = STATES[key];
  const folded = S.fold && foldId && !expanded.has(foldId) && list.length > S.fold;
  const shown = folded ? list.slice(0, S.fold) : list;
  return el("div", { class: "sect s-" + key, style: `--c:${S.c};--bg:${S.bg || "none"}` },
    showHeader ? el("h3", {}, el("span", { class: "glyph", html: GLYPH[key](14) }), t(key), el("span", { class: "n" }, String(list.length))) : null,
    el("div", { class: "panel" + (S.bg ? "" : " plain") }, shown.map((it, i) => {
      const glyph = el("span", { class: "glyph", html: GLYPH[key](18) });
      if (!it.p) return el("div", { class: "item" }, glyph, el("div", { class: "text" }, el("div", { class: "t" }, it.text)));
      const id = `${key}:${it.p.id}:${i}`;
      const waited = key === "needs" && it.item?.since ? ago(it.item.since) : "";
      const s = it.p.summary;
      const row = el("div", { class: "item tap" + (ui.openItem === id ? " open" : "") },
        glyph,
        el("div", { class: "text" },
          el("div", { class: "t" }, it.text),
          el("div", { class: "sub" }, [nameOf(it.p), waited].filter(Boolean).join(" · ")),
          el("div", { class: "fold" }, el("div", {},
            s?.now ? el("div", { class: "now" }, t("nowPrefix", { x: s.now })) : null,
            el("div", { style: "margin-top:8px" }, agentLine(it.p)),
            el("a", { class: "go", href: `#/s/${encodeURIComponent(it.p.id)}`, onclick: (e) => e.stopPropagation() },
              el("span", {}, t("seeAll")), el("span", {}, "›")),
            el("div", { class: "card-acts" }, openActs(it.p, ""))))));
      row.onclick = () => {
        const wasOpen = row.classList.contains("open");
        document.querySelectorAll(".item.open").forEach((r) => r.classList.remove("open"));
        ui.openItem = wasOpen ? null : id;
        if (!wasOpen) row.classList.add("open");
        else if (ui.stale) ui.render(); // updates that arrived while the card was open
      };
      return row;
    })),
    folded ? el("button", { class: "more", onclick: () => { expanded.add(foldId); ui.render(); } }, t("showAll", { n: list.length })) : null);
}

export function backBar(title = "") {
  return el("div", { class: "bar" },
    el("button", { class: "back", html: ICON.back, "aria-label": t("back"), onclick: () => ui.back() }),
    el("div", { class: "small" }, title), el("span"));
}

// Shown on home while no summarizer is chosen.
function summariesOff() {
  const sz = store.summarizer;
  if (!sz || sz.active) return null;
  const rec = sz.recommended;
  return el("div", { class: "notice" },
    el("span", { class: "icon", html: ICON.summary }),
    el("div", {},
      el("b", {}, t("offTitle")),
      el("p", {}, t("offBody") + (rec ? " " + t("offRec", { label: rec.label, cost: rec.cost_per_summary }) : "")),
      el("p", { class: "how" }, rec ? t("offHowRec") : t("offHow"))));
}

/* ---------- home ---------- */

const SHUT_KEY = "pm.shut";
function shutSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SHUT_KEY) || "[]")); } catch { return new Set(); }
}
function saveShut(set) {
  try { localStorage.setItem(SHUT_KEY, JSON.stringify([...set])); } catch {}
}
function toggle(id, g) {
  const set = shutSet();
  const nowShut = !g.classList.contains("shut");
  g.classList.toggle("shut", nowShut);
  g.querySelector(".srow.area").setAttribute("aria-expanded", String(!nowShut));
  if (nowShut) set.add(id); else set.delete(id);
  saveShut(set);
}

function syncLabel() {
  if (store.error) return el("span", { class: "side r err" }, t("loadFailed"));
  if (!store.data) return el("span", { class: "side r" });
  if (!store.live) return el("span", { class: "side r" }, t("reconnecting"));
  return el("span", { class: "side r" }, el("span", { class: "dot" }), time(Date.parse(store.data.at)));
}

export function home() {
  const all = sessions(), shut = shutSet();
  const ws = store.data?.workspaces || [];
  const top = el("div", { class: "top" },
    el("div", { class: "nav" },
      el("a", { class: "side bell", href: "#/settings", "aria-label": t("notifySettings"), html: ICON.bell }),
      el("h1", {}, t("appTitle")), syncLabel()));
  const listRow = (key) => el("a", { class: "srow", href: `#/l/${key}` },
    el("span", { class: "icon", html: GLYPH[key](22) }), el("span", { class: "name" }, t(key)),
    el("span", { class: "count" + (key === "needs" ? " needs" : "") }, items(key).length || ""));
  const lists = el("div", { class: "group" }, ["needs", "blocked", "doing", "done"].map(listRow));
  const areas = ws.map((w) => {
    const ps = [...w.panes].sort((a, b) => rank(a) - rank(b));
    const n = ps.reduce((k, p) => k + needsOf(p).length, 0);
    const g = el("div", { class: "group" + (shut.has(w.workspace_id) ? " shut" : "") },
      el("div", { class: "srow area", role: "button", "aria-expanded": String(!shut.has(w.workspace_id)) },
        el("span", { class: "icon", html: ICON.area }), el("span", { class: "name" }, w.label),
        n ? el("span", { class: "needs-n" }, n) : null,
        el("span", { class: "count" }, ps.length),
        el("span", { class: "chev", html: ICON.fold })),
      el("div", { class: "kids" }, el("div", {}, ps.map((p) => {
        const needs = needsOf(p).length;
        return el("a", { class: "srow child", href: `#/s/${encodeURIComponent(p.id)}` },
          el("span", { class: "icon", html: pie(frac(p.summary)) }),
          el("span", { class: "name" }, nameOf(p)),
          p.status === "working" ? el("span", { class: "live", title: t("status_working") }) : null,
          mark(p.agent),
          needs ? el("span", { class: "count needs" }, needs) : el("span", { class: "count" }, openCount(p.summary) || ""));
      }))));
    g.querySelector(".srow.area").onclick = () => toggle(w.workspace_id, g);
    return g;
  });
  const summarized = all.filter((p) => p.summary).length;
  const foot = !store.data ? store.error || t("loading") : t("foot", { n: all.length, k: summarized });
  return [top, summariesOff(), lists, ...areas, el("div", { class: "foot" }, foot)];
}

/* ---------- one list ---------- */

export function listView(key) {
  const list = items(key);
  const n = new Set(list.map((i) => i.p.id)).size;
  const head = el("div", { class: "head" },
    el("div", { class: "title" }, el("span", { class: "icon", html: GLYPH[key](26) }), el("span", {}, t(key))),
    el("div", { class: "caption" }, list.length ? t("sessionsCount", { n, k: list.length }) : ""));
  return [backBar(t(key)), head, list.length ? section(key, list, { showHeader: false })
    : el("div", { class: "empty" }, el("b", {}, t(`${key}Empty`)), el("span", {}, key === "needs" ? t("needsEmptySub") : ""))];
}

/* ---------- one session ---------- */

const SOURCE = { "self-report": "src_self", transcript: "src_transcript", screen: "src_screen" };

function lastWords(p) {
  if (!p.last_message) return null;
  const said = el("p", { class: "notes said" }, el("span", { class: "lbl" }, t("lastWords")), p.last_message);
  said.onclick = () => said.classList.toggle("all");
  return said;
}

function caption(p) {
  const s = p.summary;
  if (s?.now) return t("nowPrefix", { x: s.now });
  if (p.summarizing) return t("writing");
  const status = statusText(p.status) || t("statusUnknown");
  if (store.summarizer && !store.summarizer.active) return status;
  return t("notYet", { status });
}

export function sessionView(p) {
  const s = p.summary;
  const head = el("div", { class: "head" },
    el("div", { class: "title" }, el("span", { class: "icon", html: pie(frac(s), 22) }), el("span", {}, nameOf(p))),
    s?.goal && s.goal !== nameOf(p) ? el("p", { class: "notes" }, s.goal) : null,
    el("div", { class: "caption" }, caption(p)),
    s ? null : lastWords(p),
    s?.error ? el("p", { class: "notes err" }, t("updateFailed", { e: s.error })) : null);
  const needs = needsOf(p);
  const sections = [
    needs.length ? section("needs", needs.map((it) => ({ text: it.text }))) : null,
    ...(s ? ["blocked", "doing", "todo", "done"] : [])
      .filter((k) => s[STATES[k].field]?.length)
      .map((k) => section(k, s[STATES[k].field].map((it) => ({ text: it.text })), { foldId: `${p.id}:${k}` })),
  ];
  const pre = el("pre", {}, p.tail || t("noOutput"));
  const term = el("details", {}, el("summary", {}, t("terminal")), pre);
  term.ontoggle = async () => {
    if (!term.open) { if (ui.stale) ui.render(); return; }
    try {
      const r = await fetch(`/v1/sessions/${encodeURIComponent(p.id)}/screen`, { cache: "no-store" });
      pre.textContent = (await r.json()).text || t("noOutput");
      pre.scrollTop = pre.scrollHeight;
    } catch (e) { pre.textContent = t("readFailed", { e: e.message }); }
  };
  const by = s ? (s.source === "self-report" ? t("src_self") : t("by", { src: t(SOURCE[s.source]), who: summarizerName(s.summarized_by, agentName) })) : null;
  const meta = el("div", { class: "meta" }, agentLine(p),
    el("div", { style: "margin-top:4px" }, [p.workspace, p.pane_id, by].filter(Boolean).join(" · ")),
    s?.self_report_at ? el("div", { style: "margin-top:4px" }, t("selfReport", { time: time(Date.parse(s.self_report_at)) })) : null);
  return [backBar(nameOf(p)), head, el("div", { class: "acts" }, openActs(p)), ...sections, meta, term];
}

export function missing() {
  return [backBar(), el("div", { class: "empty" }, el("b", {}, store.data ? t("paneClosed") : t("loading")))];
}
