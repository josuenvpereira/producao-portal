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

// Mini barras verticais no canto do KPI (igual ao modelo).
export function MiniBars({ values, w = 78, h = 40 }: { values: number[]; w?: number; h?: number }) {
  const max = Math.max(1, ...values);
  const n = values.length || 1;
  const bw = w / (n * 1.7);
  const gap = bw * 0.7;
  return (
    <svg width={w} height={h} aria-hidden>
      {values.map((v, i) => {
        const bh = Math.max(2, (v / max) * (h - 4));
        const last = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={h - bh}
            width={bw}
            height={bh}
            rx={1.5}
            fill={last ? 'var(--chart)' : 'var(--chart-soft)'}
          />
        );
      })}
    </svg>
  );
}

export function Kpi({
  label,
  value,
  foot,
  tone,
  chart,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: 'pos' | 'neg' | 'warn';
  chart?: ReactNode;
}) {
  return (
    <div className="card kpi">
      <div className="top">
        <div>
          <div className="label">{label}</div>
          <div className="value">{value}</div>
        </div>
        {chart}
      </div>
      {foot != null && <div className={`foot ${tone ?? 'muted'}`}>{foot}</div>}
    </div>
  );
}

export function Bars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="bars">
      {data.length === 0 && <span className="muted">sem dados</span>}
      {data.map((d) => (
        <div className="bar-row" key={d.label}>
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <span className="mono" style={{ textAlign: 'right' }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Panel({
  title,
  sub,
  right,
  flush,
  children,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  flush?: boolean; // sem padding no corpo (p/ tabelas edge-to-edge)
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {right}
      </div>
      <div className={flush ? 'panel-body flush' : 'panel-body'}>{children}</div>
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
