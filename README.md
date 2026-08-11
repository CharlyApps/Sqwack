# Sqwack

Sqwack is a local status board for your development machine.

It runs a small macOS daemon, `sqwackd`, and a native iPad app. The daemon watches
your AI coding agents and local development services, then streams a live status
view to the iPad over your LAN or Tailscale.

No cloud backend. No remote shell. No source-code upload.

```text
AI agents + dev services
          |
          v
       sqwackd              macOS daemon
          |
          v
   LAN or Tailscale
          |
          v
       Sqwack               iPad app
```

## What It Shows

- Agent state: working, waiting for input, done, failed, or idle.
- Local dev services: process name, port, PID, and project directory.
- Machine health: CPU, memory, top processes, and recent activity.
- Read-only transcripts when the original provider session file is available.
- Account usage where a supported local source exists.

## How It Works

- `sqwackd` runs locally on your Mac.
- Agent integrations send small lifecycle events into the daemon.
- The daemon stores recent events in SQLite under `~/.sqwack/`.
- The iPad connects with a paired device token stored in Keychain.
- Tailscale is recommended for private remote access.

## Requirements

- macOS
- Node.js 24 or newer
- Xcode 16 or newer
- iPadOS 18 or newer
- Tailscale, optional but recommended

## Install

```bash
git clone https://github.com/CharlyApps/Sqwack.git
cd Sqwack

./scripts/install-daemon.sh
sqwackd setup
sqwackd status
```

Install agent integrations:

```bash
sqwackd integrations install claude
sqwackd integrations install codex
```

Open the iPad app:

```bash
open ios/Sqwack.xcodeproj
```

Select the `Sqwack` scheme in Xcode and run it on an iPad simulator or device.

## Pair The iPad

Start pairing on the Mac:

```bash
sqwackd pair
```

The command prints a short code and the addresses the iPad can use. In the app,
enter the daemon address and the pairing code.

Pairing creates a long-lived device credential in the iOS Keychain. Revoke paired
devices any time:

```bash
sqwackd devices
sqwackd devices revoke <device-id>
```

## Tailscale

Tailscale lets the iPad reach the daemon privately from anywhere without opening
a public port.

Edit `~/.sqwack/config.json`:

```json
{
  "network": {
    "port": 4737,
    "bind": "127.0.0.1",
    "tailscaleServe": true
  }
}
```

Then apply the change:

```bash
sqwackd setup
sqwackd doctor
```

Sqwack uses Tailscale Serve only. It does not use Tailscale Funnel.

## Try Demo Data

```bash
sqwackd demo
sqwackd demo --loop
```

The iPad should update as the demo cycles through working, waiting, done,
failure, and recovery states.

## Useful Commands

```bash
sqwackd status
sqwackd doctor
sqwackd logs -f
sqwackd restart
sqwackd prune
sqwackd uninstall
```

## Privacy And Safety

- The daemon is local-first and stores data under `~/.sqwack/`.
- Device tokens are hashed at rest.
- Pairing codes are short-lived and single-use.
- Hook scripts time out quickly and always exit without blocking your agents.
- The process kill action is confirmation-gated and PID-recycle checked.
- There is no arbitrary command execution endpoint.

## Tests

Daemon:

```bash
cd daemon
npm test
npm run typecheck
```

iPad app:

```bash
cd ios
xcodebuild -project Sqwack.xcodeproj -scheme Sqwack \
  -destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5)' test
```

## Uninstall

```bash
sqwackd uninstall
rm /usr/local/bin/sqwackd
rm -rf ~/.sqwack
```

If you installed agent integrations, remove the `sqwack-*` hook entries from the
provider config files. Sqwack creates `.sqwack-backup` files before editing
provider configs.

## Documentation

- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Integrations](docs/integrations.md)
