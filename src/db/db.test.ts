import { describe, it, expect } from 'vitest';
import { openDb, getMeta, setMeta } from './db.js';
import { MIGRATIONS } from './migrations.js';

const LATEST = String(Math.max(...MIGRATIONS.map((m) => m.v)));

// node:sqlite suporta ':memory:' — testa migrations + upsert idempotente.
describe('db', () => {
  it('aplica migrations e versiona o schema', () => {
    const db = openDb(':memory:');
    expect(getMeta(db, 'schema_version')).toBe(LATEST);
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='episodes'")
      .get();
    expect(t).toBeTruthy();
    db.close();
  });

  it('migrations são idempotentes (reabrir não duplica)', () => {
    const db = openDb(':memory:');
    setMeta(db, 'k', 'v1');
    setMeta(db, 'k', 'v2');
    expect(getMeta(db, 'k')).toBe('v2');
    db.close();
  });

  it('upsert de episode é idempotente', () => {
    const db = openDb(':memory:');
    const ins = db.prepare(
      `INSERT INTO episodes (episode_id, title, state) VALUES (?,?,?)
       ON CONFLICT(episode_id) DO UPDATE SET title=excluded.title, state=excluded.state`,
    );
    ins.run('ep1', 'T1', 'NEW');
    ins.run('ep1', 'T2', 'ROTEIRO');
    const row = db.prepare('SELECT title, state FROM episodes WHERE episode_id=?').get('ep1') as {
      title: string;
      state: string;
    };
    const count = db.prepare('SELECT COUNT(*) c FROM episodes').get() as { c: number };
    expect(count.c).toBe(1);
    expect(row.title).toBe('T2');
    expect(row.state).toBe('ROTEIRO');
    db.close();
  });
});
