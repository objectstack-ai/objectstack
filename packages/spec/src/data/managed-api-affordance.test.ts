// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The shared managed-`apiMethods` predicate (#7521). These cases mirror
// `reconcileManagedApiMethods`'s own suite in `@objectstack/objectql`
// one-for-one: that function is now a pure REACTION to this predicate, so any
// divergence between the two suites means the strip changed shape.

import { describe, expect, it } from 'vitest';

import {
  MANAGED_WRITE_VERB_AFFORDANCE,
  checkManagedApiMethodAffordances,
  describeManagedApiMethodConflicts,
  type ManagedApiMethodConflict,
} from './managed-api-affordance';

/** The fixture the registry suite uses: all-locked `better-auth`, full CRUD declared. */
const managed = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'sys_thing',
  managedBy: 'better-auth',
  enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update', 'delete'] },
  ...extra,
});

const verbs = (conflicts: readonly ManagedApiMethodConflict[]): string[] =>
  conflicts.map((c) => c.verb);

describe('checkManagedApiMethodAffordances — the contradiction it names', () => {
  it('reports every write verb an all-locked managed bucket refuses', () => {
    const conflicts = checkManagedApiMethodAffordances(managed());
    expect(verbs(conflicts)).toEqual(['create', 'update', 'delete']);
    expect(conflicts.map((c) => c.needs)).toEqual(['create', 'edit', 'delete']);
  });

  it('never reports read verbs — only writes are affordance-gated', () => {
    const conflicts = checkManagedApiMethodAffordances(
      managed({ enable: { apiMethods: ['get', 'list', 'search', 'history'] } }),
    );
    expect(conflicts).toEqual([]);
  });

  it('keeps `update` once `userActions.edit` opens the affordance (the sys_user case)', () => {
    const conflicts = checkManagedApiMethodAffordances(managed({ userActions: { edit: true } }));
    expect(verbs(conflicts)).toEqual(['create', 'delete']);
  });

  it('covers the legacy `upsert`/`purge` verbs a raw whitelist may still carry (#3543)', () => {
    const conflicts = checkManagedApiMethodAffordances(
      managed({ enable: { apiMethods: ['upsert', 'purge'] } }),
    );
    expect(conflicts).toEqual([
      { verb: 'upsert', needs: 'edit', index: 0 },
      { verb: 'purge', needs: 'delete', index: 1 },
    ]);
  });

  it('is the exact shape #7521 was filed for (sys_environment / sys_package)', () => {
    // `managedBy: 'platform'` grants CRUD by default, so the contradiction here
    // comes from `userActions` CLOSING the writes while `apiMethods` still
    // advertises them. This declaration booted the control plane for months.
    const conflicts = checkManagedApiMethodAffordances({
      name: 'sys_environment',
      managedBy: 'platform',
      userActions: { create: false, edit: false, delete: false },
      enable: { apiMethods: ['get', 'list', 'create', 'update'] },
    });
    expect(verbs(conflicts)).toEqual(['create', 'update']);
  });
});

describe('checkManagedApiMethodAffordances — what it deliberately does not judge', () => {
  it('unmanaged objects: no bucket default, nothing to contradict', () => {
    expect(
      checkManagedApiMethodAffordances({
        name: 'crm_lead',
        enable: { apiMethods: ['get', 'create', 'update', 'delete'] },
      }),
    ).toEqual([]);
  });

  it('a bucket that grants the writes reports nothing (`platform`, `system-data`)', () => {
    const full = ['get', 'list', 'create', 'update', 'delete'];
    expect(
      checkManagedApiMethodAffordances({ managedBy: 'platform', enable: { apiMethods: full } }),
    ).toEqual([]);
    expect(
      checkManagedApiMethodAffordances({ managedBy: 'system-data', enable: { apiMethods: full } }),
    ).toEqual([]);
  });

  it('`undefined` (unrestricted) and `[]` (deny-all) advertise nothing', () => {
    expect(checkManagedApiMethodAffordances(managed({ enable: {} }))).toEqual([]);
    expect(checkManagedApiMethodAffordances(managed({ enable: { apiMethods: [] } }))).toEqual([]);
  });

  it('tolerates junk the Zod path would have rejected, rather than throwing', () => {
    // A raw / out-of-band metadata write can reach the registry unparsed; the
    // predicate must return a verdict, never blow up mid-registration.
    expect(checkManagedApiMethodAffordances(null)).toEqual([]);
    expect(checkManagedApiMethodAffordances('nope')).toEqual([]);
    expect(checkManagedApiMethodAffordances(managed({ enable: { apiMethods: 'create' } }))).toEqual(
      [],
    );
    expect(
      verbs(checkManagedApiMethodAffordances(managed({ enable: { apiMethods: [7, null, 'create'] } }))),
    ).toEqual(['create']);
  });
});

describe('checkManagedApiMethodAffordances — the index contract', () => {
  it('indexes point at the declared array, so a caller can filter without collapsing duplicates', () => {
    const schema = managed({ enable: { apiMethods: ['get', 'create', 'list', 'create'] } });
    const conflicts = checkManagedApiMethodAffordances(schema);
    expect(conflicts.map((c) => c.index)).toEqual([1, 3]);

    // The rebuild `reconcileManagedApiMethods` performs, done here to pin that
    // a duplicated offender does not take a legitimate verb down with it.
    const declared = ['get', 'create', 'list', 'create'];
    const strip = new Set(conflicts.map((c) => c.index));
    expect(declared.filter((_v, i) => !strip.has(i))).toEqual(['get', 'list']);
  });
});

describe('the verb → affordance table', () => {
  it('maps exactly the five generic write verbs, and is frozen', () => {
    expect(MANAGED_WRITE_VERB_AFFORDANCE).toEqual({
      create: 'create',
      update: 'edit',
      upsert: 'edit',
      delete: 'delete',
      purge: 'delete',
    });
    expect(Object.isFrozen(MANAGED_WRITE_VERB_AFFORDANCE)).toBe(true);
  });
});

describe('describeManagedApiMethodConflicts', () => {
  it('names the verbs and the affordance they would need', () => {
    const msg = describeManagedApiMethodConflicts(checkManagedApiMethodAffordances(managed()));
    expect(msg).toContain('create, update, delete');
    expect(msg).toContain('userActions create/edit/delete');
    expect(msg).toContain('enable.apiMethods');
    expect(msg).toContain('ADR-0092');
  });

  it('states the contradiction only — the remedy belongs to each consumer', () => {
    const msg = describeManagedApiMethodConflicts(checkManagedApiMethodAffordances(managed()));
    expect(msg).not.toMatch(/\b(drop|remove|Either)\b/);
  });

  it('does not repeat an affordance flag shared by two verbs', () => {
    const msg = describeManagedApiMethodConflicts(
      checkManagedApiMethodAffordances(managed({ enable: { apiMethods: ['update', 'upsert'] } })),
    );
    expect(msg).toContain('needs userActions edit)');
  });

  it('reads correctly for a single conflict', () => {
    const msg = describeManagedApiMethodConflicts(
      checkManagedApiMethodAffordances(managed({ enable: { apiMethods: ['get', 'delete'] } })),
    );
    expect(msg).toContain('[delete]');
    expect(msg).toContain('needs userActions delete)');
  });
});
