// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0095 D1, 2026-10-18 note; ruling of record 6250748677 on #24164, letter
 * E′ item 4] An `extend` contribution cannot set or loosen an object's declared
 * default row scope: `registerObject` refuses one that carries
 * `defaultRowScope`, by name, before it opens the contributor list.
 *
 * The refusal is pinned on its envelope (`code` + `status`) and its `name`, the
 * condition `INVALID_METADATA` shares with other refusals in this package —
 * never on a bare throw. Its controls: an extension that leaves the key alone
 * still registers and still folds, and the owner's own declaration of the key
 * is untouched by either.
 */

import { describe, it, expect } from 'vitest';
import { EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE, SchemaRegistry } from './registry.js';

const OWNER_PKG = 'com.objectstack.platform-objects';
const EXTENDER_PKG = 'app.extender';
const OBJECT_NAME = 'sys_user';

/** The owner's declaration — `sys_user`'s own default row scope. */
const OWNER_SCOPE = {
  name: 'sys_user_self_or_org_members',
  operation: 'select',
  using: 'id == current_user.id || id in current_user.org_user_ids',
};

function registryWithOwner(): SchemaRegistry {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  r.registerObject(
    {
      name: OBJECT_NAME,
      label: 'User',
      defaultRowScope: OWNER_SCOPE,
      fields: { email: { name: 'email', type: 'text', label: 'Email' } },
    } as any,
    OWNER_PKG,
  );
  return r;
}

function refusalOf(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('registerObject refuses an `extend` contribution that carries `defaultRowScope`', () => {
  it.each([
    ['loosens it to every row', { name: 'everyone', operation: 'select', using: 'id != null' }],
    ['repeats the owner\'s own scope', OWNER_SCOPE],
    ['narrows it to no row', { name: 'nobody', operation: 'all', using: 'id == null' }],
  ])('refuses an extension that %s, by name, and the object keeps the owner\'s scope', (_label, scope) => {
    const r = registryWithOwner();
    const err = refusalOf(() =>
      r.registerObject(
        {
          name: OBJECT_NAME,
          defaultRowScope: scope,
          fields: { nickname: { name: 'nickname', type: 'text', label: 'Nickname' } },
        } as any,
        EXTENDER_PKG,
        undefined,
        'extend',
      ),
    );

    expect(err).toBeDefined();
    expect({ code: err.code, status: err.status, name: err.name }).toEqual({
      code: EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE,
      status: 422,
      name: 'ExtensionDefaultRowScopeRefusedError',
    });
    expect(EXTENSION_DEFAULT_ROW_SCOPE_REFUSED_CODE).toBe('INVALID_METADATA');
    expect({ objectName: err.objectName, packageId: err.packageId }).toEqual({
      objectName: OBJECT_NAME,
      packageId: EXTENDER_PKG,
    });

    // Nothing of the refused contribution landed: no contributor, no field.
    expect(r.getObjectContributors(OBJECT_NAME).map((c) => c.packageId)).toEqual([OWNER_PKG]);
    const resolved = r.getObject(OBJECT_NAME) as any;
    expect(resolved.defaultRowScope).toEqual(OWNER_SCOPE);
    expect(resolved.fields.nickname).toBeUndefined();
  });

  it('refuses it on an object whose owner declares no default too: the fold would never carry it', () => {
    const r = new SchemaRegistry({ multiTenant: false });
    r.logLevel = 'silent';
    r.registerObject(
      { name: 'app_ticket', label: 'Ticket', fields: { title: { name: 'title', type: 'text', label: 'Title' } } } as any,
      'app.owner',
    );
    const err = refusalOf(() =>
      r.registerObject(
        { name: 'app_ticket', defaultRowScope: { name: 'own', operation: 'select', using: 'id != null' } } as any,
        EXTENDER_PKG,
        undefined,
        'extend',
      ),
    );
    expect({ code: err?.code, status: err?.status, name: err?.name }).toEqual({
      code: 'INVALID_METADATA',
      status: 422,
      name: 'ExtensionDefaultRowScopeRefusedError',
    });
    expect((r.getObject('app_ticket') as any).defaultRowScope).toBeUndefined();
  });

  it('control: an extension that leaves `defaultRowScope` alone registers and folds as before', () => {
    const r = registryWithOwner();
    r.registerObject(
      {
        name: OBJECT_NAME,
        label: 'Person',
        fields: { nickname: { name: 'nickname', type: 'text', label: 'Nickname' } },
      } as any,
      EXTENDER_PKG,
      undefined,
      'extend',
    );
    // An explicitly-undefined key sets nothing, so it is not a contribution of one.
    r.registerObject(
      { name: OBJECT_NAME, defaultRowScope: undefined, fields: { pronouns: { name: 'pronouns', type: 'text', label: 'Pronouns' } } } as any,
      'app.second-extender',
      undefined,
      'extend',
    );

    expect(r.getObjectContributors(OBJECT_NAME).map((c) => c.packageId)).toEqual([
      OWNER_PKG,
      EXTENDER_PKG,
      'app.second-extender',
    ]);
    const resolved = r.getObject(OBJECT_NAME) as any;
    expect(resolved.label).toBe('Person');
    expect(Object.keys(resolved.fields)).toEqual(expect.arrayContaining(['email', 'nickname', 'pronouns']));
    expect(resolved.defaultRowScope).toEqual(OWNER_SCOPE);
  });

  it('control: the owner\'s own `defaultRowScope` registers, and re-registers, unrefused', () => {
    const r = registryWithOwner();
    expect(() =>
      r.registerObject(
        { name: OBJECT_NAME, label: 'User', defaultRowScope: OWNER_SCOPE, fields: {} } as any,
        OWNER_PKG,
      ),
    ).not.toThrow();
    expect((r.getObject(OBJECT_NAME) as any).defaultRowScope).toEqual(OWNER_SCOPE);
  });
});
