import type { ReactNode } from 'react';

export function fmtUsd(n: number | null | undefined): string {
  return n == null ? '—' : `$${n.toFixed(2)}`;
}
export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
}

const DONE = ['PUBLISHED', 'REVIEW_OK', 'PACKAGED', 'READY_TO_PUBLISH', 'BRIEF_OK', 'SCRIPT_OK', 'BRANDING_OK', 'AUDIO_OK', 'RENDERED'];
const ERR = ['ESCALATED'];
const WARN = ['REPROVADO'];

export function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="badge b-idle">sem estado</span>;
  const cls = ERR.includes(state) ? 'b-err' : WARN.includes(state) ? 'b-warn' : DONE.includes(state) ? 'b-done' : 'b-prog';
  return <span className={`badge ${cls}`}>{state}</span>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' | 'warn' }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub != null && <div className={`delta ${tone ?? ''}`}>{sub}</div>}
    </div>
  );
}

export function Bars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars">
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="muted">{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="mono" style={{ textAlign: 'right' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Banner({ notes }: { notes?: string[] }) {
  if (!notes || notes.length === 0) return null;
  return <div className="banner">⚠ {notes.join(' · ')}</div>;
}

export function Loading({ error }: { error?: Error | null }) {
  if (error) return <div className="banner">erro: {error.message}</div>;
  return <div className="muted" style={{ padding: 20 }}>carregando…</div>;
}
