#!/usr/bin/env node
/**
 * generate_org_manifest.js — gera openclaw_workspaces/org.json (data-driven).
 *
 * FONTE DA VERDADE = roster real dos agentes do OpenClaw (cada agente = uma
 * branch lá; main = Jotaene/CEO). As pastas openclaw_workspaces/<x>/ deste
 * repo estão DESATUALIZADAS e por isso NÃO são mais a fonte — o roster abaixo
 * reflete a lista real informada pelo Josué. Ajustes finos persistem via
 * openclaw_workspaces/org.overrides.json (merge raso por id de agente).
 *
 * "Atualizável p/ novos projetos": editar ROSTER (ou o overrides) e rodar de
 * novo. O portal lê o org.json resultante.
 *
 * USO: node scripts/generate_org_manifest.js [--stdout]
 */
const fs = require('fs');
const path = require('path');

// Repo standalone: org.json fica na RAIZ do producao-portal (roster-driven,
// não depende mais de openclaw_workspaces/ do remotion_project).
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'org.json');
const OVERRIDES = path.join(ROOT, 'org.overrides.json');

// CEO = branch `main` (agente Jotaene), acima das duas squads.
// ROSTER REAL — extraído de `openclaw agents list` no VPS (2026-05-17).
// Agente = branch no OpenClaw; `main` = Jotaene (CEO). NÃO existe
// orquestrador-msu; o líder do Canal MSU é o `gerente-canal-msu`.
const CEO = {
  id: 'main', branch: 'main', emoji: '⚡',
  name: 'Jotaene', role: 'CEO · Comandante de Inteligência',
  model: 'deepseek-v4-pro',
};

// Dois times SEPARADOS. `lead:true` = gerente do time. `model` = real (CLI).
const SQUADS = [
  {
    id: 'conteudo', name: 'Conteúdo · Mensageria',
    agents: [
      { id: 'gerente-com', branch: 'gerente-com', emoji: '📋', name: 'Gerente Comunicação', role: 'Gerente · pautas (mensageria/Jotaene)', model: 'deepseek-v4-pro', lead: true },
      { id: 'analista-com', branch: 'analista-com', emoji: '✍️', name: 'Analista Comunicação', role: 'Analista · publica posts (WhatsApp)', model: 'deepseek-v4-flash' },
    ],
  },
  {
    id: 'canal_msu', name: 'Canal MSU · Vídeo',
    agents: [
      { id: 'gerente-canal-msu', branch: 'gerente-canal-msu', emoji: '📺', name: 'Gerente Canal MSU', role: 'Gerente do Canal MSU', model: 'deepseek-v4-flash', lead: true },
      { id: 'curador-msu', branch: 'curador-msu', emoji: '🔍', name: 'Curador de Vídeo', role: 'Curador · pesquisa de mercado', model: 'deepseek-v4-pro' },
      { id: 'roteirista-msu', branch: 'roteirista-msu', emoji: '✍️', name: 'Roteirista de Vídeo', role: 'Roteirista · narrativa + script.json', model: 'deepseek-v4-pro' },
      { id: 'diretor-criativo-msu', branch: 'diretor-criativo-msu', emoji: '🎨', name: 'Diretor Criativo de Vídeo', role: 'Diretor Criativo · branding', model: 'deepseek-v4-pro' },
      { id: 'produtor-msu', branch: 'produtor-msu', emoji: '🎬', name: 'Produtor de Vídeo', role: 'Produtor · TTS + render', model: 'deepseek-v4-flash' },
      { id: 'revisor-msu', branch: 'revisor-msu', emoji: '🔬', name: 'Revisor de Vídeo', role: 'Revisor · QA do MP4', model: 'deepseek-v4-pro' },
      { id: 'designer-msu', branch: 'designer-msu', emoji: '🎣', name: 'Designer de Hook', role: 'Designer de Hook · thumbnails', model: 'deepseek-v4-flash' },
    ],
  },
];

// Ordem canônica do pipeline de vídeo (arestas de handoff no organograma).
const PIPELINE = [
  'curador-msu', 'roteirista-msu', 'diretor-criativo-msu',
  'produtor-msu', 'revisor-msu', 'designer-msu',
];
const PIPELINE_STATES = [
  'NEW', 'CURADORIA', 'BRIEF_OK', 'ROTEIRO', 'SCRIPT_OK', 'BRANDING',
  'BRANDING_OK', 'PRODUCAO_AUDIO', 'AUDIO_OK', 'RENDER_QUEUED', 'RENDERED',
  'REVISAO', 'REVIEW_OK', 'PACKAGING', 'PACKAGED', 'READY_TO_PUBLISH',
  'PUBLISHED', 'REPROVADO', 'ESCALATED',
];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; }
}

// handsOffTo no canal MSU = próximo do PIPELINE (só agentes de vídeo).
function handsOff(id) {
  const i = PIPELINE.indexOf(id);
  return i >= 0 && i < PIPELINE.length - 1 ? [PIPELINE[i + 1]] : [];
}

function build() {
  const overrides = readJson(OVERRIDES);
  const squads = SQUADS.map((sq) => ({
    id: sq.id,
    name: sq.name,
    agents: sq.agents.map((a) => {
      const o = overrides[a.id] || {};
      return {
        ...a,
        handsOffTo: handsOff(a.id),
        ...o,
      };
    }),
  }));
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    project: 'Jotaene Serviços',
    ceo: { ...CEO, ...(overrides[CEO.id] || {}) },
    pipeline: PIPELINE,
    states: PIPELINE_STATES,
    squads,
  };
}

function main() {
  const manifest = build();
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (process.argv.includes('--stdout')) {
    process.stdout.write(json);
    return;
  }
  fs.writeFileSync(OUT, json);
  const n = manifest.squads.reduce((acc, s) => acc + s.agents.length, 0) + 1;
  console.log(`✅ org.json gerado: ${path.relative(ROOT, OUT)} (${n} agentes, CEO=${manifest.ceo.name})`);
}

main();
