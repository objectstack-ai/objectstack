// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6/D7, #23609] `DatabaseLoader`'s count agrees with its reads on a
 * database the organization-ownership ceremony has not migrated. The family
 * declares no organization column; the physical column still holds each
 * legacy organization's rows, which `load()` and the history page leave out.
 * Counted with them, `exists()` answered true for an address only a legacy row
 * held (while `load()` answered null), and the history `total` counted rows no
 * page serves. Each case runs on that v17 shape and on a migrated store (the
 * CONTROL), whose answers are the ones the loader always gave.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseLoader } from './database-loader.js';

type Row = Record<string, unknown>;

/** Equality, `$and` and `$nin` — the subset these reads emit. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === '$and') {
      if (!(v as Row[]).every((clause) => matches(row, clause))) return false;
      continue;
    }
    if (k.startsWith('$')) throw new Error(`matches: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ops = v as Record<string, unknown>;
      for (const op of Object.keys(ops)) if (op !== '$nin') throw new Error(`matches: unsupported operator ${op}`);
      if ((ops.$nin as unknown[]).includes(row[k])) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

/** An engine over `seed`; `legacyShape` puts the physical organization column on disk. */
function engineOver(seed: Record<string, Row[]>, legacyShape: boolean) {
  const rowsOf = (t: string) => (seed[t] ?? []).filter((r) => legacyShape || !r.organization_id);
  const declared = ({ organization_id: _physical, ...row }: Row): Row => row;
  const select = (t: string, q?: { where?: Row; limit?: number; offset?: number }) => {
    const start = q?.offset ?? 0;
    return rowsOf(t).filter((r) => matches(r, q?.where))
      .slice(start, typeof q?.limit === 'number' ? start + q.limit : undefined).map(declared);
  };
  return {
    async find(t: string, q?: any) { return select(t, q); },
    async findOne(t: string, q?: any) { return select(t, q)[0] ?? null; },
    async count(t: string, q?: any) { return rowsOf(t).filter((r) => matches(r, q?.where)).length; },
    getDriverForObject(t: string) {
      return {
        dialectName: 'sqlite',
        async execute(sql: string) {
          if (/column_name/.test(sql)) {
            return [{ column_name: 'id' }, ...(legacyShape ? [{ column_name: 'organization_id' }] : [])];
          }
          return rowsOf(t).filter((r) => r.organization_id).map((r) => ({ id: r.id, organization_id: r.organization_id }));
        },
      };
    },
  };
}

const meta = (id: string, name: string, organization_id: string | null): Row => ({
  id, type: 'object', name, state: 'active', version: 1, checksum: `c_${id}`,
  metadata: JSON.stringify({ name }), organization_id,
});

const history = (id: string, version: number, organization_id: string | null): Row => ({
  id, type: 'object', name: 'account', version, operation_type: 'update',
  recorded_at: `2026-01-0${version}T00:00:00.000Z`, metadata: JSON.stringify({ name: 'account' }), organization_id,
});

const SHAPES = [
  { shape: 'v17 shape (legacy organization rows on disk)', legacyShape: true },
  { shape: 'CONTROL: a migrated store', legacyShape: false },
] as const;

describe('[#23609] DatabaseLoader counts what it reads: a legacy organization row is not counted', () => {
  for (const { shape, legacyShape } of SHAPES) {
    describe(shape, () => {
      it('exists() agrees with load() for an address only a legacy organization row holds', async () => {
        const engine = engineOver({ sys_metadata: [meta('o_1', 'org_only', 'org_a'), meta('e_1', 'account', null)] }, legacyShape);
        const loader = new DatabaseLoader({ engine: engine as any });
        expect(await loader.exists('object', 'org_only')).toBe(false);
        expect(await loader.load('object', 'org_only')).toMatchObject({ data: null });
        expect(await loader.exists('object', 'account'), 'the environment\'s row').toBe(true);
      });

      it('the history total counts the rows the history page serves', async () => {
        const engine = engineOver({
          sys_metadata_history: [history('h_1', 1, null), history('o_h', 2, 'org_a'), history('h_3', 3, null)],
        }, legacyShape);
        const loader = new DatabaseLoader({ engine: engine as any });
        const { records, total } = await loader.queryHistory('object', 'account');
        expect(records.map((r: { id: string }) => r.id).sort()).toEqual(['h_1', 'h_3']);
        expect(total).toBe(2);
      });
    });
  }
});
