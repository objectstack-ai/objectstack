// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22445 (d4) — the `update`-mode preview keeps a stored column only where the
// read door served the caller that very value, so a column the read door
// served TRANSFORMED (a partial mask) is judged as empty. This file is the
// representation control for that comparison, on a real driver (driver-sql over
// SQLite): a plain readable column of every common type must reach the rules
// as its stored value. If the read door and the prior-row read represented one
// of them differently, the comparison would judge a readable column empty and
// the preview would answer on less than the write knows.
//
// Each `n_<column>` is required while its column holds the stored value. The
// stored row satisfies every rule; the patch clears every `n_<column>`, so a
// rule that judges the STORED value refuses with `required` (a compliant row
// made violating), and a rule that judged the column empty would answer
// otherwise (a fault, or an admission). The by-id update is the reference.

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const OBJECT = 'pv_repr';

/** column → [field definition, the predicate its `n_<column>` is required under, stored value]. */
const COLUMNS: Record<string, [Record<string, unknown>, string, unknown]> = {
  amount: [{ type: 'number' }, 'record.amount > 10', 50],
  active: [{ type: 'boolean' }, 'record.active == true', true],
  due_on: [{ type: 'date' }, 'record.due_on != null', '2026-01-15'],
  happened_at: [{ type: 'datetime' }, 'record.happened_at != null', '2026-01-15T08:30:00.000Z'],
  meta: [{ type: 'json' }, 'record.meta != null', { a: 1, b: [1, 2] }],
  tags: [{ type: 'multiselect', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] }, 'record.tags != null', ['a', 'b']],
  tier: [{ type: 'select', options: [{ label: 'Gold', value: 'gold' }, { label: 'Basic', value: 'basic' }] }, "record.tier == 'gold'", 'gold'],
  code: [{ type: 'text' }, "record.code == 'X1'", 'X1'],
};

const fields: Record<string, Record<string, unknown>> = { title: { name: 'title', label: 'Title', type: 'text' } };
for (const [column, [def, predicate]] of Object.entries(COLUMNS)) {
  fields[column] = { name: column, label: column, ...def };
  fields[`n_${column}`] = { name: `n_${column}`, label: `n_${column}`, type: 'text', requiredWhen: predicate };
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registry.registerObject({ name: OBJECT, label: 'Preview Representation', fields } as any);
  await engine.syncSchemas();
  const stored: Record<string, unknown> = { title: 'stored' };
  for (const [column, [, , value]] of Object.entries(COLUMNS)) {
    stored[column] = value;
    stored[`n_${column}`] = 'kept';
  }
  const created = await engine.insert(OBJECT, stored) as Record<string, unknown>;
  return { engine, id: created.id as string };
}

const clearAll = () => Object.fromEntries(Object.keys(COLUMNS).map((c) => [`n_${c}`, null]));
const findings = (errors: Array<{ field: string; code: string }>) =>
  errors.map((e) => ({ field: e.field, code: e.code })).sort((a, b) => a.field.localeCompare(b.field));

describe('#22445 (d4) a plain readable column reaches the preview\'s rules as its stored value', () => {
  it('every column type judges the stored value, as the by-id update does', async () => {
    const { engine, id } = await boot();
    const expected = Object.keys(COLUMNS).map((c) => ({ field: `n_${c}`, code: 'required' }))
      .sort((a, b) => a.field.localeCompare(b.field));

    const preview = await engine.validate(OBJECT, { ...clearAll(), id }, { mode: 'update', context: { userId: 'reader' } });
    expect(findings(preview.results![0]!.errors)).toEqual(expected);

    let writeErrors: Array<{ field: string; code: string }> = [];
    try {
      await engine.update(OBJECT, { ...clearAll(), id }, { context: { userId: 'reader' } });
    } catch (e: any) {
      expect(e?.code).toBe('VALIDATION_FAILED');
      writeErrors = e.fields;
    }
    expect(findings(writeErrors)).toEqual(expected);
  });

  it('control: each rule admits once its own column is cleared in the same patch', async () => {
    const { engine, id } = await boot();
    const patch: Record<string, unknown> = { ...clearAll(), id };
    for (const column of Object.keys(COLUMNS)) patch[column] = null;
    const preview = await engine.validate(OBJECT, patch, { mode: 'update', context: { userId: 'reader' } });
    expect(findings(preview.results![0]!.errors)).toEqual(
      // `null > 10` has no overload: the number rule cannot judge a cleared column.
      [{ field: 'n_amount', code: 'rule_violation' }],
    );
  });
});
