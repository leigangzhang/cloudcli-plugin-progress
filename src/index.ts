import type { PluginAPI } from './types.js';
import type {
  ExtractionMode,
  ProgressResponse,
  ProgressTree,
  TurnResponse,
} from './core/types.js';
import { isProgressResponse, parseJsonLine } from './core/protocol.js';
import { renderEmpty, renderError, renderLoading } from './ui/error.js';
import { refreshIcon } from './ui/icons.js';
import { themeColors } from './ui/theme.js';
import { renderProgressTree } from './ui/tree.js';
import { renderStatsPanel } from './ui/stats.js';

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif";

function ensureAssets(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pp-style')) return;

  const style = document.createElement('style');
  style.id = 'pp-style';
  style.textContent = `
    .pp-root * { box-sizing: border-box; }
    .pp-root button { font-family: inherit; cursor: pointer; }
    .pp-title { font-size:0.96rem; font-weight:650; color:var(--pp-text); }
    .pp-subtitle { font-size:0.68rem; line-height:1.35; color:var(--pp-muted); }
    .pp-header-actions { display:flex; align-items:center; gap:8px; }
    .pp-mode-buttons { display:inline-flex; gap:6px; }
    .pp-mode-button { display:inline-flex; align-items:center; padding:5px 11px; border:1px solid var(--pp-border); border-radius:6px; background:var(--pp-surface); color:var(--pp-muted); font-size:0.72rem; font-weight:500; transition:background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s; }
    .pp-mode-button:hover { border-color:var(--pp-accent); color:var(--pp-accent); }
    .pp-mode-button.active { background:var(--pp-accent); border-color:var(--pp-accent); color:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.10); }

    .pp-stats-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .pp-stat-card { background:var(--pp-surface); border:1px solid var(--pp-border); border-radius:8px; padding:11px 12px; box-shadow:0 1px 2px rgba(0,0,0,0.03); }
    .pp-stat-label { color:var(--pp-muted); font-size:0.68rem; margin-bottom:4px; }
    .pp-stat-value { color:var(--pp-text); font-size:1.18rem; font-weight:650; line-height:1.1; }
    .pp-stat-detail { color:var(--pp-muted); font-size:0.64rem; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    @media (min-width: 520px) {
      .pp-stats-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
    }

    .pp-goal-header, .pp-step-header { transition:background 0.15s, border-color 0.15s; }
    .pp-goal-header:hover { background:var(--pp-surfaceHover); }
    .pp-step-header:hover { background:var(--pp-surfaceHover); }
    .pp-turn-panel { font-family: Georgia, 'Times New Roman', serif; }
    .pp-turn-panel .pp-markdown { font-family: Georgia, 'Times New Roman', serif; }

    .pp-markdown { font-size:0.78rem; line-height:1.65; color:var(--pp-text); }
    .pp-markdown p { margin: 0 0 0.55em; }
    .pp-markdown h1, .pp-markdown h2, .pp-markdown h3, .pp-markdown h4 { margin: 0.7em 0 0.35em; font-weight: 600; line-height:1.3; }
    .pp-markdown h1 { font-size:1.05em; border-bottom:1px solid var(--pp-divider); padding-bottom:4px; }
    .pp-markdown h2 { font-size:0.98em; }
    .pp-markdown h3 { font-size:0.9em; }
    .pp-markdown h4 { font-size:0.84em; }
    .pp-markdown pre { background: var(--pp-surfaceHover); border:1px solid var(--pp-border); padding: 10px; border-radius: 6px; overflow: auto; max-height: 320px; margin: 0.55em 0; }
    .pp-markdown pre code { background: transparent; padding: 0; }
    .pp-markdown pre code, .pp-markdown code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
    .pp-markdown code { background: var(--pp-accentSoft); color: var(--pp-accent); padding: 2px 5px; border-radius: 4px; font-size: 0.86em; }
    .pp-markdown a { color: var(--pp-accent); text-decoration: none; }
    .pp-markdown a:hover { text-decoration: underline; }
    .pp-markdown ul, .pp-markdown ol { margin: 0.55em 0; padding-left: 1.6em; }
    .pp-markdown li { margin: 0.22em 0; }
    .pp-markdown blockquote { border-left: 3px solid var(--pp-accent); padding: 8px 12px; margin: 0.55em 0; color: var(--pp-muted); background:var(--pp-surfaceHover); border-radius:0 6px 6px 0; }
    .pp-markdown table { border-collapse: collapse; margin: 0.55em 0; border:1px solid var(--pp-border); }
    .pp-markdown th { background:var(--pp-surfaceHover); color:var(--pp-muted); }
    .pp-markdown th, .pp-markdown td { border: 1px solid var(--pp-border); padding: 5px 8px; }
    @keyframes pp-spin { to { transform: rotate(360deg); } }
    .pp-spin { display: inline-flex; animation: pp-spin 1s linear infinite; }
  `;
  document.head.appendChild(style);
}

export function mount(container: HTMLElement, api: PluginAPI): void {
  ensureAssets();

  const root = document.createElement('div');
  root.className = 'pp-root';
  root.style.cssText =
    'height:100%;overflow-y:auto;box-sizing:border-box;padding:16px;font-family:' + FONT + ';';
  container.appendChild(root);

  let tree: ProgressTree = { version: 0, goals: [] };
  let status: ProgressResponse['status'] = 'idle';
  let extractionMode: ExtractionMode = 'default';
  let errorMessage: string | undefined;
  let expanded = new Set<string>();
  let turnExpanded = new Set<string>();
  let turnRecords = new Map<string, TurnResponse>();
  let ws: WebSocket | null = null;
  let isRefreshing = false;
  let currentProjectPath: string | null = null;
  let currentSessionId: string | null = null;
  let currentRealSessionId: string | null = null;

  function render(): void {
    const dark = api.context.theme === 'dark';
    const colors = themeColors(dark);
    root.style.background = colors.bg;
    root.style.color = colors.text;
    for (const [key, value] of Object.entries(colors)) {
      root.style.setProperty(`--pp-${key}`, value);
    }

    if (!api.context.project || !api.context.session) {
      root.innerHTML = renderEmpty(colors, 'Select a project and session to view progress.');
      return;
    }

    if (status === 'syncing' && tree.goals.length === 0) {
      root.innerHTML = renderLoading(colors);
      return;
    }

    if (status === 'error') {
      root.innerHTML = renderError(colors, errorMessage ?? 'Sync failed');
      return;
    }

    const refreshLabel = isRefreshing ? 'Refreshing...' : 'Refresh';
    const refreshDisabled = isRefreshing ? 'opacity:0.6;cursor:not-allowed;' : '';
    const refreshHover = isRefreshing ? '' : `onmouseover="this.style.background='${colors.accentHover}'" onmouseout="this.style.background='${colors.accent}'"`;
    const iconClass = isRefreshing ? 'pp-spin' : '';
    const modeControl = `
      <div class="pp-mode-buttons">
        ${(['default', 'progress-tree'] as ExtractionMode[]).map((mode) => {
          const active = mode === extractionMode;
          const label = mode === 'default' ? 'Default' : 'ProgressTree';
          const summary =
            mode === 'default'
              ? 'Show a flat list of user queries without LLM extraction.'
              : 'Show goals and steps inferred from the session.';
          return `<button type="button" class="pp-mode-button${active ? ' active' : ''}" data-mode="${mode}" title="${summary}" aria-pressed="${active}">${label}</button>`;
        }).join('')}
      </div>
    `;
    const header = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;min-width:0;">
          <div class="pp-title">Progress</div>
          <div class="pp-subtitle">Auto-track goals and steps from your session.</div>
        </div>
        <div class="pp-header-actions">
          ${modeControl}
          <button id="pp-refresh" ${isRefreshing ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:${colors.accent};border:1px solid ${colors.accent};border-radius:6px;color:#fff;font-size:0.72rem;transition:background 0.15s, border-color 0.15s;${refreshDisabled}" ${refreshHover}>
            <span class="${iconClass}">${refreshIcon()}</span> ${refreshLabel}
          </button>
        </div>
      </div>
    `;

    root.innerHTML =
      header +
      renderStatsPanel(tree, colors) +
      renderProgressTree(
        tree,
        {
          theme: api.context.theme,
          extractionMode,
          expanded,
          turnExpanded,
          turnRecords,
        },
        colors,
      );

    root.querySelectorAll('[data-goal-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.goalId!;
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
        }
        render();
      });
    });

    root.querySelectorAll('[data-step-id]').forEach((el) => {
      const headerEl = el.querySelector('.pp-step-header');
      headerEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        void toggleStep(el as HTMLElement);
      });
    });

    const refreshBtn = root.querySelector('#pp-refresh');
    refreshBtn?.addEventListener('click', () => void refresh());
    root.querySelectorAll<HTMLButtonElement>('.pp-mode-button').forEach((el) => {
      el.addEventListener('click', () => {
        const mode = el.dataset.mode as ExtractionMode;
        if (mode !== extractionMode) void setMode(mode);
      });
    });
  }

  async function toggleStep(el: HTMLElement): Promise<void> {
    const stepId = el.dataset.stepId!;
    const promptId = el.dataset.promptId!;
    const isExpanded = turnExpanded.has(stepId);
    if (isExpanded) {
      turnExpanded.delete(stepId);
      render();
      return;
    }
    turnExpanded.add(stepId);
    render();
    if (!turnRecords.has(promptId)) {
      const sid = currentRealSessionId ?? currentSessionId;
      if (!sid) return;
      try {
        const res = await api.rpc('GET', `/turn?sessionId=${encodeURIComponent(sid)}&promptId=${encodeURIComponent(promptId)}`);
        if (res && typeof res === 'object' && 'promptId' in res) {
          turnRecords.set(promptId, res as TurnResponse);
        }
      } catch (err) {
        console.error('Failed to load turn:', (err as Error).message);
      }
      render();
    }
  }

  function applyResponse(res: unknown): void {
    if (isProgressResponse(res)) {
      tree = res.tree;
      status = res.status;
      extractionMode = res.extractionMode ?? 'default';
      errorMessage = res.error;
      void hydrateTurnRecords();
      return;
    }
    if (res && typeof res === 'object' && 'error' in res) {
      status = 'error';
      errorMessage = (res as { error: string }).error;
      void hydrateTurnRecords();
      return;
    }
  }

  async function hydrateTurnRecords(nextTree: ProgressTree = tree): Promise<void> {
    const sid = currentRealSessionId ?? currentSessionId;
    if (!sid) return;
    const promptIds = Array.from(
      new Set(
        nextTree.goals
          .flatMap((goal) => goal.steps ?? [])
          .map((step) => step.promptId),
      ),
    ).filter((promptId) => !turnRecords.has(promptId));
    if (promptIds.length === 0) return;

    let changed = false;
    await Promise.all(
      promptIds.map(async (promptId) => {
        try {
          const res = await api.rpc(
            'GET',
            `/turn?sessionId=${encodeURIComponent(sid)}&promptId=${encodeURIComponent(promptId)}`,
          );
          if (res && typeof res === 'object' && 'promptId' in res) {
            turnRecords.set(promptId, res as TurnResponse);
            changed = true;
          }
        } catch (err) {
          console.error('Failed to load turn timestamp:', (err as Error).message);
        }
      }),
    );
    if (changed) render();
  }

  async function subscribe(projectPath: string, sessionId: string): Promise<void> {
    if (ws) {
      ws.close();
      ws = null;
    }

    const proto = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = globalThis.location?.host ?? 'localhost';
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth-token') || '' : '';
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    ws = new WebSocket(`${proto}//${host}/plugin-ws/progress-plugin${qs}`);

    ws.onopen = () => {
      const sid = currentRealSessionId ?? sessionId;
      ws?.send(JSON.stringify({ type: 'subscribe', projectPath, sessionId: sid }));
    };

    ws.onmessage = (event) => {
      const msg = parseJsonLine(event.data as string);
      if (!msg || typeof msg !== 'object') return;
      const typed = msg as { type: string };
      if (typed.type === 'progress') {
        tree = (msg as { tree: ProgressTree }).tree;
        void hydrateTurnRecords(tree);
      } else if (typed.type === 'status') {
        const newStatus = (msg as { status: ProgressResponse['status'] }).status;
        if (status === 'syncing' && (newStatus === 'idle' || newStatus === 'error')) {
          isRefreshing = false;
        }
        status = newStatus;
        errorMessage = (msg as { error?: string }).error;
      }
      render();
    };

    ws.onerror = () => {
      status = 'error';
      errorMessage = 'WebSocket connection error';
      render();
    };

    ws.onclose = () => {
      if (status !== 'error') {
        status = 'paused';
      }
      render();
    };

    try {
      const res = await api.rpc('POST', '/watch', { projectPath, sessionId });
      applyResponse(res);
      if (res && typeof res === 'object' && 'sessionId' in res) {
        currentRealSessionId = (res as { sessionId?: string }).sessionId ?? sessionId;
      } else {
        currentRealSessionId = sessionId;
      }
    } catch (err) {
      status = 'error';
      errorMessage = (err as Error).message;
    }
    render();
  }

  async function refresh(): Promise<void> {
    const sid = currentRealSessionId ?? currentSessionId;
    if (!sid || isRefreshing) return;
    isRefreshing = true;
    render();
    try {
      const res = await api.rpc('POST', '/refresh', { sessionId: sid });
      applyResponse(res);
    } catch (err) {
      status = 'error';
      errorMessage = (err as Error).message;
    } finally {
      isRefreshing = false;
      render();
    }
  }

  async function setMode(mode: ExtractionMode): Promise<void> {
    const sid = currentRealSessionId ?? currentSessionId;
    if (!sid || mode === extractionMode) return;
    try {
      const res = await api.rpc('POST', '/mode', { sessionId: sid, mode });
      applyResponse(res);
    } catch (err) {
      status = 'error';
      errorMessage = (err as Error).message;
    }
    render();
  }

  currentProjectPath = api.context.project?.path ?? null;
  currentSessionId = api.context.session?.id ?? null;
  if (currentProjectPath && currentSessionId) {
    void subscribe(currentProjectPath, currentSessionId);
  } else {
    render();
  }

  const unsubscribe = api.onContextChange((ctx) => {
    const p = ctx.project?.path ?? null;
    const s = ctx.session?.id ?? null;
    if (p !== currentProjectPath || s !== currentSessionId) {
      currentProjectPath = p;
      currentSessionId = s;
      currentRealSessionId = null;
      turnExpanded.clear();
      turnRecords.clear();
      if (p && s) {
        void subscribe(p, s);
      } else {
        render();
      }
    } else {
      render();
    }
  });

  (container as unknown as { _ppCleanup?: () => void })._ppCleanup = () => {
    unsubscribe();
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}

export function unmount(container: HTMLElement): void {
  (container as unknown as { _ppCleanup?: () => void })._ppCleanup?.();
  container.innerHTML = '';
}
