#!/usr/bin/env node
// Stands in for `claude -p` in tests: echoes a fixed structured summary, and
// reports in `now` which model and which instructions it was given.
const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : "default";
const prompt = args[args.length - 1];
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const kind = prompt.includes("Update the progress") ? "update" : "full";
  // Keep the id the input gave for the same request, as the real model is asked to.
  const idOf = (text) => input.match(new RegExp(`"id":"([^"]*)","text":"${text}"`))?.[1] || "";
  const needs = [{ id: idOf("Confirm the rain threshold"), text: "Confirm the rain threshold" }];
  if (input.includes("Please pick a reminder time")) needs.push({ id: idOf("Pick a reminder time"), text: "Pick a reminder time" });
  console.log(JSON.stringify({
    is_error: false,
    structured_output: {
      goal: "Skip watering on rainy days", now: `${input.includes("#7") ? "Merge #7" : "?"} model=${model} prompt=${kind}${input.startsWith("Herdr status now: stopped") ? " status=blocked" : ""}${prompt.includes("Write in English") ? " lang=en" : ""}`,
      needs_you: needs, blocked: [], doing: ["Merge #7"], todo: ["Add a sound to reminders"], done: ["Read the weather forecast"],
    },
  }));
});
