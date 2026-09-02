import { marked } from 'marked';
import type {
  ExtractionMode,
  ProgressGoal,
  ProgressStep,
  ProgressTree,
  TurnResponse,
} from '../core/types.js';
import type { ThemeColors } from './theme.js';
import { statusBadge } from './badge.js';
import { chevronDown, chevronRight } from './icons.js';

export interface TreeRenderOptions {
  theme: 'dark' | 'light';
  extractionMode?: ExtractionMode;
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
    return `<div class="pp-tree-empty" style="background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;padding:28px 16px;text-align:center;color:${colors.muted};font-size:0.78rem;">No goals tracked yet.</div>`;
  }
  if (options.extractionMode === 'default') {
    const steps = tree.goals.flatMap((goal) => goal.steps ?? []);
    if (steps.length === 0) {
      return `<div class="pp-tree-empty" style="background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;padding:28px 16px;text-align:center;color:${colors.muted};font-size:0.78rem;">No queries tracked yet.</div>`;
    }
    return `<div class="pp-tree pp-tree-flat" style="background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;overflow:hidden;">${steps
      .map((step, index) => renderStep(step, options, colors, index + 1, false))
      .join('')}</div>`;
  }
  return `<div class="pp-tree" style="background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;overflow:hidden;">${tree.goals
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
      <div class="pp-goal-header" style="display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid ${colors.divider};background:${colors.surface};cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='${colors.surfaceHover}'" onmouseout="this.style.background='${colors.surface}'">
        <span style="display:inline-flex;width:16px;height:16px;flex-shrink:0;color:${colors.muted};">${toggle}</span>
        ${statusBadge(goal.status, colors)}
        <span style="font-size:0.8rem;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${colors.text};" title="${description}">${title}</span>
      </div>
      ${expanded ? renderSteps(goal, options, colors) : ''}
    </div>
  `;
}

function renderSteps(goal: ProgressGoal, options: TreeRenderOptions, colors: ThemeColors): string {
  const steps = goal.steps ?? [];
  if (steps.length === 0) return '';
  return `<div class="pp-steps" style="margin:0 12px 4px 28px;padding:4px 0 4px 12px;border-left:1px solid ${colors.divider};">${steps
    .map((step) => renderStep(step, options, colors, undefined, true))
    .join('')}</div>`;
}

function renderStep(
  step: ProgressStep,
  options: TreeRenderOptions,
  colors: ThemeColors,
  sequence?: number,
  embedded = false,
): string {
  const expanded = options.turnExpanded.has(step.id);
  const title = escapeHtml(step.subject);
  const completedIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const pendingIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"></circle></svg>`;
  const icon = step.status === 'completed'
    ? `<span style="color:${colors.success};display:inline-flex;">${completedIcon}</span>`
    : `<span style="color:${colors.muted};display:inline-flex;">${pendingIcon}</span>`;
  const panel = expanded ? renderTurnPanel(step, options, colors) : '';
  const sequenceLabel = sequence
    ? `<span style="width:18px;text-align:right;flex-shrink:0;color:${colors.muted};font-size:0.72rem;">${sequence}.</span>`
    : '';
  const rowStyle = embedded
    ? 'padding:6px 0;'
    : `padding:10px 12px;border-bottom:1px solid ${colors.divider};`;
  const hover = embedded
    ? ''
    : `onmouseover="this.style.background='${colors.surfaceHover}'" onmouseout="this.style.background='${colors.surface}'"`;
  const stepRowBackground = embedded ? 'background:transparent;' : `background:${colors.surface};`;
  return `
    <div class="pp-step" data-step-id="${escapeHtml(step.id)}" data-prompt-id="${escapeHtml(step.promptId)}" style="${stepRowBackground}">
      <div class="pp-step-header" style="display:flex;align-items:center;gap:8px;${rowStyle}cursor:pointer;transition:background 0.15s;" ${hover}>
        ${sequenceLabel}
        <span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;">${icon}</span>
        <span style="font-size:0.76rem;color:${colors.text};opacity:0.9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${title}">${title}</span>
      </div>
      ${panel}
    </div>
  `;
}

function renderTurnPanel(step: ProgressStep, options: TreeRenderOptions, colors: ThemeColors): string {
  const turn = options.turnRecords.get(step.promptId);
  if (!turn) {
    return `<div style="margin-left:20px;margin-bottom:8px;padding:10px 12px;border-radius:6px;background:${colors.surfaceHover};color:${colors.muted};font-size:0.72rem;">Loading conversation...</div>`;
  }
  const userBlock = renderBlock('User question', turn.userText, colors);
  const assistantBlock = turn.assistantText
    ? renderBlock('Assistant reply', turn.assistantText, colors)
    : renderEmptyBlock('Assistant reply', colors);
  const reasoningBlock = renderPlainDetails('Model reasoning', turn.thinkingText, colors);
  const toolBlock = renderPlainDetails('Tool activity', turn.toolText, colors);
  return `
    <div class="pp-turn-panel" style="margin-left:20px;margin-bottom:8px;padding:10px 12px;border-radius:6px;background:${colors.accentSoft};" onclick="event.stopPropagation();">
      ${userBlock}
      ${reasoningBlock}
      ${toolBlock}
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

function renderPlainDetails(
  label: string,
  text: string | undefined,
  colors: ThemeColors,
): string {
  if (!text) return '';
  const sizeLabel = text.length >= 10_000 ? `${Math.round(text.length / 1000)}k` : `${text.length}`;
  return `
    <details style="margin:6px 0;color:${colors.text};">
      <summary style="color:${colors.muted};font-size:0.7rem;cursor:pointer;">${escapeHtml(label)} (${sizeLabel} characters)</summary>
      <pre style="margin:6px 0 0;padding:8px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:${colors.surfaceHover};border-radius:6px;font-size:0.72rem;line-height:1.5;">${escapeHtml(text)}</pre>
    </details>
  `;
}

function renderEmptyBlock(label: string, colors: ThemeColors): string {
  return `
    <div style="margin:6px 0;">
      <div style="color:${colors.muted};font-size:0.7rem;margin-bottom:4px;">${escapeHtml(label)}</div>
      <div style="color:${colors.muted};font-size:0.72rem;">No reply recorded.</div>
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
