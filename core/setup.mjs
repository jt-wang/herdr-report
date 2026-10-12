#!/usr/bin/env node
// Choose the summarizer. Run by the plugin's actions through scripts/ctl.sh:
//   show — what is in use, and the cheapest tested option installed here
//   use  — write that option into config.env
//   off  — turn summaries off
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parseEnvFile, setEnvKeys } from "./lib.mjs";
import { findClis } from "./clis.mjs";
import { OPTIONS, recommend, costPerSummary, applyChoice } from "./catalog.mjs";
import { summarizerFromEnv, backendLabel } from "./summarizer.mjs";

const file = process.env.CONFIG_FILE
  || join(process.env.HERDR_PLUGIN_CONFIG_DIR || join(homedir(), ".config/herdr/plugins/config/herdr-report"), "config.env");
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const env = { ...process.env, ...parseEnvFile(text) };
const found = findClis(env);
const rec = recommend(found);
const save = (t) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, t);
};

const lang = (env.SUMMARY_LANG || Intl.DateTimeFormat().resolvedOptions().locale).toLowerCase().startsWith("zh") ? "zh" : "en";
const cost = (o) => `$${costPerSummary(o.price).toFixed(4)}`;
const W = {
  zh: {
    summaries: (x) => `总结：${x}`, off: "没开",
    continuous: "一直在更新，不管有没有人看（config.env 里删掉 SUMMARY_MODE=continuous 就改回只在有人看时更新）。",
    onDemand: "只在有人打开页面时更新，没人看就不花钱（config.env 里加 SUMMARY_MODE=continuous 改成一直更新）。",
    suggested: (o) => `推荐：${o.label}，每次约 ${cost(o)}（${o.quality.zh}，${o.tested} 测过）`,
    howToUse: "要用它，运行插件的「Use the recommended summarizer」。",
    others: "这台机器上也能用（在 config.env 里写这两行）：",
    other: (o) => `  ${o.label}，每次约 ${cost(o)}：SUMMARIZER=${o.summarizer} SUMMARY_MODEL=${o.model}`,
    noneFound: "这台机器上没找到测过的 agent CLI。",
    otherWays: `也可以在 ${file} 里自己设：
  SUMMARIZER=openai，加 OPENAI_BASE_URL、OPENAI_MODEL（和 OPENAI_API_KEY），用 DeepSeek、OpenRouter 或本地模型服务；
  SUMMARIZER=command，加 SUMMARIZER_CMD，用任何从 stdin 读、输出 JSON 的命令。`,
    unchanged: "这台机器上没找到测过的 agent CLI，没有改设置。",
    switched: (o) => `总结改成 ${o.label}，每次约 ${cost(o)}。`,
    turnedOff: "总结已关。",
  },
  en: {
    summaries: (x) => `Summaries: ${x}`, off: "off",
    continuous: "Updating all the time, whether or not anyone is looking (remove SUMMARY_MODE=continuous from config.env to update only while someone looks).",
    onDemand: "Updated only while someone has the page open, so nothing is spent otherwise (add SUMMARY_MODE=continuous to config.env to update all the time).",
    suggested: (o) => `Suggested: ${o.label}, about ${cost(o)} per summary (${o.quality.en}; tested ${o.tested})`,
    howToUse: "To use it, run the plugin's \"Use the recommended summarizer\" action.",
    others: "Also usable here (put these two lines in config.env):",
    other: (o) => `  ${o.label}, about ${cost(o)}: SUMMARIZER=${o.summarizer} SUMMARY_MODEL=${o.model}`,
    noneFound: "No tested agent CLI found on this machine.",
    otherWays: `You can also set it yourself in ${file}:
  SUMMARIZER=openai with OPENAI_BASE_URL, OPENAI_MODEL (and OPENAI_API_KEY), for DeepSeek, OpenRouter or a local model server;
  SUMMARIZER=command with SUMMARIZER_CMD, for any command that reads stdin and prints the JSON.`,
    unchanged: "No tested agent CLI found on this machine; settings unchanged.",
    switched: (o) => `Summaries now by ${o.label}, about ${cost(o)} per summary.`,
    turnedOff: "Summaries are off.",
  },
}[lang];

function current() {
  let b = null;
  try { b = summarizerFromEnv(env, found); } catch {}
  return b ? backendLabel(b) : null;
}

const verb = process.argv[2];
if (verb === "show") {
  console.log(W.summaries(current() || W.off));
  if (current()) console.log(env.SUMMARY_MODE === "continuous" ? W.continuous : W.onDemand);
  if (rec) {
    console.log(W.suggested(rec));
    console.log(W.howToUse);
    const others = OPTIONS.filter((o) => o !== rec && found[o.cli]);
    if (others.length) {
      console.log(W.others);
      for (const o of others) console.log(W.other(o));
    }
  } else {
    console.log(W.noneFound);
  }
  console.log(W.otherWays);
} else if (verb === "use") {
  if (!rec) {
    console.error(`${W.unchanged}\n${W.otherWays}`);
    process.exit(1);
  }
  save(applyChoice(text, rec));
  console.log(W.switched(rec));
} else if (verb === "off") {
  save(setEnvKeys(text, { SUMMARIZER: "off" }));
  console.log(W.turnedOff);
} else {
  console.error("usage: setup.mjs show|use|off");
  process.exit(2);
}
