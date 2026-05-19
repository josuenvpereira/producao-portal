import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap, Handle, Position } from 'reactflow';
import type { Node, Edge, NodeProps, NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import type { EsteiraData, EsteiraAgent } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { StateBadge, Banner, Loading } from '../components';

// Esteira = o pipeline de produção visual (estilo n8n). Fonte 100%
// data-driven: nós = agentes de TODOS os squads do org.json; as arestas
// vêm do `handsOffTo` de cada agente (gerado em generate_org_manifest.js,
// nada inferido aqui). Cada episódio cai no nó do ÚLTIMO `by_agent` do
// state_history. Clicar num episódio abre o detalhe (Episode).

interface EpItem { id: string; title: string; state: string | null; escalated: number }
interface PhaseData {
  emoji: string;
  name: string;
  role: string;
  squad: string;
  lead: boolean;
  eps: EpItem[];
  onOpen: (id: string) => void;
}

function short(role: string): string {
  const head = role.split(/[—.:·\n]/)[0]?.trim() ?? role;
  return head.length > 42 ? head.slice(0, 40).trimEnd() + '…' : head;
}

function PhaseNode({ data }: NodeProps<PhaseData>) {
  return (
    <div className="onode" style={{ width: 260 }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="ohead">
        <div className="oav">{data.emoji}</div>
        <div style={{ minWidth: 0 }}>
          <div className="oname">
            {data.name}
            {data.lead && <span className="badge b-prog" style={{ marginLeft: 6 }}>lead</span>}
          </div>
          <div className="orole">{data.role}</div>
        </div>
      </div>
      <div className="ostats" style={{ gridTemplateColumns: '1fr' }}>
        <div className="ostat">
          <b>{data.eps.length}</b>
          <span>episódio(s) nesta fase</span>
        </div>
      </div>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.eps.length === 0 && <span className="muted" style={{ fontSize: 11 }}>—</span>}
        {data.eps.slice(0, 8).map((e) => (
          <button
            key={e.id}
            className="oact"
            style={{ width: '100%', margin: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => data.onOpen(e.id)}
            title={e.title}
          >
            <StateBadge state={e.state} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.title}
            </span>
            {e.escalated ? <span className="badge b-err">!</span> : null}
          </button>
        ))}
        {data.eps.length > 8 && (
          <span className="muted" style={{ fontSize: 11 }}>+{data.eps.length - 8} mais</span>
        )}
      </div>
    </div>
  );
}

function SquadLabel({ data }: NodeProps<{ name: string }>) {
  return <div className="esq-lane-label">{data.name}</div>;
}

const NODE_TYPES: NodeTypes = { phase: PhaseNode, squad: SquadLabel };

const COL_W = 320;
const ROW_H = 540;

// Ordena os agentes de um squad pela cadeia de handoff (Kahn). Líderes
// entram primeiro entre as raízes; ciclos/sobras preservam ordem original.
function orderSquad(agents: EsteiraAgent[]): EsteiraAgent[] {
  const ids = new Set(agents.map((a) => a.id));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const indeg = new Map<string, number>();
  agents.forEach((a) => indeg.set(a.id, 0));
  agents.forEach((a) =>
    a.handsOffTo.forEach((t) => {
      if (ids.has(t)) indeg.set(t, (indeg.get(t) ?? 0) + 1);
    }),
  );
  const queue = agents
    .filter((a) => (indeg.get(a.id) ?? 0) === 0)
    .sort((a, b) => Number(b.lead) - Number(a.lead));
  const out: EsteiraAgent[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const a = queue.shift();
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
    for (const t of a.handsOffTo) {
      if (!ids.has(t) || seen.has(t)) continue;
      indeg.set(t, (indeg.get(t) ?? 1) - 1);
      if ((indeg.get(t) ?? 0) <= 0) {
        const n = byId.get(t);
        if (n) queue.push(n);
      }
    }
  }
  for (const a of agents) if (!seen.has(a.id)) out.push(a);
  return out;
}

function build(
  d: EsteiraData,
  onOpen: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const known = new Set(d.agents.map((a) => a.id));
  const toItem = (e: EsteiraData['episodes'][number]): EpItem => ({
    id: e.episode_id,
    title: e.title || e.episode_id,
    state: e.state,
    escalated: e.escalated,
  });
  const epsOf = (id: string) =>
    d.episodes.filter((e) => e.last_agent === id).map(toItem);
  const orphans = d.episodes.filter(
    (e) => !e.last_agent || !known.has(e.last_agent),
  );

  // Agrupa por squad preservando a ordem de chegada (Comunicação, depois MSU).
  const order: string[] = [];
  const bySquad = new Map<string, { name: string; agents: EsteiraAgent[] }>();
  for (const a of d.agents) {
    let g = bySquad.get(a.squadId);
    if (!g) {
      g = { name: a.squadName, agents: [] };
      bySquad.set(a.squadId, g);
      order.push(a.squadId);
    }
    g.agents.push(a);
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let row = 0;

  if (orphans.length) {
    nodes.push({
      id: '__entrada__',
      type: 'phase',
      position: { x: 0, y: 0 },
      data: {
        emoji: '📥',
        name: 'Sem fase',
        role: 'sem handoff registrado',
        squad: '',
        lead: false,
        eps: orphans.map(toItem),
        onOpen,
      },
    });
    row = 1;
  }

  for (const sid of order) {
    const g = bySquad.get(sid);
    if (!g) continue;
    const y = row * ROW_H;
    nodes.push({
      id: `__lane_${sid}`,
      type: 'squad',
      position: { x: -220, y: y + 8 },
      data: { name: g.name },
      draggable: false,
      selectable: false,
    });
    orderSquad(g.agents).forEach((a, col) => {
      nodes.push({
        id: a.id,
        type: 'phase',
        position: { x: col * COL_W, y },
        data: {
          emoji: a.emoji,
          name: a.name,
          role: short(a.role),
          squad: g.name,
          lead: a.lead,
          eps: epsOf(a.id),
          onOpen,
        },
      });
    });
    row += 1;
  }

  // Arestas = handsOffTo de cada agente (n8n look). Nada inferido.
  for (const a of d.agents) {
    for (const t of a.handsOffTo) {
      if (!known.has(t)) continue;
      edges.push({
        id: `${a.id}-${t}`,
        source: a.id,
        target: t,
        type: 'smoothstep',
        animated: true,
        style: { stroke: 'var(--c-dev)', strokeWidth: 2 },
      });
    }
  }
  return { nodes, edges };
}

export function Esteira() {
  const tick = useRefreshTick();
  const navigate = useNavigate();
  const { data, error } = useApi(() => api.esteira(), [tick]);

  const graph = useMemo(
    () => (data ? build(data, (id) => navigate(`/episodios/${id}`)) : { nodes: [], edges: [] }),
    [data, navigate],
  );

  if (!data) return <Loading error={error} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Esteira</h1>
          <div className="sub">
            Pipeline de produção fase a fase · {data.episodes.length} episódio(s) · atualiza ao vivo (SSE)
          </div>
        </div>
      </div>
      <Banner notes={data.degraded} />

      <div className="orgwrap">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          nodesDraggable={false}
        >
          <Background color="var(--border)" gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#52525b" maskColor="rgba(0,0,0,0.5)" />
        </ReactFlow>
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Nós = agentes de todos os squads (org.json) · arestas = handoff real
        (handsOffTo) · episódio posicionado pelo último handoff (state_history)
        · clique num episódio → detalhe + artefatos (read-only).
      </div>
    </>
  );
}
