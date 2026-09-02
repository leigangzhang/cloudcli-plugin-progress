export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  divider: string;
  text: string;
  muted: string;
  accent: string;
  dim: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
}

export function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        bg: '#17171a',
        surface: '#232326',
        surfaceHover: '#2a2b2f',
        border: '#333438',
        divider: '#2e3033',
        text: '#e5e6eb',
        muted: '#8f959e',
        accent: '#4c88ff',
        dim: '#2a2b2f',
        accentSoft: 'rgba(76,136,255,0.16)',
        success: '#34c724',
        warning: '#ff8800',
        danger: '#f54a45',
        successSoft: 'rgba(52,199,36,0.16)',
        warningSoft: 'rgba(255,136,0,0.16)',
        dangerSoft: 'rgba(245,74,69,0.16)',
      }
    : {
        bg: '#f5f6f7',
        surface: '#ffffff',
        surfaceHover: '#f2f3f5',
        border: '#e5e6eb',
        divider: '#ebedf0',
        text: '#1f2329',
        muted: '#646a73',
        accent: '#3370ff',
        dim: '#f2f3f5',
        accentSoft: '#f0f5ff',
        success: '#34c724',
        warning: '#ff8800',
        danger: '#f54a45',
        successSoft: 'rgba(52,199,36,0.10)',
        warningSoft: 'rgba(255,136,0,0.10)',
        dangerSoft: 'rgba(245,74,69,0.10)',
      };
}
