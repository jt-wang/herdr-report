#!/usr/bin/env bash
# Start, stop and inspect the Herdr Report server.
# Herdr runs this from the plugin root with HERDR_PLUGIN_CONFIG_DIR set and no
# login shell, so tool paths are looked up explicitly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${HERDR_PLUGIN_CONFIG_DIR:-$HOME/.config/herdr/plugins/config/herdr-report}"
mkdir -p "$CONF"
# shellcheck disable=SC1091
[ -f "$CONF/config.env" ] && . "$CONF/config.env"

find_bin() {
  local name="$1" p
  p="$(command -v "$name" 2>/dev/null || true)"
  [ -n "$p" ] && { echo "$p"; return; }
  for d in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/.opencode/bin" /opt/homebrew/opt/node@24/bin /opt/homebrew/opt/node/bin \
           /Applications/Tailscale.app/Contents/MacOS; do
    [ -x "$d/$name" ] && { echo "$d/$name"; return; }
    [ "$name" = tailscale ] && [ -x "$d/Tailscale" ] && { echo "$d/Tailscale"; return; }
  done
}

# HOST: comma-separated addresses to listen on; this Mac only by default.
# The phone reaches it through `tailscale serve`, which adds HTTPS (core/tailnet.mjs).
PORT="${PORT:-8794}"
HOST="${HOST:-127.0.0.1}"
TS="$(find_bin tailscale)"
NODE="$(find_bin node)"
TAILNET_STATE="$CONF/tailnet.json"
LABEL="${PM_LABEL:-io.herdr-report}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
# The address to show: the first one that isn't loopback, else the first one.
PHONE_HOST="$(tr ',' '\n' <<<"$HOST" | grep -v -E '^(127\.|::1$|localhost$)' | head -1 || true)"
[ -n "$PHONE_HOST" ] || PHONE_HOST="${HOST%%,*}"
URL="http://$PHONE_HOST:$PORT"
LOCAL_URL="http://${HOST%%,*}:$PORT"
tailnet() { TAILSCALE_BIN="$TS" TAILNET_STATE="$TAILNET_STATE" "$NODE" "$ROOT/core/tailnet.mjs" "$@"; }
# The address to give the phone: the HTTPS tailnet one once published.
phone_url() { [ -f "$TAILNET_STATE" ] && tailnet url 2>/dev/null || echo "$URL"; }

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

start() {
  local node herdr claude codex opencode path
  node="$(find_bin node)"; herdr="$(find_bin herdr)"; claude="$(find_bin claude)"; codex="$(find_bin codex)"; opencode="$(find_bin opencode)"
  [ -n "$node" ] || { echo "node not found" >&2; exit 1; }
  [ -n "$herdr" ] || { echo "herdr not found" >&2; exit 1; }
  path="$(dirname "$node"):$(dirname "$herdr")${claude:+:$(dirname "$claude")}${codex:+:$(dirname "$codex")}${opencode:+:$(dirname "$opencode")}:/usr/bin:/bin:/usr/sbin:/sbin"
  if [ "$(uname)" = Darwin ]; then
    mkdir -p "$(dirname "$PLIST")"
    cat >"$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(xml "$node")</string><string>$(xml "$ROOT/core/server.mjs")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$ROOT")</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOST</key><string>$HOST</string>
    <key>PORT</key><string>$PORT</string>
    <key>CONF_DIR</key><string>$(xml "$CONF")</string>
    <key>CACHE_DIR</key><string>$(xml "$CONF/cache")</string>
    <key>REPORTS_DIR</key><string>$(xml "$CONF/reports")</string>
    <key>CONFIG_FILE</key><string>$(xml "$CONF/config.env")</string>
    <key>PATH</key><string>$(xml "$path")</string>
    <key>HOME</key><string>$(xml "$HOME")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$CONF/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$CONF/server.log")</string>
</dict></plist>
PL
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  else
    stop_linux
    HOST="$HOST" PORT="$PORT" CONF_DIR="$CONF" CACHE_DIR="$CONF/cache" REPORTS_DIR="$CONF/reports" CONFIG_FILE="$CONF/config.env" PATH="$path" nohup "$node" "$ROOT/core/server.mjs" >>"$CONF/server.log" 2>&1 &
    echo $! >"$CONF/server.pid"
  fi
  for _ in $(seq 1 20); do
    curl -fsS -o /dev/null -m 2 "$LOCAL_URL/" 2>/dev/null && { publish; "$node" "$ROOT/core/setup.mjs" show | head -1; return; }
    sleep 0.5
  done
  echo "Started, but $URL is not answering yet. Log: $CONF/server.log" >&2
  exit 1
}

# Publish on the tailnet over HTTPS, unless HOST already lists an address the phone can reach.
publish() {
  if [ "$PHONE_HOST" != "${HOST%%,*}" ] || [ "${PUBLISH:-1}" = 0 ]; then echo "$URL"; return; fi
  if tailnet publish "$PORT"; then return; fi
  echo "$LOCAL_URL (this Mac only)"
}

stop_linux() {
  [ -f "$CONF/server.pid" ] && kill "$(cat "$CONF/server.pid")" 2>/dev/null || true
  rm -f "$CONF/server.pid"
}

stop() {
  [ -f "$TAILNET_STATE" ] && tailnet unpublish || true
  stop_service
  echo "stopped"
}

# Stop the server but keep the tailnet address, so a restart doesn't drop the phone.
stop_service() {
  if [ "$(uname)" = Darwin ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
  else
    stop_linux
  fi
}

status() {
  if curl -fsS -o /dev/null -m 2 "$LOCAL_URL/" 2>/dev/null; then echo "running at $(phone_url)"; else echo "not running"; fi
  echo "log: $CONF/server.log"
}

running() { curl -fsS -o /dev/null -m 2 "$LOCAL_URL/" 2>/dev/null; }

# Change the summarizer, then restart so it takes effect.
choose() {
  local node bins
  node="$(find_bin node)"
  # setup.mjs looks for the agent CLIs on PATH, which Herdr runs us without
  bins="$(for b in claude codex opencode; do p="$(find_bin "$b")"; [ -n "$p" ] && printf '%s:' "$(dirname "$p")"; done)"
  PATH="$bins$PATH" CONFIG_FILE="$CONF/config.env" "$node" "$ROOT/core/setup.mjs" "$1"
  [ "$1" = show ] && return
  if running; then stop_service; start >/dev/null && echo "restarted"; fi
}

# Reinstall from the GitHub repo Herdr installed it from (Herdr replaces it in
# place), then restart from the new files. A plugin linked from a folder is
# updated with git pull instead.
update() {
  local herdr src
  herdr="$(find_bin herdr)"
  src="$("$herdr" plugin list --json | "$NODE" -e '
    const p = JSON.parse(require("fs").readFileSync(0)).result.plugins.find((x) => x.plugin_id === "herdr-report");
    if (p?.source?.kind === "github") console.log(`${p.source.owner}/${p.source.repo}`);')"
  if [ -z "$src" ]; then
    echo "This copy is linked from $ROOT: update it with git pull there, then run restart."
    return
  fi
  "$herdr" plugin install "$src" --yes >/dev/null
  echo "updated from github.com/$src"
  # the files were just replaced; run the new ctl.sh rather than the rest of this one
  if running; then exec bash "$ROOT/scripts/ctl.sh" restart; fi
}

# Stop the service and delete what it made; keep config.env.
uninstall() {
  stop >/dev/null
  rm -rf "$CONF/cache" "$CONF/reports" "$CONF/server.log" "$CONF/sessions.json" "$CONF/push"
  echo "removed the service, cache and log; kept $CONF/config.env"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop_service; start ;;
  status) status ;;
  url) phone_url ;;
  summarizer) choose show ;;
  use-recommended) choose use ;;
  summaries-off) choose off ;;
  uninstall) uninstall ;;
  update) update ;;
  check) TAILSCALE_BIN="$TS" CONFIG_FILE="$CONF/config.env" PATH="$(for b in claude codex opencode herdr; do p="$(find_bin "$b")"; [ -n "$p" ] && printf '%s:' "$(dirname "$p")"; done)$PATH" "$NODE" "$ROOT/core/check.mjs" ;;
  *) echo "usage: ctl.sh start|stop|restart|status|url|check|update|summarizer|use-recommended|summaries-off|uninstall" >&2; exit 2 ;;
esac
