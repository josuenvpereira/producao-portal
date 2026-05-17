import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useParams } from 'react-router-dom';
import { api } from './api';
import { useSse } from './hooks';
import { RefreshCtx } from './refresh';
import { Login } from './Login';
import { Overview } from './pages/Overview';
import { Esteira } from './pages/Esteira';
import { Episode } from './pages/Episode';
import { Custos } from './pages/Custos';
import { Organograma } from './pages/Organograma';
import { Assets } from './pages/Assets';

function Shell() {
  const [tick, setTick] = useState(0);
  useSse(() => setTick((t) => t + 1));
  const link = ({ isActive }: { isActive: boolean }) => 'navlink' + (isActive ? ' active' : '');
  return (
    <RefreshCtx.Provider value={tick}>
      <div className="app">
        <nav className="sidebar">
          <div className="brand">
            <span style={{ fontSize: 22 }}>📦</span>
            <span>
              <b>Produção</b>
              <small>My Storage Units</small>
            </span>
          </div>
          <NavLink to="/" end className={link}>📊 Dashboard</NavLink>
          <NavLink to="/esteira" className={link}>🛠️ Esteira</NavLink>
          <NavLink to="/episodios" className={link}>🎬 Episódios</NavLink>
          <NavLink to="/custos" className={link}>💰 Custos</NavLink>
          <NavLink to="/organograma" className={link}>🧭 Organograma</NavLink>
          <NavLink to="/assets" className={link}>🗂️ Assets</NavLink>
          <div className="spacer" />
          <button className="logout" onClick={() => api.logout().then(() => location.reload())}>
            ⎋ Sair
          </button>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/esteira" element={<Esteira />} />
            <Route path="/episodios" element={<Esteira />} />
            <Route path="/episodios/:id" element={<EpisodeRoute />} />
            <Route path="/custos" element={<Custos />} />
            <Route path="/organograma" element={<Organograma />} />
            <Route path="/assets" element={<Assets />} />
          </Routes>
        </main>
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
