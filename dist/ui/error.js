import { alertIcon } from './icons.js';
export function renderLoading(colors) {
    return `
     <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:50%;gap:12px;color:${colors.muted};">
       <div style="width:18px;height:18px;border:2px solid ${colors.border};border-top-color:${colors.accent};border-radius:50%;animation:pp-spin 1s linear infinite;"></div>
       <div style="font-size:0.72rem;letter-spacing:0.05em;">Loading progress...</div>
     </div>
     <style>@keyframes pp-spin { to { transform: rotate(360deg); } }</style>
   `;
}
export function renderError(colors, message) {
    return `
     <div style="padding:16px;border:1px solid ${colors.border};border-radius:4px;background:${colors.surface};color:${colors.danger};font-size:0.75rem;line-height:1.5;">
       <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:600;">
         ${alertIcon()} Sync error
       </div>
       <div style="color:${colors.text};opacity:0.85;">${escapeHtml(message)}</div>
     </div>
   `;
}
export function renderEmpty(colors, message) {
    return `
     <div style="display:flex;align-items:center;justify-content:center;height:50%;color:${colors.muted};font-size:0.72rem;text-align:center;padding:0 24px;">
       ${escapeHtml(message)}
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
//# sourceMappingURL=error.js.map