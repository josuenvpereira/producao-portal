import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  useParams,
  useLocation,
} from 'react-router-dom';
import { api } from './api';
import { useSse } from './hooks';
import { useTheme } from './theme';
import { RefreshCtx } from './refresh';
import { Login } from './Login';
import { Overview } from './pages/Overview';
import { Esteira } from './pages/Esteira';
import { Episode } from './pages/Episode';
import { Custos } from './pages/Custos';
import { Comunicacao } from './pages/Comunicacao';
import { Organograma } from './pages/Organograma';
import { Sfx } from './pages/Sfx';
import { Assets } from './pages/Assets';

const CRUMB: Record<string, string> = {
  '/': 'Overview',
  '/esteira': 'Esteira',
  '/episodios': 'Episódios',
  '/custos': 'Custos',
  '/comunicacao': 'Comunicação',
  '/organograma': 'Organograma',
  '/sfx': 'SFX / Áudio',
  '/assets': 'Assets',
};

function Appbar({ onToggleTheme, theme }: { onToggleTheme: () => void; theme: string }) {
  const { pathname } = useLocation();
  const label = pathname.startsWith('/episodios/') ? 'Episódio' : (CRUMB[pathname] ?? 'Overview');
  return (
    <div className="appbar">
      <div className="crumb">
        Produção <span style={{ opacity: 0.5 }}>›</span> <b>{label}</b>
      </div>
      <div className="row">
        <span className="chip">ao vivo · SSE</span>
        <button
          className="btn icon"
          onClick={onToggleTheme}
          title={theme === 'light' ? 'Tema escuro' : 'Tema claro'}
          aria-label="Alternar tema"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const [tick, setTick] = useState(0);
  useSse(() => setTick((t) => t + 1));
  const [theme, toggleTheme] = useTheme();
  const link = ({ isActive }: { isActive: boolean }) => 'navlink' + (isActive ? ' active' : '');

  return (
    <RefreshCtx.Provider value={tick}>
      <div className="app">
        <nav className="sidebar">
          <div className="org">
            <div className="logo">P</div>
            <div>
              <b>Produção</b>
              <small>My Storage Units</small>
            </div>
          </div>

          <div className="nav-group">Principal</div>
          <NavLink to="/" end className={link}><span className="ic">▦</span> Dashboard</NavLink>
          <NavLink to="/esteira" className={link}><span className="ic">▤</span> Esteira</NavLink>
          <NavLink to="/episodios" className={link}><span className="ic">▷</span> Episódios</NavLink>

          <div className="nav-group">Custos & Org</div>
          <NavLink to="/custos" className={link}><span className="ic">$</span> Custos</NavLink>
          <NavLink to="/comunicacao" className={link}><span className="ic">✉</span> Comunicação</NavLink>
          <NavLink to="/organograma" className={link}><span className="ic">⌥</span> Organograma</NavLink>

          <div className="nav-group">Acervo</div>
          <NavLink to="/sfx" className={link}><span className="ic">♪</span> SFX / Áudio</NavLink>
          <NavLink to="/assets" className={link}><span className="ic">▣</span> Assets</NavLink>

          <div className="spacer" />
          <div className="usercard">
            <div className="av">O</div>
            <div>
              <b style={{ fontSize: 13 }}>Operador</b>
              <small>Squad MSU</small>
            </div>
            <button
              className="lo"
              title="Sair"
              onClick={() => api.logout().then(() => location.reload())}
            >
              ⎋
            </button>
          </div>
        </nav>

        <div className="main">
          <Appbar onToggleTheme={toggleTheme} theme={theme} />
          <div className="content">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/esteira" element={<Esteira />} />
              <Route path="/episodios" element={<Esteira />} />
              <Route path="/episodios/:id" element={<EpisodeRoute />} />
              <Route path="/custos" element={<Custos />} />
              <Route path="/comunicacao" element={<Comunicacao />} />
              <Route path="/organograma" element={<Organograma />} />
              <Route path="/sfx" element={<Sfx />} />
              <Route path="/assets" element={<Assets />} />
            </Routes>
          </div>
        </div>
      </div>
    </RefreshCtx.Provider>
  );
}

function EpisodeRoute() {
  const { id } = useParams();
  return <Episode id={id ?? ''} />;
}

export function App() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    api
      .me()
      .then((r) => setState(r.authenticated ? 'in' : 'out'))
      .catch(() => setState('out'));
  }, []);

  if (state === 'loading') return <div className="login muted">…</div>;
  if (state === 'out') return <Login onOk={() => setState('in')} />;
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
