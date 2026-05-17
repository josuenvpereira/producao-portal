import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AdapterResult, RenderRun, ArtifactRef } from './types.js';

// Adapter da API do GitHub Actions p/ o workflow render-ep.yml.
// Contrato (de .github/workflows/render-ep.yml):
//  - job `render` é gateado por approve_paid_apis==true → se existe job
//    `render` não-skipped, houve aprovação de custo.
//  - artifacts: `ep-mp4-<ep>-<run_id>` (14d), `ep-audio-<ep>` (7d) — EFÊMEROS.
// Por isso o vault baixa imediatamente. Sem token → degrada (não derruba).

const API = 'https://api.github.com';
const WORKFLOW_FILE = 'render-ep.yml';

interface GhConfig {
  repo: string;
  token: string;
  vaultDir: string;
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'msu-producao-portal',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function ghJson<T>(url: string, token: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: headers(token),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 403 || res.status === 429) {
        // rate limit — backoff curto e tenta de novo
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function episodeFromArtifact(name: string): string | null {
  // ep-mp4-<episode>-<run_id>  |  ep-audio-<episode>
  let m = /^ep-mp4-(.+)-\d+$/.exec(name);
  if (m) return m[1] ?? null;
  m = /^ep-audio-(.+)$/.exec(name);
  return m ? (m[1] ?? null) : null;
}

interface GhRunsResp {
  workflow_runs?: Array<{
    id: number;
    name?: string;
    display_title?: string;
    status: string;
    conclusion: string | null;
    event: string;
    created_at: string;
    updated_at: string;
    html_url: string;
    head_sha: string;
    head_branch?: string;
  }>;
}
interface GhJobsResp {
  jobs?: Array<{ name: string; status: string; conclusion: string | null }>;
}
interface GhArtifactsResp {
  artifacts?: Array<{
    id: number;
    name: string;
    size_in_bytes: number;
    expired: boolean;
    expires_at: string;
  }>;
}

export async function fetchRenderData(cfg: GhConfig): Promise<
  AdapterResult<{ runs: RenderRun[]; artifacts: ArtifactRef[] }>
> {
  const notes: string[] = [];
  if (!cfg.token) {
    return {
      data: { runs: [], artifacts: [] },
      degraded: true,
      notes: ['GITHUB_TOKEN ausente — runs de render indisponíveis (degradado)'],
    };
  }

  const runsResp = await ghJson<GhRunsResp>(
    `${API}/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=40`,
    cfg.token,
  );
  if (!runsResp) {
    return {
      data: { runs: [], artifacts: [] },
      degraded: true,
      notes: ['Falha ao listar runs do GitHub Actions (degradado)'],
    };
  }

  const runs: RenderRun[] = [];
  const artifacts: ArtifactRef[] = [];

  for (const r of runsResp.workflow_runs ?? []) {
    const jobsResp = await ghJson<GhJobsResp>(
      `${API}/repos/${cfg.repo}/actions/runs/${r.id}/jobs`,
      cfg.token,
    );
    const jobs = (jobsResp?.jobs ?? []).map((j) => ({
      name: j.name,
      status: j.status,
      conclusion: j.conclusion,
    }));
    // render job não-skipped ⇒ approve_paid_apis foi true (gate do workflow).
    const renderJob = jobs.find((j) => j.name.toLowerCase().includes('render'));
    const approvePaidApis = !!renderJob && renderJob.conclusion !== 'skipped';

    const artResp = await ghJson<GhArtifactsResp>(
      `${API}/repos/${cfg.repo}/actions/runs/${r.id}/artifacts`,
      cfg.token,
    );
    let episode: string | null = null;
    for (const a of artResp?.artifacts ?? []) {
      const ep = episodeFromArtifact(a.name);
      if (ep && !episode) episode = ep;
      const kind: ArtifactRef['kind'] = a.name.startsWith('ep-mp4-')
        ? 'mp4'
        : a.name.startsWith('ep-audio-')
          ? 'audio'
          : 'other';
      const ref: ArtifactRef = {
        id: String(a.id),
        runId: String(r.id),
        episode: ep,
        name: a.name,
        kind,
        sizeBytes: a.size_in_bytes,
        expiresAt: a.expires_at,
        expired: a.expired,
      };
      artifacts.push(ref);
      // Vault durável: baixa MP4 não-expirado ainda não cacheado.
      if (kind === 'mp4' && !a.expired) {
        await downloadArtifact(cfg, a.id, ref).catch(() => {
          notes.push(`vault: falha ao baixar artifact ${a.name}`);
        });
      }
    }

    runs.push({
      runId: String(r.id),
      episode,
      channel: 'my-storage-units',
      status: r.status,
      conclusion: r.conclusion,
      approvePaidApis,
      event: r.event,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
      headSha: r.head_sha,
      jobs,
    });
  }

  return { data: { runs, artifacts }, degraded: false, notes };
}

/**
 * Baixa o zip do artifact pro vault (idempotente: pula se já existe).
 * A extração do render.mp4 de dentro do zip é feita na Fase 2 (rota de asset).
 */
async function downloadArtifact(
  cfg: GhConfig,
  artifactId: number,
  ref: ArtifactRef,
): Promise<void> {
  mkdirSync(cfg.vaultDir, { recursive: true });
  const dest = join(cfg.vaultDir, `${ref.name}.zip`);
  if (existsSync(dest)) return;
  const res = await fetch(
    `${API}/repos/${cfg.repo}/actions/artifacts/${artifactId}/zip`,
    { headers: headers(cfg.token), redirect: 'follow', signal: AbortSignal.timeout(60000) },
  );
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

export function vaultPathFor(vaultDir: string, artifactName: string): string {
  return join(vaultDir, `${artifactName}.zip`);
}
