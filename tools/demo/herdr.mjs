#!/usr/bin/env node
// Stands in for the herdr CLI in the demo, answering from tools/demo/data.mjs.
import { WORKSPACES, SESSIONS, screen } from "./data.mjs";

const [group, cmd, id] = process.argv.slice(2);
const out = (result) => console.log(JSON.stringify({ result }));
if (group === "workspace" && cmd === "list") out({ workspaces: WORKSPACES });
else if (group === "pane" && cmd === "list") out({ panes: SESSIONS.map((s) => s.pane) });
else if (group === "pane" && cmd === "read") console.log(screen(SESSIONS.find((s) => s.pane.pane_id === id) || SESSIONS[0]));
else if (group === "agent" && cmd === "focus") out({ type: "ok" });
else process.exit(2);
