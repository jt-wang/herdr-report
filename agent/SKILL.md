---
name: herdr-status-report
description: Use when you are running inside a Herdr pane (HERDR_PANE_ID is set) and you start a task, finish a step, get blocked, or need the user to decide or approve something. Keeps a small status file that Herdr Report shows on the user's phone.
---

# Report your status to Herdr Report

Herdr Report shows the user, on their phone, what each agent session is doing. It summarizes your
conversation on its own, but only you know exactly what you are doing right now and what you are
waiting for. Write that down in one file whenever it changes.

**When:** after you start a task, finish a step, hit a blocker, or stop to ask the user something.
Do it before you hand the turn back to the user, so the phone shows the question.

**Where:** `~/.config/herdr/plugins/config/herdr-report/reports/$HERDR_PANE_ID.json`
If `HERDR_PANE_ID` is not set, you are not in Herdr: do nothing.

**What:** one JSON object, every field required, plain sentences in the user's language:

```json
{
  "goal": "what this whole session is trying to get done",
  "now": "what you are doing or waiting for right now, one sentence",
  "needs_you": ["decisions, approvals or actions only the user can take, still open"],
  "blocked": ["what is stuck and on what"],
  "doing": ["what is in progress"],
  "todo": [],
  "done": [],
  "reported_at": "2026-01-01T12:00:00Z"
}
```

Only `now`, `needs_you`, `blocked` and `doing` are shown from your report; leave `todo` and `done`
empty unless you keep a real list. Herdr Report fills those in from your transcript.

```bash
f="$HOME/.config/herdr/plugins/config/herdr-report/reports/$HERDR_PANE_ID.json"
mkdir -p "$(dirname "$f")"
cat > "$f.tmp" <<'JSON'
{ ...the object above... }
JSON
mv "$f.tmp" "$f"
```

Write to a temp file and move it into place so the reader never sees half a file. Use
`date -u +%Y-%m-%dT%H:%M:%SZ` for `reported_at`.
