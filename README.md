<p align="center">
  <img src="public/paddy-icon.jpg" width="160" height="160" alt="Paddy Irishman">
</p>

# Paddy Irishman

Irish-roots super harness. Gateway presence plus a closed learning loop.

Not affiliated with the OpenClaw Foundation, Nous Research, Guinness, or Paddy Irish Whiskey.

## Install

Same shape as the usual harness installers.

macOS / Linux / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.ps1 | iex
```

Skip first-run config:

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.sh | bash -s -- --no-config
```

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/coruairc/paddy-gui/main/install.ps1))) -NoConfig
```

If git or Node.js 22+ is missing, the script offers to install them. It clones this repo to `~/.paddy/src`, runs `npm install`, and puts `paddy` on your PATH (`~/.local/bin`, and `/usr/local/bin` when writable). If this terminal still says `command not found`:

```bash
export PATH="$HOME/.local/bin:$PATH"
hash -r
paddy gateway
```

## Then

```bash
paddy config               # write ~/.paddy — models, channels, secrets
paddy config show          # canonical JSON (tokens redacted)
paddy gateway              # control plane (foreground)
paddy gateway start        # background
paddy dashboard            # web console
paddy chat "hello"
paddy models
paddy models prefer laguna
paddy channels add telegram --token <bot>
paddy config import        # from ~/.openclaw and ~/.hermes
paddy channels export --to both
paddy pairing approve ABCD
paddy skills
paddy skills install meeting-actions
paddy skills import ./SKILL.md
paddy skills export standup-notes
paddy memory
paddy doctor
```

`paddy onboard` is an alias for `paddy config`.

## Config

One file. Paddy owns it. OpenClaw and Hermes are import/export only.

| File | What it holds |
|---|---|
| `~/.paddy/config.json` | Structure and behaviour (gateway, brain, channels, access policy) |
| `~/.paddy/.env` | Secrets (`TELEGRAM_BOT_TOKEN`, CLI token, …) referenced as `${ENV}` |
| `selfhost.env` | Brain keys / setup-tokens |

```bash
paddy config                 # init
paddy config show
paddy config validate
paddy config import --from openclaw
paddy channels add telegram --token <bot>
paddy models prefer laguna
```

Saving a channel writes Paddy config. Export writes OpenClaw / Hermes compatibility files without changing Paddy. Import merges with conflict prompts — never a silent overwrite.

Access policy on each channel: **pairing**, **allowlist**, or **open**.

Put keys in `~/.paddy/src/selfhost.env` (copy `selfhost.env.example`) or `~/.paddy/selfhost.env`. Sign-in in the dashboard is for the browser; the CLI spends the gateway environment.

## Manual

```bash
git clone https://github.com/coruairc/paddy-gui.git
cd paddy
npm install          # puts `paddy` on PATH
paddy config
paddy gateway
```

## License

MIT — see [LICENSE](LICENSE).
