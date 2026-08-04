// src/core/protocol.ts
function isProgressResponse(value) {
  const v = value;
  return typeof v === "object" && v !== null && typeof v.tree === "object" && typeof v.status === "string" && ["idle", "syncing", "error", "paused"].includes(v.status);
}
function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return void 0;
  }
}

// src/ui/icons.ts
function chevronRight() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
}
function chevronDown() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}
function checkIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
}
function circleIcon() {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>`;
}
function refreshIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>`;
}
function alertIcon() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
}

// src/ui/error.ts
function renderLoading(colors) {
  return `
     <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50%;gap:12px;color:${colors.muted};">
       <div style="width:18px;height:18px;border:2px solid ${colors.border};border-top-color:${colors.accent};border-radius:50%;animation:pp-spin 1s linear infinite;"></div>
       <div style="font-size:0.72rem;letter-spacing:0.05em;">Loading progress...</div>
     </div>
     <style>@keyframes pp-spin { to { transform: rotate(360deg); } }</style>
   `;
}
function renderError(colors, message) {
  return `
     <div style="padding:16px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};color:${colors.danger};font-size:0.75rem;line-height:1.5;">
       <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:600;">
         ${alertIcon()} Sync error
       </div>
       <div style="color:${colors.text};opacity:0.85;">${escapeHtml(message)}</div>
     </div>
   `;
}
function renderEmpty(colors, message) {
  return `
     <div style="display:flex;align-items:center;justify-content:center;height:50%;color:${colors.muted};font-size:0.72rem;text-align:center;padding:0 24px;">
       ${escapeHtml(message)}
     </div>
   `;
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// src/ui/theme.ts
function themeColors(dark) {
  return dark ? {
    bg: "#08080f",
    surface: "#0e0e1a",
    border: "#1a1a2c",
    text: "#e2e0f0",
    muted: "#52507a",
    accent: "#fbbf24",
    dim: "rgba(251,191,36,0.1)",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#f43f5e"
  } : {
    bg: "#fafaf9",
    surface: "#ffffff",
    border: "#e8e6f0",
    text: "#0f0e1a",
    muted: "#9490b0",
    accent: "#d97706",
    dim: "rgba(217,119,6,0.08)",
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#f43f5e"
  };
}

// src/ui/badge.ts
var STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Done",
  deleted: "Deleted"
};
var STATUS_COLORS = (c) => ({
  pending: { fg: c.muted, bg: "transparent", icon: circleIcon() },
  in_progress: { fg: c.accent, bg: c.dim, icon: circleIcon() },
  completed: { fg: c.success, bg: "transparent", icon: checkIcon() },
  deleted: { fg: c.danger, bg: "transparent", icon: circleIcon() }
});
function statusBadge(status, colors) {
  const style = STATUS_COLORS(colors)[status];
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border:1px solid ${colors.border};border-radius:3px;font-size:0.62rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${style.fg};background:${style.bg};">${style.icon}${STATUS_LABELS[status]}</span>`;
}

// src/ui/tree.ts
function renderProgressTree(tree, options, colors) {
  if (tree.goals.length === 0) {
    return `<div style="color:${colors.muted};font-size:0.72rem;padding:12px 0;">No goals tracked yet.</div>`;
  }
  return `<div class="pp-tree" style="display:flex;flex-direction:column;gap:8px;">${tree.goals.map((goal) => renderGoal(goal, options, colors)).join("")}</div>`;
}
function renderGoal(goal, options, colors) {
  const expanded = options.expanded.has(goal.id);
  const toggle = expanded ? chevronDown() : chevronRight();
  const title = escapeHtml2(goal.subject);
  const description = goal.description ? escapeHtml2(goal.description) : "";
  return `
    <div class="pp-goal" data-goal-id="${escapeHtml2(goal.id)}">
      <div class="pp-goal-header" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='${colors.dim}'" onmouseout="this.style.background='${colors.surface}'">
        <span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;color:${colors.muted};">${toggle}</span>
        ${statusBadge(goal.status, colors)}
        <span style="font-size:0.78rem;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${description}">${title}</span>
      </div>
      ${expanded ? renderSteps(goal, options, colors) : ""}
    </div>
  `;
}
function renderSteps(goal, options, colors) {
  const steps = goal.steps ?? [];
  if (steps.length === 0) return "";
  return `<div class="pp-steps" style="margin-left:20px;margin-top:4px;padding-left:10px;border-left:1px solid ${colors.border};">${steps.map((step) => renderStep(step, options, colors)).join("")}</div>`;
}
function renderStep(step, options, colors) {
  const expanded = options.turnExpanded.has(step.id);
  const title = escapeHtml2(step.subject);
  const completedIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const pendingIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>`;
  const icon = step.status === "completed" ? completedIcon : pendingIcon;
  const panel = expanded ? renderTurnPanel(step, options, colors) : "";
  return `
    <div class="pp-step" data-step-id="${escapeHtml2(step.id)}" data-prompt-id="${escapeHtml2(step.promptId)}">
      <div class="pp-step-header" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;">
        <span style="display:inline-flex;width:10px;height:10px;flex-shrink:0;color:${colors.muted};">${icon}</span>
        <span style="font-size:0.72rem;color:${colors.text};opacity:0.9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${title}">${title}</span>
      </div>
      ${panel}
    </div>
  `;
}
function renderTurnPanel(step, options, colors) {
  const turn = options.turnRecords.get(step.promptId);
  if (!turn) {
    return `<div style="margin-left:18px;padding:8px;color:${colors.muted};font-size:0.7rem;">Loading conversation...</div>`;
  }
  const userBlock = renderBlock("User question", turn.userText, colors);
  const thinkingBlock = turn.thinkingText ? `<details style="margin:6px 0;color:${colors.text};">
        <summary style="color:${colors.muted};font-size:0.7rem;cursor:pointer;">Model reasoning</summary>
        <div style="margin-top:6px;">${renderPre(turn.thinkingText, colors)}</div>
      </details>` : "";
  const assistantBlock = renderBlock("Assistant reply", turn.assistantText, colors);
  return `
    <div class="pp-turn-panel" style="margin-left:18px;margin-bottom:8px;padding:10px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};">
      ${userBlock}
      ${thinkingBlock}
      ${assistantBlock}
    </div>
  `;
}
function renderBlock(label, text, colors) {
  if (!text) return "";
  return `
    <div style="margin:6px 0;">
      <div style="color:${colors.muted};font-size:0.7rem;margin-bottom:4px;">${escapeHtml2(label)}</div>
      ${renderPre(text, colors)}
    </div>
  `;
}
function renderPre(text, colors) {
  return `<pre style="margin:0;padding:8px;border-radius:4px;background:${colors.dim};color:${colors.text};font-size:0.72rem;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;">${escapeHtml2(text)}</pre>`;
}
function escapeHtml2(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// src/index.ts
var FONT = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";
function ensureAssets() {
  if (typeof document === "undefined") return;
  if (document.getElementById("pp-font")) return;
  const link = document.createElement("link");
  link.id = "pp-font";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap";
  document.head.appendChild(link);
  const style = document.createElement("style");
  style.textContent = `
    .pp-root * { box-sizing: border-box; }
    .pp-root button { font-family: inherit; cursor: pointer; }
  `;
  document.head.appendChild(style);
}
function mount(container, api) {
  ensureAssets();
  const root = document.createElement("div");
  root.className = "pp-root";
  root.style.cssText = "height:100%;overflow-y:auto;box-sizing:border-box;padding:16px;font-family:" + FONT + ";";
  container.appendChild(root);
  let tree = { version: 0, goals: [] };
  let status = "idle";
  let errorMessage;
  let expanded = /* @__PURE__ */ new Set();
  let turnExpanded = /* @__PURE__ */ new Set();
  let turnRecords = /* @__PURE__ */ new Map();
  let ws = null;
  let currentProjectPath = null;
  let currentSessionId = null;
  let currentRealSessionId = null;
  function render() {
    const dark = api.context.theme === "dark";
    const colors = themeColors(dark);
    root.style.background = colors.bg;
    root.style.color = colors.text;
    if (!api.context.project || !api.context.session) {
      root.innerHTML = renderEmpty(colors, "Select a project and session to view progress.");
      return;
    }
    if (status === "syncing" && tree.goals.length === 0) {
      root.innerHTML = renderLoading(colors);
      return;
    }
    if (status === "error") {
      root.innerHTML = renderError(colors, errorMessage ?? "Sync failed");
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
    root.innerHTML = header + renderProgressTree(
      tree,
      {
        theme: api.context.theme,
        expanded,
        turnExpanded,
        turnRecords
      },
      colors
    );
    root.querySelectorAll("[data-goal-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.goalId;
        if (expanded.has(id)) {
          expanded.delete(id);
        } else {
          expanded.add(id);
        }
        render();
      });
    });
    root.querySelectorAll("[data-step-id]").forEach((el) => {
      const headerEl = el.querySelector(".pp-step-header");
      headerEl?.addEventListener("click", () => void toggleStep(el));
    });
    const refreshBtn = root.querySelector("#pp-refresh");
    refreshBtn?.addEventListener("click", () => void refresh());
  }
  async function toggleStep(el) {
    const stepId = el.dataset.stepId;
    const promptId = el.dataset.promptId;
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
        const res = await api.rpc("GET", `/turn?sessionId=${encodeURIComponent(sid)}&promptId=${encodeURIComponent(promptId)}`);
        if (res && typeof res === "object" && "promptId" in res) {
          turnRecords.set(promptId, res);
        }
      } catch (err) {
        console.error("Failed to load turn:", err.message);
      }
      render();
    }
  }
  function applyResponse(res) {
    if (isProgressResponse(res)) {
      tree = res.tree;
      status = res.status;
      errorMessage = res.error;
      return;
    }
    if (res && typeof res === "object" && "error" in res) {
      status = "error";
      errorMessage = res.error;
      return;
    }
  }
  async function subscribe(projectPath, sessionId) {
    if (ws) {
      ws.close();
      ws = null;
    }
    const proto = globalThis.location?.protocol === "https:" ? "wss:" : "ws:";
    const host = globalThis.location?.host ?? "localhost";
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("auth-token") || "" : "";
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    ws = new WebSocket(`${proto}//${host}/plugin-ws/progress-plugin${qs}`);
    ws.onopen = () => {
      const sid = currentRealSessionId ?? sessionId;
      ws?.send(JSON.stringify({ type: "subscribe", projectPath, sessionId: sid }));
    };
    ws.onmessage = (event) => {
      const msg = parseJsonLine(event.data);
      if (!msg || typeof msg !== "object") return;
      const typed = msg;
      if (typed.type === "progress") {
        tree = msg.tree;
      } else if (typed.type === "status") {
        status = msg.status;
        errorMessage = msg.error;
      }
      render();
    };
    ws.onerror = () => {
      status = "error";
      errorMessage = "WebSocket connection error";
      render();
    };
    ws.onclose = () => {
      if (status !== "error") {
        status = "paused";
      }
      render();
    };
    try {
      const res = await api.rpc("POST", "/watch", { projectPath, sessionId });
      applyResponse(res);
      if (res && typeof res === "object" && "sessionId" in res) {
        currentRealSessionId = res.sessionId ?? sessionId;
      } else {
        currentRealSessionId = sessionId;
      }
    } catch (err) {
      status = "error";
      errorMessage = err.message;
    }
    render();
  }
  async function refresh() {
    const sid = currentRealSessionId ?? currentSessionId;
    if (!sid) return;
    try {
      const res = await api.rpc("POST", "/refresh", { sessionId: sid });
      applyResponse(res);
    } catch (err) {
      status = "error";
      errorMessage = err.message;
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
  container._ppCleanup = () => {
    unsubscribe();
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}
function unmount(container) {
  container._ppCleanup?.();
  container.innerHTML = "";
}
export {
  mount,
  unmount
};
