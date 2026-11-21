# OpenCode v2 API Migration Spec

Paddy's controller (`src/server/opencode-client.ts`, `src/server/normalize.ts`) targets the
OpenCode **v1** HTTP API. The installed server is **v2.3.2**, which broke every contract.
This spec is the complete v2 contract, captured from the live server (`http://127.0.0.1:4096`)
and its `/openapi.json`.

## Goal
Make Paddy work against OpenCode v2. **Keep the internal GUI contracts stable**
(`GuiEvent`, `ChatMessage`, `SessionSummary`, `ActivityItem`, `DiffFile`, `PermissionPrompt`
in `normalize.ts`, and the browser types in `src/lib/desk/client.ts`). Confine v2 changes to
`opencode-client.ts` + `normalize.ts` + minimal `api.ts` threading. The UI (`app.tsx`,
`settings.tsx`) should NOT need changes.

## Global changes
- **All paths get an `/api` prefix.** Base URL stays `http://127.0.0.1:4096`.
- **Project scoping query param: `directory` → `location`** (value = absolute project path).
- **List/detail responses are wrapped:** `{ "data": ... }` or `{ "data": [ ... ] }`. Unwrap `.data`.
- Auth unchanged: HTTP Basic `opencode:<password>`.
- `request()` already returns parsed JSON or `{message}` on non-JSON; keep, but unwrap `data`.

## Endpoint map (v1 → v2)
| Client method | v2 | Notes |
|---|---|---|
| getStatus | `GET /api/info` | returns `ServerInfo {version, pid, urls, paths}`. Map to `{healthy:true, version}`. |
| listSessions(dir, search) | `GET /api/session?location=<dir>&search=<s>` | returns `{data:[Session.Info], cursor}` → return `.data` |
| createSession(dir, title) | `POST /api/session` body `{title, location:{directory:<dir>}}` | returns `{data:Session.Info}` → `.data` |
| getSession(dir, id) | `GET /api/session/{id}` | returns `{data:Session.Info}` (verify; unwrap if wrapped) |
| updateSession(dir,id,{title}) | `PATCH /api/session/{id}` body `{title}` | 204 |
| deleteSession(dir,id) | `DELETE /api/session/{id}` | 204 |
| sendMessage(dir,id,{text,model,agent}) | `POST /api/session/{id}/prompt` body `{text}` | If model given: first `POST /api/session/{id}/model` body `{model:{id,providerID,variant?}}`. If agent given: `POST /api/session/{id}/agent` body `{agent}`. Then prompt. Returns `{data:userMessage}`. |
| abortSession(dir,id) | `POST /api/session/{id}/interrupt` | returns `{interrupted:bool}` |
| listMessages(dir,id) | `GET /api/session/{id}/message` | returns `{data:[Session.Message.Info], cursor}` → `.data` |
| deleteMessage(dir,id,mid) | `DELETE /api/session/{id}/message/{mid}` | |
| getDiff(dir,id) | `GET /api/session/{id}/diff` | shape TBD; return raw, normalize defensively |
| getConfig(dir) | `GET /api/config?location=<dir>` | returns array of `{type:"document", info:{...}}` docs. Adapt: find the doc with `info.model` or merge. The desk only needs `{model}`. Return `{model: <string>}` derived from config docs, or `{}`. |
| updateConfig(patch,dir) | `PATCH /api/config?location=<dir>` body patch | |
| getProviders(dir) | `GET /api/provider?location=<dir>` | |
| getProviderAuth(dir) | `GET /api/credential` | (v1 `/provider/auth` gone) |
| setApiKey(providerId,key) | `POST /api/credential` body `{providerID, key}` (verify field names) | |
| removeApiKey(providerId) | `DELETE /api/credential/{id}` | |
| getAgents(dir) | `GET /api/agent?location=<dir>` | |
| getMcp(dir) | `GET /api/mcp?location=<dir>` | |
| addMcp(dir,name,config) | `POST /api/mcp` | |
| connectMcp(dir,name) | `POST /api/experimental/mcp/{name}/connect` | |
| disconnectMcp(dir,name) | `POST /api/experimental/mcp/{name}/disconnect` | |
| listPermissions(dir) | `GET /api/permission/request?location=<dir>` | returns array of Permission.Request |
| replyPermission | `POST /api/session/{sessionID}/permission/{requestID}/reply` body `{decision:"once"|"always"|"reject"}` | **needs sessionID** — see api.ts changes |
| listQuestions(dir) | `GET /api/form?location=<dir>` | returns array of Form.Info |
| replyQuestion | `POST /api/session/{sessionID}/form/{formID}/reply` body `{answer:{<fieldId>:<value>}}` | needs sessionID |
| rejectQuestion | `POST /api/session/{sessionID}/form/{formID}/reply` with cancel, or DELETE — verify; fallback: reply with empty/cancel | |
| getVcs(dir) | `GET /api/vcs?location=<dir>` | |
| getFileStatus(dir) | `GET /api/vcs/status?location=<dir>` | |
| subscribeToEvents | `GET /api/event` (SSE) | |

## v2 data shapes

### ServerInfo (GET /api/info)
`{ version:string, pid:number, hostname?:string|null, urls:string[], paths:{tmp:string}, capabilities?:{persistentPty?:bool|null}|null }`

### Session.Info
`{ id, parentID?, projectID, agent?, model?:{id,providerID,variant?}, cost, tokens, time:{created,updated,archived?}, title?, subpath?, location?:{directory}, ... }`
- `summarizeSession`: id, title (|| "New chat"), directory = `location?.directory`, created/updated from `time`, archived = `Boolean(time?.archived)`. additions/deletions/files: v2 has no `summary` — set 0 (or derive from diff if available).

### Session.Message.Info (union by `type`)
- **user**: `{ id, type:"user", time:{created}, text:string, files?, agents?, skills? }`
- **assistant**: `{ id, type:"assistant", time:{created,...}, agent?, model?, content:[Part], finish?, error?:{type,message}, cost, tokens }`
- **idle**: `{ id, type:"idle" }` → ignore (no chat bubble) or system
- **model-switched / agent-selected / location-switched / synthetic / system / skill / shell / compaction**: minor; map to system or ignore.

**Part (inside assistant `content[]`):**
- text: `{ type:"text", text:string }`
- reasoning: `{ type:"reasoning", text:string, native?, time? }` → treat like text? Currently v1 ignored reasoning. Keep ignoring for `text` (or append). Decide: ignore reasoning in main text (matches v1 behavior of filtering).
- tool: `{ type:"tool", id, name, executed:bool, state:{ status:"pending"|"running"|"completed"|"error", input:object, content:[{type:"text",text}], metadata?:object, error?:string, title?:string }, time? }`

**toChatMessage(v2 message) → ChatMessage:**
- role: user→"user", assistant→"assistant", system→"system", else "assistant"
- text: for user, `message.text`; for assistant, join `content[].text` where type==="text" (skip reasoning, skip `<`-prefixed).
- activity: for assistant, `content[].filter(type==="tool").map(toActivity)`
- error: assistant `error?.message`
- created: `time?.created`
- **toActivity(toolPart)**: id = part.id, tool = part.name, status = part.state.status, title = toolTitle(name, state.title, state.input), detail = state.error || clip(join of state.content[].text).

### Events — `GET /api/event` SSE
Envelope: `{ id, created?, metadata?, type:string, location?:{directory}, data:object, durable?:{aggregateID,seq,version} }`
**The payload is in `data` (NOT `properties`).** `normalizeEvent` must read `event.data`.

Key events (data shapes captured live):
- `server.connected`: `{}` → ignore (or status healthy)
- `session.execution.started`: `{sessionID}` → status working
- `session.execution.succeeded`: `{sessionID}` → status idle
- `session.execution.failed`: `{sessionID, error:{type,message,status?}}` → status error + error message
- `session.execution.interrupted`: `{sessionID}` → status idle
- `session.idle`: `{sessionID}` → status idle
- `session.text.started`: `{sessionID, assistantMessageID, ordinal}` → ignore (or prime message)
- `session.text.delta`: `{sessionID, assistantMessageID, ordinal, delta}` → **text-delta** {sessionId, messageId:assistantMessageID, delta}
- `session.text.ended`: `{sessionID, assistantMessageID, ordinal, text}` → message {id:assistantMessageID, role:assistant, text, ...}
- `session.reasoning.delta`: `{sessionID, assistantMessageID, delta}` → ignore (or text-delta; v1 ignored reasoning) — ignore
- `session.tool.input.started`: `{sessionID, assistantMessageID, id, name}` → activity {id, tool:name, status:"running", title:toolTitle(name)}
- `session.tool.called`: `{sessionID, assistantMessageID, id, input, executed}` → activity {id, tool:?, status:"running", ...} (name may be absent here; use input.started's name — track by id, or just emit activity with tool from a prior map; simplest: emit activity {id, status:"running", title:"Working"} and rely on tool.success for final)
- `session.tool.progress`: `{sessionID, assistantMessageID, id, metadata}` → ignore or activity update
- `session.tool.success`: `{sessionID, assistantMessageID, id, content:[{type,text}], metadata:{status,...}}` → activity {id, status:"completed", detail: join content text}
- `session.tool.failed`: `{sessionID, assistantMessageID, id, ...error}` → activity {id, status:"error"}
- `session.step.started`: `{sessionID, agent, model, assistantMessageID, snapshot, started}` → ignore (or status working)
- `session.step.ended`: `{sessionID, assistantMessageID, finish, tokens, cost, files}` → ignore
- `session.usage.updated`: `{sessionID, cost, tokens}` → ignore
- `session.created`: `{sessionID, slug, version, projectID, location:{directory}, subpath, title, ...}` → **session** event. Build SessionSummary from this (id=sessionID, title, directory=location.directory, created/updated=now, archived=false).
- `session.renamed`: `{sessionID, title}` → session update (need existing summary; emit a partial session event with id+title — the UI's upsertSession merges by id, but title-only would lose other fields. Better: emit `session` with a SessionSummary built from minimal info; UI upsert replaces. Acceptable, or fetch. Keep simple: emit session with id+title+created/updated=now.)
- `session.deleted`: `{sessionID}` → session-deleted {id:sessionID}
- `session.archived` / `session.unarchived`: `{sessionID, ...}` → session update
- `permission.asked`: `data` = Permission.Request `{id, sessionID, action, resources:[], save:[], metadata:{}, source, message}` → **permission** prompt {id, sessionId, kind:"permission", title: action||"Permission", detail: message || JSON(metadata)}
- `permission.replied`: `{id?, requestID?, sessionID}` → permission-cleared {id}
- `form.created`: `data` = Form.Info `{id, sessionID, title, metadata, fields:[...]}` → **permission** prompt {id, sessionId, kind:"question", title, detail: first field question/label}
- `form.replied` / `form.cancelled`: `{id?, formID?, sessionID}` → permission-cleared {id}
- `filesystem.changed`, `vcs.branch.updated`, `mcp.status.changed`, etc.: ignore (return null)
- `session.diff` does NOT exist in v2; diff comes from `GET /api/session/{id}/diff`. The `session.step.ended` has `files:[]`. For the diff panel, the UI calls getDiff explicitly. No diff event needed (return null for unknown).

**normalizeEvent rewrite:** read `event.data` (call it `d`). Switch on `event.type` using the v2 names above. Return the existing GuiEvent union. Unknown → null.

### Permission.Request
`{ id, sessionID, action:string, resources:any[], save:any[], metadata:object, source, message:string }`

### Form.Info
`{ id, sessionID, title:string, metadata, fields: Form.Field[] }` where a field has `{id, type, label?, question?, options?...}`. For the prompt detail, use `title` and the first field's label/question.

## api.ts changes (minimal)
- `replyPermission(runtime, request, requestId)`: v2 needs sessionID in the path. The browser must send sessionID. Update the route to read sessionID from the request body (the client already knows the prompt's sessionId — `PermissionPrompt.sessionId`). Change `client.replyPermission(directory, requestId, response)` → `client.replyPermission(directory, sessionId, requestId, response)`.
- Same for `replyQuestion`/`rejectQuestion`: add sessionId.
- `src/lib/desk/client.ts`: `replyPermission`/`replyQuestion`/`rejectQuestion` must include `sessionId` in the POST body. The UI (`app.tsx`) already has `prompt.sessionId` — pass it.
- Check `api.ts` permission/question reply handlers and `client.ts` signatures; thread `sessionId` through.

## Tests to update (mocks use v1 shapes)
- `src/server/opencode-client.test.ts`: update mocked fetch paths (`/api/...`), response wrappers (`{data:...}`), and assertions.
- `src/server/normalize.test.ts`: rewrite fixtures to v2 message/event shapes.
- `src/server/api.test.ts`: the fake `runtime.client` object must match the new method signatures (replyPermission/replyQuestion take sessionId). Update calls.
- `src/server/runtime.test.ts`: getStatus now hits `/api/info`; update fake client/probe expectations.
- `src/server/http.test.ts`, `state.test.ts`: likely unaffected (auth/state), but verify.
- `src/components/desk/messages.test.ts`: tests the pure reducers (appendDelta/mergeMessage) — unaffected by API change; verify.

## Verification
- `npx tsc --noEmit` clean.
- `npm test` green.
- `npm run lint` 0 errors.
- Live: with the dev server running and OpenCode v2 on :4096, `GET /api/status` → connected:true; the desk loads sessions; sending a message streams text and tool activity; stop/interrupt works.

## Live server facts (for manual verification)
- OpenCode v2.3.2 on `127.0.0.1:4096`, Basic auth `opencode:<password>` where password = `ownedServerPassword` in `~/.paddy/state.json`.
- A working model: `{id:"deepseek-v4.1-flash", providerID:"opencode-go"}` (the `google`/`opencode` providers are quota/billing-limited).
- `/openapi.json` is served (auth) — full contract reference.
