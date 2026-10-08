// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22300] A flow's `get_record` serves exactly the `fields` its config names
 * when one of them is a `formula` field — the door the defect was measured on.
 *
 * `config.fields` is declared as "only these fields are read", and the executor
 * hands it to `find` / `findOne` as the projection. A formula field in it makes
 * the engine widen the DRIVER read to every stored column (the formula's CEL
 * reads `record.<field>` off the full row); the rows are then cut back to the
 * projection. What the node puts in its output variable — and so what any
 * later node can send on — is the projection plus the formula's value, never
 * the tenant, owner or audit columns of the record.
 *
 * Both node branches (`findOne` with no `limit`, `find` with `limit > 1`) under
 * both run identities. The reference is the same node with the formula left
 * out of `fields`: the formula read must serve that row plus the formula.
 *
 * [#22344] The one-row branch also names `id` in the projection it hands the
 * engine (its `output.id` is read off the row), so the row it serves carries
 * `id` beside the named fields; the list branch serves the named fields only.
 *
 * Composition: the real stack the other `*.integration.test.ts` files in this
 * package boot — `ObjectKernel`, `ObjectQLPlugin`, `driver-sql` on
 * better-sqlite3 `:memory:`, and the real `AutomationServicePlugin`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AutomationServicePlugin } from '../plugin.js';
import type { AutomationEngine } from '../engine.js';

const SYS = { isSystem: true, userId: 'usr_seed' } as const;
const OBJECT = 'pin_formula_line';

const LINE = {
  name: OBJECT,
  label: 'Line',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    quantity: { name: 'quantity', label: 'Quantity', type: 'number' },
    unit_price: { name: 'unit_price', label: 'Unit price', type: 'number' },
    note: { name: 'note', label: 'Note', type: 'text' },
    total_price: {
      name: 'total_price', label: 'Total', type: 'formula',
      expression: { dialect: 'cel', source: 'record.quantity * record.unit_price' },
    },
  },
};

type RunAs = 'system' | 'user';
type Branch = 'one' | 'list';

/** start → get_record(fields) → end, the read in a declared output. */
function readFlow(name: string, runAs: RunAs, branch: Branch, fields: string[]) {
  return {
    name,
    label: name,
    type: 'autolaunched',
    runAs,
    variables: [{ name: 'rec', type: 'object', isOutput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'read',
        type: 'get_record',
        label: 'Read',
        config: {
          objectName: OBJECT,
          filter: { name: 'Widget' },
          fields,
          outputVariable: 'rec',
          ...(branch === 'list' ? { limit: 5 } : {}),
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'read' },
      { id: 'e2', source: 'read', target: 'end' },
    ],
  };
}

const TRIGGER = { userId: 'usr_flow_reader', tenantId: 'org_1', positions: [] as string[], permissions: [] as string[] };

describe('flow get_record serves exactly its `fields` when one is a formula (#22300)', () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let seq = 0;

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.bootstrap();
    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.connect();
    ql.registerDriver(driver, true);
    ql.registry.registerObject(LINE as any, 'pin-22300', 'pin-22300');
    await ql.syncSchemas();
    await ql.insert(OBJECT, {
      id: 'line_1', name: 'Widget', quantity: 3, unit_price: 7, note: 'not requested',
      owner_id: 'usr_owner', organization_id: 'org_1',
    }, { context: SYS });
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* best-effort teardown */ }
  });

  /** Run the flow; the one row the node served. */
  async function served(runAs: RunAs, branch: Branch, fields: string[]): Promise<Record<string, unknown>> {
    seq += 1;
    const def = readFlow(`pin_formula_read_${seq}`, runAs, branch, fields);
    automation.registerFlow(def.name, def as any);
    const res: any = await automation.execute(def.name, { ...TRIGGER });
    expect(res.success, `run failed: ${JSON.stringify(res.error ?? res)}`).toBe(true);
    const rec = res.output?.rec;
    if (branch === 'list') {
      expect(Array.isArray(rec) && rec.length, 'the list branch served no row').toBe(1);
      return rec[0];
    }
    expect(rec, 'the one-row branch served nothing').toBeTruthy();
    return rec;
  }

  const CASES: Array<[RunAs, Branch]> = [['system', 'one'], ['system', 'list'], ['user', 'one'], ['user', 'list']];

  /** The one-row branch's `id` (#22344); the list branch adds nothing. */
  const idOf = (branch: Branch): Record<string, unknown> => (branch === 'one' ? { id: 'line_1' } : {});

  it.each(CASES)('runAs %s, %s: the formula read serves the named fields plus the formula, nothing else', async (runAs, branch) => {
    const row = await served(runAs, branch, ['name', 'total_price']);
    expect(Object.keys(row).sort()).toEqual([...Object.keys(idOf(branch)), 'name', 'total_price']);
    // 3 × 7 — computed from two columns the node never named.
    expect(row.total_price).toBe(21);
  });

  it.each(CASES)('runAs %s, %s: it equals the same read without the formula, plus the formula value', async (runAs, branch) => {
    const without = await served(runAs, branch, ['name', 'quantity']);
    expect(without, 'control: a projection with no formula is the named columns').toStrictEqual({ ...idOf(branch), name: 'Widget', quantity: 3 });
    const withFormula = await served(runAs, branch, ['name', 'quantity', 'total_price']);
    expect(withFormula).toStrictEqual({ ...without, total_price: 21 });
  });
});
