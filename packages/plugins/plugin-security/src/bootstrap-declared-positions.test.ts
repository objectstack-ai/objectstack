// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#2909 T2] Lock the seed semantics of bootstrapDeclaredPositions.
 *
 * sys_position is RECORD-AUTHORITATIVE (ADR-0094 addendum): the declared
 * `positions: []` metadata seeds row IDENTITY + display fields only. The
 * record side — permission-set bindings, `active`, `is_default`,
 * `delegatable`, `managed_by` provenance — belongs to the runtime/admin and
 * must never be touched by a re-seed. These tests exist to keep that
 * contract from regressing silently (the behavior predates them but was
 * never locked).
 */

import { describe, it, expect } from 'vitest';
import { bootstrapDeclaredPositions } from './bootstrap-declared-positions.js';

/** Minimal in-memory ql for sys_position seeding. */
function makeQl(declared: any[] = []) {
  const rows: any[] = [];
  return {
    rows,
    // [#8378] Items are surfaced as the real engine surfaces them — the
    // document itself, not a `{ content: <item> }` box that nothing produces.
    registry: { listItems: (type: string) => (type === 'position' ? [...declared] : []) },
    async find(object: string, q: any) {
      if (object !== 'sys_position') return [];
      const where = q?.where ?? {};
      return rows.filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    },
    async insert(object: string, data: any) {
      if (object !== 'sys_position') return null;
      rows.push({ ...data });
      return { id: data.id };
    },
    async update(object: string, data: any) {
      if (object !== 'sys_position') return;
      const r = rows.find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
    },
  };
}

describe('bootstrapDeclaredPositions (#2909 T2 — seed-only semantics locked)', () => {
  it('inserts new declared positions with identity + display fields only', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor', description: 'Does work' }]);
    const r = await bootstrapDeclaredPositions(ql, null);
    expect(r.seeded).toBe(1);
    const row = ql.rows[0];
    expect(row).toMatchObject({ name: 'contributor', label: 'Contributor', active: true, is_default: false });
    // Provenance is NOT stamped by the declared seeder (bootstrapBuiltinRoles
    // owns the built-in anchors; declared positions carry the object default).
    expect(row.managed_by).toBeUndefined();
  });

  it('refreshes ONLY label/description on existing rows', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor v2', description: 'new text' }]);
    ql.rows.push({
      id: 'pos_1', name: 'contributor', label: 'Contributor', description: 'old',
      active: true, is_default: false,
    });
    const r = await bootstrapDeclaredPositions(ql, null);
    expect(r.updated).toBe(1);
    expect(ql.rows[0].label).toBe('Contributor v2');
    expect(ql.rows[0].description).toBe('new text');
  });

  it('NEVER touches authoritative record fields (active/is_default/delegatable/managed_by)', async () => {
    const ql = makeQl([{ name: 'contributor', label: 'Contributor v2' }]);
    // Admin turned the position off, made it default, marked it delegatable,
    // and the row carries provenance — a re-seed must not reset any of it.
    ql.rows.push({
      id: 'pos_1', name: 'contributor', label: 'Contributor', description: 'old',
      active: false, is_default: true, delegatable: true, managed_by: 'package',
      permissions: ['something_admin_set'],
    });
    await bootstrapDeclaredPositions(ql, null);
    const row = ql.rows[0];
    expect(row.active).toBe(false);
    expect(row.is_default).toBe(true);
    expect(row.delegatable).toBe(true);
    expect(row.managed_by).toBe('package');
    expect(row.permissions).toEqual(['something_admin_set']);
    // …while the display fields did refresh.
    expect(row.label).toBe('Contributor v2');
  });

  it('is idempotent — a re-run inserts nothing new', async () => {
    const ql = makeQl([{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }]);
    const r1 = await bootstrapDeclaredPositions(ql, null);
    expect(r1.seeded).toBe(2);
    const r2 = await bootstrapDeclaredPositions(ql, null);
    expect(r2.seeded).toBe(0);
    expect(ql.rows).toHaveLength(2);
  });
});
