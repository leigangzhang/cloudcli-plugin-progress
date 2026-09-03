export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  divider: string;
  text: string;
  muted: string;
  accent: string;
  accentHover: string;
  deepBlue: string;
  dim: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  successSoft: string;
  warningSoft: string;
  dangerSoft: string;
  turnPanel: string;
}

export function themeColors(dark: boolean): ThemeColors {
  return dark
    ? {
        bg: '#17171a',
        surface: '#232326',
        surfaceHover: '#2a2b2f',
        border: '#333438',
        divider: '#2e3033',
        text: '#f5f6f7',
        muted: '#9aa0a6',
        accent: '#4c88ff',
        accentHover: '#6ba1ff',
        deepBlue: '#8ab4f8',
        dim: '#2a2b2f',
        accentSoft: 'rgba(76,136,255,0.16)',
        success: '#34c724',
        warning: '#ff8800',
        danger: '#f54a45',
        successSoft: 'rgba(52,199,36,0.16)',
        warningSoft: 'rgba(255,136,0,0.16)',
        dangerSoft: 'rgba(245,74,69,0.16)',
        turnPanel: '#2a2826',
      }
    : {
        bg: '#f5f6f7',
        surface: '#ffffff',
        surfaceHover: '#f7f8fa',
        border: '#e5e6eb',
        divider: '#eef0f3',
        text: '#1f2329',
        muted: '#6f7785',
        accent: '#3370ff',
        accentHover: '#2e5bd7',
        deepBlue: '#1f4e79',
        dim: '#f2f3f5',
        accentSoft: '#eff4ff',
        success: '#34c724',
        warning: '#ff8800',
        danger: '#f54a45',
        successSoft: '#eaf7e9',
        warningSoft: '#fff4e5',
        dangerSoft: '#fdecec',
        turnPanel: '#f6f4f1',
      };
}
