#!/usr/bin/env node
// Stands in for a summarizer CLI that is killed mid-run, as when the service stops.
process.kill(process.pid, "SIGTERM");
setTimeout(() => {}, 5000);
