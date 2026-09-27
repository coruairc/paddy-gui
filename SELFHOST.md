# Run Paddy Irishman on your machine

Paddy is a super harness: gateway presence plus a closed learning loop. This kit is the same app you tried in the preview. Hook **your** subscriptions and keys. The hosted demo’s SuperGrok quota is not yours.

Not affiliated with the OpenClaw Foundation, Nous Research, OpenAI, Anthropic, Google, DeepSeek, Poolside, or xAI.

## Install from git (recommended)

Same shape as the usual harness installers. If git or Node.js 22+ is missing, the installer offers to install them.

```bash
curl -fsSL https://raw.githubusercontent.com/coruairc/paddy/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/coruairc/paddy/main/install.ps1 | iex
```

That clones [coruairc/paddy](https://github.com/coruairc/paddy), runs `npm install`, and puts `paddy` on your PATH. Then:

```bash
paddy gateway
```

Skip first-run config: `bash -s -- --no-config`. Help: `bash -s -- --help`.

## Zip kit

```bash
unzip paddy-selfhost.zip
cd paddy-selfhost
npm install            # puts `paddy` on PATH (~/.local/bin)
paddy config
paddy gateway
```

In another terminal:

```bash
paddy dashboard        # web console
paddy chat "remember I prefer terse replies"
paddy models
paddy doctor
```

`paddy gateway start` backgrounds it; `stop` / `restart` / `status` match. The command is `paddy` — never npx.

Open the URL the gateway prints (default http://127.0.0.1:8080). Prefer a model in **Models**, or `paddy models prefer laguna`. Keys and session tokens in the UI stay in that browser’s localStorage. **The CLI spends the gateway’s environment** (`selfhost.env`) — sign-in in the dashboard is for the browser.

`--port` and `--host` override the default `127.0.0.1:8080`.

## CLI

| Command | What it does |
|---|---|
| `paddy gateway` | Run the gateway in the foreground |
| `paddy gateway start` | Start in the background (`~/.paddy/gateway.pid`) |
| `paddy gateway stop` / `restart` / `status` | Control the background process |
| `paddy chat` | Interactive REPL against the running gateway |
| `paddy chat "…"` | One-shot turn |
| `paddy dashboard` | Open the web console |
| `paddy models` / `paddy models prefer <id>` | List / pick a brain |
| `paddy skills` | List skills in `workspace.json` |
| `paddy skills install <id>` | Copy a bundled hub playbook onto this mind |
| `paddy skills import [file]` | Add a SKILL.md (OpenClaw / agentskills.io). Stdin if omitted |
| `paddy skills export <name>` | Print a skill as SKILL.md |
| `paddy memory` | Show persisted MEMORY.md facts |
| `paddy approve allow` / `deny` | Allow or deny a gated tool the last chat held |
| `paddy doctor` | Check node, kit, env, gateway |
| `paddy configure` | Interactive OpenClaw-style section wizard (↑/↓ + Enter) |
| `paddy config` | Same wizard on a TTY; `--yes` / non-TTY keeps first-run init |
| `paddy config init` | First-run `~/.paddy` + `selfhost.env` (alias: `paddy onboard`) |
| `paddy config show` | Print canonical config (secrets redacted) |
| `paddy config validate` | Check the JSON schema |
| `paddy config get|set|unset <path>` | Path-addressed read/write (secrets redacted on read) |
| `paddy config schema` | JSON Schema subset for FE / Control UI |
| `paddy config import` | Pull OpenClaw / Hermes into Paddy (conflicts ask before replace) |
| `paddy channels` | List Telegram / Discord / Slack / … |
| `paddy channels add telegram --token …` | Write Paddy config; the live bridge picks it up |
| `paddy gateway setup` | Connect wizard (same config as the CLI) |
| `paddy channels export --to both` | Compatibility files only — Paddy config stays the source of truth |
| `paddy pairing approve CODE` | Allow a stranger who DMed the bot |
| `paddy agent list` | Seed mind is Paddy; extras are added in the dashboard |

Config lives in `~/.paddy/config.json`. Chat history for the CLI lives in `~/.paddy/workspace.json` (separate from the browser workspace).

Path-keyed edits (OpenClaw-style) address that flat JSON file.

Interactive `paddy configure` (and bare `paddy config` on a TTY) opens a section menu
(Workspace, Model/Brain, Gateway, Channels, Memory, Skills, Health, Skip/Done).
Every write goes through `configSet` / `configGet` against `canonicalConfigSchema`
(same schema as `getConfigSchema`). Gateway auth tokens are writeOnly: they land in
`cli.token` + `~/.paddy/.env`, never plaintext in `config.json`. Plugins / Daemon are
not offered yet (no persistence surface).

- `paddy config get|set|unset <path>` — e.g. `gateway.port`, `brain.preferred`, `channels.telegram`
- `paddy config schema` — JSON Schema subset for Control UI forms
- Alias: `gateway.auth.token` → `cli.token` (`${PADDY_CLI_TOKEN}`); secrets are redacted on read
- `openclaw.runtime` (`paddy` | `openclaw`), `openclaw.url`, `openclaw.token`, `openclaw.model` — opt-in OpenClaw gateway target
- `agents.defaults.memory.*` — Hermes memory defaults (enabled, char/recall limits); runtime SoT via `resolveMemoryLimits` for **both** `openclaw.runtime=paddy` and `openclaw`
- `skills.*` are accepted for FE forms

`npm run dev` still works if you want Vite directly. Prefer `paddy gateway` so the CLI token is injected and `paddy chat` can reach `/api/cli`.

## Environment

| Variable | Provider |
|---|---|
| `XAI_API_KEY` | SuperGrok API key (or Sign in with SuperGrok in Models) |
| `OPENAI_API_KEY` | OpenAI API (fallback if you do not sign in with ChatGPT) |
| `CHATGPT_ACCESS_TOKEN` / `CHATGPT_REFRESH_TOKEN` | Optional Codex session (or sign in via Models) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `ANTHROPIC_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN` | Claude setup-token / Claude Code oauth |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Gemini (free AI Studio key is enough) |
| `POOLSIDE_API_KEY` | Laguna S / XS (free Poolside key) |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek official API (not the free chat login) |
| `OLLAMA_HOST` | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | default `llama3.2` |
| `PADDY_CLI_TOKEN` | Set automatically by `paddy gateway` |
| `PADDY_MODEL` | Preferred provider id |
| `PADDY_HOME` | Override `~/.paddy` |

Never commit keys. Never paste them into the console chat.

## What is real

- **SuperGrok / X Premium+** — Sign in with SuperGrok (device code) in Models. API key still works as a fallback. CLI uses `XAI_API_KEY`.
- **ChatGPT Plus / Pro** — Sign in with ChatGPT (device code) in Models. Enable device-code in ChatGPT → Settings → Security. CLI uses `OPENAI_API_KEY` or `CHATGPT_ACCESS_TOKEN`.
- **Claude Pro / Max** — paste a token from `claude setup-token`, or an API key. Anthropic does not allow third-party Claude.ai login. CLI uses `ANTHROPIC_TOKEN` / `ANTHROPIC_API_KEY`.
- **Gemini** — free Google AI Studio key, or a Pro/Ultra key. Google does not allow third-party Gemini CLI login.
- **Kimi / MiniMax / GLM / Qwen / Mistral / Groq / Together / Fireworks / Hugging Face** — paste the matching key in Models. Env aliases are in `selfhost.env.example`.
- **Laguna** — free Poolside models (S or XS). Get a key at platform.poolside.ai.
- **Ollama** — first-class on the machine running `paddy gateway`. The hosted preview cannot see your localhost.
- **Learning loop** — `write_memory`, `create_skill` / `patch_skill` / `skill_manage`, daily notes, HEARTBEAT.md, curator (ages + folds duplicate triggers). Skills persist in the browser workspace and in `~/.paddy/workspace.json` for the CLI.
- **Skills hub** — local catalog, not the live ClawHub/Hermes registries.
- **Workspace** — browser localStorage (`paddy-harness-v1`); CLI workspace is `~/.paddy/workspace.json`.
- **Channels** — web, CLI, and a live bridge. Connect Telegram / Discord / Slack / WhatsApp / Signal / email on Gateway, or `paddy channels add telegram --token …`. Pairing codes match OpenClaw. Env names match Hermes (`TELEGRAM_BOT_TOKEN`). `paddy channels import` reads `~/.openclaw/openclaw.json` and `~/.hermes/.env`; `--sync both` writes them back so those gateways see the same bots. WhatsApp Cloud API webhook: `/api/hooks/whatsapp`.


## OpenClaw runtime (optional, self-host)

Paddy’s GUI and **Hermes memory** (MemoryStore prefetch → ranked recall as system → curatorPass → versioned syncTurn) stay in Paddy for **both** runtimes. When you opt in, **OpenClaw** runs only the model HTTP path; Paddy still executes tools, persists memory, and runs the curator after every turn.

1. Install OpenClaw and start its gateway (default `http://127.0.0.1:18789`).
2. Enable the OpenAI-compatible chat endpoint in `~/.openclaw/openclaw.json`:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

3. Point Paddy at it (`~/.paddy/config.json` or path-keyed CLI):

```bash
paddy config set openclaw.runtime openclaw
paddy config set openclaw.url http://127.0.0.1:18789
paddy config set openclaw.token   # writes ${OPENCLAW_GATEWAY_TOKEN} into ~/.paddy/.env
paddy config set openclaw.model openclaw
```

4. Restart `paddy gateway`. Hosted/demo stays on `openclaw.runtime=paddy` + SuperGrok and never requires OpenClaw.

**Channels on the OpenClaw runtime:** OpenClaw owns the bots (`~/.openclaw/openclaw.json`). With `openclaw.runtime=openclaw`, `paddy gateway` does not start Paddy’s channel bridge (no second poller against the same bots), `paddy channels` still lists your saved config and prints “Channels are configured in ~/.openclaw/openclaw.json, Paddy's bridge is paused.”, and every `/api/hooks/*` route (including `/api/hooks/whatsapp`) answers **409** with `{"ok":false,"error":"<that message>","code":"openclaw_channels_paused","runtime":"openclaw"}`. The runtime is read when the gateway starts, so restart `paddy gateway` after switching.

**ChatGPT on OpenClaw:** operators on OpenClaw **2026.9.14** should run `openclaw update` before relying on ChatGPT-backed agents through this path. Paddy always calls chat completions with `stream: true` (required for that backend).

Probe from the Control UI / FE via `probeOpenClaw` (server fn) or `probeBrain` when runtime is `openclaw` — hits `GET /v1/models`, not a full agent turn.

## Models

Open **Models**, sign in or paste a token, **Save & prefer**, then **Test**. The live brain in the console is the preferred provider. The CLI’s preferred brain is `paddy models prefer <id>` plus env keys.

## License

MIT — see `LICENSE`.
