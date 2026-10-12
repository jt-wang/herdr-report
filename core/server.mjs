// The data layer: a small HTTP API over Herdr that says, for every agent
// session, what it is trying to do, what's done, what's in progress and what
// is waiting on the user. It also serves the web client from ../web.
//
// Without any model: Herdr's state for each agent, its last words (Claude Code,
// Codex) and the end of its screen. On top of that, two sources, merged field by field:
//   - the agent's own report (REPORTS_DIR/<pane id>.json): what it is doing now,
//     what's blocked, what it needs from the user. Used while it is fresh.
//   - a summary of its transcript (Claude Code, Codex) or of its screen (any agent),
//     made by the summarizer the user chose in config.env: the goal, what's done
//     and what's left, which an agent does not keep a list of itself. After the
//     first one, only the new part of the transcript is sent.
//
// Every change is also written to SNAPSHOT_FILE and streamed on /v1/events.
// HOST is a comma-separated list: 127.0.0.1 for local tools, the Tailscale IP
// for the phone. The only thing it changes in Herdr is focus.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync, renameSync, openSync, readSync, closeSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir, hostname } from "node:os";
import { createHash } from "node:crypto";
import { stripAgentChrome, buildSessions, parseEnvFile } from "./lib.mjs";
import { fromStrings, assignIds, transitions } from "./items.mjs";
import { createNotifier } from "./notify.mjs";
import { dialogTurns, codexTurns, kimiTurns, buildInput, needsRefresh, lastAssistantText } from "./transcript.mjs";
import { summarize, summarizerFromEnv, backendLabel, validateSummary } from "./summarizer.mjs";
import { recommend, costPerSummary } from "./catalog.mjs";
import { findClis } from "./clis.mjs";

const run = promisify(execFile);
// Settings: the process environment, then the plugin's config.env (keys stay out of the launchd plist).
const env = { ...process.env };
if (process.env.CONFIG_FILE && existsSync(process.env.CONFIG_FILE)) {
  Object.assign(env, parseEnvFile(readFileSync(process.env.CONFIG_FILE, "utf8")));
}
const HOSTS = (env.HOST || "127.0.0.1").split(",").map((h) => h.trim()).filter(Boolean);
const PORT = Number(env.PORT || 8794);
const HERDR = env.HERDR_BIN || "herdr";
// Everything the plugin writes lives in one folder: the one Herdr gives the
// plugin (CONF_DIR, set by scripts/ctl.sh), else the usual place.
const CONF = env.CONF_DIR || join(homedir(), ".config/herdr/plugins/config/herdr-report");
const PROJECTS_DIR = env.PROJECTS_DIR || join(homedir(), ".claude/projects");
const CODEX_SESSIONS_DIR = env.CODEX_SESSIONS_DIR || join(homedir(), ".codex/sessions");
const KIMI_SESSIONS_DIR = env.KIMI_SESSIONS_DIR || join(homedir(), ".kimi-code/sessions");
const CACHE_DIR = env.CACHE_DIR || join(CONF, "cache");
const REPORTS_DIR = env.REPORTS_DIR || join(CONF, "reports");
const SNAPSHOT_FILE = env.SNAPSHOT_FILE || join(CONF, "sessions.json");
const PUSH_DIR = env.PUSH_DIR || join(CONF, "push");
const LOOP_MS = Number(env.LOOP_MS || 30_000);
const MIN_INTERVAL_MS = Number(env.SUMMARY_INTERVAL_MS || 10 * 60_000);
// When an agent starts waiting on the user or finishes, redo its summary this soon.
const URGENT_MIN_MS = Number(env.URGENT_MIN_MS ?? 60_000);
const URGENT_STATES = new Set(["blocked", "done"]);
// A report counts while it is no more than this much older than the session's last activity.
const REPORT_GRACE_MS = 10 * 60_000;
// For screen-only agents there is no activity time; a report counts for this long.
const REPORT_TTL_MS = 30 * 60_000;
const CONCURRENCY = 2;
// Summaries spend the user's quota, so by default they run only while someone
// is looking: a client asked for sessions within LOOK_MS, or holds the event
// stream open. A new look first brings every changed session up to date.
// SUMMARY_MODE=continuous keeps summarizing whether anyone looks or not.
const CONTINUOUS = env.SUMMARY_MODE === "continuous";
const LOOK_MS = Number(env.LOOK_MS || 2 * 60_000);
// The language summaries and notifications are written in: SUMMARY_LANG, else the Mac's.
const LANG = (env.SUMMARY_LANG || Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith("zh") ? "zh" : "en";
const SESSION_ID = /^[a-z]+:[A-Za-z0-9_-]+(@[A-Za-z0-9_-]+)?$/;
const HOST_NAME = env.HOST_NAME || hostname().replace(/\.local$/, "");
const iso = (ms) => new Date(ms).toISOString();
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const SCREEN_LINES = 2000;
const WEB = new URL("../web/", import.meta.url);
const SCHEMA_URL = new URL("../schema/sessions-v1.schema.json", import.meta.url);

for (const d of [CACHE_DIR, REPORTS_DIR]) mkdirSync(d, { recursive: true });
const SUMMARIZER_CWD = join(CACHE_DIR, "cwd");
mkdirSync(SUMMARIZER_CWD, { recursive: true });

const schema = readFileSync(SCHEMA_URL);
// The web client: every file under web/ with a known type, read once at startup.
// Anything else is a 404, so no path from the URL ever reaches the filesystem.
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
};
const STATIC = new Map();
for (const f of readdirSync(WEB, { recursive: true })) {
  const type = TYPES[String(f).match(/\.[a-z]+$/)?.[0]];
  if (type) STATIC.set(`/${String(f).split(sep).join("/")}`, { type, body: readFileSync(new URL(String(f), WEB)) });
}
STATIC.set("/", STATIC.get("/index.html"));

const found = findClis(env);

let backend = null;
try {
  backend = summarizerFromEnv(env, found);
} catch (e) {
  console.error(`summarizer: ${e.message}`);
}
if (!backend && env.SUMMARIZER && env.SUMMARIZER !== "off") {
  console.error(`summarizer "${env.SUMMARIZER}" is set but can't run here; summaries are off`);
}

async function herdr(...args) {
  const { stdout } = await run(HERDR, args, { timeout: 15_000, maxBuffer: 8 << 20 });
  return stdout;
}

async function paneText(id, lines) {
  return stripAgentChrome(await herdr("pane", "read", id, "--source", "recent-unwrapped", "--lines", String(lines)));
}

const lastLines = (text, n) => text.split("\n").slice(-n).join("\n");

// ---- the agent's own report ---------------------------------------------------

function readReport(paneId) {
  const p = join(REPORTS_DIR, `${paneId}.json`);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const at = Date.parse(raw.reported_at);
    if (!Number.isFinite(at)) return null;
    return { ...fromStrings(validateSummary(raw), iso(at)), at };
  } catch (e) {
    console.error(`report ${paneId}: ${e.message}`);
    return null;
  }
}

function reportIsFresh(report, src, input) {
  if (!report) return false;
  if (src?.path) return report.at >= input.version - REPORT_GRACE_MS;
  return Date.now() - report.at <= REPORT_TTL_MS;
}

// ---- summaries made from the transcript or screen ---------------------------

const summaries = new Map(); // source key -> cache entry
const running = new Set();
const lastStatus = new Map(); // pane id -> Herdr status seen on the previous tick
const urgent = new Set(); // source keys whose agent just started waiting on the user or finished
const paths = new Map();

function cachePath(key) {
  return join(CACHE_DIR, `${key}.json`);
}

function cached(key) {
  if (!summaries.has(key) && existsSync(cachePath(key))) {
    try {
      const e = JSON.parse(readFileSync(cachePath(key), "utf8"));
      if (e.sourceVersion === undefined && e.sourceMtimeMs !== undefined) e.sourceVersion = e.sourceMtimeMs;
      // written before items had ids
      summaries.set(key, e.goal !== undefined ? fromStrings(e, iso(e.at || Date.now())) : e);
    } catch {}
  }
  return summaries.get(key) || null;
}

function findClaudeTranscript(id) {
  for (const d of existsSync(PROJECTS_DIR) ? readdirSync(PROJECTS_DIR) : []) {
    const p = join(PROJECTS_DIR, d, `${id}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

function findCodexRollout(id) {
  if (!existsSync(CODEX_SESSIONS_DIR)) return null;
  const suffix = `-${id}.jsonl`;
  const hit = readdirSync(CODEX_SESSIONS_DIR, { recursive: true }).find((f) => String(f).endsWith(suffix));
  return hit ? join(CODEX_SESSIONS_DIR, String(hit)) : null;
}

// Kimi keeps each session under a folder named after its working directory.
function findKimiWire(id) {
  if (!existsSync(KIMI_SESSIONS_DIR)) return null;
  for (const wd of readdirSync(KIMI_SESSIONS_DIR)) {
    const p = join(KIMI_SESSIONS_DIR, wd, id, "agents", "main", "wire.jsonl");
    if (existsSync(p)) return p;
  }
  return null;
}

function locate(kind, id, find) {
  const k = `${kind}:${id}`;
  if (!paths.get(k)) paths.set(k, find(id));
  return paths.get(k);
}

// The transcript when we can read the agent's format (Claude Code, Codex),
// otherwise the pane's screen, which works for every agent Herdr recognizes.
function sourceFor(p) {
  if (!p?.agent) return null;
  const sid = p.agent_session?.value;
  if (sid && SAFE_ID.test(sid)) {
    if (p.agent === "claude") {
      const path = locate("claude", sid, findClaudeTranscript);
      if (path) return { key: sid, kind: "claude", path, agent: p.agent };
    }
    if (p.agent === "codex") {
      const path = locate("codex", sid, findCodexRollout);
      if (path) return { key: `codex-${sid}`, kind: "codex", path, agent: p.agent };
    }
    if (p.agent === "kimi") {
      const path = locate("kimi", sid, findKimiWire);
      if (path) return { key: `kimi-${sid}`, kind: "kimi", path, agent: p.agent };
    }
  }
  const tid = p.terminal_id || p.pane_id.replace(":", "_");
  return SAFE_ID.test(tid) ? { key: `screen-${tid}`, kind: "screen", paneId: p.pane_id, agent: p.agent } : null;
}

// What to send the summarizer: for a transcript, the whole dialog the first
// time and then only what's new (see buildInput); for a screen, the screen.
async function inputFor(src, status) {
  if (src.kind === "screen") {
    const text = await paneText(src.paneId, SCREEN_LINES);
    return {
      version: createHash("sha1").update(text).digest("hex"),
      build: () => {
        const head = buildInput({ turns: [], prev: null, status }).text;
        return { mode: "full", text: `${head}Below is the recent screen of the terminal an AI coding agent runs in. It is only the latest part, not the full record:\n\n${text}` };
      },
    };
  }
  return {
    version: statSync(src.path).mtimeMs,
    build: (prev) => {
      const lines = readFileSync(src.path, "utf8").split("\n");
      const turns = { codex: codexTurns, kimi: kimiTurns }[src.kind] || dialogTurns;
      return buildInput({ turns: turns(lines), prev, status });
    },
  };
}

async function refresh(src, input) {
  running.add(src.key);
  let entry;
  try {
    const prev = cached(src.key);
    const job = input.build(prev);
    if (job.mode === "same") {
      // The transcript changed, but not its dialog (tool calls only): nothing new to summarize.
      entry = { ...prev, sourceVersion: input.version };
    } else {
      const s = await summarize(job.text, backend, { cwd: SUMMARIZER_CWD, mode: job.mode, lang: LANG });
      entry = {
        ...assignIds(s, prev?.goal !== undefined ? prev : null, iso(Date.now())), source: src.kind, summarized_by: backendLabel(backend), at: Date.now(), sourceVersion: input.version,
        ...(job.mark ? { mark: job.mark, updates: job.updates } : {}),
      };
    }
  } catch (e) {
    if (e.interrupted) {
      running.delete(src.key);
      return; // cut off, most likely by the service stopping; the next run redoes it
    }
    console.error(`summary ${src.key}: ${e.message}`);
    entry = { ...(cached(src.key) || {}), error: String(e.message).slice(0, 200), at: Date.now(), sourceVersion: input.version };
  } finally {
    running.delete(src.key);
  }
  summaries.set(src.key, entry);
  urgent.delete(src.key);
  writeFileSync(cachePath(src.key), JSON.stringify(entry));
  publish();
  tick(); // start the next due session now instead of waiting for the loop
}

let lastLook = 0;
let catchUp = false;
const watching = () => CONTINUOUS || listeners.size > 0 || Date.now() - lastLook < LOOK_MS;
function look() {
  if (!watching()) catchUp = true;
  lastLook = Date.now();
  if (catchUp) tick();
}

async function tick() {
  let panes;
  try {
    panes = JSON.parse(await herdr("pane", "list")).result.panes;
  } catch (e) {
    return console.error(`pane list: ${e.message}`);
  }
  for (const p of panes) {
    const src = sourceFor(p);
    const was = lastStatus.get(p.pane_id);
    lastStatus.set(p.pane_id, p.agent_status);
    if (src && was !== undefined && was !== p.agent_status && URGENT_STATES.has(p.agent_status)) urgent.add(src.key);
  }
  publish();
  if (!backend || !watching()) return;
  const catchingUp = catchUp;
  catchUp = false;
  // Agents that just started waiting on the user go first.
  const order = [...panes].sort((a, b) => Number(urgent.has(sourceFor(b)?.key)) - Number(urgent.has(sourceFor(a)?.key)));
  for (const p of order) {
    if (running.size >= CONCURRENCY) return;
    const src = sourceFor(p);
    if (!src || running.has(src.key)) continue;
    let input;
    try { input = await inputFor(src, p.agent_status); } catch { continue; }
    if (catchingUp && input.version !== cached(src.key)?.sourceVersion) urgent.add(src.key);
    if (running.has(src.key) || running.size >= CONCURRENCY) continue;
    if (needsRefresh({
      version: input.version, cached: cached(src.key), now: Date.now(),
      minIntervalMs: MIN_INTERVAL_MS, urgent: urgent.has(src.key), urgentMinMs: URGENT_MIN_MS,
    })) {
      refresh(src, input);
    }
  }
}

// ---- the /v1 shape -----------------------------------------------------------

const FIELDS = ["goal", "now", "needs_you", "blocked", "doing", "todo", "done"];
const pick = (s) => Object.fromEntries(FIELDS.map((k) => [k, s[k] ?? (k === "goal" || k === "now" ? "" : [])]));

const LIVE = ["now", "needs_you", "blocked", "doing"];

// The agent's last words, from the end of its transcript; reads only the tail of the file.
const lastWords = new Map(); // path -> { mtimeMs, text }
function lastMessageFor(src) {
  if (!src?.path) return null;
  const { mtimeMs, size } = statSync(src.path);
  const hit = lastWords.get(src.path);
  if (hit?.mtimeMs === mtimeMs) return hit.text;
  const len = Math.min(size, 2 << 20);
  const buf = Buffer.alloc(len);
  const fd = openSync(src.path, "r");
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  const text = lastAssistantText(buf.toString("utf8").split("\n"), src.kind);
  lastWords.set(src.path, { mtimeMs, text });
  return text;
}

function summaryFor(p, src) {
  const report = readReport(p.pane_id);
  // With summaries off, old ones aren't shown either: the page says they're off.
  const entry = src && backend ? cached(src.key) : null;
  const activity = src && src.kind !== "screen" && src.path ? statSync(src.path).mtimeMs : null;
  const fresh = report && reportIsFresh(report, src, { version: activity }) ? report : null;
  const base = entry && entry.goal !== undefined ? entry : null;
  if (!base && !fresh) return null;
  const out = base
    ? {
        ...pick(base),
        source: base.source === "screen" ? "screen" : "transcript",
        summarized_by: base.summarized_by || "claude-code",
        updated_at: new Date(base.at).toISOString(),
        ...(base.error ? { error: base.error } : {}),
      }
    : { ...pick(fresh), source: "self-report", summarized_by: p.agent, updated_at: iso(fresh.at) };
  out.self_report_at = fresh ? new Date(fresh.at).toISOString() : null;
  if (fresh && base) {
    for (const k of LIVE) out[k] = fresh[k];
    if (!out.goal) out.goal = fresh.goal;
  }
  return out;
}

async function sessionsV1() {
  const [ws, ps] = await Promise.all([herdr("workspace", "list"), herdr("pane", "list")]);
  const workspaces = JSON.parse(ws).result.workspaces;
  const panes = JSON.parse(ps).result.panes;
  const tails = {};
  // A few at a time: one herdr process per pane, all at once, buckles a busy machine.
  const queue = panes.filter((p) => p.agent);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let p; (p = queue.shift());) tails[p.pane_id] = lastLines(await paneText(p.pane_id, 80).catch(() => ""), 10);
  }));
  const out = buildSessions(workspaces, panes, tails);
  const byId = new Map(panes.map((p) => [p.pane_id, p]));
  for (const s of out.sessions) {
    const p = byId.get(s.pane_id);
    const src = sourceFor(p);
    s.summary = summaryFor(p, src);
    s.last_message = lastMessageFor(src);
    s.summarizing = src ? running.has(src.key) : false;
  }
  return { version: 1, host: HOST_NAME, generated_at: new Date().toISOString(), ...out };
}

// ---- the file and the event stream ----------------------------------------------
// After every tick and every new summary: write SNAPSHOT_FILE when anything
// changed, send each changed session to /v1/events listeners, and say what
// changed: Herdr's status (`status`) and items entering a list (`item`). The
// first snapshot after a start is the baseline and says nothing, so a restart
// doesn't repeat old news. The screen tail changes all the time while an agent
// works, so it doesn't count as a change.

const listeners = new Set();
let lastSnapshot = null;
const lastSessions = new Map(); // session id -> the session as last published
let publishing = null;
let publishAgain = false;
let lastPublishFailed = false;
const notifier = createNotifier(PUSH_DIR, { lang: LANG });
const onTransitions = (moves, snap) => notifier.handle(moves, snap).catch((e) => console.error(`push: ${e.message}`));

const withoutTail = ({ tail, ...rest }) => JSON.stringify(rest);
const sse = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

// Calls that arrive while one is running fold into a single rerun: queueing
// every call let a slow publish fall further behind each tick.
function publish() {
  if (publishing) {
    publishAgain = true;
    return publishing;
  }
  publishing = (async () => {
    do {
      publishAgain = false;
      await publishOnce();
    } while (publishAgain);
  })().finally(() => { publishing = null; });
  return publishing;
}

async function publishOnce() {
  {
    let snap;
    try {
      snap = await sessionsV1();
      lastPublishFailed = false;
    } catch (e) {
      lastPublishFailed = true;
      return console.error(`publish: ${e.message}`);
    }
    const baseline = lastSnapshot === null;
    const changed = [];
    const moves = [];
    const at = snap.generated_at;
    const now = new Set();
    for (const s of snap.sessions) {
      now.add(s.id);
      const before = lastSessions.get(s.id);
      if (!before || withoutTail(before) !== withoutTail(s)) changed.push(s);
      if (before && !baseline) moves.push(...transitions(before, s).map((t) => ({ ...t, at })));
      lastSessions.set(s.id, s);
    }
    const removed = [...lastSessions.values()].filter((s) => !now.has(s.id));
    removed.forEach((s) => lastSessions.delete(s.id));
    lastSnapshot = snap;
    if (!changed.length && !removed.length) return;
    const tmp = `${SNAPSHOT_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(snap));
    renameSync(tmp, SNAPSHOT_FILE);
    for (const res of listeners) {
      changed.forEach((s) => sse(res, "session", s));
      removed.forEach((s) => sse(res, "removed", { id: s.id, pane_id: s.pane_id }));
      moves.forEach(({ type, ...t }) => sse(res, type, t));
    }
    if (moves.length) onTransitions(moves, snap);
  }
}

async function events(req, res) {
  look();
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  sse(res, "snapshot", lastSnapshot || (await current()).snap);
  listeners.add(res);
  const beat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(beat);
    listeners.delete(res);
  });
}

// What a request gets: the last snapshot, at once. Reading every pane can take
// many seconds on a busy machine, so a snapshot older than a few seconds is
// refreshed in the background and the change goes out on /v1/events. Only the
// very first request waits for a read. stale: the last refresh failed.
async function current() {
  if (!lastSnapshot) return { snap: await sessionsV1() };
  if (Date.now() - Date.parse(lastSnapshot.generated_at) > 3000) publish();
  return { snap: lastSnapshot, stale: lastPublishFailed };
}

function summarizerInfo() {
  const rec = recommend(found);
  return {
    active: backend
      ? { summarizer: backend.kind, model: backend.model || null, label: backendLabel(backend), mode: CONTINUOUS ? "continuous" : "on-demand" }
      : null,
    recommended: rec && { ...rec, cost_per_summary: Number(costPerSummary(rec.price).toFixed(4)) },
  };
}

// ---- HTTP ----------------------------------------------------------------------

function send(res, status, type, body, headers = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}
const json = (res, status, obj, headers) => send(res, status, "application/json; charset=utf-8", JSON.stringify(obj), headers);
const stale = (c) => (c.stale ? { "x-stale": "1" } : {});

function readBody(req, limit = 16 << 10) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (d) => {
      size += d.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); }
      else chunks.push(d);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new Error("body is not JSON")); }
    });
  });
}

// The phone's push subscription and notification settings.
async function pushRoute(req, res, action) {
  const want = { "": "GET", subscribe: "POST", unsubscribe: "POST", prefs: "PUT", test: "POST" }[action];
  if (!want) return json(res, 404, { error: "not found" });
  if (req.method !== want) return json(res, 405, { error: `${want} only` });
  if (action === "") return json(res, 200, notifier.info());
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
  if (action === "subscribe") {
    try { return json(res, 200, { devices: notifier.subscribe(body.subscription) }); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  if (action === "unsubscribe") return json(res, 200, { devices: notifier.unsubscribe(String(body.endpoint || "")) });
  if (action === "prefs") return json(res, 200, notifier.setPrefs(body));
  return json(res, 200, { sent: await notifier.test() });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  try {
    const m = path.match(/^\/v1\/sessions\/([^/]+)(\/screen|\/focus)?$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!SESSION_ID.test(id)) return json(res, 400, { error: "bad session id" });
      const wantMethod = m[2] === "/focus" ? "POST" : "GET";
      if (req.method !== wantMethod) return json(res, 405, { error: `${wantMethod} only` });
      if (wantMethod === "GET") look();
      const cur = await current();
      const one = cur.snap.sessions.find((s) => s.id === id);
      if (!one) return json(res, 404, { error: "no such session" });
      if (m[2] === "/focus") {
        await herdr("agent", "focus", one.pane_id);
        return json(res, 200, { ok: true });
      }
      if (m[2] === "/screen") return json(res, 200, { text: await paneText(one.pane_id, 400) });
      return json(res, 200, one, stale(cur));
    }
    const push = path.match(/^\/v1\/push(?:\/([a-z]+))?$/);
    if (push) return pushRoute(req, res, push[1] || "");
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    if (path === "/v1/sessions") {
      look();
      const cur = await current();
      return json(res, 200, cur.snap, stale(cur));
    }
    if (path === "/v1/events") return events(req, res);
    if (path === "/v1/summarizer") return json(res, 200, summarizerInfo());
    if (path === "/v1/schema") return send(res, 200, "application/schema+json", schema);
    const file = STATIC.get(path);
    if (file) return send(res, 200, file.type, file.body);
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 502, { error: String(e.message || e).slice(0, 300) });
  }
}

await Promise.all(HOSTS.map((h) => new Promise((resolve, reject) => {
  createServer(handle).on("error", reject).listen(PORT, h, resolve);
})));
console.log(`listening on ${HOSTS.map((h) => `http://${h.includes(":") ? `[${h}]` : h}:${PORT}`).join(" ")}`);
console.log(backend ? `summaries by ${backendLabel(backend)}, ${CONTINUOUS ? "all the time" : "while someone is looking"}` : "summaries are off (set SUMMARIZER in config.env)");
tick();
setInterval(tick, LOOP_MS);
