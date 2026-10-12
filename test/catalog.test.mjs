import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTIONS, recommend, costPerSummary, applyChoice } from "../core/catalog.mjs";

test("every option has a price, a quality note and the date it was tested", () => {
  for (const o of OPTIONS) {
    assert.ok(o.id && o.summarizer && o.cli && o.label, o.id);
    assert.ok(o.price && o.price.input >= 0 && o.price.output >= 0, o.id);
    assert.match(o.tested, /^\d{4}-\d\d-\d\d$/, o.id);
  }
});

test("recommend: the cheapest tested option whose CLI is installed; none when nothing fits", () => {
  assert.equal(recommend({ claude: "/bin/claude" }).id, "claude-haiku");
  assert.equal(recommend({}), null);
  assert.equal(recommend({ unknown: "/bin/x" }), null);
  const cheapest = [...OPTIONS].sort((a, b) => costPerSummary(a.price) - costPerSummary(b.price))[0];
  const all = Object.fromEntries(OPTIONS.map((o) => [o.cli, `/bin/${o.cli}`]));
  assert.equal(recommend(all).id, cheapest.id);
});

test("costPerSummary uses the measured typical size of one summary", () => {
  // 8,200 tokens in, 3,200 out, at $0.1 / $0.5 per million
  assert.equal(costPerSummary({ input: 0.1, output: 0.5 }).toFixed(4), "0.0024");
});

test("applyChoice sets SUMMARIZER and SUMMARY_MODEL in config.env and keeps everything else", () => {
  const opt = OPTIONS.find((o) => o.id === "claude-haiku");
  const before = "# my settings\nPORT=9000\nSUMMARIZER=off\nOPENAI_API_KEY=keep-me\n";
  const after = applyChoice(before, opt);
  assert.match(after, /^PORT=9000$/m);
  assert.match(after, /^OPENAI_API_KEY=keep-me$/m);
  assert.match(after, /^SUMMARIZER=claude$/m);
  assert.match(after, /^SUMMARY_MODEL=haiku$/m);
  assert.equal(after.match(/^SUMMARIZER=/gm).length, 1);
  assert.match(applyChoice("", opt), /^SUMMARIZER=claude\nSUMMARY_MODEL=haiku\n$/);
});

test("recommend: with only opencode installed, opencode with Haiku; DeepSeek flash is listed but costs more", () => {
  assert.equal(recommend({ opencode: "/bin/opencode" }).id, "opencode-haiku");
  const ds = OPTIONS.find((o) => o.id === "opencode-deepseek-flash");
  assert.equal(ds.model, "opencode/deepseek-v4.1-flash");
  assert.ok(costPerSummary(ds.price) > costPerSummary(OPTIONS.find((o) => o.id === "opencode-haiku").price));
});
