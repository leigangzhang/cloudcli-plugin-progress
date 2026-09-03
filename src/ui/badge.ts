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
): Record<ProgressStatus, { bg: string; dot: string }> => ({
  pending: { bg: c.deepBlue, dot: '#fff' },
  in_progress: { bg: c.deepBlue, dot: '#fff' },
  completed: { bg: c.deepBlue, dot: '#fff' },
  deleted: { bg: c.deepBlue, dot: '#fff' },
});

export function statusBadge(status: ProgressStatus, colors: ThemeColors): string {
  const style = STATUS_COLORS(colors)[status];
  return `<span style="display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:5px;font-family:Georgia, 'Times New Roman', serif;font-size:0.8rem;font-weight:700;color:#fff;background:${style.bg};"><span style="width:6px;height:6px;border-radius:50%;background:${style.dot};flex-shrink:0;"></span>${STATUS_LABELS[status]}</span>`;
}
