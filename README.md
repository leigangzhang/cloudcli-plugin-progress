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
- **LLM-powered extraction** — Calls the configured LLM to turn conversation turns into a structured progress tree. Output follows the dominant user language and has no character limits on subjects or descriptions.
- **Snapshot persistence** — After every extraction the progress tree is saved to `~/.claude-code-ui/plugins/progress-plugin/.snapshots/<sessionId>.json`. CloudCLI / plugin restarts load the snapshot first and continue incrementally.
- **Large-session polling** — Enable with `PROGRESS_USE_POLLING=true`. Long sessions are processed in 5-turn chunks; each intermediate result is pushed to the UI immediately via WebSocket.
- **Large-session fallback** — If the model returns empty or malformed JSON, the plugin truncates each turn and retries with only the last 5 turns.
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
| `ANTHROPIC_API_KEY` | Yes | LLM API key. Also accepts `ANTHROPIC_AUTH_TOKEN` or `API_KEY`. |
| `ANTHROPIC_BASE_URL` | No | Custom API base URL. Also accepts `BASE_URL`. |
| `PROGRESS_MODEL` / `ANTHROPIC_MODEL` / `MODEL` | No | Extraction model. Defaults to `claude-3-5-sonnet-20241022`. |
| `MAX_TOKENS` / `PROGRESS_MAX_TOKENS` / `ANTHROPIC_MAX_TOKENS` | No | Max output tokens per extraction. Defaults to `4096`. |
| `TIMEOUT_MS` / `PROGRESS_TIMEOUT_MS` / `ANTHROPIC_TIMEOUT_MS` | No | LLM request timeout in milliseconds. Defaults to `60000`. |
| `PROGRESS_USE_POLLING` | No | Enable polling extraction for large sessions. Defaults to `false`. |
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
3. The plugin watches the current session log and shows:
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
- **LLM Extractor**: sends the current progress tree and recent turns to the LLM, returning an updated tree.
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
| `POST` | `/refresh` | Force re-extraction. Body: `{ sessionId }`. With polling enabled, intermediate progress is broadcast via WebSocket. |
| `GET` | `/turn?sessionId=...&promptId=...` | Return the full conversation turn for the given `promptId`. |
| `GET` | `/debug?sessionId=...` | Return debug info: project path, log path, model, buffer size, status, error, etc. |

## WebSocket

- Path: `/ws`
- Subscribe message: `{ "type": "subscribe", "projectPath": "...", "sessionId": "..." }`
- Server pushes:
  - `{ "type": "progress", "tree": { ... } }`
  - `{ "type": "status", "status": "idle|syncing|error|paused", "error": "..." }`

## Large-session polling mode

Set `PROGRESS_USE_POLLING=true` to handle long sessions without exceeding the model context window.

How it works:

1. The full conversation is split into 5-turn chunks.
2. Each chunk is extracted sequentially, using the result of the previous chunk as the current tree.
3. After every chunk the intermediate tree is saved to the store and broadcast to the UI via WebSocket, so you see progress appear gradually instead of waiting for the whole session.
4. Each chunk also uses the same retry logic as normal mode: if the model returns empty or malformed JSON, it retries with a stricter prompt.
5. If the accumulated tree makes a later chunk fail, that chunk is retried with an empty tree as a last resort.

Recommended for sessions larger than a few dozen turns or when the default mode returns JSON errors.

## Troubleshooting

- **No progress shown**:
  - Verify `ANTHROPIC_API_KEY` is configured.
  - Verify the session log exists. Check the path via `/debug?sessionId=...`.
  - Check the CloudCLI Network tab to confirm the WebSocket `/ws` connection is open and the `subscribe` message was sent.
- **Sync errors**:
  - The UI displays the error message. Use `/debug` for details; API keys are redacted in logs.
- **Large-session extraction fails**:
  - Default mode: the plugin automatically truncates turns and retries with the last 5 turns.
  - Enable polling: set `PROGRESS_USE_POLLING=true` to process 5-turn chunks sequentially.
  - Increase `MAX_TOKENS` to give the model more room for the JSON response.
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

The `context.mode` field distinguishes automatic triggers (`incremental`) from manual `/refresh` requests (`full`). Codex currently always reports `parseScope: "full_file"` because `buildCodexTurnsFromLog` rereads the complete rollout for every extraction. Prompts contain conversation text, so enable this only while debugging and monitor the log file size.

## License

MIT
