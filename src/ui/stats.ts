import type { ProgressTree } from '../core/types.js';
import type { ThemeColors } from './theme.js';

function statItem(
  label: string,
  value: string,
  detail: string,
  colors: ThemeColors,
  valueColor?: string,
): string {
  const color = valueColor ?? colors.text;
  return `
    <div class="pp-stat-item" style="min-width:0;">
      <div class="pp-stat-label">${label}</div>
      <div class="pp-stat-value" style="color:${color};">${value}</div>
      <div class="pp-stat-detail">${detail}</div>
    </div>
  `;
}

export function renderStatsPanel(tree: ProgressTree, colors: ThemeColors): string {
  const goals = tree.goals ?? [];
  const steps = goals.flatMap((goal) => goal.steps ?? []);
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length;
  const completedSteps = steps.filter((step) => step.status === 'completed').length;
  const inProgressSteps = steps.filter((step) => step.status === 'in_progress').length;
  const pendingSteps = steps.length - completedSteps - inProgressSteps;
  const percent = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;

  return `
    <div class="pp-stats-panel" style="display:flex;flex-direction:column;gap:12px;padding:12px 14px;margin-bottom:12px;background:${colors.surface};border:1px solid ${colors.border};border-radius:8px;">
      <div class="pp-stats-grid">
        ${statItem('Goals', `${goals.length}`, `${completedGoals} completed`, colors)}
        ${statItem('Steps', `${steps.length}`, `${completedSteps} completed`, colors)}
        ${statItem('In Progress', `${inProgressSteps}`, `${pendingSteps} pending`, colors)}
        ${statItem('Progress', `${percent}%`, `${completedSteps}/${steps.length} steps`, colors, colors.accent)}
      </div>
      <div class="pp-progress-track" style="height:6px;background:${colors.surfaceHover};border-radius:999px;overflow:hidden;">
        <div style="height:100%;width:${percent}%;background:${colors.accent};border-radius:999px;transition:width 0.2s;"></div>
      </div>
    </div>
  `;
}
