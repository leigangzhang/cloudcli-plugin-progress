import type { ProgressStatus } from '../core/types.js';
import type { ThemeColors } from './theme.js';

const STATUS_LABELS: Record<ProgressStatus, string> = {
  pending: 'Pending',
   in_progress: 'In Progress',
   completed: 'Done',
   deleted: 'Deleted',
 };

const STATUS_COLORS = (
  c: ThemeColors,
): Record<ProgressStatus, { fg: string; bg: string; dot: string }> => ({
  pending: { fg: c.muted, bg: c.surfaceHover, dot: c.muted },
  in_progress: { fg: c.accent, bg: c.accentSoft, dot: c.accent },
  completed: { fg: c.success, bg: c.successSoft, dot: c.success },
  deleted: { fg: c.danger, bg: c.dangerSoft, dot: c.danger },
});

export function statusBadge(status: ProgressStatus, colors: ThemeColors): string {
  const style = STATUS_COLORS(colors)[status];
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;font-size:0.68rem;font-weight:500;color:${style.fg};background:${style.bg};"><span style="width:6px;height:6px;border-radius:50%;background:${style.dot};flex-shrink:0;"></span>${STATUS_LABELS[status]}</span>`;
}
