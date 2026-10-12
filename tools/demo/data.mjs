// Made-up sessions for the demo and the README screenshots. Nothing here is real.
// ago: minutes before the demo starts.

export const WORKSPACES = [
  { workspace_id: "w1", label: "web-app", number: 1 },
  { workspace_id: "w2", label: "api", number: 2 },
  { workspace_id: "w3", label: "docs", number: 3 },
];

export const SESSIONS = [
  {
    pane: { pane_id: "w1:p1", workspace_id: "w1", label: "checkout redesign", agent: "claude", agent_status: "blocked", terminal_id: "t1", agent_session: { value: "demo-checkout" } },
    said: "The migration is ready. Should I run it on staging?",
    summary: {
      goal: "Ship the new checkout flow",
      now: "Waiting for approval to run the payments migration on staging",
      needs_you: [["Approve running the payments migration on staging", 4], ["Pick the wording for the order summary button", 38]],
      blocked: [],
      doing: [],
      todo: [["Remove the old checkout behind the feature flag", 90]],
      done: [["Stripe webhook handler, #212 merged", 20], ["Address form validation", 65], ["Order summary layout", 120], ["Saved cards list", 180]],
    },
  },
  {
    pane: { pane_id: "w1:p2", workspace_id: "w1", label: "flaky e2e", agent: "codex", agent_status: "working", terminal_id: "t2", agent_session: { value: "demo-e2e" } },
    said: "Found it: the cart total is read before the price API answers. Rerunning the suite 20 times.",
    summary: {
      goal: "Make the checkout end-to-end tests stable",
      now: "Running checkout.spec.ts 20 times to confirm the fix",
      needs_you: [],
      blocked: [],
      doing: [["Stress run of checkout.spec.ts", 3]],
      todo: [["Remove the retry wrapper once it passes", 3]],
      done: [["Found the race: cart total read before prices load", 12], ["Reproduced the failure locally", 40]],
    },
  },
  {
    pane: { pane_id: "w2:p1", workspace_id: "w2", label: "rate limits", agent: "claude", agent_status: "done", terminal_id: "t3", agent_session: { value: "demo-limits" } },
    said: "PR #418 is up with the rate limits and the docs page.",
    summary: {
      goal: "Per-key rate limits on the public API",
      now: "Done; PR #418 is waiting for review",
      needs_you: [["Review PR #418 (rate limits)", 9]],
      blocked: [],
      doing: [],
      todo: [],
      done: [["Docs page for limits", 10], ["429 responses with Retry-After", 30], ["Token bucket in Redis", 55]],
    },
  },
  {
    pane: { pane_id: "w2:p2", workspace_id: "w2", label: "structured logs", agent: "kimi", agent_status: "working", terminal_id: "t4" },
    summary: {
      goal: "Structured logs for the API",
      now: "Replacing console.log in the order handlers",
      needs_you: [],
      blocked: [],
      doing: [["Replacing console.log in handlers", 6]],
      todo: [["Add a request id to every line", 6], ["Turn it on in staging", 6]],
      done: [["Picked pino and agreed the format", 25]],
    },
  },
  {
    pane: { pane_id: "w2:p3", workspace_id: "w2", label: "node 22", agent: "opencode", agent_status: "idle", terminal_id: "t5" },
    summary: {
      goal: "Upgrade the API to Node 22",
      now: "Stopped: the image library won't build on Node 22",
      needs_you: [],
      blocked: [["sharp fails to build on Node 22; waiting on a release with prebuilt binaries", 70]],
      doing: [],
      todo: [["Bump the Docker base image", 70]],
      done: [["Updated engines and the CI matrix", 80]],
    },
  },
  {
    pane: { pane_id: "w3:p1", workspace_id: "w3", label: "launch post", agent: "claude", agent_status: "idle", terminal_id: "t6", agent_session: { value: "demo-post" } },
    said: "Both drafts are in posts/v2.md. Which title do you want?",
    summary: {
      goal: "Write the v2 launch post",
      now: "Waiting for you to pick a title",
      needs_you: [["Choose between the two titles", 15]],
      blocked: [],
      doing: [],
      todo: [["Changelog section", 15]],
      done: [["First draft", 50], ["Screenshots of the new dashboard", 75]],
    },
  },
];

export const screen = (s) => `${s.said || s.summary.now}\n`;
