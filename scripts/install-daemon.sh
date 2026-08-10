#!/bin/sh
# Sqwack daemon installer. Idempotent; never requires sudo unless /usr/local/bin
# is not writable (then it falls back to ~/.local/bin).
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON_DIR="$REPO_DIR/daemon"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js >= 24 is required (https://nodejs.org or 'brew install node')" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "error: Node.js >= 24 required, found $(node --version)" >&2
  exit 1
fi

echo "Installing daemon dependencies..."
(cd "$DAEMON_DIR" && npm install --no-audit --no-fund --silent)

# Link the sqwackd CLI somewhere on PATH.
TARGET="/usr/local/bin/sqwackd"
if [ ! -w "$(dirname "$TARGET")" ]; then
  mkdir -p "$HOME/.local/bin"
  TARGET="$HOME/.local/bin/sqwackd"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) echo "note: add ~/.local/bin to your PATH to use 'sqwackd' directly" ;;
  esac
fi
ln -sf "$DAEMON_DIR/bin/sqwackd" "$TARGET"
echo "Linked $TARGET -> $DAEMON_DIR/bin/sqwackd"

echo
echo "Files this installer creates/changes:"
echo "  $TARGET                          (symlink to the CLI)"
echo "  ~/.sqwack/                       (config, SQLite DB, tokens, logs — created on first run)"
echo "  ~/Library/LaunchAgents/com.sqwack.sqwackd.plist   (only when you run 'sqwackd setup')"
echo
echo "Next steps:"
echo "  sqwackd setup                      # start now + at login"
echo "  sqwackd integrations install claude"
echo "  sqwackd integrations install codex"
echo "  sqwackd pair                       # pair the iPad app"
echo "  sqwackd status"
echo
echo "Uninstall: sqwackd uninstall && rm $TARGET && rm -rf ~/.sqwack"
