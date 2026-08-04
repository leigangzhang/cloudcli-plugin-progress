# Claude Code Progress Plugin

CloudCLI 标签页插件，自动从 Claude Code CLI 会话日志中提取并可视化会话进度。

## 功能

- **多会话隔离**：每个 Claude Code 会话拥有独立的 watcher、buffer、提取器和状态，切换会话时不会错位。
- **Claude Code 会话映射**：CloudCLI 传入的 sessionId 会自动映射到真实的 Claude Code CLI 会话 ID，日志路径从 `~/.claude/projects/<项目编码>/<sessionId>.jsonl` 读取。
- **主题 → 会话轮次 两层树**：
  - **Goal（主题/目标）**：会话中讨论的高层级主题。
  - **Step（会话轮次）**：每个 Step 对应一轮完整对话，点击 Step 可展开查看该轮的用户提问、模型推理与模型回复。
- **本地加载会话记录**：点击 Step 后从本地 `.jsonl` 实时读取对应轮次，Markdown 渲染后展示，不依赖 LLM 返回原文。
- **实时同步**：通过 `fs.watch` 增量读取会话日志，新消息到达后自动触发提取并推送到 UI。
- **LLM 智能提取**：调用 LLM 将对话轮次转换为结构化的 ProgressTree，自动跟随用户主要语言，不限制 subject/description 长度。
- **大会话降级**：当单轮文本过长导致模型无法返回 JSON 时，自动截断每轮文本并降级到最近 5 轮重试。
- **快照持久化**：每次提取完成后自动保存快照，CloudCLI/插件重启后优先加载已有进度并继续增量更新。
- **WebSocket 实时推送**：Progress 和状态变化通过 WebSocket 推送到 UI，无需轮询。
- **深浅色主题**：自动适配 CloudCLI 主题。

## 安装

1. 确保已安装 [CloudCLI](https://cloudcli.ai)。
2. 将插件克隆到 CloudCLI 插件目录：
   ```bash
   git clone git@github.com:leigangzhang/cloudcli-plugin-progress.git ~/.cloudcli/plugins/progress-plugin
   cd ~/.cloudcli/plugins/progress-plugin
   npm install
   npm run build
   ```
3. 重启 CloudCLI 或重载插件。会话视图中会出现 **Progress** 标签页。

## 配置

插件按以下优先级读取配置（从高到低）：

1. **项目目录 `.env`**：`/Users/ray/Workspace/<project>/.env`
2. **插件目录 `.env`**：插件安装目录下的 `.env`
3. **`~/.claude/settings.json`** 中的 `env` 块
4. **环境变量**
5. **CloudCLI 传入的 `X-Plugin-Secret-*` 请求头**

### 配置项

| 变量 | 是否必填 | 说明 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 必填 | LLM API Key，也支持 `ANTHROPIC_AUTH_TOKEN` 或 `API_KEY` |
| `ANTHROPIC_BASE_URL` | 可选 | 自定义 API 基础地址，也支持 `BASE_URL` |
| `PROGRESS_MODEL` / `ANTHROPIC_MODEL` / `MODEL` | 可选 | 提取模型，默认 `claude-3-5-sonnet-20241022` |
| `MAX_TOKENS` / `PROGRESS_MAX_TOKENS` / `ANTHROPIC_MAX_TOKENS` | 可选 | 每次提取的最大输出 token，默认 `4096` |
| `TIMEOUT_MS` / `PROGRESS_TIMEOUT_MS` / `ANTHROPIC_TIMEOUT_MS` | 可选 | LLM 请求超时（毫秒），默认 `60000` |

### 插件目录 `.env` 示例

```bash
ANTHROPIC_API_KEY=sk-...
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_MODEL=deepseek-v4-flash
MAX_TOKENS=8192
TIMEOUT_MS=120000
```

## 开发

```bash
# 安装依赖
npm install

# 运行测试
npm test

# 构建生产版本
npm run build

# 监听模式
npm run dev
```

## 使用

1. 打开 CloudCLI 并启动一个会话。
2. 点击 **Progress** 标签页。
3. 插件会自动监听当前会话日志并展示：
   - **Goals**：从会话中识别出的主题或目标。
   - **Steps**：每个主题下的会话轮次，Step 的 subject 是对该轮对话的一句话总结。
4. 点击 Goal 头部可展开/折叠其下的 Steps。
5. 点击 Step 的 subject 可在下方展开该轮完整对话记录，包括：
   - 用户提问
   - 模型推理与工具结果（可折叠）
   - 模型回复
6. 点击 **Refresh** 可强制从完整 `.jsonl` 重新提取进度。

## 架构

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

- **Watcher**：增量读取 `~/.claude/projects/<编码>/<sessionId>.jsonl`，支持文件追加和替换。
- **Buffer**：聚合最近读取的日志条目。
- **TurnBuilder**：按 `promptId` 将日志条目分组为完整的“用户提问 → 模型回复”轮次。
- **Diff Detector**：当出现 assistant thinking、tool use、stop reason 等关键事件时触发提取。
- **LLM Extractor**：将当前 ProgressTree 和最近轮次发送给 LLM，返回更新后的树。
- **Store**：维护当前进度，并在每次更新后保存快照到 `~/.claude-code-ui/plugins/progress-plugin/.snapshots/<sessionId>.json`。
- **Server**：HTTP + WebSocket 后端，按 `sessionId` 隔离所有状态。
- **UI**：原生 DOM 标签页，Markdown 渲染会话记录。

## HTTP API

插件启动后会监听一个随机本地端口，CloudCLI 通过 `/api/plugins/progress-plugin/rpc/*` 代理到该端口。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查，返回 `{ status, model }` |
| `POST` | `/watch` | 开始/复用监听会话，请求体 `{ projectPath, sessionId }` |
| `GET` | `/progress?sessionId=...` | 获取指定会话的当前 ProgressTree |
| `POST` | `/refresh` | 强制重新提取，请求体 `{ sessionId }` |
| `GET` | `/turn?sessionId=...&promptId=...` | 获取某轮对话的完整记录 |
| `GET` | `/debug?sessionId=...` | 返回会话调试信息，包括日志路径、是否存在、模型、buffer 大小、状态等 |

## WebSocket

- 连接路径：`/ws`
- 订阅消息：`{ "type": "subscribe", "projectPath": "...", "sessionId": "..." }`
- 服务端推送：
  - `{ "type": "progress", "tree": { ... } }`
  - `{ "type": "status", "status": "idle|syncing|error|paused", "error": "..." }`

## 常见问题

- **没有显示 Progress**：
  - 确认 `ANTHROPIC_API_KEY` 已配置。
  - 确认会话日志文件存在，路径可通过 `/debug?sessionId=...` 查看。
  - 检查 CloudCLI 的 Progress 标签页网络请求，确认 WebSocket `/ws` 已连接并收到 `subscribe` 响应。
- **同步出错**：UI 会展示错误信息。可调用 `/debug` 查看详情；错误日志中 API Key 会被脱敏。
- **大会话提取失败**：插件会自动截断文本并降级到最近 5 轮重试。如仍失败，可增大 `.env` 中的 `MAX_TOKENS` 或缩短会话。
- **WebSocket 不更新**：确保插件 server 已启动（日志输出 `{ "ready": true, "port": ... }`），且 `subscribe` 消息中的 `sessionId` 正确。

## License

MIT
