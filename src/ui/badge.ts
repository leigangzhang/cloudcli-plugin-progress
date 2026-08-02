import type { ProgressStatus } from '../core/types.js';
import type { ThemeColors } from './theme.js';
 import { checkIcon, circleIcon } from './icons.js';

 const STATUS_LABELS: Record<ProgressStatus, string> = {
   pending: 'Pending',
   in_progress: 'In Progress',
   completed: 'Done',
   deleted: 'Deleted',
 };

 const STATUS_COLORS = (
   c: ThemeColors,
 ): Record<ProgressStatus, { fg: string; bg: string; icon: string }> => ({
   pending: { fg: c.muted, bg: 'transparent', icon: circleIcon() },
   in_progress: { fg: c.accent, bg: c.dim, icon: circleIcon() },
   completed: { fg: c.success, bg: 'transparent', icon: checkIcon() },
   deleted: { fg: c.danger, bg: 'transparent', icon: circleIcon() },
 });

 export function statusBadge(status: ProgressStatus, colors: ThemeColors): string {
   const style = STATUS_COLORS(colors)[status];
   return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border:1px solid ${colors.border};border-radius:3px;font-size:0.62rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${style.fg};background:${style.bg};">${style.icon}${STATUS_LABELS[status]}</span>`;
 }
