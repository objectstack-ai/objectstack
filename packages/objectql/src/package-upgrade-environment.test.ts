// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment half of the package upgrade plan (epic cloud#3652 Q3,
 * #30884), read through the real `ObjectQL` engine over an in-memory driver:
 * rows in each column the upgrade touches, and rows a customer edited that the
 * seed replay overwrites.
 */

import { describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { planPackageUpgrade } from './package-upgrade-environment.js';

type Row = Record<string, unknown>;

/** In-memory driver: equality, `$in` and `$ne` WHERE; `find` honours `limit`. */
function makeDriver(rowsByObject: Record<string, Row[]>, failing: ReadonlySet<string> = new Set()) {
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w: any) => matches(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const value = row[k] === undefined ? null : row[k];
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.includes(value)) return false;
        continue;
      }
      if (v && typeof v === 'object' && '$ne' in (v as any)) {
        if (value === (v as any).$ne) return false;
        continue;
      }
      if (value !== (v === undefined ? null : v)) return false;
    }
    return true;
  };
  const rowsOf = (object: string) => {
    if (failing.has(object)) throw new Error(`connection lost reading ${object}`);
    return (rowsByObject[object] ?? []).map((row) => ({ ...row }));
  };
  return {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = rowsOf(object).filter((row) => matches(row, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) { return rowsOf(object).find((row) => matches(row, ast?.where)) ?? null; },
    async count(object: string, ast: any) { return rowsOf(object).filter((row) => matches(row, ast?.where)).length; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

async function makeEngine(objects: Array<{ name: string; fields: Record<string, unknown> }>, rows: Record<string, Row[]>, failing?: Set<string>) {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(rows, failing) as any, true);
  await engine.init();
  for (const object of objects) (engine.registry as any).registerObject(object);
  return engine;
}

const STAGE_FIELDS = { name: { type: 'text' }, label: { type: 'text' }, probability: { type: 'number' }, color: { type: 'text' } };
const STAGE = { name: 'acme_stage', fields: STAGE_FIELDS };

const stages = (labels: Record<string, string>) =>
  Object.entries(labels).map(([name, label]) => ({ name, label, probability: 10, color: 'grey' }));

describe('rows a customer edited that the seed replay overwrites', () => {
  it('a seeded upsert dataset with one row edited reports that row', async () => {
    const installed = { objects: [STAGE], data: [{ object: 'acme_stage', mode: 'upsert', records: stages({ new: 'New', won: 'Won', lost: 'Lost' }) }] };
    // The new version relabels `lost`, and changes nothing a customer touched.
    const incoming = { objects: [STAGE], data: [{ object: 'acme_stage', mode: 'upsert', records: stages({ new: 'New', won: 'Won', lost: 'Closed lost' }) }] };
    const engine = await makeEngine([STAGE], {
      acme_stage: [
        { id: 's1', name: 'new', label: 'New', probability: 10, color: 'grey' },
        // The customer's edit, which the replay writes `Won` back over.
        { id: 's2', name: 'won', label: 'Won (signed)', probability: 10, color: 'grey' },
        // As seeded: the replay's new label is an upgrade, not an erased edit.
        { id: 's3', name: 'lost', label: 'Lost', probability: 10, color: 'grey' },
      ],
    });

    const { plan, environment } = await planPackageUpgrade(engine, installed, incoming, { getObject: (n) => engine.registry.getObject(n) });

    expect(plan.seeds.changed.map((d) => d.key)).toEqual(['acme_stage']);
    expect(environment.seeds).toEqual([
      { key: 'acme_stage', object: 'acme_stage', mode: 'upsert', changed: true, matchedRows: 3, editedRows: 1, editedKeys: ['won'] },
    ]);
  });

  it('an unchanged upsert dataset overwrites the same edits, and says it is unchanged', async () => {
    const body = { objects: [STAGE], data: [{ object: 'acme_stage', mode: 'upsert', records: stages({ won: 'Won' }) }] };
    const engine = await makeEngine([STAGE], { acme_stage: [{ id: 's2', name: 'won', label: 'Signed', probability: 10, color: 'grey' }] });
    const { environment } = await planPackageUpgrade(engine, body, structuredClone(body));
    expect(environment.seeds).toEqual([expect.objectContaining({ changed: false, matchedRows: 1, editedRows: 1 })]);
  });

  it("an ignore dataset never writes over a matched row, so it is not read; nor is a column declared applyOn: 'create'", async () => {
    const engine = await makeEngine([STAGE], {
      acme_stage: [{ id: 's2', name: 'won', label: 'Won', probability: 90, color: 'grey' }],
      acme_tier: [{ id: 't1', name: 'gold', label: 'Platinum' }],
    });
    const { environment } = await planPackageUpgrade(
      engine,
      { data: [
        { object: 'acme_stage', mode: 'upsert', columns: { probability: { applyOn: 'create' } }, records: stages({ won: 'Won' }) },
        { object: 'acme_tier', records: [{ name: 'gold', label: 'Gold' }] },
      ] },
      { data: [
        { object: 'acme_stage', mode: 'upsert', columns: { probability: { applyOn: 'create' } }, records: stages({ won: 'Won' }) },
        { object: 'acme_tier', records: [{ name: 'gold', label: 'Gold tier' }] },
      ] },
      { getObject: (n) => engine.registry.getObject(n) },
    );
    expect(environment.seeds).toEqual([
      { key: 'acme_stage', object: 'acme_stage', mode: 'upsert', changed: false, matchedRows: 1, editedRows: 0, editedKeys: [] },
    ]);
  });

  it('a reading that fails is null, never zero, and is told', async () => {
    const warn = vi.fn();
    const body = { objects: [STAGE], data: [{ object: 'acme_stage', mode: 'upsert', records: stages({ won: 'Won' }) }] };
    const engine = await makeEngine([STAGE], {}, new Set(['acme_stage']));
    const { environment } = await planPackageUpgrade(engine, body, structuredClone(body), { warn });
    expect(environment.seeds).toEqual([expect.objectContaining({ matchedRows: null, editedRows: null })]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('answered null, never zero'), expect.objectContaining({ object: 'acme_stage' }));
  });
});

describe('rows in each column the upgrade touches', () => {
  const lead = (fields: Record<string, unknown>) => ({ name: 'acme_lead', fields });

  it('removed, suspected-rename, renamed and retyped columns, each with its rows; a removed object with its rows', async () => {
    const before = lead({
      company: { type: 'text' }, legacy: { type: 'text' }, amount: { type: 'text' }, total: { type: 'formula' }, region: { type: 'select' },
    });
    const after = lead({
      account_name: { type: 'text' }, amount_value: { type: 'number', renamedFrom: ['amount'] }, total: { type: 'number' }, area: { type: 'select', renamedFrom: ['region'] },
    });
    // The registry holds the installed object's stored columns (the computed
    // `total` and the option-less `region` would only add boot-log noise here).
    const registered = lead({ company: { type: 'text' }, legacy: { type: 'text' }, amount: { type: 'text' }, region: { type: 'text' } });
    const engine = await makeEngine([registered, { name: 'acme_old', fields: { x: { type: 'text' } } }], {
      acme_lead: [
        { id: 'l1', company: 'Acme', legacy: null, amount: '10', region: 'emea' },
        { id: 'l2', company: 'Globex', legacy: 'x', amount: null, region: null },
        { id: 'l3', company: null, legacy: null, amount: '7', region: 'apac' },
      ],
      acme_old: [{ id: 'o1', x: 'a' }, { id: 'o2', x: 'b' }],
    });

    const { environment } = await planPackageUpgrade(
      engine,
      { objects: [before, { name: 'acme_old', fields: { x: { type: 'text' } } }] },
      { objects: [after] },
    );

    expect(environment.columns).toEqual([
      { object: 'acme_lead', field: 'company', reasons: ['removed', 'suspected_rename'], rows: 2 },
      { object: 'acme_lead', field: 'legacy', reasons: ['removed', 'suspected_rename'], rows: 1 },
      { object: 'acme_lead', field: 'amount', reasons: ['renamed', 'type_change'], rows: 2 },
      { object: 'acme_lead', field: 'region', reasons: ['renamed'], rows: 2 },
    ]);
    // `total` was computed (formula → number is `safe`): no stored column to count.
    expect(environment.removedObjects).toEqual([{ object: 'acme_old', rows: 2 }]);
  });

  it('an identical pair reads nothing', async () => {
    const engine = await makeEngine([lead({ company: { type: 'text' } })], { acme_lead: [{ id: 'l1', company: 'Acme' }] });
    const body = { objects: [lead({ company: { type: 'text' } })] };
    expect((await planPackageUpgrade(engine, body, structuredClone(body))).environment).toEqual({ columns: [], removedObjects: [], seeds: [] });
  });
});

describe("the `manifest` service's planUpgrade", () => {
  it('folds a multi-package artifact with the platform reader and reads through the engine', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    try {
      const ql = kernel.getService<ObjectQL>('objectql');
      ql.registerDriver(makeDriver({ acme_lead: [{ id: 'l1', company: 'Acme' }, { id: 'l2', company: null }] }) as any, true);
      (ql.registry as any).registerObject({ name: 'acme_lead', fields: { company: { type: 'text' } } });
      const artifact = (fields: Record<string, unknown>) => ({
        packages: [{ manifest: { id: 'com.acme.crm', name: 'crm', version: '1.0.0', type: 'app', objects: [{ name: 'acme_lead', fields }] } }],
      });

      const manifest = kernel.getService<{ planUpgrade(a: unknown, b: unknown): ReturnType<typeof planPackageUpgrade> }>('manifest');
      const { plan, environment } = await manifest.planUpgrade(artifact({ company: { type: 'text' } }), artifact({ account_name: { type: 'text' } }));

      expect(plan.suspectedRenames.map((s) => `${s.field}→${s.candidates.map((c) => c.field).join('|')}`)).toEqual(['company→account_name']);
      expect(environment.columns).toEqual([{ object: 'acme_lead', field: 'company', reasons: ['removed', 'suspected_rename'], rows: 1 }]);
    } finally {
      await kernel.shutdown();
    }
  });
});
