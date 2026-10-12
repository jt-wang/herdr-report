import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = new URL("../", import.meta.url).pathname;

test("the plugin manifest names the plugin and offers its actions", () => {
  const toml = readFileSync(join(dir, "herdr-plugin.toml"), "utf8");
  assert.match(toml, /^id = "herdr-report"$/m);
  assert.match(toml, /^name = "Herdr Report"$/m);
  for (const verb of ["start", "stop", "restart", "status", "url", "check", "summarizer", "use-recommended", "summaries-off", "uninstall"]) {
    assert.match(toml, new RegExp(`command = \\["bash", "scripts/ctl.sh", "${verb}"\\]`));
  }
});

test("ctl.sh url prints the address from the plugin's config.env", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  writeFileSync(join(conf, "config.env"), "HOST=100.1.2.3\nPORT=9999\n");
  const out = execFileSync("bash", ["scripts/ctl.sh", "url"], {
    cwd: dir, env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: conf }, encoding: "utf8",
  });
  assert.equal(out.trim(), "http://100.1.2.3:9999");
});

test("ctl.sh url prints the phone address when HOST lists local and Tailscale addresses", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  writeFileSync(join(conf, "config.env"), "HOST=127.0.0.1,100.1.2.3\nPORT=9999\n");
  const out = execFileSync("bash", ["scripts/ctl.sh", "url"], {
    cwd: dir, env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: conf }, encoding: "utf8",
  });
  assert.equal(out.trim(), "http://100.1.2.3:9999");
});

const setup = (conf, verb, extra = {}) => execFileSync(process.execPath, ["core/setup.mjs", verb], {
  cwd: dir, encoding: "utf8",
  env: { ...process.env, CONFIG_FILE: join(conf, "config.env"), CLAUDE_BIN: "/bin/echo", CODEX_BIN: "", OPENCODE_BIN: "", SUMMARY_LANG: "en", PATH: "/usr/bin:/bin", ...extra },
});

test("setup.mjs show: what is in use now, and the suggestion with its cost", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  const out = setup(conf, "show");
  assert.match(out, /Summaries: off/);
  assert.match(out, /Claude Code · Haiku/);
  assert.match(out, /\$0\.00\d+/);
});

test("setup.mjs use / off: write the choice into config.env and keep the rest", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  writeFileSync(join(conf, "config.env"), "PORT=9999\n");
  setup(conf, "use");
  const on = readFileSync(join(conf, "config.env"), "utf8");
  assert.match(on, /^PORT=9999$/m);
  assert.match(on, /^SUMMARIZER=claude$/m);
  assert.match(on, /^SUMMARY_MODEL=haiku$/m);
  assert.match(setup(conf, "show"), /Summaries: claude-code:haiku/);
  assert.match(setup(conf, "show"), /only while someone has the page open/);
  writeFileSync(join(conf, "config.env"), readFileSync(join(conf, "config.env"), "utf8") + "SUMMARY_MODE=continuous\n");
  assert.match(setup(conf, "show"), /Updating all the time/);
  setup(conf, "off");
  assert.match(readFileSync(join(conf, "config.env"), "utf8"), /^SUMMARIZER=off$/m);
});

test("setup.mjs use with no tested option installed changes nothing and says what to do instead", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  let err;
  try { setup(conf, "use", { CLAUDE_BIN: "" }); } catch (e) { err = e; }
  assert.equal(err.status, 1);
  assert.match(String(err.stderr), /OPENAI_BASE_URL|SUMMARIZER_CMD/);
});

test("setup.mjs show also lists the other tested options this machine can run", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  const out = setup(conf, "show", { OPENCODE_BIN: "/bin/echo" });
  assert.match(out, /opencode · DeepSeek V4\.1 Flash/);
  assert.match(out, /SUMMARIZER=opencode/);
});

test("ctl.sh url prints the HTTPS tailnet address once the server is published", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  writeFileSync(join(conf, "tailnet.json"), JSON.stringify({ host: "mac.tail1.ts.net", port: 8794 }));
  const out = execFileSync("bash", ["scripts/ctl.sh", "url"], {
    cwd: dir, env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: conf }, encoding: "utf8",
  });
  assert.equal(out.trim(), "https://mac.tail1.ts.net:8794");
});

test("restart keeps the Tailscale address published; only stop and uninstall take it down", () => {
  const sh = readFileSync(join(dir, "scripts/ctl.sh"), "utf8");
  assert.match(sh, /^\s*restart\) stop_service; start ;;$/m);
  assert.match(sh, /^stop\(\) \{\n\s*\[ -f "\$TAILNET_STATE" \] && tailnet unpublish/m);
});

test("by default the server listens on this Mac only; Tailscale publishes it", () => {
  const sh = readFileSync(join(dir, "scripts/ctl.sh"), "utf8");
  assert.match(sh, /HOST="\$\{HOST:-127\.0\.0\.1\}"/);
  assert.match(sh, /core\/tailnet\.mjs"/);
  assert.match(sh, /tailnet publish "\$PORT"/);
  assert.match(sh, /tailnet unpublish/);
});

test("setup.mjs speaks Chinese when SUMMARY_LANG is zh", () => {
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  const out = setup(conf, "show", { SUMMARY_LANG: "zh" });
  assert.match(out, /总结：没开/);
  assert.match(out, /推荐：Claude Code · Haiku/);
});

test("SKILL.md lets an agent install it: a 'Use when' description, the install, check and start actions, and asking before spending", () => {
  const skill = readFileSync(join(dir, "SKILL.md"), "utf8");
  assert.match(skill, /^---\nname: herdr-report\ndescription: Use when /);
  for (const step of ["herdr plugin install", "action invoke check", "action invoke start", "use-recommended", "Add to Home Screen"]) {
    assert.ok(skill.includes(step), step);
  }
  assert.match(skill, /ask/i);
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(readme, /SKILL\.md/);
});

test("the server keeps everything in the config directory it is given (CONF_DIR), and ctl.sh gives it Herdr's", async () => {
  const sh = readFileSync(join(dir, "scripts/ctl.sh"), "utf8");
  assert.match(sh, /<key>CONF_DIR<\/key><string>\$\(xml "\$CONF"\)<\/string>/);
  const { spawn } = await import("node:child_process");
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  const proc = spawn(process.execPath, ["core/server.mjs"], {
    cwd: dir,
    env: { ...process.env, CONF_DIR: conf, HOST: "127.0.0.1", PORT: "18930", HERDR_BIN: join(dir, "test/fixtures/fake-herdr.mjs"), SUMMARIZER: "", LOOP_MS: "200" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    await new Promise((ok, no) => { proc.stdout.on("data", (d) => String(d).includes("listening") && ok()); proc.on("exit", no); });
    await fetch("http://127.0.0.1:18930/v1/sessions");
    await new Promise((r) => setTimeout(r, 800));
    for (const f of ["push/vapid.json", "sessions.json", "cache"]) assert.ok(existsSync(join(conf, f)), f);
  } finally {
    proc.kill();
  }
});

test("the scripts still run when the plugin sits under a symlinked path (macOS /tmp is one)", async () => {
  const { symlinkSync } = await import("node:fs");
  const link = join(mkdtempSync(join(tmpdir(), "pm-link-")), "plugin");
  symlinkSync(dir, link);
  const conf = mkdtempSync(join(tmpdir(), "pm-conf-"));
  writeFileSync(join(conf, "tailnet.json"), JSON.stringify({ host: "mac.tail1.ts.net", port: 8794 }));
  const out = execFileSync(process.execPath, [join(link, "core/tailnet.mjs"), "url"], {
    env: { ...process.env, TAILNET_STATE: join(conf, "tailnet.json") }, encoding: "utf8",
  });
  assert.equal(out.trim(), "https://mac.tail1.ts.net:8794");
  const check = execFileSync(process.execPath, [join(link, "core/check.mjs")], { encoding: "utf8", env: { ...process.env, TAILSCALE_BIN: "" } }).toString();
  assert.match(check, /Node \d+/);
});

test("update: reinstalls from the GitHub repo it came from; a plugin linked from a folder is told to git pull", () => {
  const bin = mkdtempSync(join(tmpdir(), "pm-bin-"));
  const log = join(bin, "calls.log");
  const fake = (source) => writeFileSync(join(bin, "herdr"), `#!/bin/sh
echo "$@" >> "${log}"
case "$1 $2" in
  "plugin list") echo '{"result":{"plugins":[{"plugin_id":"herdr-report","source":${JSON.stringify(source)}}]}}' ;;
  "plugin install") echo "Installed" ;;
esac
`, { mode: 0o755 });
  const run = () => execFileSync("bash", ["scripts/ctl.sh", "update"], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HERDR_PLUGIN_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pm-conf-")), PORT: "18999" },
  });
  fake({ kind: "github", owner: "someone", repo: "herdr-report" });
  const out = run();
  assert.match(readFileSync(log, "utf8"), /^plugin install someone\/herdr-report --yes$/m);
  assert.match(out, /updated/i);
  fake({ kind: "local" });
  assert.match(run(), /git pull/);
  const toml = readFileSync(join(dir, "herdr-plugin.toml"), "utf8");
  assert.match(toml, /command = \["bash", "scripts\/ctl.sh", "update"\]/);
});
