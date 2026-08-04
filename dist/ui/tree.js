import { truncateDescription, truncateSubject } from '../core/schema.js';
import { statusBadge } from './badge.js';
import { chevronDown, chevronRight } from './icons.js';
export function renderProgressTree(tree, _options, colors) {
    if (tree.goals.length === 0) {
        return `<div style="color:${colors.muted};font-size:0.72rem;padding:12px 0;">No goals tracked yet.</div>`;
    }
    return `<div class="pp-tree" style="display:flex;flex-direction:column;gap:8px;">${tree.goals
        .map((goal) => renderGoal(goal, _options, colors))
        .join('')}</div>`;
}
function renderGoal(goal, options, colors) {
    const expanded = options.expanded.has(goal.id);
    const toggle = expanded ? chevronDown() : chevronRight();
    const title = escapeHtml(truncateSubject(goal.subject));
    const description = goal.description ? escapeHtml(truncateDescription(goal.description)) : '';
    return `
     <div class="pp-goal" data-goal-id="${escapeHtml(goal.id)}">
       <div class="pp-goal-header" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='${colors.dim}'" onmouseout="this.style.background='${colors.surface}'">
         <span style="display:inline-flex;width:12px;height:12px;flex-shrink:0;color:${colors.muted};">${toggle}</span>
         ${statusBadge(goal.status, colors)}
         <span style="font-size:0.78rem;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${description}">${title}</span>
       </div>
       ${expanded ? renderSteps(goal, colors) : ''}
     </div>
   `;
}
function renderSteps(goal, colors) {
    const steps = goal.steps ?? [];
    if (steps.length === 0)
        return '';
    return `<div class="pp-steps" style="margin-left:20px;margin-top:4px;padding-left:10px;border-left:1px solid ${colors.border};">${steps
        .map((step) => renderStep(step, colors))
        .join('')}</div>`;
}
function renderStep(step, colors) {
    const title = escapeHtml(truncateSubject(step.subject));
    const tool = step.toolUse ? `<span style="color:${colors.muted};font-size:0.65rem;margin-left:auto;">${escapeHtml(step.toolUse)}</span>` : '';
    return `
     <div class="pp-step" style="display:flex;align-items:center;gap:8px;padding:5px 0;">
       <span style="display:inline-flex;width:10px;height:10px;flex-shrink:0;color:${colors.muted};">${step.status === 'completed' ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"></circle></svg>'}</span>
       <span style="font-size:0.72rem;color:${colors.text};opacity:0.9;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(title)}">${title}</span>
       ${tool}
     </div>
   `;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
//# sourceMappingURL=tree.js.map