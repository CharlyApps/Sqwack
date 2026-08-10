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

## Build & run the iPad app

```bash
open ios/Sqwack.xcodeproj
```

Select the **Sqwack** scheme and an iPad (simulator or device), then Run. There
are no third-party Swift dependencies.

## Pair the iPad

1. On the Mac: make the daemon reachable from the iPad — either
   - **Tailscale (recommended):** set `"tailscaleServe": true` in
     `~/.sqwack/config.json` (keeps the daemon bound to 127.0.0.1; Tailscale
     proxies tailnet traffic), then restart it (`sqwackd setup`), or
   - **LAN:** set `"bind": "0.0.0.0"` in `~/.sqwack/config.json` and restart.
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
- **Codex CLI** (`derived` confidence): the `notify` mechanism reports turn
  completion; approvals surface when Codex emits them. If you already had a
  `notify` program configured, the installer chains it — your existing notifier
  keeps running.
- **Desktop apps**: no supported native event mechanism today → reported
  honestly as unsupported in Settings; nothing is faked. See
  [docs/integrations.md](docs/integrations.md).

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
