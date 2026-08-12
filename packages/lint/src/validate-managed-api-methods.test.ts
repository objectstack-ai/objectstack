// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7521 — the authoring-time gate for `enable.apiMethods` ⊆ affordances.
//
// The predicate's own verdict table is tested in `@objectstack/spec`
// (`managed-api-affordance.test.ts`); what is tested HERE is the walk — which
// stack shapes are reached, and whether a conflict becomes a finding an author
// can act on.

import { describe, expect, it } from 'vitest';

import {
  MANAGED_API_METHOD_UNAFFORDABLE,
  validateManagedApiMethods,
} from './validate-managed-api-methods';

/** The #7521 shape: `platform` bucket, `userActions` closing every write. */
const sysEnvironment = {
  name: 'sys_environment',
  managedBy: 'platform',
  userActions: { create: false, edit: false, delete: false },
  enable: { apiEnabled: true, apiMethods: ['get', 'list', 'create', 'update'] },
};

describe('validateManagedApiMethods — the finding', () => {
  it('flags the declaration #7521 was filed for', () => {
    const findings = validateManagedApiMethods({ objects: [sysEnvironment] });
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(MANAGED_API_METHOD_UNAFFORDABLE);
    expect(f.where).toBe('object "sys_environment"');
    expect(f.path).toBe('objects[0].enable.apiMethods');
    expect(f.message).toContain('create, update');
    expect(f.message).toContain("managedBy: 'platform'");
  });

  it('offers both ways out, and names the affordances that would be needed', () => {
    const [f] = validateManagedApiMethods({ objects: [sysEnvironment] });
    expect(f.hint).toContain('userActions: { create: true, edit: true }');
    expect(f.hint).toContain('remove');
    // ADR-0092 D4 — an author must not open the affordance to silence a lint.
    expect(f.hint).toContain('ADR-0092 D4');
  });

  it('emits ONE finding per object, not one per offending verb', () => {
    // Three refused verbs, one authoring mistake, one edit to fix it.
    const findings = validateManagedApiMethods({
      objects: [
        {
          name: 'sys_thing',
          managedBy: 'better-auth',
          enable: { apiMethods: ['get', 'create', 'update', 'delete'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('create, update, delete');
  });
});

describe('validateManagedApiMethods — the walk', () => {
  it('reads objects declared as a name-keyed map as well as an array', () => {
    const findings = validateManagedApiMethods({ objects: { sys_environment: sysEnvironment } });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('object "sys_environment"');
  });

  it('reports the index of the offending object, not of the finding', () => {
    const clean = { name: 'crm_lead', enable: { apiMethods: ['get', 'create'] } };
    const findings = validateManagedApiMethods({ objects: [clean, clean, sysEnvironment] });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[2].enable.apiMethods');
  });

  it('stays silent on a coherent stack', () => {
    const findings = validateManagedApiMethods({
      objects: [
        // Unmanaged — no bucket default to contradict.
        { name: 'crm_lead', enable: { apiMethods: ['get', 'list', 'create', 'update', 'delete'] } },
        // Managed, and the affordance is declared (the `sys_api_key` shape).
        {
          name: 'sys_api_key',
          managedBy: 'better-auth',
          userActions: { edit: true },
          enable: { apiMethods: ['get', 'list', 'update'] },
        },
        // Managed and read-only — reads are never affordance-gated.
        { name: 'sys_email', managedBy: 'append-only', enable: { apiMethods: ['get', 'list'] } },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('survives a stack that is missing, junk, or has no objects at all', () => {
    expect(validateManagedApiMethods(undefined)).toEqual([]);
    expect(validateManagedApiMethods('nope')).toEqual([]);
    expect(validateManagedApiMethods({})).toEqual([]);
    expect(validateManagedApiMethods({ objects: [null, 42] })).toEqual([]);
  });
});
