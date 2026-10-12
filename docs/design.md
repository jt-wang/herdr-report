# Design

What Herdr Report is, how it is built, and the decisions behind it. Written
for whoever reviews it before the repo goes public.

## What it is

A Herdr plugin that keeps a progress record for every agent session on the
machine: the goal, what's done, what's in progress, what's stuck, what needs
the user, what's left. It gives that record out as data. The phone page is one
client of that data; other apps and scripts can be others.

## Layers

| Layer | What | Costs |
|---|---|---|
| Collect | Herdr's state for each pane, the agent's last words from its transcript, the end of its screen | nothing |
| Summarize | A model the user picked reads the transcript (or screen) and writes the record; after the first time it reads only what's new | per summary, opt-in |
| Give out | `/v1` HTTP API, `/v1/events` stream, `sessions.json`, push notifications | nothing |
| Clients | the phone page here; anything else that reads the API | — |

An agent can also write its own report (`agent/SKILL.md`). The server reads
it, but nothing installs it: making the working agent spend tokens on
reporting was turned down, and summaries cover the same ground.

## Data contract (v1)

Decided before publishing, because changing it afterwards breaks other
people's tools.

1. **Sessions have a stable `id`**: `claude:<session>`, `codex:<session>`, or
   `terminal:<terminal id>` when Herdr doesn't report an agent session. A
   pane's id changes when it moves to another workspace; the session's doesn't.
   `pane_id` is still there, saying where the session is now. Routes take the
   session `id`.
2. **Every item has an id and a time**: `{ id, text, since }`. `since` is when
   it entered that list. The summarizer is given the previous items and keeps
   an item's id when it is the same thing, even reworded, so a client can tell
   a new request from an old one said differently. Ids that the model invents
   or repeats are replaced by fresh ones.
3. **Events say what changed**, not only that something did: `status` (Herdr's
   state moved, e.g. to `blocked`) and `item` (an item entered a list, e.g.
   `needs_you`). The first snapshot after a start is a baseline and emits
   neither, so a restart doesn't repeat old news. Push notifications are sent
   from the same transitions.
4. **No links to other apps in the data.** A client that wants to open a pane
   in Collie, Heeler or anything else builds the link from `pane_id`. The data
   stays free of every app's URL format.
5. **`host`** names the machine at the top of every payload, so a client that
   reads several machines can tell them apart.

## Choosing the summarizer

Off until the user picks one, so nobody's quota is spent unasked. The plugin
lists the tested options it can run on this machine with their cost and
suggests the cheapest (`core/catalog.mjs`). It never defaults to the model the
user writes code with. Measurements in [summarizers.md](summarizers.md).

When to summarize: only while someone is looking (a client asked for sessions
in the last 2 minutes, or holds the event stream open). A new look first
brings every changed session up to date; after that, at most every 10 minutes
per session, and within a minute when Herdr sees the agent start waiting on
the user or finish. Only sessions whose record or screen changed. Most of the
time nobody is looking, and then nothing is spent. `SUMMARY_MODE=continuous`
keeps summarizing regardless, for people who want item-level notifications.

## Reaching the phone

The server listens on 127.0.0.1. `tailscale serve` publishes it on the tailnet
over HTTPS, on a port of its own (the local port number when free; never
:443, which is the machine's root URL), and the plugin only ever removes that
one mount. HTTPS is what web push and a proper home-screen app need. There is
no login: the tailnet is the boundary.

## Push

The main trigger costs nothing: Herdr sees an agent stop at a prompt, and the
notification carries the agent's last words, which usually are the question
it is asking. It works with summaries off and nobody looking. When summaries
are running, a new `needs_you` or `blocked` item also notifies. "Done" (Herdr
sees the turn end, or a new `done` item) is off by default. Quiet hours mute
everything except what needs the user. A session stopped at a prompt notifies
at most once every 10 minutes. Pushes are encrypted on the Mac (RFC 8291, no
dependency; `core/push.mjs` comes from codexbar-pwa).

Checked end to end on 2026-10-13: a real Claude Code pane stopped at a file
write approval, Herdr reported it blocked, and a Chrome profile subscribed
through Google's push service showed the notification.

## Coverage by agent

| Agent | Status | Last words | Summary from |
|---|---|---|---|
| Claude Code | Herdr | transcript | transcript |
| Codex | Herdr | transcript | transcript |
| Kimi Code | Herdr | `wire.jsonl` | `wire.jsonl` |
| everything else Herdr recognizes | Herdr | — | screen |

opencode keeps its sessions in a SQLite database, but Herdr only reports which
opencode session a pane runs once Herdr's opencode integration is installed
(`herdr integration install opencode`). Without it, matching a pane to a
session would be a guess, so opencode panes are read from the screen.

## Not doing

- Typing into panes from the phone: Collie and Heeler do that.
- Our own native app: the page installs to the home screen and gets push.
- Installing hooks or skills into agents.
