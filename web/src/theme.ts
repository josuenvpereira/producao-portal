import { useEffect, useState } from 'react';

// Tema claro/escuro persistido. Default = claro (igual ao modelo). Aplica
// data-theme no <html>; o CSS resolve via [data-theme=dark].
export type Theme = 'light' | 'dark';
const KEY = 'portal-theme';

export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

export function applyTheme(t: Theme): void {
  document.documentElement.dataset['theme'] = t;
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}
