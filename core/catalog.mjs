// Summarizers we have tested, so the plugin can suggest the cheapest one the
// user already has instead of the expensive model they write code with.
//
// Prices are USD per million tokens, read from opencode's price list
// (`opencode models --verbose`) on 2026-10-13. Re-check them there before
// changing this table. Quality notes come from summarizing the same real
// session with each option (docs/summarizers.md).

import { setEnvKeys } from "./lib.mjs";

export const OPTIONS = [
  {
    id: "claude-haiku",
    summarizer: "claude",
    model: "haiku",
    cli: "claude",
    label: "Claude Code · Haiku",
    price: { input: 0.1, output: 0.5 },
    quality: { zh: "找全了「需要你」和「卡住」", en: "caught what needs you and what's stuck" },
    tested: "2026-10-13",
  },
  {
    id: "opencode-haiku",
    summarizer: "opencode",
    model: "opencode/claude-haiku-5-5",
    cli: "opencode",
    label: "opencode · Claude Haiku",
    price: { input: 0.1, output: 0.5 },
    quality: { zh: "找全了「需要你」和「卡住」", en: "caught what needs you and what's stuck" },
    tested: "2026-10-13",
  },
  {
    id: "opencode-deepseek-flash",
    summarizer: "opencode",
    model: "opencode/deepseek-v4.1-flash",
    cli: "opencode",
    label: "opencode · DeepSeek V4.1 Flash",
    price: { input: 0.3, output: 1.2 },
    quality: { zh: "找全了「需要你」和「卡住」，另多列了一两条次要的", en: "caught what needs you and what's stuck, plus a minor extra or two" },
    tested: "2026-10-13",
  },
];

// One summary of a mid-sized session, measured with Haiku on 2026-10-13.
// Incremental updates read less than this.
export const TYPICAL = { input: 8_200, output: 3_200 };

export function costPerSummary(price) {
  return (TYPICAL.input * price.input + TYPICAL.output * price.output) / 1e6;
}

// found: { <cli name>: path } for the CLIs installed on this machine.
export function recommend(found) {
  const usable = OPTIONS.filter((o) => found[o.cli]);
  usable.sort((a, b) => costPerSummary(a.price) - costPerSummary(b.price));
  return usable[0] || null;
}

// Set SUMMARIZER / SUMMARY_MODEL in config.env text, leaving every other line alone.
export function applyChoice(text, option) {
  return setEnvKeys(text, { SUMMARIZER: option.summarizer, SUMMARY_MODEL: option.model });
}
