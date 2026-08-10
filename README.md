# Sqwack

An ambient development activity monitor. A native iPad app (**Sqwack**) shows, at a
glance from several feet away, whether anything in your development environment
needs you — AI coding agents working / waiting for input / finished / failed,
plus your running development services. A local macOS daemon (**sqwackd**)
collects events from Claude Code and Codex via their official hook mechanisms
and streams them to the iPad over LAN or Tailscale.

No cloud backend. No remote shell. One machine for now; every schema carries a
`machineId` so more machines can be added without a rewrite.

```text
Claude / Codex / OS
        |
        v
     sqwackd            (Mac, local daemon, SQLite, port 4737)
        |
   LAN / Tailscale
        |
        v
   Sqwack iPad app      (SwiftUI, WebSocket live updates)
```

## Requirements

- macOS (tested on macOS 26)
- Node.js >= 24 (`brew install node`)
- Xcode 16+ with an iPadOS 18+ simulator or device (deployment target: **iPadOS 18.0**)
- Optional: [Tailscale](https://tailscale.com) on both the Mac and the iPad for remote access

## Install the daemon

```bash
git clone <this repo>
cd sqwack
./scripts/install-daemon.sh
sqwackd setup                        # installs a LaunchAgent: starts now + at login
sqwackd integrations install claude  # Claude Code lifecycle hooks
sqwackd integrations install codex   # Codex notify hook
sqwackd status
```

`sqwackd status` should report something like:

```text
Sqwack daemon          running
Machine                Mac-mini
Machine ID             83a847be-...
Local API              ready on http://127.0.0.1:4737
Tailscale              reachable (mac-mini.tailnet.ts.net)
claude-code            native / active
codex-cli              derived / active
Active agents          0
Development services   3
Status                 quiet
```

Everything lives in `~/.sqwack/` (config, SQLite DB, tokens, logs, hook scripts).
`sqwackd doctor` diagnoses common problems; `sqwackd logs -f` follows the log.
After changing `~/.sqwack/config.json`, apply it with `sqwackd restart` —
restarts never affect pairing (device credentials are persisted in SQLite and
the iPad reconnects automatically).

## Build & run the iPad app

```bash
open ios/Sqwack.xcodeproj
```

Select the **Sqwack** scheme and an iPad (simulator or device), then Run. There
are no third-party Swift dependencies.

## Set up Tailscale (recommended for remote access)

Tailscale gives the iPad a private, encrypted path to the daemon from anywhere —
no port forwarding, nothing exposed publicly. Skip this section if you only ever
use the iPad on your home LAN.

1. **On the Mac** — install Tailscale and sign in:

   ```bash
   brew install --cask tailscale-app
   open -a Tailscale
   ```

   (or download from <https://tailscale.com/download/macos>). Sign in and note
   the Mac's tailnet name — `sqwackd status` will show it once connected, e.g.
   `mac-mini.your-tailnet.ts.net`.

2. **On the iPad** — install the Tailscale app from the App Store and sign in
   to the **same tailnet** (same account).

3. **Tell the daemon to serve on the tailnet** — edit `~/.sqwack/config.json`:

   ```json
   "network": { "port": 4737, "bind": "127.0.0.1", "tailscaleServe": true }
   ```

   then restart the daemon:

   ```bash
   sqwackd setup
   ```

   With `tailscaleServe` on, the daemon stays bound to `127.0.0.1` and
   Tailscale Serve proxies tailnet traffic to it — nothing listens on your LAN
   or the public internet. Sqwack never uses Tailscale Funnel.

4. Verify: `sqwackd status` should show `Tailscale  reachable (…)`, and
   `sqwackd doctor` checks the whole chain.

When pairing (next section), give the iPad the Tailscale address, e.g.
`mac-mini.your-tailnet.ts.net` or the Mac's `100.x.y.z` Tailscale IP.

## Pair the iPad

1. On the Mac: make the daemon reachable from the iPad — either
   - **Tailscale (recommended):** follow the section above, or
   - **LAN only:** set `"bind": "0.0.0.0"` in `~/.sqwack/config.json` and
     restart with `sqwackd setup`.
2. Run `sqwackd pair`. It prints an 8-character single-use code (valid 5
   minutes) and the addresses the iPad can use.
3. In the app, enter the address and the code. The code is exchanged for a
   long-lived device credential stored in the iOS Keychain. Revoke devices any
   time with `sqwackd devices` / `sqwackd devices revoke <id>`.

Pairing works identically over LAN and Tailscale; if both devices are on your
tailnet the app keeps working away from home. The app reconnects automatically
with exponential backoff and refreshes its full state after every reconnect.

## See it work without real agents

```bash
sqwackd demo          # one realistic event cycle (working -> needs input -> done -> failure -> recovery)
sqwackd demo --loop   # continuously
```

Within a second of each event the iPad updates: the Overview goes amber
("NEEDS YOU") when an agent waits for input, red on failure, back to calm when
resolved.

## Real agent events

- **Claude Code** (`native` confidence): SessionStart/UserPromptSubmit/
  Notification/Stop/SessionEnd hooks map to started/working/needs_input/
  finished/idle. A `Stop` means "finished a turn", not "your whole task is
  done" — Sqwack words it that way on purpose.
- **Codex** (CLI + desktop app): three channels, capability-detected — lifecycle
  hooks in `~/.codex/hooks.json` give working/needs-input/finished/idle (trust
  them once via `/hooks` inside Codex); a `sqwack-codex-exec` wrapper makes
  non-interactive `codex exec` runs observable (including failures); and the
  `notify` fallback reports turn completions with no trust step. An existing
  `notify` program is chained, never replaced.
- **Claude Desktop (chat app)**: no supported native event mechanism → reported
  honestly; nothing is faked. See [docs/integrations.md](docs/integrations.md).

Integrations bind per session: agents already running when hooks are installed
won't report — start a new session/chat. Retention keeps the database small
(events 14 days, sessions 30 days, automatic); `sqwackd prune [--all]` compacts
on demand.

Hook scripts always exit 0 and time out after 3s, so a stopped daemon can never
block or slow your agents. Only session ids, project name/cwd, and short
notification messages are transmitted — never prompt bodies or source code.

## Development processes

The **Development** tab lists listening dev services (node, java, python,
databases, and common dev tools) with port, PID, and project directory. Kill is
confirmation-gated, daemon-verified (the PID's start time must match what was
listed, so a recycled PID is never killed), graceful (SIGTERM), and rate-limited.
The daemon itself is protected. Arbitrary command execution does not exist.

## Tests

```bash
cd daemon && npm test        # 28 daemon tests: reducer, validation, persistence, API, auth, installers
cd ios && xcodebuild -project Sqwack.xcodeproj -scheme Sqwack \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
```

## Uninstall

```bash
sqwackd uninstall            # removes the LaunchAgent
rm /usr/local/bin/sqwackd    # or ~/.local/bin/sqwackd
rm -rf ~/.sqwack
```

Integration changes are additive and backed up (`settings.json.sqwack-backup`,
`config.toml.sqwack-backup`); remove the `sqwack-*` hook entries to detach them.

## More documentation

- [docs/architecture.md](docs/architecture.md) — components, state reducer, multi-machine design
- [docs/protocol.md](docs/protocol.md) — canonical event schema, REST + WebSocket wire protocol
- [docs/integrations.md](docs/integrations.md) — per-integration support level and mapping
