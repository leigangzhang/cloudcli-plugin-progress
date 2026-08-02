 export interface ThemeColors {
   bg: string;
   surface: string;
   border: string;
   text: string;
   muted: string;
   accent: string;
   dim: string;
   success: string;
   warning: string;
   danger: string;
 }

 export function themeColors(dark: boolean): ThemeColors {
   return dark
     ? {
         bg: '#08080f',
         surface: '#0e0e1a',
         border: '#1a1a2c',
         text: '#e2e0f0',
         muted: '#52507a',
         accent: '#fbbf24',
         dim: 'rgba(251,191,36,0.1)',
         success: '#10b981',
         warning: '#f59e0b',
         danger: '#f43f5e',
       }
     : {
         bg: '#fafaf9',
         surface: '#ffffff',
         border: '#e8e6f0',
         text: '#0f0e1a',
         muted: '#9490b0',
         accent: '#d97706',
         dim: 'rgba(217,119,6,0.08)',
         success: '#10b981',
         warning: '#f59e0b',
         danger: '#f43f5e',
       };
 }
