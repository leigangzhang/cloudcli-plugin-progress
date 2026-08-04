import type { PluginAPI } from './types.js';
import type { ProgressResponse, ProgressTree, TurnResponse } from './core/types.js';
import { isProgressResponse, parseJsonLine } from './core/protocol.js';
import { renderEmpty, renderError, renderLoading } from './ui/error.js';
import { refreshIcon } from './ui/icons.js';
import { themeColors } from './ui/theme.js';
import { renderProgressTree } from './ui/tree.js';

const FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

function ensureAssets(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('pp-font')) return;

  const link = document.createElement('link');
  link.id = 'pp-font';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(link);

  const style = document.createElement('style');
  style.textContent = `
    .pp-root * { box-sizing: border-box; }
    .pp-root button { font-family: inherit; cursor: pointer; }
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
  let errorMessage: string | undefined;
  let expanded = new Set<string>();
  let turnExpanded = new Set<string>();
  let turnRecords = new Map<string, TurnResponse>();
  let ws: WebSocket | null = null;
  let currentProjectPath: string | null = null;
  let currentSessionId: string | null = null;
  let currentRealSessionId: string | null = null;

  function render(): void {
    const dark = api.context.theme === 'dark';
    const colors = themeColors(dark);
    root.style.background = colors.bg;
    root.style.color = colors.text;

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

    const header = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="font-size:0.7rem;color:${colors.muted};letter-spacing:0.08em;text-transform:uppercase;">Progress</div>
        <button id="pp-refresh" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:${colors.surface};border:1px solid ${colors.border};border-radius:4px;color:${colors.text};font-size:0.68rem;transition:border-color 0.15s;" onmouseover="this.style.borderColor='${colors.accent}'" onmouseout="this.style.borderColor='${colors.border}'">
          ${refreshIcon()} Refresh
        </button>
      </div>
    `;

    root.innerHTML =
      header +
      renderProgressTree(
        tree,
        {
          theme: api.context.theme,
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
      headerEl?.addEventListener('click', () => void toggleStep(el as HTMLElement));
    });

    const refreshBtn = root.querySelector('#pp-refresh');
    refreshBtn?.addEventListener('click', () => void refresh());
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
        status = (msg as { status: ProgressResponse['status'] }).status;
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
    if (!sid) return;
    try {
      const res = await api.rpc('POST', '/refresh', { sessionId: sid });
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
