#!/usr/bin/env node
// Stands in for a user's own SUMMARIZER_CMD: reads instructions + text on stdin.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const rules = input.includes("needs_you") ? "has-rules" : "no-rules";
  console.log("```json\n" + JSON.stringify({ goal: "g", now: `${rules} ${input.includes("#7") ? "#7" : ""}`, needs_you: [], blocked: [], doing: [], todo: [], done: [] }) + "\n```");
});
