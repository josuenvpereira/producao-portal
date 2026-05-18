import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import type { Node, Edge, NodeProps, NodeTypes } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import type { EsteiraData } from '../api';
import { useApi } from '../hooks';
import { useRefreshTick } from '../refresh';
import { StateBadge, Banner, Loading } from '../components';

// Esteira = o pipeline de produção visual (estilo n8n). Fonte 100%
// data-driven: nós = agentes do org.json `pipeline` (ordem do handoff);
// cada episódio cai no nó do ÚLTIMO `by_agent` do state_history. Clicar
// num episódio abre o detalhe (Episode), onde estão os artefatos reais.

interface EpItem { id: string; title: string; state: string | null; escalated: number }
interface PhaseData {
  emoji: string;
  name: string;
  role: string;
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
      <div className="ohead">
        <div className="oav">{data.emoji}</div>
        <div>
          <div className="oname">{data.name}</div>
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

const NODE_TYPES: NodeTypes = { phase: PhaseNode };

function build(
  d: EsteiraData,
  onOpen: (id: string) => void,
): { nodes: Node<PhaseData>[]; edges: Edge[] } {
  const inPipe = new Set(d.pipeline);
  const toItem = (e: EsteiraData['episodes'][number]): EpItem => ({
    id: e.episode_id,
    title: e.title || e.episode_id,
    state: e.state,
    escalated: e.escalated,
  });
  const orphans = d.episodes.filter((e) => !e.last_agent || !inPipe.has(e.last_agent));
  const nodes: Node<PhaseData>[] = [];
  const edges: Edge[] = [];
  let x = 0;

  if (orphans.length) {
    nodes.push({
      id: '__entrada__',
      type: 'phase',
      position: { x: 0, y: 0 },
      data: { emoji: '📥', name: 'Sem fase', role: 'sem handoff registrado', eps: orphans.map(toItem), onOpen },
    });
    x = 320;
  }

  d.agents.forEach((a, i) => {
    nodes.push({
      id: a.id,
      type: 'phase',
      position: { x: x + i * 320, y: 0 },
      data: {
        emoji: a.emoji,
        name: a.name,
        role: short(a.role),
        eps: d.episodes.filter((e) => e.last_agent === a.id).map(toItem),
        onOpen,
      },
    });
  });

  for (let i = 0; i < d.pipeline.length - 1; i++) {
    const s = d.pipeline[i];
    const t = d.pipeline[i + 1];
    if (s && t) {
      edges.push({
        id: `${s}-${t}`,
        source: s,
        target: t,
        type: 'bezier',
        animated: true,
        style: { stroke: 'var(--c-dev)', strokeWidth: 2 },
      });
    }
  }
  const first = d.pipeline[0];
  if (orphans.length && first) {
    edges.push({
      id: `entrada-${first}`,
      source: '__entrada__',
      target: first,
      type: 'bezier',
      style: { stroke: 'var(--border-strong)', strokeDasharray: '4 4' },
    });
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
        Nós = agentes do pipeline (org.json) · episódio posicionado pelo último
        handoff (state_history) · clique num episódio → detalhe + artefatos
        (read-only, não dispara agente).
      </div>
    </>
  );
}
