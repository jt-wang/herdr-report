import { t } from "./i18n.js";

// The page's own model, built from the public /v1 API (schema/sessions-v1.schema.json),
// and kept current by /v1/events.

export const store = {
  data: null, // { at, workspaces: [{ workspace_id, label, panes: [session] }] }
  error: "",
  live: false, // connected to /v1/events
  summarizer: null, // GET /v1/summarizer
};

// Titles and empty-state words live in i18n.js under the same keys: t("needs"), t("needsEmpty").
export const STATES = {
  needs: { field: "needs_you", c: "var(--blue)", bg: "var(--blue-bg)" },
  blocked: { field: "blocked", c: "var(--red)", bg: "var(--red-bg)" },
  doing: { field: "doing", c: "var(--blue)" },
  todo: { field: "todo", c: "var(--secondary)" },
  done: { field: "done", c: "var(--green)", fold: 3 },
};

export const statusText = (s) => (s && s !== "unknown" ? t(`status_${s}`) : "");

// Herdr itself sees an agent stopped at an approval or question. That needs the
// user even when no summary says so, or when summaries are off.
const waitingItem = () => ({ id: "waiting", text: t("waiting"), since: null });

function toPane(s) {
  return { ...s, summary: s.summary && { ...s.summary, at: Date.parse(s.summary.updated_at) } };
}

export function fromV1(v1) {
  const byId = new Map(v1.sessions.map((s) => [s.id, s]));
  return {
    at: v1.generated_at,
    workspaces: v1.workspaces.map((w) => ({
      workspace_id: w.id,
      label: w.label,
      panes: w.session_ids.map((id) => byId.get(id)).filter(Boolean).map(toPane),
    })),
  };
}

export function applySession(s) {
  const d = store.data;
  if (!d) return;
  d.at = new Date().toISOString();
  const pane = toPane(s);
  for (const w of d.workspaces) {
    const i = w.panes.findIndex((p) => p.id === s.id);
    if (i >= 0) {
      // moved to another workspace: take it out here, add it there
      if (w.workspace_id === s.workspace_id) { w.panes[i] = pane; return; }
      w.panes.splice(i, 1);
      break;
    }
  }
  const w = d.workspaces.find((x) => x.workspace_id === s.workspace_id);
  if (w) w.panes.push(pane);
  else d.workspaces.push({ workspace_id: s.workspace_id, label: s.workspace_label, panes: [pane] });
  d.workspaces = d.workspaces.filter((x) => x.panes.length);
}

export function removeSession(id) {
  const d = store.data;
  if (!d) return;
  d.at = new Date().toISOString();
  for (const w of d.workspaces) w.panes = w.panes.filter((p) => p.id !== id);
  d.workspaces = d.workspaces.filter((w) => w.panes.length);
}

export function sessions() {
  return store.data ? store.data.workspaces.flatMap((w) => w.panes.map((p) => ({ ...p, workspace: w.label }))) : [];
}

export function nameOf(p) {
  const label = (p.label || "").trim();
  if (label && label !== "shell" && label.toLowerCase() !== p.agent) return label;
  return p.summary?.goal || p.title || p.pane_id;
}

// What a session needs from the user: the summary's items, or Herdr's own signal.
export function needsOf(p) {
  if (p.summary?.needs_you.length) return p.summary.needs_you;
  return p.status === "blocked" ? [waitingItem()] : [];
}

export const openCount = (s) => (s ? s.needs_you.length + s.blocked.length + s.doing.length + s.todo.length : 0);

export function frac(s) {
  if (!s?.done) return 0;
  const total = s.done.length + openCount(s);
  return total ? s.done.length / total : 0;
}

export function rank(p) {
  return (needsOf(p).length ? 0 : 4) + (p.status === "blocked" ? 0 : p.status === "working" ? 1 : 2);
}

export function items(key) {
  const list = (p) => (key === "needs" ? needsOf(p) : p.summary?.[STATES[key].field] || []);
  return sessions().filter((p) => list(p).length).sort((a, b) => rank(a) - rank(b))
    .flatMap((p) => list(p).map((item) => ({ text: item.text, item, p })));
}

// "claude-code:haiku" -> "Claude Code · haiku"
export function summarizerName(label, agentName) {
  if (!label) return "";
  const [tool, model] = label.split(/:(.*)/s);
  const TOOL = { "claude-code": "Claude Code", codex: "Codex", opencode: "opencode", "openai-compatible": "", command: t("customCommand") };
  const name = tool in TOOL ? TOOL[tool] : agentName(tool);
  return [name, model].filter(Boolean).join(" · ");
}
