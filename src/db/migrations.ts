// Migrations versionadas do read-model. Idempotente: cada versão roda 1x,
// controlado por meta('schema_version'). Append-only — nunca editar uma
// migration já aplicada em produção; adicionar nova.

export const MIGRATIONS: ReadonlyArray<{ v: number; sql: string }> = [
  {
    v: 1,
    sql: `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Episódio = tarefa. Projeção de pipeline-state/<id>.json.
    CREATE TABLE IF NOT EXISTS episodes (
      episode_id    TEXT PRIMARY KEY,
      channel       TEXT,
      title         TEXT,
      state         TEXT,
      escalated     INTEGER DEFAULT 0,
      created_at    TEXT,
      updated_at    TEXT,
      attempts_json TEXT,
      content_hash  TEXT,
      indexed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS state_history (
      episode_id TEXT,
      seq        INTEGER,
      at         TEXT,
      from_state TEXT,
      to_state   TEXT,
      by_agent   TEXT,
      note       TEXT,
      PRIMARY KEY (episode_id, seq)
    );

    -- Handoff agente→agente, derivado de state_history (by muda entre passos).
    CREATE TABLE IF NOT EXISTS handoffs (
      episode_id TEXT,
      seq        INTEGER,
      at         TEXT,
      from_agent TEXT,
      to_agent   TEXT,
      to_state   TEXT,
      note       TEXT,
      PRIMARY KEY (episode_id, seq)
    );

    CREATE TABLE IF NOT EXISTS escalations (
      episode_id TEXT,
      at         TEXT,
      stage      TEXT,
      attempts   INTEGER,
      reason     TEXT,
      from_state TEXT,
      PRIMARY KEY (episode_id, at)
    );

    -- Sinal de aprovação de custo (_COST_APPROVAL_<id>.json).
    CREATE TABLE IF NOT EXISTS cost_signals (
      episode_id    TEXT PRIMARY KEY,
      at            TEXT,
      type          TEXT,
      projected_usd REAL,
      budget_usd    REAL,
      chars         INTEGER,
      scenes        INTEGER,
      files_json    TEXT
    );

    -- Rastreabilidade tarefa→artefato: blocos do script.json.
    CREATE TABLE IF NOT EXISTS script_blocks (
      episode_id     TEXT,
      block_id       TEXT,
      ord            INTEGER,
      kind           TEXT,
      audio_file     TEXT,
      duration_frames INTEGER,
      spoken_chars   INTEGER,
      images_json    TEXT,
      PRIMARY KEY (episode_id, block_id)
    );

    -- Assets versionados no repo (áudio/imagem/brand) por episódio.
    CREATE TABLE IF NOT EXISTS assets (
      episode_id TEXT,
      kind       TEXT,
      rel_path   TEXT,
      bytes      INTEGER,
      mtime      TEXT,
      PRIMARY KEY (rel_path)
    );

    -- Runs do GitHub Actions render-ep.yml.
    CREATE TABLE IF NOT EXISTS render_runs (
      run_id            TEXT PRIMARY KEY,
      episode           TEXT,
      channel           TEXT,
      status            TEXT,
      conclusion        TEXT,
      approve_paid_apis INTEGER,
      event             TEXT,
      created_at        TEXT,
      updated_at        TEXT,
      html_url          TEXT,
      head_sha          TEXT,
      jobs_json         TEXT
    );

    -- Artifacts (MP4/áudio) — efêmeros no GH; vault durável local.
    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      run_id       TEXT,
      episode      TEXT,
      name         TEXT,
      kind         TEXT,
      size_bytes   INTEGER,
      expires_at   TEXT,
      expired      INTEGER DEFAULT 0,
      vault_path   TEXT,
      downloaded_at TEXT
    );

    -- Consumo de tokens/custo (OpenClaw /usage + ElevenLabs derivado).
    CREATE TABLE IF NOT EXISTS token_usage (
      id        TEXT PRIMARY KEY,
      at        TEXT,
      period    TEXT,
      agent     TEXT,
      source    TEXT,
      tokens    INTEGER,
      cost_usd  REAL,
      raw_json  TEXT
    );

    -- Estimativa de custo TTS por episódio (derivada do spokenText).
    CREATE TABLE IF NOT EXISTS cost_estimates (
      episode_id    TEXT PRIMARY KEY,
      tts_chars     INTEGER,
      tts_cost_usd  REAL,
      computed_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runs_episode ON render_runs(episode);
    CREATE INDEX IF NOT EXISTS idx_usage_period ON token_usage(period);
    CREATE INDEX IF NOT EXISTS idx_hist_episode ON state_history(episode_id);
  `,
  },
  {
    v: 2,
    sql: `
    -- Crons do OpenClaw (esteira de Comunicação) — snapshot via exporter host.
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id            TEXT PRIMARY KEY,
      agent_id      TEXT,
      name          TEXT,
      description   TEXT,
      enabled       INTEGER,
      schedule_expr TEXT,
      tz            TEXT,
      status        TEXT,
      last_run_at   INTEGER,
      last_status   TEXT,
      last_duration INTEGER,
      next_run_at   INTEGER,
      consec_errors INTEGER
    );
    CREATE TABLE IF NOT EXISTS cron_runs (
      job_id      TEXT,
      session_id  TEXT,
      agent_id    TEXT,
      at_ms       INTEGER,
      action      TEXT,
      status      TEXT,
      summary     TEXT,
      duration_ms INTEGER,
      model       TEXT,
      in_tokens   INTEGER,
      out_tokens  INTEGER,
      total_tokens INTEGER,
      PRIMARY KEY (job_id, session_id)
    );
    CREATE TABLE IF NOT EXISTS agent_usage (
      agent_id    TEXT,
      model       TEXT,
      sessions    INTEGER,
      in_tokens   INTEGER,
      out_tokens  INTEGER,
      total_tokens INTEGER,
      cost_usd    REAL,
      PRIMARY KEY (agent_id, model)
    );
    CREATE INDEX IF NOT EXISTS idx_cronruns_job ON cron_runs(job_id);
    CREATE INDEX IF NOT EXISTS idx_cronruns_at ON cron_runs(at_ms);
  `,
  },
];
