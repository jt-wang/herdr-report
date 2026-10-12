// Settings: push notifications on this device, what they cover, quiet hours,
// and which model writes the summaries (shown, changed on the Mac).
import { el, ICON, agentName } from "./dom.js";
import { store, summarizerName } from "./model.js";
import { pushState, currentDevice } from "./platform.js";
import { ui, backBar } from "./views.js";
import { t, savedLang, chooseLang } from "./i18n.js";

export const push = { info: null, subscribed: false, note: "", busy: false };

const b64ToBytes = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const call = (path, method, body) =>
  fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json());

async function subscription() {
  const reg = await navigator.serviceWorker?.getRegistration();
  return (await reg?.pushManager?.getSubscription?.()) || null;
}

export async function loadPush() {
  try {
    // Set both together: a redraw between the two awaits showed a subscribed device as off.
    const [info, sub] = await Promise.all([fetch("/v1/push", { cache: "no-store" }).then((r) => r.json()), subscription()]);
    push.info = info;
    push.subscribed = Boolean(sub);
  } catch {}
  ui.render();
}

async function turnOn() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    push.note = t("noPermission");
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(push.info.public_key) });
  await call("/v1/push/subscribe", "POST", { subscription: sub.toJSON() });
  push.note = "";
}

async function turnOff() {
  const sub = await subscription();
  if (sub) {
    await call("/v1/push/unsubscribe", "POST", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

async function act(fn) {
  if (push.busy) return;
  push.busy = true;
  try { await fn(); } catch (e) { push.note = t("error", { e: e.message }); }
  push.busy = false;
  await loadPush();
}

function toggle(on, disabled, onchange) {
  const input = el("input", { type: "checkbox", class: "switch", role: "switch", disabled: disabled || null });
  input.checked = on;
  input.onchange = () => onchange(input.checked);
  return input;
}

const row = (label, sub, control) =>
  el("label", { class: "srow set" }, el("span", { class: "name" }, label, sub ? el("span", { class: "hint" }, sub) : null), control);

function setPref(k, v) {
  return act(async () => { push.info.prefs = await call("/v1/push/prefs", "PUT", { [k]: v }); });
}

function installSteps() {
  return el("div", { class: "notice" },
    el("span", { class: "icon", html: ICON.bell }),
    el("div", {},
      el("b", {}, t("addToHome")),
      el("p", {}, t("addToHomeWhy")),
      el("ol", { class: "steps" }, el("li", {}, t("step1")), el("li", {}, t("step2")), el("li", {}, t("step3")))));
}

export function settingsView() {
  const state = pushState(currentDevice());
  const info = push.info;
  const prefs = info?.prefs;
  const on = push.subscribed;
  const off = !on || push.busy;
  const head = el("div", { class: "head" },
    el("div", { class: "title" }, el("span", { class: "icon", html: ICON.bell }), el("span", {}, t("notifications"))));

  const blockedWhy = { unsupported: t("unsupported"), denied: t("denied") }[state];
  const main = el("div", { class: "group" },
    row(t("notifications"), blockedWhy || (on ? t("onHere") : t("offHere")),
      toggle(on, !info || state !== "ready" || push.busy, (v) => act(v ? turnOn : turnOff))));
  const what = info && el("div", { class: "group" },
    row(t("needs"), t("needsSub"), toggle(prefs.needs, off, (v) => setPref("needs", v))),
    row(t("blocked"), null, toggle(prefs.blocked, off, (v) => setPref("blocked", v))),
    row(t("done"), null, toggle(prefs.done, off, (v) => setPref("done", v))));
  const quiet = info && el("div", { class: "group" },
    row(t("quiet"), t("quietSub"), toggle(prefs.quiet, off, (v) => setPref("quiet", v))),
    prefs.quiet ? el("div", { class: "srow set times" },
      el("span", { class: "name" }, t("from")),
      timeInput(prefs.quietFrom, off, (v) => setPref("quietFrom", v)),
      el("span", { class: "name" }, t("to")),
      timeInput(prefs.quietTo, off, (v) => setPref("quietTo", v))) : null);
  const test = on && el("button", { class: "act", onclick: () => act(async () => {
    const r = await call("/v1/push/test", "POST");
    push.note = r.sent ? t("sent") : t("notSent");
  }) }, t("sendTest"));

  const sz = store.summarizer;
  const summary = el("div", { class: "group" },
    row(t("summaries"), sz?.active ? summarizerName(sz.active.label, agentName) : t("off"),
      el("span", { class: "count" }, "")));

  return [
    backBar(t("notifications")), head,
    state === "add-to-home" ? installSteps() : null,
    main, what, quiet,
    test ? el("div", { class: "acts" }, test) : null,
    push.note ? el("p", { class: "foot" }, push.note) : null,
    info ? el("p", { class: "foot" }, t("devices", { n: info.devices })) : null,
    summary,
    el("p", { class: "foot" }, [sz?.active?.mode === "continuous" ? t("modeContinuous") : sz?.active ? t("modeOnDemand") : "", t("changeModel")].filter(Boolean).join(" ")),
    language(),
  ];
}

function timeInput(value, disabled, onchange) {
  const input = el("input", { type: "time", class: "time", value, disabled: disabled || null });
  input.onchange = () => input.value && onchange(input.value);
  return input;
}

// Automatic follows the phone; a choice is kept on this device.
function language() {
  const now = savedLang();
  const pick = (choice) => () => { chooseLang(choice); ui.render(); };
  return el("div", { class: "group" },
    el("div", { class: "srow set" }, el("span", { class: "name" }, t("language")),
      el("span", { class: "seg" }, ["auto", "zh", "en"].map((c) =>
        el("button", { class: c === now ? "on" : "", onclick: pick(c) }, t({ auto: "langAuto", zh: "langZh", en: "langEn" }[c]))))));
}
