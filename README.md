# Claude Code Progress Plugin

A CloudCLI tab plugin that automatically extracts and visualizes progress from Claude Code CLI session logs.

## Features

- **Real-time sync**: Watches the active Claude Code session `.jsonl` log and updates progress as new messages arrive.
- **LLM-powered extraction**: Uses Claude API to turn conversation segments into structured goals and steps.
- **Tab UI**: Renders as a CloudCLI tab page with a clean dark/light theme.
- **WebSocket live updates**: Pushes progress and status changes to the UI without polling.
- **Snapshot persistence**: Optionally persists progress snapshots per session for fast reloads.

## Installation

1. Ensure you have [CloudCLI](https://cloudcli.ai) installed.
2. Clone or copy this plugin into your CloudCLI plugins directory:
   ```bash
   git clone <repo> ~/.cloudcli/plugins/progress-plugin
   cd ~/.cloudcli/plugins/progress-plugin
   npm install
   npm run build
   ```
3. Restart CloudCLI or reload plugins. A **Progress** tab should appear in the session view.

## Configuration

The plugin reads configuration in the following priority order:

1. **`~/.claude/settings.json`** under `env.PROGRESS_MODEL` and `env.ANTHROPIC_API_KEY`.
2. **Environment variables**: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `PROGRESS_MODEL`.
3. **Plugin configuration panel** (if supported by CloudCLI).

Example `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "PROGRESS_MODEL": "claude-3-5-sonnet-20241022"
  }
}
```

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key.
- `PROGRESS_MODEL` (optional): Claude model for extraction. Defaults to `claude-3-5-sonnet-20241022`.
- `ANTHROPIC_BASE_URL` (optional): Custom API base URL.

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

1. Open CloudCLI and start a coding session.
2. Click the **Progress** tab.
3. The plugin automatically watches the current session log and displays:
   - **Goals**: High-level objectives inferred from the conversation.
   - **Steps**: Concrete actions taken toward each goal.
   - **Status**: Pending, in progress, completed, or deleted.
4. Click a goal to expand or collapse its steps.
5. Click **Refresh** to force a re-extraction.

## Architecture

```text
+-----------+     +--------+     +-------------+     +-------+
| jsonl log | --> | Watcher | --> | Buffer      | --> | Diff  |
+-----------+     +--------+     +-------------+     | Detector|
                                                     +---+---+
                                                         |
                                                         v
+-------+     +--------+     +------+              +-------------+
|  UI   | <-- | Server | <-- | Store | <-- | Extractor (LLM) |
+-------+     +--------+     +------+              +-------------+
```

- **Watcher**: Incrementally reads the session `.jsonl` file using `fs.watch` / `fs.watchFile` fallback.
- **Buffer**: Aggregates recent log entries into `ConversationSegment`s grouped by prompt.
- **Diff Detector**: Triggers extraction when assistant thinking, tool use, or stop reason appears.
- **LLM Extractor**: Calls Claude API with the current progress tree and latest segments.
- **Store**: Holds current progress and optionally persists snapshots.
- **Server**: HTTP + WebSocket backend exposed by CloudCLI.
- **UI**: Vanilla DOM tab page styled to match CloudCLI.

## Troubleshooting

- **No progress shown**: Verify `ANTHROPIC_API_KEY` is set and the session log exists.
- **Sync errors**: Check the CloudCLI server logs; API keys are redacted in error messages.
- **WebSocket not updating**: Ensure the plugin server started and printed `{"ready": true, "port": ...}`.

## License

MIT
