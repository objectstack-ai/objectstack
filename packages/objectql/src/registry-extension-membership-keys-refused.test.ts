// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25234 ruling A, refusal 10] An `extend` contribution cannot declare a
 * membership key: `registerObject` refuses one that carries `membershipKeys`,
 * by name, before it opens the contributor list, beside the `defaultRowScope`
 * refusal (`registry-extension-default-row-scope-refused.test.ts`).
 *
 * Without it the fold (`mergeObjectDefinitions`) dropped the key in silence:
 * the extender's declaration registered, the resolved object never carried
 * it, and nothing told the author the key would never resolve.
 *
 * Pinned on the envelope (`code` + `status`) and the error's `name`. The
 * controls: an extension that leaves the key alone still registers and still
 * folds, and the owner's own declaration of the key is untouched by either.
 */

import { describe, it, expect } from 'vitest';
import { EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE, SchemaRegistry } from './registry.js';

const OWNER_PKG = 'app.srm';
const EXTENDER_PKG = 'app.extender';
const OBJECT_NAME = 'srm_supplier_contact';

/** The owner's declaration — the roster object's own key. */
const OWNER_KEYS = {
  portal_supplier_ids: { userField: 'user', valueField: 'supplier', filter: 'active == true' },
};

/** `null` registers an owner that declares no key. */
function registryWithOwner(membershipKeys: unknown = OWNER_KEYS): SchemaRegistry {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  r.registerObject(
    {
      name: OBJECT_NAME,
      label: 'Supplier contact',
      ...(membershipKeys === null ? {} : { membershipKeys }),
      fields: {
        user: { name: 'user', type: 'lookup', reference: 'sys_user', label: 'User' },
        supplier: { name: 'supplier', type: 'text', label: 'Supplier' },
        active: { name: 'active', type: 'boolean', label: 'Active' },
      },
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

describe('registerObject refuses an `extend` contribution that carries `membershipKeys`', () => {
  it.each([
    ['adds a key of its own', { all_supplier_ids: { userField: 'user', valueField: 'supplier' } }],
    ['repeats the owner\'s own key', OWNER_KEYS],
    ['carries an empty map', {}],
  ])('refuses an extension that %s, by name, and the object keeps the owner\'s keys', (_label, keys) => {
    const r = registryWithOwner();
    const err = refusalOf(() =>
      r.registerObject(
        {
          name: OBJECT_NAME,
          membershipKeys: keys,
          fields: { nickname: { name: 'nickname', type: 'text', label: 'Nickname' } },
        } as any,
        EXTENDER_PKG,
        undefined,
        'extend',
      ),
    );

    expect(err).toBeDefined();
    expect({ code: err.code, status: err.status, httpStatus: err.httpStatus, name: err.name }).toEqual({
      code: EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE,
      status: 422,
      httpStatus: 422,
      name: 'ExtensionMembershipKeysRefusedError',
    });
    expect(EXTENSION_MEMBERSHIP_KEYS_REFUSED_CODE).toBe('INVALID_METADATA');
    expect({ objectName: err.objectName, packageId: err.packageId }).toEqual({
      objectName: OBJECT_NAME,
      packageId: EXTENDER_PKG,
    });
    expect(err.message).toContain('`membershipKeys`');
    expect(err.message).toContain(EXTENDER_PKG);

    // Nothing of the refused contribution landed: no contributor, no field.
    expect(r.getObjectContributors(OBJECT_NAME).map((c) => c.packageId)).toEqual([OWNER_PKG]);
    const resolved = r.getObject(OBJECT_NAME) as any;
    expect(resolved.membershipKeys).toEqual(OWNER_KEYS);
    expect(resolved.fields.nickname).toBeUndefined();
  });

  it('refuses it on an object whose owner declares no key too: the fold would never carry it', () => {
    const r = registryWithOwner(null);
    const err = refusalOf(() =>
      r.registerObject(
        { name: OBJECT_NAME, membershipKeys: { portal_supplier_ids: { userField: 'user', valueField: 'supplier' } } } as any,
        EXTENDER_PKG,
        undefined,
        'extend',
      ),
    );
    expect({ code: err?.code, status: err?.status, name: err?.name }).toEqual({
      code: 'INVALID_METADATA',
      status: 422,
      name: 'ExtensionMembershipKeysRefusedError',
    });
    expect((r.getObject(OBJECT_NAME) as any).membershipKeys).toBeUndefined();
  });

  it('control: an extension that leaves `membershipKeys` alone registers and folds as before', () => {
    const r = registryWithOwner();
    r.registerObject(
      {
        name: OBJECT_NAME,
        label: 'Contact',
        fields: { nickname: { name: 'nickname', type: 'text', label: 'Nickname' } },
      } as any,
      EXTENDER_PKG,
      undefined,
      'extend',
    );
    // An explicitly-undefined key sets nothing, so it is not a contribution of one.
    r.registerObject(
      { name: OBJECT_NAME, membershipKeys: undefined, fields: { pronouns: { name: 'pronouns', type: 'text', label: 'Pronouns' } } } as any,
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
    expect(resolved.label).toBe('Contact');
    expect(Object.keys(resolved.fields)).toEqual(expect.arrayContaining(['user', 'supplier', 'nickname', 'pronouns']));
    expect(resolved.membershipKeys).toEqual(OWNER_KEYS);
  });

  it('control: the owner\'s own `membershipKeys` registers, and re-registers, unrefused', () => {
    const r = registryWithOwner();
    expect(() =>
      r.registerObject(
        {
          name: OBJECT_NAME,
          label: 'Supplier contact',
          membershipKeys: OWNER_KEYS,
          fields: { user: { name: 'user', type: 'lookup', reference: 'sys_user', label: 'User' } },
        } as any,
        OWNER_PKG,
      ),
    ).not.toThrow();
    expect((r.getObject(OBJECT_NAME) as any).membershipKeys).toEqual(OWNER_KEYS);
  });
});
