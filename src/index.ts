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
    .pp-mode-control { display:inline-flex; align-items:center; gap:2px; padding:2px; background:var(--pp-surface); border:1px solid var(--pp-border); border-radius:6px; }
    .pp-mode-option { display:inline-flex; }
    .pp-mode-option input { position:absolute; width:1px; height:1px; opacity:0; }
    .pp-mode-option span { padding:3px 10px; border-radius:4px; font-size:0.7rem; line-height:1.4; color:var(--pp-muted); cursor:pointer; transition:background 0.15s, color 0.15s; }
    .pp-mode-option input:checked + span { background:var(--pp-accentSoft); color:var(--pp-accent); font-weight:500; }
    .pp-markdown p { margin: 0 0 0.5em; line-height: 1.5; }
    .pp-markdown h1, .pp-markdown h2, .pp-markdown h3, .pp-markdown h4 { margin: 0.6em 0 0.3em; font-weight: 600; }
    .pp-markdown h1 { font-size: 1.1em; }
    .pp-markdown h2 { font-size: 1em; }
    .pp-markdown h3 { font-size: 0.95em; }
    .pp-markdown pre { background: var(--pp-surfaceHover); padding: 10px; border-radius: 6px; overflow: auto; margin: 0.5em 0; }
    .pp-markdown pre code { background: transparent; padding: 0; }
    .pp-markdown code { font-family: inherit; background: var(--pp-surfaceHover); padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
    .pp-markdown a { color: var(--pp-accent); text-decoration: none; }
    .pp-markdown a:hover { text-decoration: underline; }
    .pp-markdown ul, .pp-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
    .pp-markdown li { margin: 0.2em 0; }
    .pp-markdown blockquote { border-left: 3px solid var(--pp-border); padding-left: 10px; margin: 0.5em 0; color: var(--pp-muted); }
    .pp-markdown table { border-collapse: collapse; margin: 0.5em 0; }
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
    const refreshHover = isRefreshing ? '' : `onmouseover="this.style.background='${colors.surfaceHover}'" onmouseout="this.style.background='${colors.surface}'"`;
    const iconClass = isRefreshing ? 'pp-spin' : '';
    const modeControl = `
      <div class="pp-mode-control">
        ${(['default', 'progress-tree'] as ExtractionMode[]).map((mode) => {
          const active = mode === extractionMode;
          const label = mode === 'default' ? 'Default' : 'ProgressTree';
          return `<label class="pp-mode-option"><input type="radio" name="pp-extraction-mode" value="${mode}" ${active ? 'checked' : ''}><span>${label}</span></label>`;
        }).join('')}
      </div>
    `;
    const header = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
          <div style="font-size:0.92rem;font-weight:600;color:${colors.text};">Progress</div>
          ${modeControl}
        </div>
        <button id="pp-refresh" ${isRefreshing ? 'disabled' : ''} style="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:${colors.surface};border:1px solid ${colors.border};border-radius:6px;color:${colors.text};font-size:0.72rem;transition:background 0.15s, border-color 0.15s;${refreshDisabled}" ${refreshHover}>
          <span class="${iconClass}">${refreshIcon()}</span> ${refreshLabel}
        </button>
      </div>
    `;

    root.innerHTML =
      header +
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
    root.querySelectorAll<HTMLInputElement>('input[name="pp-extraction-mode"]').forEach((el) => {
      el.addEventListener('change', () => {
        const mode = el.value as ExtractionMode;
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
      return;
    }
    if (res && typeof res === 'object' && 'error' in res) {
      status = 'error';
      errorMessage = (res as { error: string }).error;
      return;
    }
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
