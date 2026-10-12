import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { STR, pickLang, setLang, t } from "../web/js/i18n.js";

test("every string exists in both languages", () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.zh).sort());
});

test("pickLang: a saved choice wins, then the device language; anything not Chinese is English", () => {
  assert.equal(pickLang({ saved: "en", device: "zh-CN" }), "en");
  assert.equal(pickLang({ saved: null, device: "zh-Hant-TW" }), "zh");
  assert.equal(pickLang({ saved: null, device: "ja-JP" }), "en");
  assert.equal(pickLang({ saved: "auto", device: "zh-CN" }), "zh");
});

test("t fills in values", () => {
  setLang("en");
  assert.equal(t("sessionsCount", { n: 3, k: 7 }), "3 sessions, 7 items");
  setLang("zh");
  assert.equal(t("sessionsCount", { n: 3, k: 7 }), "3 个会话，7 件");
});

test("no Chinese text is left in the page code outside the dictionary", () => {
  const dir = new URL("../web/js/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "i18n.js")) {
    const code = readFileSync(new URL(f, dir), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\/\/.*$/, ""));
    const left = code.filter((l) => /[一-龥]/.test(l));
    assert.deepEqual(left, [], f);
  }
});
