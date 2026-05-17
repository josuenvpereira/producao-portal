import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
} from 'reactflow';
import type { Node, Edge, NodeChange, NodeProps, NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import type { OrgManifest, Overview } from '../api';
import { useApi } from '../hooks';
import { Loading } from '../components';

type View = 'squads' | 'agentes';
const POS_KEY = (v: View) => `org-pos-${v}`;

// ── Custom nodes ───────────────────────────────────────────────────────────
interface Stat { v: string | number; l: string }
interface NodeData {
  variant: 'ceo' | 'gov' | 'ops' | 'plain';
  emoji: string;
  name: string;
  role: string;
  stats?: Stat[];
  chips?: string[];
  actionLabel?: string;
  onOpen?: () => void;
}

function CardNode({ data }: NodeProps<NodeData>) {
  const lvl =
    data.variant === 'ceo' ? 'lvl-ceo' : data.variant === 'gov' ? 'lvl-gov' : data.variant === 'ops' ? 'lvl-ops' : '';
  return (
    <div className={`onode ${lvl}`}>
      <div className="ohead">
        <div className="oav">{data.emoji}</div>
        <div>
          <div className="oname">{data.name}</div>
          <div className="orole">{data.role}</div>
        </div>
      </div>
      {data.stats && data.stats.length > 0 && (
        <div className="ostats">
          {data.stats.map((s, i) => (
            <div className="ostat" key={i}>
              <b>{s.v}</b>
              <span>{s.l}</span>
            </div>
          ))}
        </div>
      )}
      {data.actionLabel && (
        <button className="oact" onClick={() => data.onOpen?.()}>
          ↗ {data.actionLabel}
        </button>
      )}
    </div>
  );
}

function BandNode({ data }: NodeProps<NodeData>) {
  return (
    <div className="oband" style={{ color: `var(--c-${data.variant === 'ops' ? 'ops' : 'gov'})` }}>
      {data.name}
      <small>{data.role}</small>
    </div>
  );
}

function AgentNode({ data }: NodeProps<NodeData>) {
  return (
    <div className="onode oagent" onClick={() => data.onOpen?.()} style={{ cursor: 'pointer' }}>
      <div className="ohead" style={{ padding: 0 }}>
        <div className="oav">{data.emoji}</div>
        <div>
          <div className="oname">{data.name}</div>
          <div className="orole">{data.role}</div>
        </div>
      </div>
      {data.chips && data.chips.length > 0 && (
        <div className="ochips">
          {data.chips.map((c) => (
            <span className="ochip" key={c}>⚡ {c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { card: CardNode, band: BandNode, agent: AgentNode };

// ── Builders (dados reais de /api/org + /api/overview) ─────────────────────
function num(n: number | undefined): number { return n ?? 0; }
// Papel curto p/ caber no card (org.json traz frase longa).
function short(role: string): string {
  const head = role.split(/[—.:·\n]/)[0]?.trim() ?? role;
  return head.length > 54 ? head.slice(0, 52).trimEnd() + '…' : head;
}

function buildSquads(org: OrgManifest, ov: Overview | null, navigate: (p: string) => void) {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];
  const squads = org.squads ?? [];
  const allAgents = squads.flatMap((s) => s.agents);
  const lead = squads.find((s) => s.id === 'gestao')?.agents ?? [];
  const gerente = lead.find((a) => a.id.includes('gerente'));
  const orq = lead.find((a) => a.id.includes('orquestrador'));

  const MID = 560;
  const GX = 180, OX = 940; // x da liderança/banda gov / ops
  nodes.push({
    id: 'ceo', type: 'card', position: { x: MID, y: 0 },
    data: {
      variant: 'ceo', emoji: '🧠', name: 'Josué', role: 'CEO · Comandante',
      stats: [
        { v: allAgents.length, l: 'Agentes' },
        { v: squads.length, l: 'Squads' },
        { v: (org.states ?? []).length, l: 'Estados' },
        { v: ov?.recentHandoffs.length ?? 0, l: 'Handoffs' },
      ],
      actionLabel: 'Dashboard', onOpen: () => navigate('/'),
    },
  });

  const leads = [
    { a: gerente, variant: 'gov' as const, x: GX, band: 'gestao' },
    { a: orq, variant: 'ops' as const, x: OX, band: 'video_msu' },
  ];
  for (const L of leads) {
    if (!L.a) continue;
    nodes.push({
      id: L.a.id, type: 'card', position: { x: L.x, y: 210 },
      data: {
        variant: L.variant, emoji: L.a.emoji, name: L.a.name, role: short(L.a.role),
        stats: [
          { v: allAgents.length, l: 'Agentes' },
          { v: num(ov?.kpis.inPipeline), l: 'Esteira' },
          { v: num(ov?.kpis.published), l: 'Publicados' },
          { v: num(ov?.kpis.escalated), l: 'Escalados' },
        ],
        actionLabel: 'Ver esteira', onOpen: () => navigate('/esteira'),
      },
    });
    edges.push({
      id: `ceo-${L.a.id}`, source: 'ceo', target: L.a.id, type: 'bezier',
      style: { stroke: `var(--c-${L.variant})`, strokeWidth: 2 }, animated: true,
    });
  }

  // bandas (1 por squad) + cards de agente sob a banda
  squads.forEach((sq) => {
    const color = sq.id === 'gestao' ? 'gov' : 'ops';
    const bandX = sq.id === 'gestao' ? GX : OX;
    const bandId = `band-${sq.id}`;
    nodes.push({
      id: bandId, type: 'band', position: { x: bandX + 40, y: 410 },
      data: { variant: color, emoji: '', name: sq.name.toUpperCase(), role: `${sq.agents.length} agente(s)` },
    });
    const parent = sq.id === 'gestao' ? gerente?.id : orq?.id;
    if (parent) edges.push({
      id: `${parent}-${bandId}`, source: parent, target: bandId, type: 'bezier',
      style: { stroke: `var(--c-${color})`, strokeWidth: 2 },
    });
    // agentes que não são liderança — grade 2 colunas (não empilha alto)
    const members = sq.agents.filter((a) => a.id !== gerente?.id && a.id !== orq?.id);
    members.forEach((a, ai) => {
      nodes.push({
        id: a.id, type: 'agent',
        position: { x: bandX - 110 + (ai % 2) * 280, y: 540 + Math.floor(ai / 2) * 170 },
        data: {
          variant: 'plain', emoji: a.emoji, name: a.name, role: short(a.role),
          chips: (a.handsOffTo ?? []).slice(0, 3).map((h) => h.replace(/_/g, '-')),
          onOpen: () => navigate('/esteira'),
        },
      });
      edges.push({
        id: `${bandId}-${a.id}`, source: bandId, target: a.id, type: 'smoothstep',
        style: { stroke: `var(--c-${color})`, strokeWidth: 1.5 },
      });
    });
  });

  // supervisão do orquestrador (tracejada) → agentes do pipeline
  if (orq) {
    for (const aid of org.pipeline ?? []) {
      if (nodes.some((n) => n.id === aid)) {
        edges.push({
          id: `sup-${aid}`, source: orq.id, target: aid, type: 'bezier',
          style: { stroke: 'var(--c-ops)', strokeDasharray: '4 4', opacity: 0.5 },
        });
      }
    }
  }
  return { nodes, edges };
}

function buildAgentes(org: OrgManifest, navigate: (p: string) => void) {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];
  const order = org.pipeline ?? [];
  const all = (org.squads ?? []).flatMap((s) => s.agents);
  const idx = (id: string) => { const i = order.indexOf(id); return i === -1 ? 90 : i; };
  const sorted = [...all].sort((a, b) => idx(a.id) - idx(b.id));
  sorted.forEach((a, i) => {
    nodes.push({
      id: a.id, type: 'agent', position: { x: i * 250, y: (i % 2) * 130 },
      data: {
        variant: 'plain', emoji: a.emoji, name: a.name, role: short(a.role),
        chips: (a.handsOffTo ?? []).map((h) => h.replace(/_/g, '-')),
        onOpen: () => navigate('/esteira'),
      },
    });
    for (const t of a.handsOffTo ?? []) {
      if (all.some((x) => x.id === t)) edges.push({
        id: `${a.id}-${t}`, source: a.id, target: t, type: 'bezier', animated: true,
        style: { stroke: 'var(--c-dev)', strokeWidth: 2 },
      });
    }
    for (const s of a.supervises ?? []) {
      if (all.some((x) => x.id === s)) edges.push({
        id: `${a.id}~${s}`, source: a.id, target: s, type: 'bezier',
        style: { stroke: 'var(--c-ops)', strokeDasharray: '4 4', opacity: 0.55 },
      });
    }
  });
  return { nodes, edges };
}

function loadPos(v: View): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(POS_KEY(v)) ?? '{}'); } catch { return {}; }
}

// ── Página ─────────────────────────────────────────────────────────────────
export function Organograma() {
  const navigate = useNavigate();
  const { data: org, error } = useApi(() => api.org(), []);
  const { data: ov } = useApi(() => api.overview(), []);
  const [view, setView] = useState<View>('squads');
  const [squadFilter, setSquadFilter] = useState('all');

  const base = useMemo(() => {
    if (!org) return { nodes: [] as Node<NodeData>[], edges: [] as Edge[] };
    const b = view === 'squads' ? buildSquads(org, ov, navigate) : buildAgentes(org, navigate);
    const saved = loadPos(view);
    let nodes = b.nodes.map((n) =>
      saved[n.id] ? { ...n, position: saved[n.id]! } : n,
    );
    let edges = b.edges;
    if (squadFilter !== 'all') {
      const keep = new Set(
        (org.squads.find((s) => s.id === squadFilter)?.agents ?? []).map((a) => a.id),
      );
      keep.add('ceo');
      keep.add(`band-${squadFilter}`);
      nodes = nodes.filter((n) => keep.has(n.id));
      const ids = new Set(nodes.map((n) => n.id));
      edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    }
    return { nodes, edges };
  }, [org, ov, view, squadFilter, navigate]);

  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [sig, setSig] = useState('');
  const curSig = `${view}|${squadFilter}|${base.nodes.length}`;
  if (curSig !== sig) {
    setSig(curSig);
    setNodes(base.nodes);
  }
  const onNodesChange = useCallback(
    (ch: NodeChange[]) => setNodes((nds) => applyNodeChanges(ch, nds)),
    [],
  );

  const save = () => {
    const map: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) map[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
    localStorage.setItem(POS_KEY(view), JSON.stringify(map));
  };
  const reset = () => {
    localStorage.removeItem(POS_KEY(view));
    setNodes(base.nodes.map((n) => ({ ...n })));
    setSig('');
  };

  if (!org) return <Loading error={error} />;
  const squads = org.squads ?? [];
  const total = squads.reduce((a, s) => a + s.agents.length, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Organograma</h1>
          <div className="sub">{org.project ?? 'Pipeline'} — data-driven (openclaw_workspaces/org.json)</div>
        </div>
      </div>

      <div className="orgwrap">
        <div className="opanel">
          <h2>Organograma</h2>
          <div className="ph">Arraste nós para reorganizar</div>

          <div className="plabel">Visualização</div>
          <div className="seg">
            <button className={view === 'squads' ? 'on' : ''} onClick={() => setView('squads')}>Squads</button>
            <button className={view === 'agentes' ? 'on' : ''} onClick={() => setView('agentes')}>Agentes</button>
          </div>

          <div className="plabel">Filtrar squad</div>
          <select value={squadFilter} onChange={(e) => setSquadFilter(e.target.value)}>
            <option value="all">Todos ({total})</option>
            {squads.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.agents.length})</option>
            ))}
          </select>

          <div className="prow">
            <button className="btn primary" onClick={save}>Salvar</button>
            <button className="btn" onClick={reset} title="Restaurar layout">↻</button>
          </div>

          <div className="plabel">Legenda</div>
          <div className="oleg">
            <div><i style={{ background: 'var(--c-ceo)' }} /> CEO (Josué)</div>
            <div><i style={{ background: 'var(--c-gov)' }} /> Gerente Canal MSU</div>
            <div><i style={{ background: 'var(--c-ops)' }} /> Orquestrador MSU</div>
            <div><i style={{ background: 'var(--c-dev)' }} /> Agentes / squads</div>
          </div>
        </div>

        <ReactFlow
          nodes={nodes}
          edges={base.edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
        >
          <Background color="var(--border)" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#52525b" maskColor="rgba(0,0,0,0.5)" />
        </ReactFlow>
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Linhas cheias = hierarquia/handoff · tracejadas = supervisão (Orquestrador) ·
        “Ver” abre a esteira (read-only — não dispara agente)
      </div>
    </>
  );
}
