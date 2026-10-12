// Pure helpers for the herdr report: no I/O, so they can be unit-tested.

const SEPARATOR = /^\s*─{10,}\s*$/;

// Claude Code draws the input box between two separator lines, then a footer.
// Cut everything from the second-to-last separator down.
export function stripAgentChrome(text) {
  const lines = text.replace(/\s+$/, "").split("\n");
  const seps = [];
  lines.forEach((l, i) => SEPARATOR.test(l) && seps.push(i));
  const kept = seps.length >= 2 ? lines.slice(0, seps[seps.length - 2]) : lines;
  return kept.join("\n").replace(/\s+$/, "");
}

const SAFE = /^[A-Za-z0-9_-]+$/;

// A session's id stays the same when its pane moves to another workspace (the
// pane id doesn't): the agent's own session id when Herdr reports one, else the
// terminal's.
export function sessionId(p) {
  const sid = p.agent_session?.value;
  if (sid && SAFE.test(sid) && p.agent) return `${p.agent}:${sid}`;
  if (p.terminal_id && SAFE.test(p.terminal_id)) return `terminal:${p.terminal_id}`;
  return `pane:${p.pane_id.replace(":", "-")}`;
}

// The /v1 shape without summaries: workspaces in Herdr's order, each listing
// its agent sessions; sessions flat, in the same order. Panes with no agent are left out.
export function buildSessions(workspaces, panes, tails) {
  const ordered = [...workspaces].sort((a, b) => a.number - b.number);
  const sessions = [];
  const out = [];
  const taken = new Set();
  // Two panes on the same agent session (rare): the second gets its pane appended.
  const idFor = (p) => {
    let id = sessionId(p);
    if (taken.has(id)) id = `${id}@${p.pane_id.replace(":", "-")}`;
    taken.add(id);
    return id;
  };
  for (const w of ordered) {
    const mine = panes.filter((p) => p.workspace_id === w.workspace_id && p.agent).map((p) => ({ p, id: idFor(p) }));
    if (!mine.length) continue;
    out.push({ id: w.workspace_id, label: w.label, session_ids: mine.map((m) => m.id) });
    for (const { p, id } of mine) {
      sessions.push({
        id,
        pane_id: p.pane_id,
        workspace_id: w.workspace_id,
        workspace_label: w.label,
        label: p.label || "",
        title: p.terminal_title_stripped || p.terminal_title || "",
        agent: p.agent,
        status: p.agent_status || "unknown",
        cwd: p.foreground_cwd || p.cwd || "",
        tail: tails[p.pane_id] ?? "",
      });
    }
  }
  return { workspaces: out, sessions };
}

// config.env: KEY=VALUE lines, as the control script sources them.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^export\s+/, "");
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || line.startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

// Set keys in config.env text, leaving every other line alone.
export function setEnvKeys(text, set) {
  const lines = text.split("\n").filter((l, i, all) => !(i === all.length - 1 && l === ""));
  const seen = new Set();
  const out = lines.map((l) => {
    const k = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/)?.[1];
    if (k && k in set) {
      seen.add(k);
      return `${k}=${set[k]}`;
    }
    return l;
  });
  for (const k of Object.keys(set)) if (!seen.has(k)) out.push(`${k}=${set[k]}`);
  return out.join("\n") + "\n";
}
