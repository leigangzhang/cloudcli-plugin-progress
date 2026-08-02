import { isProgressResponse, parseJsonLine } from './core/protocol.js';
import { renderEmpty, renderError, renderLoading } from './ui/error.js';
import { refreshIcon } from './ui/icons.js';
import { themeColors } from './ui/theme.js';
import { renderProgressTree } from './ui/tree.js';
const FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
function ensureAssets() {
    if (typeof document === 'undefined')
        return;
    if (document.getElementById('pp-font'))
        return;
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
export function mount(container, api) {
    ensureAssets();
    const root = document.createElement('div');
    root.className = 'pp-root';
    root.style.cssText =
        'height:100%;overflow-y:auto;box-sizing:border-box;padding:16px;font-family:' + FONT + ';';
    container.appendChild(root);
    let tree = { version: 0, goals: [] };
    let status = 'idle';
    let errorMessage;
    let expanded = new Set();
    let ws = null;
    let currentProjectPath = null;
    let currentSessionId = null;
    function render() {
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
                renderProgressTree(tree, {
                    theme: api.context.theme,
                    expanded,
                    onToggle: () => { },
                }, colors);
        root.querySelectorAll('[data-goal-id]').forEach((el) => {
            el.addEventListener('click', () => {
                const id = el.dataset.goalId;
                if (expanded.has(id)) {
                    expanded.delete(id);
                }
                else {
                    expanded.add(id);
                }
                render();
            });
        });
        const refreshBtn = root.querySelector('#pp-refresh');
        refreshBtn?.addEventListener('click', () => void refresh());
    }
    async function subscribe(projectPath, sessionId) {
        if (ws) {
            ws.close();
            ws = null;
        }
        const proto = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = globalThis.location?.host ?? 'localhost';
        ws = new WebSocket(`${proto}//${host}/plugin-ws/progress-plugin`);
        ws.onopen = () => {
            ws?.send(JSON.stringify({ type: 'subscribe', projectPath, sessionId }));
        };
        ws.onmessage = (event) => {
            const msg = parseJsonLine(event.data);
            if (!msg || typeof msg !== 'object')
                return;
            const typed = msg;
            if (typed.type === 'progress') {
                tree = msg.tree;
            }
            else if (typed.type === 'status') {
                status = msg.status;
                errorMessage = msg.error;
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
            if (isProgressResponse(res)) {
                tree = res.tree;
                status = res.status;
                errorMessage = res.error;
            }
        }
        catch (err) {
            status = 'error';
            errorMessage = err.message;
        }
        render();
    }
    async function refresh() {
        try {
            const res = await api.rpc('POST', '/refresh');
            if (isProgressResponse(res)) {
                tree = res.tree;
                status = res.status;
                errorMessage = res.error;
            }
        }
        catch (err) {
            status = 'error';
            errorMessage = err.message;
        }
        render();
    }
    currentProjectPath = api.context.project?.path ?? null;
    currentSessionId = api.context.session?.id ?? null;
    if (currentProjectPath && currentSessionId) {
        void subscribe(currentProjectPath, currentSessionId);
    }
    else {
        render();
    }
    const unsubscribe = api.onContextChange((ctx) => {
        const p = ctx.project?.path ?? null;
        const s = ctx.session?.id ?? null;
        if (p !== currentProjectPath || s !== currentSessionId) {
            currentProjectPath = p;
            currentSessionId = s;
            if (p && s) {
                void subscribe(p, s);
            }
            else {
                render();
            }
        }
        else {
            render();
        }
    });
    container._ppCleanup = () => {
        unsubscribe();
        if (ws) {
            ws.close();
            ws = null;
        }
    };
}
export function unmount(container) {
    container._ppCleanup?.();
    container.innerHTML = '';
}
//# sourceMappingURL=index.js.map