// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0160 D1/D3] A context pack that names a system column the platform
 * injects (`owner_id`, `created_at`) on an object that does not declare it.
 *
 * The executor judges every name against the definitions its door hands it.
 * The real doors hand the registry's definition, which carries the injected
 * columns: measured over one real kernel (the `/mcp` door, the real protocol,
 * `SqlDriver`, `sys_user` registered), the served listing of an object that
 * declares neither column carries both, and `get_record_context` answers
 * `owner_id` and `created_at` in the root's `fields` and a related list's
 * `fields`, filters the list by a `where` on `owner_id` and orders it by
 * `created_at`. The door below serves that shape (the spec's
 * `injectedSystemColumnDefs`, the tables the registry's `applySystemFields`
 * spreads, a declared field winning), and the executor reads every injected
 * name as a field. `@objectstack/lint`'s `ai-context-field-unknown` judges
 * the same names against the same injected map, so it does not warn on them.
 */

import { describe, expect, it } from 'vitest';
import { injectedSystemColumnDefs } from '@objectstack/spec/data';
import { executeGetRecordContext } from '../index.js';
import { fakeDoor, policyApp, type FakeApp } from './fake-door.js';

type Def = Record<string, unknown>;

/** The definition as the registry serves it: the injected columns it carries, a declared field winning. */
const registered = (def: Def): Def => ({
  ...def,
  fields: { ...injectedSystemColumnDefs(def), ...(def.fields as Def) },
});

const PACK = {
  name: 'policy_brief',
  label: 'Policy brief',
  object: 'policy',
  fields: ['title', 'owner_id', 'created_at'],
  related: [{
    object: 'policy_revision',
    field: 'policy',
    fields: ['version', 'owner_id', 'created_at'],
    where: { owner_id: 'u1' },
    orderBy: [{ field: 'created_at', order: 'desc' as const }],
  }],
};

/** The fixture app with the system columns on its rows, `sys_user` beside it, and {@link PACK}. */
function app(injected: boolean): FakeApp {
  const base = policyApp();
  const objects: FakeApp['objects'] = {
    ...base.objects,
    sys_user: { name: 'sys_user', label: 'User', nameField: 'name', fields: { name: { name: 'name', type: 'text', label: 'Name' } } },
  };
  if (injected) for (const name of ['policy', 'policy_revision']) objects[name] = registered(objects[name]);
  return {
    ...base,
    objects,
    records: {
      ...base.records,
      sys_user: [{ id: 'u1', name: 'Ann' }, { id: 'u2', name: 'Bo' }],
      policy: base.records.policy.map((r) => ({ ...r, owner_id: 'u1', created_at: '2026-01-01T00:00:00Z' })),
      policy_revision: [
        { id: 'r1', version: 'v1', policy: 'p1', owner_id: 'u1', created_at: '2026-01-02T00:00:00Z' },
        { id: 'r2', version: 'v2', policy: 'p1', owner_id: 'u1', created_at: '2026-01-03T00:00:00Z' },
        { id: 'r3', version: 'v3', policy: 'p1', owner_id: 'u2', created_at: '2026-01-04T00:00:00Z' },
      ],
    },
    packs: [PACK],
  };
}

const CALL = { objectName: 'policy', recordId: 'p1', context: 'policy_brief' };

describe('get_record_context — an injected system column the object does not declare (ADR-0160 D1/D3)', () => {
  it('the fixture declares neither column; the registered definition carries both', () => {
    const declared = policyApp().objects;
    for (const name of ['policy', 'policy_revision']) {
      expect(Object.keys(declared[name].fields as Def)).not.toContain('owner_id');
      expect(Object.keys(declared[name].fields as Def)).not.toContain('created_at');
      expect(Object.keys(registered(declared[name]).fields as Def)).toEqual(expect.arrayContaining(['owner_id', 'created_at']));
    }
  });

  it('is read as a field: in the root\'s fields, a related list\'s fields, its where and its orderBy', async () => {
    const out = await executeGetRecordContext(CALL, fakeDoor(app(true)));
    expect(out.data.fields).toEqual([
      { name: 'title', label: 'Title', value: 'Fire cover' },
      { name: 'owner_id', label: 'Owner', value: 'u1', display: 'Ann' },
      { name: 'created_at', label: 'Created At', value: '2026-01-01T00:00:00Z' },
    ]);
    expect(out.data.related?.[0]?.rows.map((r) => [r.id, r.fields.map((f) => [f.name, f.value])])).toEqual([
      ['r2', [['version', 'v2'], ['owner_id', 'u1'], ['created_at', '2026-01-03T00:00:00Z']]],
      ['r1', [['version', 'v1'], ['owner_id', 'u1'], ['created_at', '2026-01-02T00:00:00Z']]],
    ]);
    expect(out.notes).toEqual([]);
  });

  it('a door serving the declared fields alone leaves every such name out, silently: the executor reads what the door serves', async () => {
    const out = await executeGetRecordContext(CALL, fakeDoor(app(false)));
    expect(out.data.fields.map((f) => f.name)).toEqual(['title']);
    expect(out.data.related ?? []).toEqual([]);
    expect(out.notes).toEqual([]);
  });
});
