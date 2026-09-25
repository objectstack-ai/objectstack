// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18783] `buildEffectiveObjectPermissions` — the ONE function behind the
 * `/auth/me/permissions` `objects` slot and `ISecurityService.getEffectiveObjectPermissions`.
 *
 * The four folds it composes keep their own pin batteries where they were
 * written (plugin-hono-server's `fold-wildcard-superuser.test.ts` and
 * `effective-api-operations.test.ts`, which exercise them through that
 * package's unchanged re-exports). What is pinned HERE is the composition:
 * the merge rule, the order, the guards, and that the result aliases nothing.
 */

import { describe, it, expect } from 'vitest';
import { buildEffectiveObjectPermissions } from './effective-object-permissions.js';

describe('buildEffectiveObjectPermissions', () => {
  it('merges most-permissively: `true` wins, otherwise the first defined value stands', () => {
    const map: any = buildEffectiveObjectPermissions([
      { objects: { deal: { allowRead: true, allowEdit: false } } },
      { objects: { deal: { allowEdit: true, allowDelete: false } } },
      { objects: { deal: { allowDelete: true, allowCreate: false } } },
      { objects: undefined },
      null,
    ]);
    expect(map.deal).toEqual({ allowRead: true, allowEdit: true, allowDelete: true, allowCreate: false });
  });

  it('builds FRESH entries — nothing in the map aliases an input set', () => {
    const entry = { allowRead: true };
    const sets = [{ objects: { deal: entry } }];
    const map: any = buildEffectiveObjectPermissions(sets);
    expect(map.deal).toEqual(entry);
    expect(map.deal).not.toBe(entry);
    map.deal.allowEdit = true;
    expect(entry).toEqual({ allowRead: true });
  });

  it('seeds, then folds, then clamps, then annotates — in that order', () => {
    const schemas: Record<string, any> = {
      report: { name: 'report', enable: { apiMethods: ['get', 'list'] } },
      sys_member: { name: 'sys_member', managedBy: 'better-auth' },
    };
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { viewAllRecords: true, modifyAllRecords: true }, sys_member: { allowRead: true } } }],
      { allSchemas: () => Object.values(schemas), schemaOf: (n) => schemas[n] },
    );
    // Seed → fold: an entry nobody named, pulled true by the super-user bits.
    expect(map.report).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
    // Fold → clamp: the guard has the last word on a managed object's writes.
    expect(map.sys_member).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    // Annotate runs last, over the final entries.
    expect(Array.isArray(map.report.apiOperations)).toBe(true);
  });

  it('a throwing schema source degrades the annotations, never the map', () => {
    const warns: string[] = [];
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { deal: { allowRead: true } } }],
      {
        allSchemas: () => { throw new Error('registry down'); },
        schemaOf: () => { throw new Error('registry down'); },
        logger: { warn: (m) => warns.push(m) },
      },
    );
    expect(map).toEqual({ deal: { allowRead: true } });
  });

  it('seeds before it covers: an entry the seed placed keeps its place and only gains grants', () => {
    const schemas: Record<string, any> = {
      a_open: { name: 'a_open' },
      b_private: { name: 'b_private', access: { default: 'private' } },
      c_open: { name: 'c_open' },
    };
    const map: any = buildEffectiveObjectPermissions(
      [
        { objects: { '*': { allowRead: true, viewAllRecords: true } } },
        { objects: { '*': { allowCreate: true, allowRead: true, allowEdit: true } } },
      ],
      { allSchemas: () => Object.values(schemas), schemaOf: (n) => schemas[n] },
    );
    // Registration order, not "covered first, seeded after".
    expect(Object.keys(map)).toEqual(['*', 'a_open', 'b_private', 'c_open']);
    expect(Object.keys(map.a_open)).toEqual(['allowCreate', 'allowRead', 'allowEdit', 'allowDelete', 'apiOperations']);
    expect(map.a_open).toMatchObject({ allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false });
    // The private object takes nothing from the plain wildcard; the read bypass still reads it.
    expect(map.b_private).toMatchObject({ allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false });
  });

  it('with no schema source at all it is the bare merge plus the fold', () => {
    const map: any = buildEffectiveObjectPermissions([
      { objects: { '*': { modifyAllRecords: true }, deal: { allowRead: false } } },
    ]);
    expect(map.deal).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: true, allowDelete: true });
    expect(map.deal.apiOperations).toBeUndefined();
  });
});

/**
 * [#20083] A plain `'*'` — a wildcard carrying neither super-user bit — is
 * materialised onto the registered objects it covers, per set, the way
 * `PermissionEvaluator.checkObjectPermission` resolves it: a set's explicit
 * entry is that set's whole answer for the object; otherwise its wildcard
 * applies to a public object and never to a private one. Without it the map
 * held no entry for an object reached only through such a wildcard, and
 * `current_user.can()` read "no grant" where the server allows.
 *
 * The enforcement-side half of this parity — every verb, shipped sets, the
 * real `can()` against the real evaluator — is pinned table-driven in
 * plugin-security's `get-effective-object-permissions.test.ts`, the one
 * package that holds both functions.
 */
describe('[#20083] plain wildcard coverage', () => {
  const SCHEMAS: Record<string, any> = {
    crm_account: { name: 'crm_account' },
    crm_lead: { name: 'crm_lead', enable: { apiMethods: ['get', 'list'] } },
    crm_secret: { name: 'crm_secret', access: { default: 'private' } },
    crm_note: { name: 'crm_note', access: { default: 'public' } },
  };
  const source = { allSchemas: () => Object.values(SCHEMAS), schemaOf: (n: string) => SCHEMAS[n] };
  const WILD = { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: false, viewAllRecords: false, modifyAllRecords: false };

  it('puts a plain wildcard\'s grants on every registered public object no set names', () => {
    const map: any = buildEffectiveObjectPermissions([{ objects: { '*': WILD } }], source);
    for (const name of ['crm_account', 'crm_lead', 'crm_note']) {
      expect(map[name], name).toMatchObject({ allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true });
    }
    // Only `true` bits travel: a wildcard's `false` grants nothing and is not copied.
    expect(map.crm_account).not.toHaveProperty('allowTransfer');
    expect(map.crm_account).not.toHaveProperty('modifyAllRecords');
    // The later passes still run over the new entries.
    expect(map.crm_lead.apiOperations).toEqual(expect.arrayContaining(['get', 'list']));
    expect(map.crm_lead.apiOperations).not.toContain('update');
  });

  it('never covers a private object', () => {
    const map: any = buildEffectiveObjectPermissions([{ objects: { '*': WILD } }], source);
    expect(map).not.toHaveProperty('crm_secret');
  });

  it('never covers an object the registry does not hold', () => {
    const map: any = buildEffectiveObjectPermissions([{ objects: { '*': WILD } }], source);
    expect(Object.keys(map).sort()).toEqual(['*', 'crm_account', 'crm_lead', 'crm_note']);
  });

  it('a set that names the object contributes its explicit entry, never its own wildcard', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': WILD, crm_account: { allowRead: true, allowEdit: false } } }],
      source,
    );
    expect(map.crm_account).toMatchObject({ allowRead: true, allowEdit: false });
    expect(map.crm_account).not.toHaveProperty('allowDelete');
    expect(map.crm_note).toMatchObject({ allowEdit: true, allowDelete: true });
  });

  it('ANOTHER set\'s plain wildcard widens a present entry, bit by bit', () => {
    const map: any = buildEffectiveObjectPermissions(
      [
        { objects: { crm_account: { allowRead: true, allowEdit: false } } },
        { objects: { '*': { allowRead: true, allowEdit: true, allowExport: true } } },
      ],
      source,
    );
    expect(map.crm_account).toEqual({ allowRead: true, allowEdit: true, allowExport: true });
  });

  it('an export-only wildcard lends its bit to a present entry, and adds no entry of its own', () => {
    const map: any = buildEffectiveObjectPermissions(
      [
        { objects: { crm_account: { allowRead: true } } },
        { objects: { '*': { allowExport: true } } },
      ],
      source,
    );
    expect(map.crm_account).toEqual({ allowRead: true, allowExport: true });
    // Export is `grant ∧ read`: alone it grants no verb, so nothing is added for it.
    expect(Object.keys(map).sort()).toEqual(['*', 'crm_account']);
  });

  it('a wildcard that grants nothing adds nothing', () => {
    const map: any = buildEffectiveObjectPermissions([{ objects: { '*': { allowRead: false } } }], source);
    expect(map).toEqual({ '*': { allowRead: false } });
  });

  it('leaves a super-user wildcard to the seed and the fold', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { ...WILD, viewAllRecords: true, modifyAllRecords: true } } }],
      source,
    );
    // Seeded all-false, then folded: the super-user entry shape, not the wildcard's own key
    // order — [#20134] with `allowTransfer`, which `modifyAllRecords` grants, appended by the
    // per-set fold (the wildcard's own `allowTransfer: false` grants nothing and is not copied).
    expect(Object.keys(map.crm_account)).toEqual(['allowCreate', 'allowRead', 'allowEdit', 'allowDelete', 'allowTransfer', 'apiOperations']);
    expect(map.crm_account.allowTransfer).toBe(true);
    // …and the private object is the seed's, as before.
    expect(map.crm_secret).toMatchObject({ allowRead: true, allowEdit: true });
  });

  it('a throwing registry leaves the merge standing and covers nothing', () => {
    const map: any = buildEffectiveObjectPermissions([{ objects: { '*': WILD } }], {
      allSchemas: () => { throw new Error('registry down'); },
    });
    expect(map).toEqual({ '*': WILD });
  });
});

/**
 * [#20134] A SUPER-USER `'*'` — one carrying `viewAllRecords` or
 * `modifyAllRecords` — puts on the map every bit it grants, per set, the way
 * `PermissionEvaluator.checkObjectPermission` resolves it: the seed places an
 * entry for every registered object the merge left absent, and the per-set
 * fold reads each set's wildcard through the spec's `objectPermissionGrants`.
 * The map used to hold only the four bits the merged fold pulls, so
 * `current_user.can(object, 'transfer')` answered `false` for a platform admin
 * the server lets transfer, a super-read wildcard lost its own plain bits, and
 * a super-user wildcard carrying `allowExport` left every unrestricted object
 * with no entry at all.
 *
 * The enforcement-side half — every verb, the shipped super-user sets, the
 * real `can()` against the real evaluator — is pinned table-driven in
 * plugin-security's `get-effective-object-permissions.test.ts`.
 */
describe('[#20134] super-user wildcard: every bit it grants, per set', () => {
  const SCHEMAS: Record<string, any> = {
    crm_account: { name: 'crm_account' },
    crm_lead: { name: 'crm_lead', enable: { apiMethods: ['get', 'list'] } },
    crm_secret: { name: 'crm_secret', access: { default: 'private' } },
  };
  const source = { allSchemas: () => Object.values(SCHEMAS), schemaOf: (n: string) => SCHEMAS[n] };

  it('the write bypass carries `transfer` onto every entry, a private object\'s included', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { allowRead: true, allowCreate: true, modifyAllRecords: true } } }],
      source,
    );
    for (const name of Object.keys(SCHEMAS)) {
      expect(map[name], name).toMatchObject({ allowRead: true, allowEdit: true, allowDelete: true, allowTransfer: true });
    }
  });

  it('a super-read wildcard keeps its own plain bits — and nothing it does not grant', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { viewAllRecords: true, allowEdit: true } } }],
      source,
    );
    for (const name of Object.keys(SCHEMAS)) {
      expect(map[name], name).toMatchObject({ allowRead: true, allowEdit: true, allowCreate: false, allowDelete: false });
      expect(map[name], name).not.toHaveProperty('allowTransfer');
    }
  });

  it('a set that names the object contributes its explicit entry, never its own wildcard\'s grants', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { viewAllRecords: true, allowTransfer: true }, crm_account: { allowRead: true } } }],
      source,
    );
    expect(map.crm_account).not.toHaveProperty('allowTransfer');
    expect(map.crm_lead).toMatchObject({ allowRead: true, allowTransfer: true });
  });

  it('ANOTHER set\'s super-user wildcard widens a present entry, bit by bit', () => {
    const map: any = buildEffectiveObjectPermissions(
      [
        { objects: { crm_account: { allowRead: true } } },
        { objects: { '*': { viewAllRecords: true, allowTransfer: true, allowExport: true } } },
      ],
      source,
    );
    // Unrestricted and export-allowed, so annotate has nothing to add to it.
    expect(map.crm_account).toEqual({ allowRead: true, allowTransfer: true, allowExport: true });
  });

  it('a super-user wildcard carrying `allowExport` seeds every registered object — annotate keeps its own skip', () => {
    const map: any = buildEffectiveObjectPermissions(
      [{ objects: { '*': { allowRead: true, allowEdit: true, modifyAllRecords: true, allowExport: true } } }],
      source,
    );
    expect(Object.keys(map)).toEqual(['*', 'crm_account', 'crm_lead', 'crm_secret']);
    expect(map.crm_account).toMatchObject({ allowRead: true, allowEdit: true, allowTransfer: true, allowExport: true });
    // An unrestricted object whose export stays allowed: an entry, and no operation set on it.
    expect(map.crm_account).not.toHaveProperty('apiOperations');
    // A narrowed one is annotated exactly as before, `export` kept.
    expect(map.crm_lead.apiOperations).toEqual(['get', 'list', 'aggregate', 'search', 'export']);
  });
});
