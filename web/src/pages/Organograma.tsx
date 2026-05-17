import { useMemo } from 'react';
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow';
import type { Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { api } from '../api';
import { useApi } from '../hooks';
import { Banner, Loading } from '../components';

// Grafo data-driven de openclaw_workspaces/org.json. Novos agentes/projetos
// → regerar org.json (CI) → o grafo se atualiza sozinho (sem hardcode).
export function Organograma() {
  const { data, error } = useApi(() => api.org(), []);

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    if (!data) return { nodes, edges };
    const pipeline = data.pipeline ?? [];
    const orderOf = (id: string) => {
      const i = pipeline.indexOf(id);
      return i === -1 ? 99 : i;
    };
    let squadRow = 0;
    for (const sq of data.squads) {
      const y = squadRow * 200;
      // rótulo da squad
      nodes.push({
        id: `squad:${sq.id}`,
        position: { x: -40, y: y - 70 },
        data: { label: `▦ ${sq.name}` },
        draggable: false,
        selectable: false,
        style: { background: 'transparent', border: 'none', color: 'var(--muted)', fontWeight: 700, width: 220 },
      });
      const sorted = [...sq.agents].sort((a, b) => orderOf(a.id) - orderOf(b.id));
      sorted.forEach((a, i) => {
        nodes.push({
          id: a.id,
          position: { x: i * 230, y },
          data: { label: `${a.emoji}  ${a.name}` },
          style: {
            background: 'var(--surface)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            fontSize: 12,
            width: 200,
            padding: 10,
          },
        });
      });
      squadRow++;
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const sq of data.squads) {
      for (const a of sq.agents) {
        for (const t of a.handsOffTo ?? []) {
          if (ids.has(t)) {
            edges.push({
              id: `${a.id}->${t}`,
              source: a.id,
              target: t,
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
              style: { stroke: 'var(--accent)' },
            });
          }
        }
        for (const s of a.supervises ?? []) {
          if (ids.has(s)) {
            edges.push({
              id: `${a.id}~>${s}`,
              source: a.id,
              target: s,
              style: { stroke: 'var(--muted)', strokeDasharray: '4 4' },
              markerEnd: { type: MarkerType.Arrow },
            });
          }
        }
      }
    }
    return { nodes, edges };
  }, [data]);

  if (!data) return <Loading error={error} />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Organograma</h1>
          <div className="sub">{data.project ?? 'Pipeline'} — data-driven (openclaw_workspaces/org.json)</div>
        </div>
      </div>
      <Banner notes={data.degraded} />
      <div className="card" style={{ height: '72vh', overflow: 'hidden' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          nodesDraggable
        >
          <Background color="var(--border)" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        → linha azul = handoff do pipeline · linha tracejada = supervisão (Orquestrador)
      </div>
    </>
  );
}
