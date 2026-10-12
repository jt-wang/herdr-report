// Boot: load the data, keep it current from /v1/events, route between pages.
import { store, STATES, fromV1, applySession, removeSession, sessions } from "./model.js";
import { ui, home, listView, sessionView, missing } from "./views.js";
import { initGestures } from "./gestures.js";
import { settingsView, loadPush } from "./settings.js";

const app = document.getElementById("app");

/* ---------- data ---------- */

async function loadSessions() {
  try {
    const r = await fetch("/v1/sessions", { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    store.data = fromV1(await r.json());
    store.error = "";
    return true;
  } catch (e) {
    store.error = e.message;
    return false;
  } finally {
    update();
  }
}

async function loadSummarizer() {
  try { store.summarizer = await (await fetch("/v1/summarizer", { cache: "no-store" })).json(); } catch {}
  update();
}

// The server sends a snapshot on connect, then each session as it changes.
// EventSource reconnects by itself after a drop.
function connect() {
  const es = new EventSource("/v1/events");
  es.addEventListener("snapshot", (e) => { store.data = fromV1(JSON.parse(e.data)); store.error = ""; store.live = true; update(); });
  es.addEventListener("session", (e) => { applySession(JSON.parse(e.data)); update(); });
  es.addEventListener("removed", (e) => { removeSession(JSON.parse(e.data).id); update(); });
  es.onopen = () => { store.live = true; update(); };
  es.onerror = () => { store.live = false; update(); };
}

// Redraw, unless the reader has a card unfolded or the terminal open; then
// redraw when they close it, so nothing moves under their finger.
let frame = 0;
function update() {
  if (ui.openItem || document.querySelector("details[open]")) { ui.stale = true; return; }
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}

/* ---------- routing ---------- */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const route = () => location.hash || "#/";
const stack = [route()];
const scrollMemo = new Map();
let skipAnim = false, barObserver = null;

function render() {
  ui.stale = false;
  const h = route();
  const l = h.match(/^#\/l\/(\w+)$/), s = h.match(/^#\/s\/(.+)$/);
  let view;
  if (h === "#/settings") view = settingsView();
  else if (l && STATES[l[1]]) view = listView(l[1]);
  else if (s) {
    const p = sessions().find((x) => x.id === decodeURIComponent(s[1]));
    view = p ? sessionView(p) : missing();
  } else view = home();
  app.replaceChildren(...view.filter(Boolean));
  // pushed pages: a small title fades into the bar once the large title scrolls away
  barObserver?.disconnect();
  const bar = app.querySelector(".bar"), title = app.querySelector(".head .title");
  if (bar && title) {
    barObserver = new IntersectionObserver(([e]) => bar.classList.toggle("scrolled", !e.isIntersecting),
      { rootMargin: "-48px 0px 0px 0px" });
    barObserver.observe(title);
  }
}

function back({ animate = true } = {}) {
  if (!animate) skipAnim = true;
  if (stack.length > 1) history.back();
  else location.hash = "#/";
}

addEventListener("hashchange", () => {
  const h = route(), prev = stack[stack.length - 1];
  const dir = stack.length > 1 && stack[stack.length - 2] === h ? "pop" : "push";
  scrollMemo.set(prev, scrollY);
  if (dir === "pop") stack.pop(); else stack.push(h);
  ui.openItem = null;
  const swap = () => { render(); scrollTo(0, dir === "pop" ? scrollMemo.get(h) || 0 : 0); };
  if (skipAnim || reduced || !document.startViewTransition) { skipAnim = false; return swap(); }
  document.documentElement.dataset.nav = dir;
  document.startViewTransition(swap).finished.finally(() => delete document.documentElement.dataset.nav);
});

/* ---------- start ---------- */

ui.render = render;
ui.back = back;
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (standalone) initGestures({ app, atHome: () => route() === "#/", back, refresh: loadSessions });

render();
loadSummarizer();
connect();
// The service worker caches the page for offline opens and shows push notifications.
navigator.serviceWorker?.register("/sw.js").then(() => loadPush()).catch(() => loadPush());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { loadSessions(); loadSummarizer(); loadPush(); }
});
