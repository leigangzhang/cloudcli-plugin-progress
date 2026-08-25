# Claude Code Progress Plugin

A CloudCLI tab plugin that automatically extracts and visualizes progress from Claude Code CLI session logs.

## Features

- **Multi-session isolation** — Each provider session gets its own watcher, buffer, detector, and state. Switching sessions never mixes progress.
- **Claude Code and Codex session support** — CloudCLI session mappings are detected automatically. Claude Code logs are read from `~/.claude/projects/<project-encoding>/<sessionId>.jsonl`, while Codex logs are read from the mapped `~/.codex/sessions/.../rollout-*.jsonl`.
- **Goal → Turn tree** —
  - **Goal**: a high-level topic or objective from the conversation.
  - **Step**: one conversation turn. Click a step to expand the original user question, model reasoning, and assistant reply.
- **Local conversation records** — Step details are read from the local `.jsonl` file and rendered as Markdown. No raw conversation text is returned by the LLM.
- **Real-time sync** — Incrementally watches the session `.jsonl` via `fs.watch` and triggers extraction as new messages arrive.
- **Default query extraction** — Default mode extracts user queries locally without calling an LLM and displays them as a flat, numbered list instead of wrapping them under a goal.
- **ProgressTree extraction** — Optional LLM mode uses a compact tree digest plus user text and a short assistant summary to update only affected nodes through a local patch merge.
- **Snapshot persistence** — ProgressTree mode saves the LLM-generated tree to `~/.claude-code-ui/plugins/cloudcli-plugin-progress/.snapshots/<sessionId>.json`. Default mode reconstructs user queries directly from the conversation and does not write snapshots.
- **Five-turn polling** — ProgressTree sessions are processed in 5-turn chunks. Incremental triggers only send turns that do not yet have a progress step.
- **Codex rollout parsing** — Codex turns are grouped by `turn_id`, including user messages, summarized reasoning, assistant output, and tool calls. V1 tracks the mapped root thread; spawned subagent rollouts are not merged automatically.
- **WebSocket live updates** — Progress and status changes are pushed to the UI without polling.
- **Dark / light theme** — Adapts to the CloudCLI theme automatically.

## Installation

1. Make sure [CloudCLI](https://cloudcli.ai) is installed.
2. Clone the plugin into your CloudCLI plugins directory:
   ```bash
   git clone git@github.com:leigangzhang/cloudcli-plugin-progress.git ~/.cloudcli/plugins/progress-plugin
   cd ~/.cloudcli/plugins/progress-plugin
   npm install
   npm run build
   ```
3. Restart CloudCLI or reload plugins. A **Progress** tab appears in the session view.

## Configuration

Configuration is read in the following priority order:

1. **Project `.env`**: `<project-path>/.env`
2. **Plugin `.env`**: `.env` inside the plugin install directory
3. **`~/.claude/settings.json`** `env` block
4. **Environment variables**
5. **CloudCLI `X-Plugin-Secret-*` headers**

### Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | ProgressTree only | LLM API key. Also accepts `ANTHROPIC_AUTH_TOKEN` or `API_KEY`. |
| `ANTHROPIC_BASE_URL` | No | Custom API base URL. Also accepts `BASE_URL`. |
| `PROGRESS_MODEL` / `ANTHROPIC_MODEL` / `MODEL` | No | Extraction model. Defaults to `claude-3-5-sonnet-20241022`. |
| `MAX_TOKENS` / `PROGRESS_MAX_TOKENS` / `ANTHROPIC_MAX_TOKENS` | No | Max output tokens per extraction. Defaults to and is capped at `8192`. |
| `TIMEOUT_MS` / `PROGRESS_TIMEOUT_MS` / `ANTHROPIC_TIMEOUT_MS` | No | LLM request timeout in milliseconds. Defaults to `60000`. |
| `PROGRESS_USE_POLLING` | No | Deprecated compatibility flag. All extractions now use 5-turn chunks. |
| `PROGRESS_EXTRACTION_MODE` | No | `default` or `progress-tree`. Defaults to `default`. |
| `PROGRESS_TRACE_EXTRACTIONS` | No | Log full Codex conversation text, final prompts, and token usage as JSON lines. Defaults to `false`. |
| `PROGRESS_TRACE_LOG_DIR` | No | Trace log directory. Defaults to `~/.claude-code-ui/plugins/cloudcli-plugin-progress`. |
| `PROGRESS_TRACE_LOG_FILE` | No | Trace log filename. Defaults to `progress-plugin.log`. |

### Example plugin `.env`

```bash
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-flash
MAX_TOKENS=8192
TIMEOUT_MS=120000
PROGRESS_USE_POLLING=true
PROGRESS_EXTRACTION_MODE=progress-tree
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build for production
npm run build

# Watch mode
npm run dev
```

## Usage

1. Open CloudCLI and start a session.
2. Click the **Progress** tab.
3. Default mode shows locally extracted user queries without requiring an API key.
4. Use the radio controls in the top-left to switch between **Default** and **ProgressTree**.
5. The plugin watches the current session log and shows:
   - **Goals**: topics or objectives inferred from the conversation.
   - **Steps**: one step per conversation turn. The step subject is a one-sentence summary of that turn.
4. Click a Goal header to expand or collapse its steps.
5. Click a Step subject to expand the conversation record for that turn:
   - User question
   - Model reasoning and tool results (collapsible)
   - Assistant reply
6. Click **Refresh** to force a full re-extraction from the `.jsonl` log.

While a refresh is running the Refresh button is disabled and shows **Refreshing...** with a spinning icon, preventing accidental duplicate refreshes.

## Architecture

```text
+-----------+     +---------+     +---------------+     +-------------+
| jsonl log | --> | Watcher | --> | Buffer        | --> | TurnBuilder |
+-----------+     +---------+     +---------------+     +-----+-------+
                                                               |
                                                               v
+-------+     +--------+     +-------+     +-------------+     +-----------+
|  UI   | <-- | Server | <-- | Store | <-- | Extractor   | <-- | Diff      |
+-------+     +--------+     +-------+     | (LLM)       |     | Detector  |
                                          +-------------+     +-----------+
```

- **Watcher**: incrementally reads `~/.claude/projects/<encoding>/<sessionId>.jsonl`, supporting append and file replacement.
- **Buffer**: aggregates recent log entries.
- **TurnBuilder**: groups log entries by `promptId` into complete user-question → assistant-reply turns.
- **Diff Detector**: triggers extraction when assistant thinking, tool use, or stop reason entries appear.
- **Rule Extractor**: locally converts pending user queries into progress steps.
- **LLM Extractor**: sends a compact tree digest and affected turns, then merges the returned node patch locally.
- **Store**: holds current progress and persists a snapshot after every update.
- **Server**: HTTP + WebSocket backend; all state is isolated by `sessionId`.
- **UI**: vanilla DOM tab page with Markdown rendering for turn records.

## HTTP API

The plugin listens on a random local port; CloudCLI proxies `/api/plugins/progress-plugin/rpc/*` to it.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check. Returns `{ status, model }`. |
| `POST` | `/watch` | Start or reuse a session watcher. Body: `{ projectPath, sessionId }`. |
| `GET` | `/progress?sessionId=...` | Return the current `ProgressTree` for the session. |
| `POST` | `/mode` | Set the active extraction mode. Body: `{ sessionId, mode: "default" | "progress-tree" }`. |
| `POST` | `/refresh` | Force re-extraction. Body: `{ sessionId }`. With polling enabled, intermediate progress is broadcast via WebSocket. |
| `GET` | `/turn?sessionId=...&promptId=...` | Return the full conversation turn for the given `promptId`. |
| `GET` | `/debug?sessionId=...` | Return debug info: project path, log path, model, buffer size, status, error, etc. |

## WebSocket

- Path: `/ws`
- Subscribe message: `{ "type": "subscribe", "projectPath": "...", "sessionId": "..." }`
- Server pushes:
  - `{ "type": "progress", "tree": { ... } }`
  - `{ "type": "status", "status": "idle|syncing|error|paused", "error": "..." }`

## Five-turn polling mode

ProgressTree extraction works in 5-turn chunks:

1. Incremental extraction filters out turns whose `promptId` already exists in the current progress tree.
2. Remaining turns are split into 5-turn chunks and sent one request per chunk.
3. Each response is a patch containing only affected goals and steps.
4. The server merges patches locally, preserving omitted nodes and applying explicit deletions.
5. Intermediate trees are saved and broadcast to the UI via WebSocket.

Manual `/refresh` restarts from the first conversation turn using the active mode.

Mode switching preserves ProgressTree snapshots. Switching from Default to ProgressTree loads the saved LLM tree and processes only turns missing from it. Switching back to Default saves the current ProgressTree snapshot first, then reconstructs the flat user-query view from the conversation log.

## Troubleshooting

- **No progress shown**:
  - Default mode does not require an API key.
  - Verify `ANTHROPIC_API_KEY` is configured when using ProgressTree mode.
  - Verify the session log exists. Check the path via `/debug?sessionId=...`.
  - Check the CloudCLI Network tab to confirm the WebSocket `/ws` connection is open and the `subscribe` message was sent.
- **Sync errors**:
  - The UI displays the error message. Use `/debug` for details; API keys are redacted in logs.
- **Large-session extraction fails**:
  - Extraction now processes pending turns in 5-turn chunks and does not retry automatically.
  - Set `MAX_TOKENS` up to the `8192` cap to give the model more room for the JSON response.
- **WebSocket not updating**:
  - Ensure the plugin server logged `{ "ready": true, "port": ... }` and the `subscribe` message contains the correct `sessionId`.

### Codex sessions

CloudCLI stores provider metadata in `~/.cloudcli/auth.db`. When the current session has `provider = "codex"`, the plugin follows its `jsonl_path` to the local Codex rollout under `~/.codex/sessions`. `/debug` reports the detected provider and log path.

If Codex history persistence is disabled or the rollout was archived without updating the CloudCLI mapping, the plugin falls back to the Codex state database and archived session directory.

### Codex extraction tracing

Set `PROGRESS_TRACE_EXTRACTIONS=1` to write one JSON object per event to:

```text
~/.claude-code-ui/plugins/cloudcli-plugin-progress/progress-plugin.log
```

The log directory is created automatically. Each extraction emits:

- `conversation`: the normalized Codex turns before LLM filtering, including `thinkingText` and `toolText`.
- `prompt`: the exact prompt sent for each LLM attempt or polling chunk.
- `usage`: actual `inputTokens`, `outputTokens`, and cache token fields returned by the API.
- `response`: complete raw model output, response content block types, output characters, parsed JSON characters, and output tokens.

Extraction error events are written to the log even when full trace logging is disabled.

The `context.mode` field distinguishes automatic triggers (`incremental`) from manual `/refresh` requests (`full`). Codex currently always reports `parseScope: "full_file"` because `buildCodexTurnsFromLog` rereads the complete rollout for every extraction. Prompts contain conversation text, so enable this only while debugging and monitor the log file size.

Trace settings are read from the plugin `.env` through the normal configuration chain, with the process environment as a fallback. CloudCLI does not need to inject these variables into the backend process.

## License

MIT
