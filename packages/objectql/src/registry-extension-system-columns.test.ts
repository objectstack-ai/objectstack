// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24314] An `objectExtensions` body is never planned for system columns on
 * its own: the extended object's system columns are its BASE layer's plan.
 *
 * `registerObject` used to run `applySystemFields` on every contributor. An
 * extension body carries none of the declarations the injected-columns plan
 * reads (`managedBy`, `systemFields`, `tenancy`, `ownership`), so it was
 * planned as an ordinary object and the fold merged the full column set onto
 * a target whose own declaration withholds it. On a walled boot that put a
 * NULL `organization_id` on `sys_organization` and `sys_user`, and the wall
 * hid both from their own members (the booted pin is
 * `@objectstack/organizations`' `object-extension-managed-target.wall.test.ts`).
 *
 * Each case registers the same target twice, with and without one extension
 * field, and asserts the merged object differs by exactly that field: the
 * extension adds what its author wrote and nothing the platform plans. Both
 * registration orders are covered, because an extender can register before
 * the package that owns its target.
 */

import { describe, it, expect } from 'vitest';
import { SchemaRegistry } from './registry.js';

const EXTENSION_FIELD = { type: 'text', label: 'Summary' };

function registry(): SchemaRegistry {
  return new SchemaRegistry({ multiTenant: true, searchCompanion: false } as never);
}

/** The target's merged answer with no extension — the control. */
function resolvedAlone(owner: any): any {
  const reg = registry();
  reg.registerObject(structuredClone(owner), 'owner.pkg', undefined, 'own');
  return reg.getObject(owner.name);
}

function resolvedExtended(owner: any, order: 'owner-first' | 'extension-first'): any {
  const reg = registry();
  const extension = { name: owner.name, fields: { summary: EXTENSION_FIELD } } as any;
  const own = () => reg.registerObject(structuredClone(owner), 'owner.pkg', undefined, 'own');
  const extend = () => reg.registerObject(extension, 'extender.pkg', undefined, 'extend', 200);
  if (order === 'owner-first') { own(); extend(); } else { extend(); own(); }
  return reg.getObject(owner.name);
}

const TARGETS: Array<[string, any]> = [
  [
    "managedBy: 'better-auth' (the plan injects nothing)",
    {
      name: 'sys_organization',
      label: 'Organization',
      managedBy: 'better-auth',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  [
    'systemFields: false (the hard opt-out)',
    { name: 'qa_seed_table', label: 'Seed', systemFields: false, fields: { name: { type: 'text', label: 'Name' } } },
  ],
  [
    'tenancy.enabled: false (a shared catalog: no tenant column)',
    { name: 'qa_catalog', label: 'Catalog', tenancy: { enabled: false }, fields: { name: { type: 'text', label: 'Name' } } },
  ],
  [
    "ownership: 'org' (no per-record owner anchor)",
    { name: 'qa_policy', label: 'Policy', ownership: 'org', fields: { name: { type: 'text', label: 'Name' } } },
  ],
  [
    'an authored organization_id (the owner declares its own tenant column)',
    {
      name: 'qa_assignment',
      label: 'Assignment',
      fields: {
        name: { type: 'text', label: 'Name' },
        organization_id: { type: 'text', label: 'Organization', maxLength: 255 },
      },
    },
  ],
  [
    'an ordinary object (the plan injects the full set on the owner)',
    { name: 'qa_ledger', label: 'Ledger', fields: { name: { type: 'text', label: 'Name' } } },
  ],
];

describe('[#24314] an extension adds its own fields and none of the platform plan', () => {
  for (const [label, owner] of TARGETS) {
    for (const order of ['owner-first', 'extension-first'] as const) {
      it(`${label} — ${order}`, () => {
        const control = resolvedAlone(owner);
        const extended = resolvedExtended(owner, order);

        expect(extended.fields.summary).toMatchObject(EXTENSION_FIELD);
        const { summary: _added, ...rest } = extended.fields;
        // Every other field, the platform's injected columns included, is the
        // target's own answer, definition for definition.
        expect(rest).toEqual(control.fields);
        expect(extended.indexes ?? []).toEqual(control.indexes ?? []);
      });
    }
  }

  it("an audit field an extension declares is governed by the base layer's plan (#4447)", () => {
    const writable = { type: 'datetime', label: 'Created', readonly: false };
    const extendWith = (owner: any) => {
      const reg = registry();
      reg.registerObject(structuredClone(owner), 'owner.pkg', undefined, 'own');
      reg.registerObject({ name: owner.name, fields: { created_at: writable } } as any, 'extender.pkg', undefined, 'extend', 200);
      return reg.getObject(owner.name) as any;
    };
    // The base carries the audit family: the extender cannot make the anchor writable.
    expect(extendWith(TARGETS[5][1]).fields.created_at).toMatchObject({ label: 'Created', readonly: true });
    // The base's plan governs nothing (better-auth): the extender's field stands as written.
    expect(extendWith(TARGETS[0][1]).fields.created_at).toMatchObject({ label: 'Created', readonly: false });
  });

  it('the extension contributor itself carries only what its author wrote', () => {
    const reg = registry();
    reg.registerObject(structuredClone(TARGETS[5][1]), 'owner.pkg', undefined, 'own');
    reg.registerObject(
      { name: 'qa_ledger', fields: { summary: EXTENSION_FIELD } } as any,
      'extender.pkg',
      undefined,
      'extend',
      200,
    );
    const layer = reg.getObjectContributors('qa_ledger').find((c) => c.ownership === 'extend')!;
    expect(Object.keys(layer.definition.fields ?? {})).toEqual(['summary']);
    expect((layer.definition as any).indexes).toBeUndefined();
  });
});
