import type { ThemeColors } from './theme.js';
 import { alertIcon } from './icons.js';

export function renderLoading(colors: ThemeColors): string {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:240px;gap:12px;color:${colors.muted};">
      <div style="width:22px;height:22px;border:2px solid ${colors.divider};border-top-color:${colors.accent};border-radius:50%;animation:pp-spin 0.8s linear infinite;"></div>
      <div style="font-size:0.78rem;">Loading progress...</div>
    </div>
    <style>@keyframes pp-spin { to { transform: rotate(360deg); } }</style>
  `;
}

export function renderError(colors: ThemeColors, message: string): string {
  return `
    <div style="padding:14px 16px;border-left:3px solid ${colors.danger};border-radius:6px;background:${colors.dangerSoft};color:${colors.danger};font-size:0.76rem;line-height:1.6;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:600;">
        <span style="display:inline-flex;color:${colors.danger};">${alertIcon()}</span>
        <span>Sync error</span>
      </div>
      <div style="color:${colors.text};">${escapeHtml(message)}</div>
    </div>
  `;
}

export function renderEmpty(colors: ThemeColors, message: string): string {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:240px;gap:10px;color:${colors.muted};font-size:0.78rem;text-align:center;padding:0 24px;">
      <div style="width:34px;height:34px;border-radius:50%;background:${colors.surfaceHover};display:flex;align-items:center;justify-content:center;color:${colors.muted};">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
      </div>
      <div>${escapeHtml(message)}</div>
    </div>
  `;
}

 function escapeHtml(value: string): string {
   return value
     .replace(/&/g, '&amp;')
     .replace(/</g, '&lt;')
     .replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;')
     .replace(/'/g, '&#39;');
 }
