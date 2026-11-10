// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] `managedBy: 'synced'` — the bucket of an object whose rows a
 * pull copies from a source — and the `_sync_` column reservation.
 *
 * Pinned, each refusal beside its legal twin:
 *
 * - the bucket parses, and its affordance row is `engine-owned`'s;
 * - `userActions` may not open a write verb on it (the named exception to
 *   ADR-0103 D1): refused at parse, and closed by `resolveCrudAffordances`
 *   even on input that reached it unparsed; `exportCsv` stays the author's;
 * - on every other bucket `userActions` still overrides the default row (twin);
 * - a field named with the `_sync_` prefix is refused on any object and on an
 *   object extension; `fieldPatches` (which patches an existing field) is not.
 */
import { describe, expect, it } from 'vitest';
import {
  MANAGED_BY_WRITE_LOCKED_BUCKETS,
  ObjectExtensionSchema,
  ObjectSchema,
  resolveCrudAffordances,
} from './object.zod';

const synced = {
  name: 'erp_order_copy',
  label: 'ERP order copy',
  managedBy: 'synced',
  sharingModel: 'public_read',
  fields: { title: { type: 'text', label: 'Title' } },
};
const issuesOf = (input: Record<string, unknown>) => {
  const r = ObjectSchema.safeParse(input);
  return r.success ? [] : r.error.issues;
};

describe("managedBy: 'synced' — the bucket and its affordance row", () => {
  it('parses, and is the only write-locked bucket', () => {
    expect(issuesOf(synced)).toEqual([]);
    expect([...MANAGED_BY_WRITE_LOCKED_BUCKETS]).toEqual(['synced']);
  });

  it("its default row is engine-owned's: no create, import, edit or delete; exportCsv open", () => {
    expect(resolveCrudAffordances({ managedBy: 'synced' })).toEqual(resolveCrudAffordances({ managedBy: 'engine-owned' }));
    expect(resolveCrudAffordances({ managedBy: 'synced' })).toEqual({
      create: false, import: false, edit: false, delete: false, exportCsv: true,
    });
  });
});

describe("managedBy: 'synced' — userActions may not open a write (ADR-0103 D1 exception)", () => {
  it.each([
    ['create', true],
    ['import', true],
    ['edit', true],
    ['delete', true],
    ['edit', { enabled: true }],
  ])('userActions.%s: %j is refused at parse, at its own path', (verb, value) => {
    const issues = issuesOf({ ...synced, userActions: { [verb]: value } });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(['userActions', verb]);
    expect(issues[0]!.message).toContain("managedBy: 'synced'");
  });

  it('twins: closing a verb, or setting exportCsv, is accepted', () => {
    expect(issuesOf({ ...synced, userActions: { edit: false, exportCsv: false } })).toEqual([]);
  });

  it('the resolver keeps the closed row even when userActions opens every verb (unparsed input)', () => {
    const resolved = resolveCrudAffordances({
      managedBy: 'synced',
      userActions: { create: true, import: true, edit: { enabled: true }, delete: true, exportCsv: false },
    });
    expect(resolved).toEqual({ create: false, import: false, edit: false, delete: false, exportCsv: false });
  });

  it("twin: on 'engine-owned' and 'append-only' userActions still opens a verb", () => {
    expect(resolveCrudAffordances({ managedBy: 'engine-owned', userActions: { edit: true } }).edit).toBe(true);
    expect(resolveCrudAffordances({ managedBy: 'append-only', userActions: { create: true } }).create).toBe(true);
    expect(issuesOf({ ...synced, managedBy: 'engine-owned', userActions: { edit: true } })).toEqual([]);
  });
});

describe('the `_sync_` field-name reservation', () => {
  it('a `_sync_` field is refused on any object — synced or not', () => {
    for (const managedBy of ['synced', undefined]) {
      const issues = issuesOf({ ...synced, managedBy, fields: { ...synced.fields, _sync_hash: { type: 'text', label: 'H' } } });
      expect(issues.length, String(managedBy)).toBeGreaterThan(0);
      expect(issues.map((i) => i.message).join('\n')).toContain('reserved for the platform');
    }
  });

  it('twins: `sync_hash` and `_synced` are ordinary names', () => {
    expect(issuesOf({ ...synced, fields: { sync_hash: { type: 'text', label: 'H' }, _synced: { type: 'boolean', label: 'S' } } })).toEqual([]);
  });

  it('an object extension may not contribute a `_sync_` field; it may patch an ordinary one', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'crm_account', fields: { _sync_deleted_at: { type: 'datetime', label: 'D' } } });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join('\n')).toContain('_sync_');
    expect(ObjectExtensionSchema.safeParse({ extend: 'crm_account', fields: { sync_note: { type: 'text', label: 'N' } } }).success).toBe(true);
    expect(ObjectExtensionSchema.safeParse({ extend: 'crm_account', fieldPatches: { region: { label: 'Region' } } }).success).toBe(true);
  });
});
