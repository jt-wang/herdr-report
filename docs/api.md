# API

The server listens on `127.0.0.1:8794`. `tailscale serve` publishes it on
your tailnet over HTTPS (`herdr plugin action invoke url --plugin herdr-report`
prints the address). There is no login: anyone on your tailnet can read every
session and switch the Mac's focused pane.

## `GET /v1/sessions`

Every agent session Herdr knows about. The full shape is in
[`schema/sessions-v1.schema.json`](../schema/sessions-v1.schema.json), also
served at `GET /v1/schema`.

```json
{
  "version": 1,
  "host": "my-mac",
  "generated_at": "2026-10-13T01:00:00.000Z",
  "workspaces": [{ "id": "w1", "label": "web-app", "session_ids": ["claude:demo-checkout"] }],
  "sessions": [{
    "id": "claude:demo-checkout",
    "pane_id": "w1:p1",
    "workspace_id": "w1",
    "workspace_label": "web-app",
    "label": "checkout redesign",
    "agent": "claude",
    "status": "blocked",
    "last_message": "The migration is ready. Should I run it on staging?",
    "summary": {
      "goal": "Ship the new checkout flow",
      "now": "Waiting for approval to run the payments migration on staging",
      "needs_you": [{ "id": "3fa1c2d0", "text": "Approve running the payments migration on staging", "since": "2026-10-13T00:58:12.000Z" }],
      "blocked": [],
      "doing": [],
      "todo": [{ "id": "91be0c44", "text": "Remove the old checkout behind the feature flag", "since": "2026-10-13T00:31:40.000Z" }],
      "done": [{ "id": "07d5e1aa", "text": "Stripe webhook handler, #212 merged", "since": "2026-10-13T00:40:02.000Z" }],
      "source": "transcript",
      "summarized_by": "claude-code:haiku",
      "updated_at": "2026-10-13T00:58:12.000Z",
      "self_report_at": null
    },
    "summarizing": false
  }]
}
```

**`id`** stays the same while the session lives, even when its pane moves to
another workspace; `pane_id` says where it is now. To open the pane in another
app, build that app's link from `pane_id`.

**Items** keep their `id` across summaries when they are the same thing, even
reworded or moved to another list (a `doing` item that is finished shows up in
`done` with the same id). `since` is when it entered its current list.

Fields that cost nothing and are always there: `status` (from Herdr:
`working`, `blocked`, `done`, `idle`, `unknown`), `last_message` (Claude Code,
Codex, Kimi), and `tail` (the end of the screen). `summary` is `null` while
summaries are off, unless the agent wrote its own report.

Asking for sessions (this route, one session, or `/v1/events`) counts as
someone looking: by default that is what starts summaries, which then follow
along for 2 minutes after the last request, or as long as the event stream is
open. Reading `sessions.json` doesn't count.

## `GET /v1/events`

Server-sent events:

| Event | Data | When |
|---|---|---|
| `snapshot` | the same body as `/v1/sessions` | on connect |
| `session` | one full session | it changed (the screen `tail` alone doesn't count) |
| `removed` | `{ id, pane_id }` | its pane closed |
| `status` | `{ id, pane_id, from, to, at }` | Herdr's status for it changed |
| `item` | `{ id, pane_id, list, item, at }` | an item entered a list it wasn't in |

The first snapshot after the server starts is a baseline: nothing in it is
announced as `status` or `item`, so a restart doesn't repeat old news.

```js
const es = new EventSource("http://127.0.0.1:8794/v1/events");
es.addEventListener("item", (e) => {
  const { list, item } = JSON.parse(e.data);
  if (list === "needs_you") notify(item.text);
});
```

## `sessions.json`

The latest `/v1/sessions`, rewritten whenever something changes, in the
plugin's config directory (`herdr plugin config-dir herdr-report`). For tools
that would rather read a file than make a request.

## Other routes

| Route | |
|---|---|
| `GET /v1/sessions/:id` | One session. |
| `GET /v1/sessions/:id/screen` | The last 400 lines of its screen. |
| `POST /v1/sessions/:id/focus` | Switch Herdr on the Mac to its pane. |
| `GET /v1/summarizer` | The summarizer in use, and the cheapest tested one installed. |
| `GET /v1/schema` | The JSON Schema. |

## An agent's own report

An agent can write `<config dir>/reports/<pane id>.json` with the summary fields
and `reported_at`. While it is fresh, its `now`, `needs_you`, `blocked` and
`doing` replace the summary's, and `summary.self_report_at` says when.
`agent/SKILL.md` tells an agent how.
