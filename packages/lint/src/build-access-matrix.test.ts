// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — access-matrix snapshot: pure build + semantic diff.

import { describe, it, expect } from 'vitest';
import { buildAccessMatrix, diffAccessMatrix } from './build-access-matrix.js';

const STACK = {
  objects: [
    { name: 'crm_lead', sharingModel: 'private' },
    { name: 'crm_account', sharingModel: 'public_read' },
  ],
  permissions: [
    {
      name: 'sales_user',
      objects: {
        crm_lead: { allowRead: true, allowCreate: true, allowEdit: true, readScope: 'unit' },
        crm_account: { allowRead: true },
      },
    },
    {
      name: 'crm_admin',
      objects: {
        crm_lead: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true },
      },
    },
  ],
};

describe('buildAccessMatrix (ADR-0090 D6)', () => {
  it('derives one sorted row per (set × object) with OWD context', () => {
    const m = buildAccessMatrix(STACK);
    expect(m.version).toBe(1);
    expect(m.entries.map((e) => `${e.permissionSet}/${e.object}`)).toEqual([
      'crm_admin/crm_lead',
      'sales_user/crm_account',
      'sales_user/crm_lead',
    ]);
    const lead = m.entries.find((e) => e.permissionSet === 'sales_user' && e.object === 'crm_lead')!;
    expect(lead).toMatchObject({ create: true, read: true, edit: true, delete: false, readScope: 'unit', sharingModel: 'private' });
    // VAMA implies the read bit even without allowRead.
    const admin = m.entries.find((e) => e.permissionSet === 'crm_admin')!;
    expect(admin.viewAllRecords).toBe(true);
    expect(admin.read).toBe(true);
  });

  it('is deterministic (same input → identical JSON)', () => {
    expect(JSON.stringify(buildAccessMatrix(STACK))).toBe(JSON.stringify(buildAccessMatrix(STACK)));
  });
});

describe('diffAccessMatrix (semantic review lines)', () => {
  it('identical matrices produce no lines', () => {
    expect(diffAccessMatrix(buildAccessMatrix(STACK), buildAccessMatrix(STACK))).toEqual([]);
  });

  it('reports gained bits by name — the crm_admin-gains-delete shape', () => {
    const before = buildAccessMatrix(STACK);
    const after = buildAccessMatrix(JSON.parse(JSON.stringify(STACK)));
    const sales = (after.entries as any[]).find((e) => e.permissionSet === 'sales_user' && e.object === 'crm_lead');
    sales.delete = true;
    const lines = diffAccessMatrix(before, after);
    expect(lines).toEqual(["'sales_user' gains delete on 'crm_lead'"]);
  });

  it('reports depth changes, entry additions/removals, and OWD swings', () => {
    const before = buildAccessMatrix(STACK);
    const mutated = JSON.parse(JSON.stringify(STACK));
    mutated.permissions[0].objects.crm_lead.readScope = 'org';       // depth widened
    delete mutated.permissions[0].objects.crm_account;                // entry removed
    mutated.permissions[1].objects.crm_account = { allowRead: true }; // entry added
    mutated.objects[0].sharingModel = 'public_read_write';            // OWD swing
    const lines = diffAccessMatrix(before, buildAccessMatrix(mutated));
    expect(lines.some((l) => l.includes("read depth on 'crm_lead': unit → org"))).toBe(true);
    expect(lines.some((l) => l.includes("'sales_user' loses ALL access to 'crm_account'"))).toBe(true);
    expect(lines.some((l) => l.includes("'crm_admin' gains access to 'crm_account'"))).toBe(true);
    expect(lines.some((l) => l.includes('record baseline (OWD): private → public_read_write'))).toBe(true);
  });
});

/*
 * [#18785] The CRUD columns are the SPEC's fold, asked — this is the pin that
 * says so.
 *
 * `buildAccessMatrix` used to restate the super-user fold inline. The rule —
 * "does this effective object permission grant this verb?" — is stated once in
 * `@objectstack/spec`'s `objectPermissionGrants`, and the enforcement door
 * (`PermissionEvaluator.checkObjectPermission`) asks the same function, so the
 * snapshot a human signs off cannot drift away from the 403 the server hands
 * out.
 *
 * ⚠️ The expectation below is written INDEPENDENTLY of the spec helper, from
 * the rule as the card states it: read bypasses on `viewAllRecords ||
 * modifyAllRecords`; write bypasses on `modifyAllRecords` alone and NEVER
 * create. Comparing the matrix against `objectPermissionGrants` instead would
 * be a tautology — both sides would move together and the pin would survive any
 * change to the fold. This way an ablation of one spec cell reddens it.
 *
 * The enumeration is exhaustive over the declared object-permission bits, in
 * all three authorable states (`true` / `false` / absent), because every
 * implementation compares with `=== true` and absence is what an author
 * produces by omission.
 */
const FOLD_BITS = [
  'allowCreate', 'allowDelete', 'allowEdit', 'allowExport',
  'allowRead', 'allowTransfer', 'modifyAllRecords', 'viewAllRecords',
] as const;
const BIT_STATES: Array<boolean | undefined> = [true, false, undefined];

/** The fold, restated from the rule — deliberately NOT the spec helper. */
function referenceFold(p: Record<string, unknown>, verb: 'create' | 'read' | 'edit' | 'delete'): boolean {
  const modifyAll = p.modifyAllRecords === true;
  switch (verb) {
    case 'create': return p.allowCreate === true;
    case 'read': return p.allowRead === true || p.viewAllRecords === true || modifyAll;
    case 'edit': return p.allowEdit === true || modifyAll;
    case 'delete': return p.allowDelete === true || modifyAll;
  }
}

function enumerateEntries(): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const total = BIT_STATES.length ** FOLD_BITS.length;
  for (let i = 0; i < total; i++) {
    const entry: Record<string, unknown> = {};
    let n = i;
    for (const bit of FOLD_BITS) {
      const s = BIT_STATES[n % BIT_STATES.length];
      n = Math.floor(n / BIT_STATES.length);
      if (s !== undefined) entry[bit] = s;
    }
    out.push(entry);
  }
  return out;
}

describe('buildAccessMatrix CRUD columns — the spec fold, asked (#18785)', () => {
  it('named cells: the fold as the rule states it', () => {
    const m = buildAccessMatrix({
      objects: [{ name: 'o' }],
      permissions: [
        { name: 'vad', objects: { o: { viewAllRecords: true } } },
        { name: 'mad', objects: { o: { modifyAllRecords: true } } },
        { name: 'none', objects: { o: {} } },
      ],
    });
    const row = (ps: string) => m.entries.find((e) => e.permissionSet === ps)!;
    // READ bypasses on either super-user bit.
    expect(row('vad').read).toBe(true);
    expect(row('mad').read).toBe(true);
    // WRITE bypasses on Modify All Data ALONE — View All Data is a read power.
    expect(row('mad').edit).toBe(true);
    expect(row('mad').delete).toBe(true);
    expect(row('vad').edit).toBe(false);
    expect(row('vad').delete).toBe(false);
    // CREATE is never manufactured by a super-user bit.
    expect(row('mad').create).toBe(false);
    expect(row('vad').create).toBe(false);
    // An entry with no bits grants nothing.
    expect(row('none')).toMatchObject({ create: false, read: false, edit: false, delete: false });
  });

  it('exhaustively matches the fold over every declared bit combination', () => {
    const entries = enumerateEntries();
    expect(entries.length).toBe(3 ** 8);
    const m = buildAccessMatrix({
      objects: [{ name: 'o' }],
      permissions: entries.map((e, i) => ({ name: `ps_${String(i).padStart(4, '0')}`, objects: { o: e } })),
    });
    expect(m.entries.length).toBe(entries.length);
    const mismatches: string[] = [];
    let cells = 0;
    for (let i = 0; i < entries.length; i++) {
      const row = m.entries.find((e) => e.permissionSet === `ps_${String(i).padStart(4, '0')}`)!;
      for (const verb of ['create', 'read', 'edit', 'delete'] as const) {
        cells++;
        if (row[verb] !== referenceFold(entries[i], verb)) {
          mismatches.push(`${JSON.stringify(entries[i])} × ${verb}: matrix=${row[verb]} rule=${referenceFold(entries[i], verb)}`);
        }
      }
    }
    expect(cells).toBe(3 ** 8 * 4);
    expect(mismatches).toEqual([]);
  });

  it('the super-user columns stay RAW BITS, not folds', () => {
    const m = buildAccessMatrix({
      objects: [{ name: 'o' }],
      permissions: [{ name: 'mad', objects: { o: { modifyAllRecords: true } } }],
    });
    const row = m.entries[0];
    // Modify All Data implies the read POWER, but it is not a declaration of
    // View All Data — the reviewer reads the CRUD columns against what the set
    // actually declares.
    expect(row.modifyAllRecords).toBe(true);
    expect(row.viewAllRecords).toBe(false);
    expect(row.read).toBe(true);
  });
});
