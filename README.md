# Paddy

Local desk for a coding agent on your computer. The interface is Paddy. [OpenCode](https://opencode.ai) does the work.

```
Browser  -- HTTP / SSE -->  local controller  -->  OpenCode
                                (localhost)         models, sessions, tools, files, shell
```

The browser never runs shell commands and never reads the filesystem. The controller is the security boundary. It talks to OpenCode's HTTP API (`opencode serve`) and forwards events. It does not scrape CLI output, and it does not reimplement the agent.

## What you can do

- Pick a local project and chat in that directory
- Watch the agent work: reading, editing, running commands
- Allow or deny permission prompts in the thread
- See changed files and diffs
- Stop a run, then retry
- Close the browser and resume the same OpenCode session later
- Set providers, models, agents, and MCP from Settings

OpenCode remains the authority for sessions, messages, models, and file changes. The desk stores only GUI metadata (project bookmarks, appearance, an optional server password) in `~/.config/opencode-web/state.json`.

## Requirements

- Node.js 22+
- npm
- OpenCode on `PATH`, or at `~/.opencode/bin/opencode`

## Install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
opencode --version
```

## Start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:8080.

`npm run dev` binds to localhost. Remote bind is opt-in and requires a token:

```bash
OPENCODE_WEB_HOST=0.0.0.0 OPENCODE_WEB_TOKEN="$(openssl rand -hex 24)" npm run dev
```

Without `OPENCODE_WEB_TOKEN`, non-loopback API calls are rejected.

## Connect

On startup the controller:

1. Looks for an OpenCode binary (`OPENCODE_BIN`, then `~/.opencode/bin/opencode`).
2. Uses `OPENCODE_URL`, or a URL saved in Settings → Connection, if set.
3. Otherwise attaches to `http://127.0.0.1:4096` when that server is already healthy.
4. Otherwise starts `opencode serve` on localhost.

If OpenCode is already running and wants a password, set it in Settings → Connection. The password stays in the controller state file (mode `0600`) and is not returned to the browser.

## Projects

Sidebar → Add project, then paste an absolute directory. The controller checks that the path exists, is a directory, and is on the allowlist before any OpenCode call uses it. Removing a project only removes it from this desk.

The active project and its git branch show in the header. They do not take over the conversation.

## Models, agents, MCP

Settings reads providers, models, agents, and MCP status from the installed OpenCode. Saving a key calls OpenCode's auth API. The key is not kept in frontend state and is redacted from diagnostics.

The header model menu lists models OpenCode reports, grouped by provider. Choosing one writes OpenCode config (`PATCH /config`). There is no separate model catalogue in this repo.

## Security

- The OpenCode child binds to `127.0.0.1`.
- API calls from non-loopback addresses require `OPENCODE_WEB_TOKEN`.
- Cross-origin browser requests are rejected.
- Workspace paths must be absolute directories on the project allowlist.
- API keys and the OpenCode server password are not logged and are stripped from responses.
- Permission prompts are shown in the thread. Nothing dangerous is auto-approved.
- There is no cloud backend.

## Development

```bash
npm install
npm run dev       # desk + controller at http://127.0.0.1:8080
npm run build
npm run preview
npm run test
npm run typecheck
```

`OPENCODE_WEB_HOME` overrides the state directory. `OPENCODE_BIN` points at a specific binary. `OPENCODE_URL` points at an already-running server.

Tests mock OpenCode. A real API key is not required. They cover connection, sessions, prompts, config updates, event frames, invalid workspaces, unauthorized remote access, secret redaction, and malformed JSON.

## Layout

| Piece | Role |
|---|---|
| `src/components/desk` | Chat, sidebar, settings — existing Paddy visual language |
| `src/server/opencode-client.ts` | OpenCode HTTP client, matched to `opencode serve` |
| `src/server/runtime.ts` | Detect, start, reconnect, event fan-out |
| `src/server/api.ts` | Browser API. Validates projects and redacts secrets |
| `src/server/state.ts` | GUI metadata only |
