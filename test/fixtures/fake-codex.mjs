#!/usr/bin/env node
// Stands in for `codex exec` in tests: writes a fixed summary to the -o file.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args[args.indexOf("-o") + 1];
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  writeFileSync(out, JSON.stringify({
    goal: "codex goal", now: input.includes("#7") ? "Merge #7" : "?",
    needs_you: [], blocked: [], doing: [], todo: [], done: ["x"],
  }));
});
