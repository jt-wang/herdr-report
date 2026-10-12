// Turn a Claude Code or Codex session transcript (JSONL lines) into a short
// dialog text that a summarizer can read: user requests and assistant prose only.
import { createHash } from "node:crypto";

function userText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

export function extractDialog(lines, { maxChars = 60_000 } = {}) {
  return clip(dialogTurns(lines), maxChars);
}

// Tool calls run together into one short line, e.g. "Assistant used tools: Read, Bash ×2",
// so a turn that is only tool calls (an agent mid-action, or waiting to be
// allowed one) still shows, without the calls' contents.
const TOOLS = "Assistant used tools: ";
function toolLine(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  return TOOLS + [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
}
function collector() {
  const turns = [];
  let tools = [];
  const flush = () => {
    if (tools.length) turns.push(toolLine(tools));
    tools = [];
  };
  return {
    turns,
    say(t) { flush(); turns.push(t); },
    tool(name) { tools.push(name || "?"); },
    reset() { turns.length = 0; tools = []; },
    done() { flush(); return turns; },
  };
}

export function dialogTurns(lines) {
  const c = collector();
  const turns = { push: (t) => c.say(t), set length(_) { c.reset(); } };
  for (const raw of lines) {
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (d.isSidechain || d.isMeta) continue;
    const m = d.message;
    if (!m) continue;
    if (d.type === "user") {
      if (d.isCompactSummary) {
        turns.length = 0;
        turns.push(`Summary of the earlier conversation: ${userText(m.content).trim()}`);
        continue;
      }
      const t = userText(m.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
      const note = t.startsWith("<task-notification>") && t.match(/<summary>([\s\S]*?)<\/summary>/);
      if (note) turns.push(`Background task: ${note[1].trim()}`);
      else if (t && !t.startsWith("<task-notification>")) turns.push(`User: ${t}`);
    } else if (d.type === "assistant" && Array.isArray(m.content)) {
      const t = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (t) turns.push(`Assistant: ${t}`);
      for (const b of m.content) if (b.type === "tool_use") c.tool(b.name);
    }
  }
  return c.done();
}

function clip(turns, maxChars) {
  if (!turns.length) return "";
  const full = turns.join("\n\n");
  if (full.length <= maxChars) return full;
  const head = turns[0].slice(0, Math.floor(maxChars / 3));
  const tail = full.slice(full.length - (maxChars - head.length));
  return `${head}\n\n(middle omitted)\n\n…${tail}`;
}

// Codex rollout files (~/.codex/sessions/**/rollout-*.jsonl).
export function extractCodexDialog(lines, { maxChars = 60_000 } = {}) {
  return clip(codexTurns(lines), maxChars);
}

export function codexTurns(lines) {
  const c = collector();
  const turns = { push: (t) => c.say(t), set length(_) { c.reset(); } };
  const add = (item) => {
    if (item?.type === "function_call" || item?.type === "custom_tool_call") return c.tool(item.name);
    if (item?.type === "local_shell_call") return c.tool("shell");
    if (item?.type !== "message") return;
    const t = (item.content || []).map((c) => c.text || "").join("\n").trim();
    if (!t) return;
    if (item.role === "user" && !t.startsWith("<")) turns.push(`User: ${t}`);
    else if (item.role === "assistant") turns.push(`Assistant: ${t}`);
  };
  for (const raw of lines) {
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    if (d.type === "compacted") {
      turns.length = 0;
      (d.payload?.replacement_history || []).forEach(add);
    } else if (d.type === "response_item") {
      add(d.payload);
    }
  }
  return c.done();
}

// Kimi Code (~/.kimi-code/sessions/<workdir>/<session>/agents/main/wire.jsonl):
// agent.message.appended events; meta.source "input" is what the user typed,
// other user messages are the agent's own reminders.
export function kimiTurns(lines) {
  const c = collector();
  for (const raw of lines) {
    let d;
    try { d = JSON.parse(raw); } catch { continue; }
    const m = d.type === "agent.message.appended" ? d.message?.message : null;
    if (!m) continue;
    const text = (m.content || []).map((x) => x.text || "").join("\n").trim();
    if (m.role === "user" && d.message.meta?.source === "input" && text) c.say(`User: ${text}`);
    else if (m.role === "assistant") {
      if (text) c.say(`Assistant: ${text}`);
      for (const t of m.toolCalls || []) c.tool(t.name);
    }
  }
  return c.done();
}

// ---- incremental summaries ----------------------------------------------------
// The first summary reads the whole dialog. After that, the summarizer gets its
// previous summary plus only the turns added since, which is far less to read.
// It starts over from the whole dialog when the start changed (a compaction),
// after maxUpdates updates in a row (so mistakes don't pile up), or when the new
// part alone is longer than maxChars.

const SUMMARY_FIELDS = ["goal", "now", "needs_you", "blocked", "doing", "todo", "done"];
const hash = (t) => createHash("sha1").update(t).digest("hex");

// Items as the summarizer sees them: id and text, not since.
const bare = (s) => Object.fromEntries(SUMMARY_FIELDS.map((k) =>
  [k, Array.isArray(s[k]) ? s[k].map((it) => (typeof it === "string" ? it : { id: it.id, text: it.text })) : s[k]]));

// Herdr's live status, put first so the summarizer knows what the agent is doing right now.
const STATUS_LINE = {
  blocked: "stopped at an approval or question, waiting for the user",
  working: "working",
  done: "finished this turn, waiting for the user's next message",
  idle: "idle, waiting for the user's next message",
};

export function buildInput({ turns, prev, status = null, maxChars = 60_000, maxUpdates = 8 }) {
  // A trailing tool line still grows as the agent works, so it isn't part of what's been read.
  const stable = turns.length && turns[turns.length - 1].startsWith(TOOLS) ? turns.length - 1 : turns.length;
  const mark = { count: stable, last: stable ? hash(turns[stable - 1]) : "" };
  const head = STATUS_LINE[status] ? `Herdr status now: ${STATUS_LINE[status]}\n\n` : "";
  // Even a full re-read gets the previous items, so the same thing keeps its id.
  const known = prev?.goal !== undefined && !prev.error
    ? `Items from the last summary (the same thing keeps its id):\n${JSON.stringify(Object.fromEntries(Object.entries(bare(prev)).filter(([k]) => k !== "goal" && k !== "now")))}\n\nDialog:\n\n`
    : "";
  const full = { mode: "full", text: head + known + clip(turns, maxChars), mark, updates: 0 };
  const m = prev?.mark;
  if (!m || prev.goal === undefined || prev.error || m.count < 1 || turns.length < m.count) return full;
  if (hash(turns[m.count - 1]) !== m.last) return full;
  if (turns.length === m.count) return { mode: "same", mark, updates: prev.updates || 0 };
  const updates = (prev.updates || 0) + 1;
  if (updates > maxUpdates) return full;
  const fresh = turns.slice(m.count).join("\n\n");
  if (fresh.length > maxChars) return full;
  const before = JSON.stringify(bare(prev));
  return { mode: "update", text: `${head}Last summary:\n${before}\n\nNew dialog since then:\n\n${fresh}`, mark, updates };
}

// version: transcript mtime, or a hash of the screen for agents without one.
// urgent: the agent just started waiting on the user or just finished, so the
// short urgentMinMs applies instead of the long minIntervalMs.
export function needsRefresh({ version, cached, now, minIntervalMs, urgent = false, urgentMinMs = 60_000 }) {
  if (!cached) return true;
  if (version === cached.sourceVersion) return false;
  return now - cached.at >= (urgent ? urgentMinMs : minIntervalMs);
}

// The agent's last words: the newest assistant text in a Claude Code or Codex transcript.
export function lastAssistantText(lines, kind, maxChars = 600) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try { d = JSON.parse(lines[i]); } catch { continue; }
    let text = "";
    if (kind === "codex") {
      const p = d.type === "response_item" ? d.payload : null;
      if (p?.type === "message" && p.role === "assistant") text = (p.content || []).map((c) => c.text || "").join("\n");
    } else if (kind === "kimi") {
      const m = d.type === "agent.message.appended" ? d.message?.message : null;
      if (m?.role === "assistant") text = (m.content || []).map((c) => c.text || "").join("\n");
    } else if (d.type === "assistant" && !d.isSidechain && Array.isArray(d.message?.content)) {
      text = d.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    }
    text = text.trim();
    if (text) return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
  }
  return null;
}
