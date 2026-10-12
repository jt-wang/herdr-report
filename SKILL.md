---
name: herdr-report
description: Use when someone wants to see from their phone what every coding agent in Herdr is doing, what is done and what needs them, asks to be notified when an agent is waiting, or when installing, configuring or debugging the herdr-report Herdr plugin.
---

# Herdr Report

A Herdr plugin. For every agent session in Herdr it keeps the goal, what's
done, what's in progress, what's stuck and what needs the user, and serves it
as a phone page with notifications, plus an API.

## Install it for someone

You need a shell on the machine that runs Herdr. Run these one at a time and
read each result before the next.

1. **Herdr and Node.** `herdr --version` must print 0.8.0 or newer and
   `node --version` v20 or newer. If either is missing, tell the user what to
   install (https://herdr.dev, https://nodejs.org) and stop.

2. **Install the plugin.**

   ```sh
   herdr plugin install jt-wang/herdr-report --yes
   ```

3. **Check what it needs.**

   ```sh
   herdr plugin action invoke check --plugin herdr-report
   ```

   Actions run in the background; read their output with
   `herdr plugin log list --plugin herdr-report` (the newest entry's
   `stdout`). Lines start with `✓` (fine), `!` (works, but limited), `✗`
   (must fix) or `·` (a suggestion). Fix every `✗`. For `!` about Tailscale:
   without Tailscale running, or without HTTPS certificates turned on for the
   tailnet (admin console, DNS page), the page only opens on this machine.

4. **Start it.**

   ```sh
   herdr plugin action invoke start --plugin herdr-report
   ```

   The log's `stdout` has the address, `https://<machine>.<tailnet>.ts.net:<port>`.

5. **Summaries cost money, so ask first.** Out of the box nothing is
   summarized; the page shows each agent's status and last words. Goals,
   done and to-do lists need a model. Run the `summarizer` action, show the
   user the suggested option and its cost per summary, and only if they agree
   run:

   ```sh
   herdr plugin action invoke use-recommended --plugin herdr-report
   ```

   Summaries only run while someone has the page open. Never point it at the
   model the user codes with unless they ask; never paste API keys into chat.

6. **On the phone.** Give the user the address. On iPhone: open it in
   Safari, tap Share, choose **Add to Home Screen**, open it from the Home
   Screen, then tap the bell and turn notifications on. Android and desktop
   browsers can turn them on straight away.

## Settings

`config.env` in `herdr plugin config-dir herdr-report`; run the `restart`
action after editing. The keys are in README.md under Configuration.

## When something is wrong

- Page doesn't open on the phone: run `check`; it is almost always Tailscale
  (not running on the phone or the Mac, or HTTPS certificates off).
- No summaries: run the `summarizer` action. "off" means none was chosen.
  Summaries also wait until someone opens the page.
- The server log is `server.log` in the config directory.
- Remove everything it made, keeping `config.env`: the `uninstall` action,
  then `herdr plugin uninstall herdr-report`.
