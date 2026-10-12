import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;

test("the demo serves made-up sessions with summaries, without Herdr or any model", { timeout: 30000 }, async () => {
  const proc = spawn(process.execPath, ["tools/demo.mjs", "--port", "18910"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
  try {
    await new Promise((resolve, reject) => {
      proc.stdout.on("data", (d) => String(d).includes("http://") && resolve());
      proc.on("exit", (c) => reject(new Error(`demo exited ${c}`)));
    });
    const body = await (await fetch("http://127.0.0.1:18910/v1/sessions")).json();
    assert.ok(body.sessions.length >= 6);
    assert.ok(body.workspaces.length >= 3);
    const summarized = body.sessions.filter((s) => s.summary && !s.summary.error);
    assert.equal(summarized.length, body.sessions.length, "every demo session has its summary");
    assert.ok(body.sessions.some((s) => s.status === "blocked"));
    assert.ok(body.sessions.some((s) => s.summary.needs_you.length));
    await new Promise((r) => setTimeout(r, 1500));
    const again = await (await fetch("http://127.0.0.1:18910/v1/sessions")).json();
    assert.ok(!again.sessions.some((s) => s.summarizing || s.summary.error), "the demo never calls a summarizer");
  } finally {
    proc.kill();
  }
});
