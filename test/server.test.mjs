import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { fakeSubscription } from "./fixtures/push-receiver.mjs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const fx = `${root}test/fixtures/`;
const PORT = 18794;
const OFF_PORT = 18795;
const IDLE_PORT = 18796;
const base = `http://127.0.0.1:${PORT}`;
let child, offChild, idleChild, statusFile, projects, conf;

const report = (over) => ({
  goal: "Tidy the seed catalog", now: "Importing the seed sheet", needs_you: ["Decide whether to include perennials"], blocked: [], doing: ["Import the seed sheet"], todo: [], done: [],
  reported_at: new Date().toISOString(), ...over,
});

function startServer(port, dir, extra) {
  const proc = spawn(process.execPath, ["core/server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1,::1",
      PORT: String(port),
      HERDR_BIN: `${fx}fake-herdr.mjs`,
      CLAUDE_BIN: `${fx}fake-claude.mjs`,
      CODEX_BIN: `${fx}fake-codex.mjs`,
      OPENAI_API_KEY: "",
      SUMMARIZER: "",
      SUMMARY_MODEL: "",
      SUMMARY_LANG: "en",
      PROJECTS_DIR: projects,
      FAKE_STATUS_FILE: statusFile,
      FAKE_FAIL_FILE: join(conf, "herdr-fails"),
      FAKE_SLOW_FILE: join(conf, "herdr-slow"),
      SUMMARY_INTERVAL_MS: "3600000",
      URGENT_MIN_MS: "0",
      CODEX_SESSIONS_DIR: `${fx}codex`,
      KIMI_SESSIONS_DIR: `${fx}kimi`,
      CACHE_DIR: join(dir, "cache"),
      REPORTS_DIR: join(conf, "reports"),
      SNAPSHOT_FILE: join(dir, "sessions.json"),
      PUSH_DIR: join(dir, "push"),
      CONFIG_FILE: join(dir, "config.env"),
      LOOP_MS: "400",
      ...extra,
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  return new Promise((resolve, reject) => {
    proc.stdout.on("data", (d) => String(d).includes("listening") && resolve(proc));
    proc.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}

before(async () => {
  conf = mkdtempSync(join(tmpdir(), "herdr-report-"));
  statusFile = join(conf, "status.json");
  writeFileSync(statusFile, "{}");
  // A private copy of the transcripts, so a test can append to one.
  projects = join(conf, "projects");
  mkdirSync(join(projects, "-proj"), { recursive: true });
  for (const n of ["sess1", "sess2", "sess3"]) {
    writeFileSync(join(projects, "-proj", `${n}.jsonl`), readFileSync(`${fx}projects/-proj/${n}.jsonl`));
  }
  const reports = join(conf, "reports");
  mkdirSync(reports);
  // w1:p3 reported just now; w1:p4's report is years older than its transcript.
  writeFileSync(join(reports, "w1:p3.json"), JSON.stringify(report()));
  writeFileSync(join(reports, "w1:p4.json"), JSON.stringify(report({ goal: "Last year's goal", reported_at: "2020-01-01T00:00:00Z" })));
  // The user chose Claude Code with Haiku in config.env.
  const on = join(conf, "on");
  mkdirSync(on);
  writeFileSync(join(on, "config.env"), "SUMMARIZER=claude\nSUMMARY_MODEL=haiku\n");
  const off = join(conf, "off");
  mkdirSync(join(off, "cache"), { recursive: true });
  // a summary left over from when summaries were on
  writeFileSync(join(off, "cache", "sess1.json"), JSON.stringify({
    goal: "Old summary", now: "", needs_you: [], blocked: [], doing: [], todo: [], done: [], source: "claude", at: Date.now(), sourceVersion: 1,
  }));
  // The off server only answers two tests; checking less often keeps the machine free for the other.
  // Nobody looks at this one until the on-demand test does.
  const idle = join(conf, "idle");
  mkdirSync(idle);
  writeFileSync(join(idle, "config.env"), "SUMMARIZER=claude\nSUMMARY_MODEL=haiku\n");
  [child, offChild, idleChild] = await Promise.all([
    startServer(PORT, on, {}), startServer(OFF_PORT, off, { LOOP_MS: "2000" }), startServer(IDLE_PORT, idle, { LOOP_MS: "300" }),
  ]);
});

after(() => {
  child?.kill();
  offChild?.kill();
  idleChild?.kill();
});

const get = async (path) => (await fetch(base + path)).json();
// Atomic, so the fake herdr never reads a half-written file and sees no statuses.
const setStatus = (text) => {
  writeFileSync(`${statusFile}.tmp`, text);
  renameSync(`${statusFile}.tmp`, statusFile);
};
const texts = (list) => list.map((it) => it.text);
const one = (id) => `/v1/sessions/${encodeURIComponent(id)}`;

async function sessionsWhenSummarized() {
  for (let i = 0; i < 200; i++) {
    // a reply can be an error while the machine is busy; ask again
    const body = await get("/v1/sessions").catch(() => ({}));
    if (body.sessions?.every((s) => s.summary)) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("summaries never arrived");
}

test("GET /v1/sessions lists every agent session with a stable id, where it is, its status and screen tail", async () => {
  const body = await get("/v1/sessions");
  assert.equal(body.version, 1);
  assert.equal(typeof body.generated_at, "string");
  assert.equal(typeof body.host, "string");
  assert.ok(body.host.length > 0);
  assert.deepEqual(body.workspaces, [{ id: "w1", label: "garden",
    session_ids: ["claude:sess1", "claude:sess2", "claude:sess3", "terminal:term_oc1", "codex:cdx1", "kimi:session_k1"] }]);
  const s = body.sessions.find((x) => x.id === "claude:sess1");
  assert.equal(s.pane_id, "w1:p2");
  assert.equal(s.workspace_id, "w1");
  assert.equal("links" in s, false, "no links to other apps; a client builds its own from pane_id");
  assert.equal(s.label, "watering schedule");
  assert.equal(s.agent, "claude");
  assert.equal(s.status, "working");
  assert.equal(s.tail, "Read the weather forecast\n⏺ Merging #7");
  assert.ok(!body.sessions.some((x) => x.pane_id === "w1:p1"), "shell panes are left out");
});

test("by default nothing is summarized while nobody is looking; opening the page catches up", { timeout: 40000 }, async () => {
  const cache = join(conf, "idle", "cache");
  const made = () => readdirSync(cache).filter((f) => f.endsWith(".json")).length;
  await new Promise((r) => setTimeout(r, 2500)); // several checks go by, nobody asks
  assert.equal(made(), 0, "no summaries without a look");
  const body = await (await fetch(`http://127.0.0.1:${IDLE_PORT}/v1/sessions`)).json();
  assert.equal(body.sessions.length, 6);
  for (let i = 0; i < 250 && made() < 3; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(made() >= 3, "a look starts the summaries of sessions that changed");
});

test("SUMMARY_MODE=continuous keeps summarizing with nobody looking", { timeout: 40000 }, async () => {
  const dir = join(conf, "always");
  mkdirSync(dir);
  writeFileSync(join(dir, "config.env"), "SUMMARIZER=claude\nSUMMARY_MODEL=haiku\nSUMMARY_MODE=continuous\n");
  const proc = await startServer(18797, dir, { LOOP_MS: "300" });
  try {
    const made = () => (readdirSync(join(dir, "cache")).filter((f) => f.endsWith(".json")).length);
    for (let i = 0; i < 250 && made() < 3; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(made() >= 3);
  } finally {
    proc.kill();
  }
});

test("a fresh report supplies the live fields; goal, done and todo still come from the transcript", async () => {
  const by = Object.fromEntries((await sessionsWhenSummarized()).sessions.map((s) => [s.pane_id, s.summary]));
  const live = by["w1:p3"];
  assert.equal(live.now, "Importing the seed sheet");
  assert.deepEqual(texts(live.needs_you), ["Decide whether to include perennials"]);
  assert.deepEqual(texts(live.doing), ["Import the seed sheet"]);
  assert.equal(live.goal, "Skip watering on rainy days");
  assert.deepEqual(texts(live.done), ["Read the weather forecast"]);
  assert.deepEqual(texts(live.todo), ["Add a sound to reminders"]);
  for (const it of live.needs_you) assert.ok(it.id && it.since, "an agent's own items get ids too");
  assert.equal(live.source, "transcript");
  assert.equal(live.summarized_by, "claude-code:haiku");
  assert.match(live.self_report_at, /^\d{4}-\d\d-\d\dT/);
  // A report older than the session's last activity is ignored.
  assert.equal(by["w1:p4"].self_report_at, null);
  assert.notEqual(by["w1:p4"].goal, "Last year's goal");
});

test("every session is summarized by the one summarizer the user chose, with the chosen model", async () => {
  const by = Object.fromEntries((await sessionsWhenSummarized()).sessions.map((s) => [s.pane_id, s.summary]));
  for (const id of ["w1:p2", "w1:p5", "w1:p6"]) assert.equal(by[id].summarized_by, "claude-code:haiku", id);
  assert.equal(by["w1:p2"].source, "transcript");
  assert.equal(by["w1:p2"].goal, "Skip watering on rainy days");
  assert.deepEqual(texts(by["w1:p2"].needs_you), ["Confirm the rain threshold"]);
  const item = by["w1:p2"].needs_you[0];
  assert.match(item.id, /^[0-9a-f]{8}$/);
  assert.match(item.since, /^\d{4}-\d\d-\d\dT/);
  assert.match(by["w1:p2"].now, /model=haiku/);
  // a Codex pane is read from its own transcript
  assert.equal(by["w1:p6"].source, "transcript");
  assert.match(by["w1:p6"].now, /Merge #7/);
  assert.equal(by["w1:p5"].source, "screen");
  assert.equal(by["w1:p7"].source, "transcript", "kimi is summarized from its own record");
  assert.match(by["w1:p5"].updated_at, /^\d{4}-\d\d-\d\dT/);
});

test("with no summarizer chosen nothing is summarized: sessions show Herdr's state, last words and own reports only", async () => {
  await new Promise((r) => setTimeout(r, 600));
  const body = await (await fetch(`http://127.0.0.1:${OFF_PORT}/v1/sessions`)).json();
  const by = Object.fromEntries(body.sessions.map((s) => [s.pane_id, s]));
  assert.equal(by["w1:p2"].summary, null);
  assert.equal(by["w1:p2"].status, "working");
  assert.equal(by["w1:p2"].last_message, "Rain check is in, merging #7");
  assert.equal(by["w1:p3"].summary.source, "self-report");
  assert.equal(by["w1:p6"].summary, null);
  assert.ok(!body.sessions.some((s) => s.summarizing));
});

test("GET /v1/summarizer says what is in use and suggests the cheapest tested option installed", async () => {
  const on = await get("/v1/summarizer");
  assert.deepEqual(on.active, { summarizer: "claude", model: "haiku", label: "claude-code:haiku", mode: "on-demand" });
  assert.equal(on.recommended.id, "claude-haiku");
  assert.equal(typeof on.recommended.cost_per_summary, "number");
  const off = await (await fetch(`http://127.0.0.1:${OFF_PORT}/v1/summarizer`)).json();
  assert.equal(off.active, null);
  assert.equal(off.recommended.id, "claude-haiku");
});

test("a request answers at once from the last snapshot, even when Herdr is slow", async () => {
  await get("/v1/sessions");
  writeFileSync(join(conf, "herdr-slow"), "");
  try {
    await new Promise((r) => setTimeout(r, 3500)); // past the few seconds a snapshot is reused without a refresh
    const t0 = Date.now();
    const res = await fetch(`${base}/v1/sessions`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).sessions.length, 6);
    assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  } finally {
    rmSync(join(conf, "herdr-slow"));
  }
});

test("when Herdr can't answer, the API serves the last good data instead of an error", async () => {
  await get("/v1/sessions"); // there is a last snapshot
  writeFileSync(join(conf, "herdr-fails"), "");
  await new Promise((r) => setTimeout(r, 4000)); // no new snapshot since; the last one is past the few seconds it's reused for
  try {
    const res = await fetch(`${base}/v1/sessions`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-stale"), "1");
    assert.equal((await res.json()).sessions.length, 6);
  } finally {
    rmSync(join(conf, "herdr-fails"));
  }
});

test("GET /v1/sessions/:id returns one session by its id; /screen returns its longer screen", async () => {
  const s = await get(one("claude:sess1"));
  assert.equal(s.pane_id, "w1:p2");
  assert.equal((await get(`${one("claude:sess1")}/screen`)).text, "Read the weather forecast\n⏺ Merging #7");
  assert.equal((await fetch(base + one("claude:nope"))).status, 404);
  assert.equal((await fetch(`${base}/v1/sessions/--help/screen`)).status, 400);
});

test("POST /v1/sessions/:id/focus switches Herdr on the Mac to that session's pane", async () => {
  const url = `${base}${one("claude:sess1")}/focus`;
  const res = await fetch(url, { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await fetch(url)).status, 405);
});

test("the output has exactly the fields the schema lists: top level, session, summary, item", async () => {
  const schema = await get("/v1/schema");
  const body = await sessionsWhenSummarized();
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(body), [...schema.required].sort());
  const s = body.sessions.find((x) => x.id === "claude:sess1");
  assert.deepEqual(keys(s), [...schema.$defs.session.required].sort());
  assert.deepEqual(keys(s.summary).filter((k) => k !== "error"), [...schema.$defs.summary.required].sort());
  assert.deepEqual(keys(s.summary.needs_you[0]), [...schema.$defs.item.required].sort());
});

test("GET /v1/schema serves the JSON Schema that describes /v1/sessions", async () => {
  const schema = await get("/v1/schema");
  const onDisk = JSON.parse(readFileSync(`${root}schema/sessions-v1.schema.json`, "utf8"));
  assert.deepEqual(schema, onDisk);
  assert.deepEqual(schema.required, ["version", "host", "generated_at", "workspaces", "sessions"]);
});

test("the web client is served at / with its stylesheet and modules, and talks to the /v1 API only", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /href="app.css"/);
  assert.match(html, /<script type="module" src="js\/main.js">/);
  const css = await fetch(`${base}/app.css`);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const js = await fetch(`${base}/js/main.js`);
  assert.match(js.headers.get("content-type"), /javascript/);
  // every module the page loads, and what they call
  const code = [];
  for (const f of ["main", "model", "dom", "views", "gestures", "settings", "platform", "i18n"]) {
    const r = await fetch(`${base}/js/${f}.js`);
    assert.equal(r.status, 200, f);
    code.push(await r.text());
  }
  const all = code.join("\n");
  for (const route of ["/v1/sessions", "/v1/events", "/v1/summarizer", "/v1/push"]) assert.ok(all.includes(route), route);
  assert.doesNotMatch(all, /\/api\//);
  // the page links to no other app; which apps to offer is still open
  assert.doesNotMatch(all, /Collie|open_url/);
  assert.equal((await fetch(`${base}/api/overview`)).status, 404);
  assert.equal((await fetch(`${base}/js/..%2F..%2Fcore%2Fserver.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/js/nope.js`)).status, 404);
});

test("GET /marks/<name>.svg serves a known agent mark and nothing else", async () => {
  const ok = await fetch(`${base}/marks/claude.svg`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("content-type"), /image\/svg\+xml/);
  assert.equal((await fetch(`${base}/marks/NOTICE`)).status, 404);
  assert.equal((await fetch(`${base}/marks/..%2Fcore%2Fserver.mjs`)).status, 404);
});

test("each session carries the agent's last words, read from its transcript", async () => {
  const by = Object.fromEntries((await get("/v1/sessions")).sessions.map((s) => [s.pane_id, s]));
  assert.equal(by["w1:p2"].last_message, "Rain check is in, merging #7");
  assert.equal(by["w1:p6"].last_message, "Fixed the upload timeout. Merge #9?");
  assert.equal(by["w1:p5"].last_message, null);
  assert.equal(by["w1:p7"].last_message, "Added the Latin names. Sync them to search?", "kimi, from its wire.jsonl");
});

test("when an agent starts waiting on the user, its summary is redone right away, not after the long interval", async () => {
  const first = (await sessionsWhenSummarized()).sessions.find((s) => s.pane_id === "w1:p2").summary;
  const before = first.updated_at;
  const firstId = first.needs_you.find((it) => it.text === "Confirm the rain threshold").id;
  appendFileSync(join(projects, "-proj", "sess1.jsonl"),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Please pick a reminder time" }] } }) + "\n");
  setStatus(JSON.stringify({ "w1:p2": "blocked" }));
  let after = before;
  for (let i = 0; i < 50 && after === before; i++) {
    await new Promise((r) => setTimeout(r, 100));
    after = (await get(one("claude:sess1"))).summary.updated_at;
  }
  assert.notEqual(after, before);
  // only the new part was sent, with the previous summary
  const s = await get(one("claude:sess1"));
  assert.match(s.summary.now, /prompt=update/);
  assert.match(s.summary.now, /status=blocked/, "the summarizer was told the agent is waiting");
  // the same request kept its id through the update
  assert.equal(s.summary.needs_you.find((it) => it.text === "Confirm the rain threshold").id, firstId);
});

test("the server listens on every address in HOST", async () => {
  const body = await (await fetch(`http://[::1]:${PORT}/v1/sessions`)).json();
  assert.equal(body.version, 1);
});

test("the latest /v1/sessions is also kept in a file, for tools that would rather read a file", async () => {
  await sessionsWhenSummarized();
  let snap;
  for (let i = 0; i < 30; i++) {
    try { snap = JSON.parse(readFileSync(join(conf, "on", "sessions.json"), "utf8")); } catch {}
    if (snap?.sessions?.every((s) => s.summary)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(snap.version, 1);
  assert.ok(snap.sessions.every((s) => s.summary));
});

test("GET /v1/events streams a snapshot, then each changed session, status change and new item", { timeout: 30000 }, async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/v1/events`, { signal: ctrl.signal });
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const seen = []; // every event read, to say what came instead when one never does
  let pending = null;
  const deadline = Date.now() + 20_000;
  const next = async (event) => {
    for (;;) {
      const i = buf.indexOf("\n\n");
      if (i >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const name = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (name && name !== "snapshot") {
          const d = JSON.parse(data);
          seen.push(`${name}:${d.id}:${d.status || d.to || d.list || ""}${d.item ? ":" + d.item.text : ""}`);
        }
        if (name === event) return JSON.parse(data);
        continue;
      }
      if (Date.now() > deadline) throw new Error(`no ${event} event; saw ${seen.join(" | ")}`);
      // one read stays pending across checks of the deadline, so no chunk is dropped
      pending ||= reader.read();
      const r = await Promise.race([pending, new Promise((ok) => setTimeout(() => ok(null), 500))]);
      if (!r) continue;
      pending = null;
      if (r.done) throw new Error("stream ended");
      buf += dec.decode(r.value);
    }
  };
  try {
    const snap = await next("snapshot");
    assert.equal(snap.version, 1);
    // sess3 starts waiting on the user and asks for something new
    appendFileSync(join(projects, "-proj", "sess3.jsonl"),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Please pick a reminder time" }] } }) + "\n");
    setStatus(JSON.stringify({ "w1:p4": "blocked" }));
    let changed;
    do changed = await next("session"); while (changed.id !== "claude:sess3" || changed.status !== "blocked");
    assert.equal(changed.status, "blocked");
    let status;
    do status = await next("status"); while (status.id !== "claude:sess3");
    assert.deepEqual({ ...status, at: undefined }, { id: "claude:sess3", pane_id: "w1:p4", from: "idle", to: "blocked", at: undefined });
    let item;
    do item = await next("item"); while (item.id !== "claude:sess3" || item.list !== "needs_you");
    assert.equal(item.item.text, "Pick a reminder time");
  } finally {
    ctrl.abort();
  }
});

// ---- push ----------------------------------------------------------------------

// A push service on this machine: records each delivery, answers 201, or 410
// for endpoints under /gone/ (a subscription the browser dropped).
function fakePushService() {
  const got = [];
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(req.url.startsWith("/gone/") ? 410 : 201);
      res.end();
    });
  }).listen(0);
  return { got, srv, url: (p) => `http://127.0.0.1:${srv.address().port}${p}` };
}
const send = (path, method, body) => fetch(base + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const until = async (cond, ms = 25000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (cond()) return;
  throw new Error("timed out");
};

test("push: subscribe a device, change settings, send a test that the device can decrypt; a dropped device is forgotten", { timeout: 40000 }, async () => {
  const svc = fakePushService();
  try {
    const info = await get("/v1/push");
    assert.match(info.public_key, /^[A-Za-z0-9_-]{80,}$/);
    assert.equal(info.devices, 0);
    assert.equal(info.prefs.done, false);
    const phone = fakeSubscription(svc.url("/push/phone"));
    assert.equal((await (await send("/v1/push/subscribe", "POST", { subscription: phone.subscription })).json()).devices, 1);
    assert.equal((await send("/v1/push/subscribe", "POST", { subscription: { endpoint: "x" } })).status, 400);
    assert.equal((await (await send("/v1/push/prefs", "PUT", { done: true, bogus: 1 })).json()).done, true);
    await send("/v1/push/test", "POST", {});
    await until(() => svc.got.length >= 1);
    assert.match(svc.got[0].headers.authorization, /^vapid t=/);
    assert.deepEqual(phone.open(svc.got[0].body), { title: "Herdr Report", body: "Notifications are on", tag: "test", url: "/" });
    const old = fakeSubscription(svc.url("/gone/old"));
    assert.equal((await (await send("/v1/push/subscribe", "POST", { subscription: old.subscription })).json()).devices, 2);
    await send("/v1/push/test", "POST", {});
    await until(() => svc.got.some((g) => g.path === "/gone/old"));
    await until(() => false, 300).catch(() => {});
    assert.equal((await get("/v1/push")).devices, 1);
  } finally {
    svc.srv.close();
  }
});

test("push: an agent stopping at a prompt wakes the subscribed device, which opens that session", { timeout: 40000 }, async () => {
  const svc = fakePushService();
  try {
    const phone = fakeSubscription(svc.url("/push/phone2"));
    await send("/v1/push/subscribe", "POST", { subscription: phone.subscription });
    setStatus(JSON.stringify({ "w1:p5": "blocked" }));
    await until(() => svc.got.some((g) => g.path === "/push/phone2"));
    const note = phone.open(svc.got.find((g) => g.path === "/push/phone2").body);
    assert.equal(note.body, "Stopped at a prompt, waiting for you");
    assert.equal(note.tag, "terminal:term_oc1");
    assert.equal(note.url, "/#/s/terminal%3Aterm_oc1");
  } finally {
    svc.srv.close();
  }
});

test("the page installs to the home screen: manifest, icons and a service worker at the root", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icon-180.png">/);
  const m = await fetch(`${base}/manifest.webmanifest`);
  assert.match(m.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await m.json();
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const r = await fetch(`${base}/${icon.src.replace(/^\//, "")}`);
    assert.match(r.headers.get("content-type"), /image\/png/, icon.src);
    const png = Buffer.from(await r.arrayBuffer());
    assert.equal(png.toString("latin1", 1, 4), "PNG");
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const sw = await fetch(`${base}/sw.js`);
  assert.match(sw.headers.get("content-type"), /javascript/);
  const code = await sw.text();
  assert.match(code, /addEventListener\("push"/);
  assert.match(code, /addEventListener\("notificationclick"/);
  assert.match(code, /\/v1\//, "the API is never served from the cache");
});

test("the page and the home-screen app carry the plugin's name", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /<title>Herdr Report<\/title>/);
  const m = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(m.name, "Herdr Report");
  assert.equal(m.short_name, "Report");
});
