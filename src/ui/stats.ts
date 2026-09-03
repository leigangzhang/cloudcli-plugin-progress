import type { ProgressTree } from '../core/types.js';
import type { ThemeColors } from './theme.js';

function statItem(
  label: string,
  value: string,
  detail: string,
  colors: ThemeColors,
  valueColor?: string,
  fontFamily = 'inherit',
): string {
  const color = valueColor ?? colors.text;
  return `
    <div class="pp-stat-card" style="min-width:0;font-family:${fontFamily};">
      <div class="pp-stat-label">${label}</div>
      <div class="pp-stat-value" style="color:${color};">${value}</div>
      <div class="pp-stat-detail">${detail}</div>
    </div>
  `;
}

export function renderStatsPanel(
  tree: ProgressTree,
  colors: ThemeColors,
  chinese = false,
): string {
  const goals = tree.goals ?? [];
  const steps = goals.flatMap((goal) => goal.steps ?? []);
  const completedGoals = goals.filter((goal) => goal.status === 'completed').length;
  const completedSteps = steps.filter((step) => step.status === 'completed').length;
  const inProgressSteps = steps.filter((step) => step.status === 'in_progress').length;
  const pendingSteps = steps.length - completedSteps - inProgressSteps;
  const percent = steps.length ? Math.round((completedSteps / steps.length) * 100) : 0;
  const fontFamily = chinese
    ? "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', 'Noto Serif SC', serif"
    : 'inherit';
  const t = (zh: string, en: string) => (chinese ? zh : en);

  return `
    <div class="pp-stats-panel" style="display:flex;flex-direction:column;gap:10px;margin-bottom:12px;">
      <div class="pp-stats-grid">
        ${statItem(t('目标', 'Goals'), `${goals.length}`, `${completedGoals} ${t('已完成', 'completed')}`, colors, undefined, fontFamily)}
        ${statItem(t('步骤', 'Steps'), `${steps.length}`, `${completedSteps} ${t('已完成', 'completed')}`, colors, undefined, fontFamily)}
        ${statItem(t('进行中', 'In Progress'), `${inProgressSteps}`, `${pendingSteps} ${t('待处理', 'pending')}`, colors, undefined, fontFamily)}
        ${statItem(t('进度', 'Progress'), `${percent}%`, `${completedSteps}/${steps.length} ${t('步骤', 'steps')}`, colors, colors.accent, fontFamily)}
      </div>
    </div>
  `;
}
