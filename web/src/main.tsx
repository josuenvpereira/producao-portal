import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, initialTheme } from './theme';
import './index.css';

applyTheme(initialTheme()); // antes do render — evita flash e cobre o login

const el = document.getElementById('root');
if (!el) throw new Error('#root ausente');
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
