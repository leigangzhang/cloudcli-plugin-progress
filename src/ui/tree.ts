import { marked } from 'marked';
import type { ProgressGoal, ProgressStep, ProgressTree, TurnResponse } from '../core/types.js';
import type { ThemeColors } from './theme.js';
import { statusBadge } from './badge.js';
import { chevronDown, chevronRight } from './icons.js';

export interface TreeRenderOptions {
  theme: 'dark' | 'light';
  expanded: Set<string>;
  turnExpanded: Set<string>;
  turnRecords: Map<string, TurnResponse>;
}

export function renderProgressTree(
  tree: ProgressTree,
  options: TreeRenderOptions,
  colors: ThemeColors,
): string {
  if (tree.goals.length === 0) {
    return `<div style="color:${colors.muted};font-size:0.72rem;padding:12px 0;">No goals tracked yet.</div>`;
  }
  return `<div class="pp-tree" style="display:flex;flex-direction:column;gap:8px;">${tree.goals
    .map((goal) => renderGoal(goal, options, colors))
    .join('')}</div>`;
}

function renderGoal(goal: ProgressGoal, options: TreeRenderOptions, colors: ThemeColors): string {
  const expanded = options.expanded.has(goal.id);
  const toggle = expanded ? chevronDown() : chevronRight();
  const title = escapeHtml(goal.subject);
  const description = goal.description ? escapeHtml(goal.description) : '';
  return `
    <div class="pp-goal" data-goal-id="${escapeHtml(goal.id)}">
      <div class="pp-goal-header" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='${colors.dim}'" onmouseout="this.style.background='${colors.surface}'">
        <span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;color:${colors.muted};">${toggle}</span>
        ${statusBadge(goal.status, colors)}
        <span style="font-size:0.78rem;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${description}">${title}</span>
      </div>
      ${expanded ? renderSteps(goal, options, colors) : ''}
    </div>
  `;
}

function renderSteps(goal: ProgressGoal, options: TreeRenderOptions, colors: ThemeColors): string {
  const steps = goal.steps ?? [];
  if (steps.length === 0) return '';
  return `<div class="pp-steps" style="margin-left:20px;margin-top:4px;padding-left:10px;border-left:1px solid ${colors.border};">${steps
    .map((step) => renderStep(step, options, colors))
    .join('')}</div>`;
}

function renderStep(step: ProgressStep, options: TreeRenderOptions, colors: ThemeColors): string {
  const expanded = options.turnExpanded.has(step.id);
  const title = escapeHtml(step.subject);
  const completedIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const pendingIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>`;
  const icon = step.status === 'completed' ? completedIcon : pendingIcon;
  const panel = expanded ? renderTurnPanel(step, options, colors) : '';
  return `
    <div class="pp-step" data-step-id="${escapeHtml(step.id)}" data-prompt-id="${escapeHtml(step.promptId)}">
      <div class="pp-step-header" style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;">
        <span style="display:inline-flex;width:10px;height:10px;flex-shrink:0;color:${colors.muted};">${icon}</span>
        <span style="font-size:0.72rem;color:${colors.text};opacity:0.9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${title}">${title}</span>
      </div>
      ${panel}
    </div>
  `;
}

function renderTurnPanel(step: ProgressStep, options: TreeRenderOptions, colors: ThemeColors): string {
  const turn = options.turnRecords.get(step.promptId);
  if (!turn) {
    return `<div style="margin-left:18px;padding:8px;color:${colors.muted};font-size:0.7rem;">Loading conversation...</div>`;
  }
  const userBlock = renderBlock('User question', turn.userText, colors);
  const assistantBlock = renderBlock('Assistant reply', turn.assistantText, colors);
  const reasoningContent = [turn.thinkingText, turn.toolText].filter(Boolean).join('\n\n---\n\n');
  const reasoningBlock = reasoningContent
    ? `<details style="margin:6px 0;color:${colors.text};">
        <summary style="color:${colors.muted};font-size:0.7rem;cursor:pointer;">Model reasoning & tool results</summary>
        <div style="margin-top:6px;">${renderMarkdown(reasoningContent, colors)}</div>
      </details>`
    : '';
  return `
    <div class="pp-turn-panel" style="margin-left:18px;margin-bottom:8px;padding:10px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};">
      ${userBlock}
      ${reasoningBlock}
      ${assistantBlock}
    </div>
  `;
}

function renderBlock(label: string, text: string | undefined, colors: ThemeColors): string {
  if (!text) return '';
  return `
    <div style="margin:6px 0;">
      <div style="color:${colors.muted};font-size:0.7rem;margin-bottom:4px;">${escapeHtml(label)}</div>
      ${renderMarkdown(text, colors)}
    </div>
  `;
}

function renderMarkdown(text: string, _colors: ThemeColors): string {
  const html = marked.parse(text, { async: false }) as string;
  return `<div class="pp-markdown" style="font-size:0.75rem;line-height:1.5;">${html}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
