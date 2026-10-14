// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0086 D3] The owner-binding judge every door of the rule calls
 * (`judgePermissionSetOwnerBinding`): its verdict table, and the words of the
 * two doors it gained when it moved here from the metadata write doors.
 *
 * The words of the save, restore and publish doors are pinned where those
 * doors are (`protocol.item-name-every-door.test.ts`, `@objectstack/metadata-protocol`),
 * through the door itself; this file pins the verdict every door shares and
 * the build and registration wording.
 */
import { describe, it, expect } from 'vitest';
import { judgePermissionSetOwnerBinding, type PermissionSetOwnerBindingDoor } from './permission-set-owner-binding';

const DOORS: PermissionSetOwnerBindingDoor[] = ['save', 'restore', 'publish', 'build', 'register'];
const set = (packageId?: unknown) => ({
  name: 'probe_set',
  objects: {},
  ...(packageId === undefined ? {} : { packageId }),
});

describe('[ADR-0086 D3] the verdict, at every door', () => {
  it.each(DOORS)('%s: a body `packageId` that names another package is refused, naming both values', (door) => {
    const refusal = judgePermissionSetOwnerBinding(set('com.acme.other'), 'probe_set', 'com.acme.crm', door);
    expect(refusal).toMatchObject({ declared: 'com.acme.other', bound: 'com.acme.crm' });
    expect(refusal!.message).toContain("'com.acme.other'");
    expect(refusal!.message).toContain("'com.acme.crm'");
    expect(refusal!.issueMessage).toContain("'com.acme.crm'");
  });

  it.each(DOORS)('%s: any body `packageId` on a set no package binds is refused, the empty string included', (door) => {
    for (const binding of [undefined, null, '']) {
      expect(judgePermissionSetOwnerBinding(set('com.acme.other'), 'probe_set', binding, door)).toMatchObject({
        declared: 'com.acme.other',
        bound: null,
      });
      expect(judgePermissionSetOwnerBinding(set(''), 'probe_set', binding, door)).toMatchObject({ declared: '', bound: null });
    }
  });

  it.each(DOORS)('CONTROL %s: a body `packageId` equal to the binding, and an absent one, are accepted', (door) => {
    expect(judgePermissionSetOwnerBinding(set('com.acme.crm'), 'probe_set', 'com.acme.crm', door)).toBeUndefined();
    for (const binding of ['com.acme.crm', undefined, null, '']) {
      expect(judgePermissionSetOwnerBinding(set(), 'probe_set', binding, door)).toBeUndefined();
    }
  });

  it('a non-string `packageId` and a non-object body are the schema\'s to refuse, never judged here', () => {
    for (const item of [set(1), set(null), null, undefined, 'probe_set', [set('x')]]) {
      expect(judgePermissionSetOwnerBinding(item, 'probe_set', 'com.acme.crm', 'build')).toBeUndefined();
    }
  });
});

describe('[ADR-0086 D3] the build and registration words prescribe first', () => {
  it('build: drop the key, or ship the set from the stack the key names', () => {
    const refusal = judgePermissionSetOwnerBinding(set('com.acme.other'), 'probe_set', 'com.acme.crm', 'build')!;
    expect(refusal.message.indexOf("Drop `packageId` from permission set 'probe_set', or ship the set from package 'com.acme.other'")).toBe(0);
    expect(refusal.message).toContain("this stack ships it from package 'com.acme.crm'");
  });

  it('build: a stack with no `manifest` ships the set from no package, and the empty key offers only the drop', () => {
    const refusal = judgePermissionSetOwnerBinding(set(''), 'probe_set', undefined, 'build')!;
    expect(refusal.message.indexOf("Drop `packageId` from permission set 'probe_set'. ")).toBe(0);
    expect(refusal.message).toContain('from no package (the stack declares no `manifest`)');
    expect(refusal.issueMessage).toContain('(none)');
    expect(refusal.issueMessage).not.toContain('ship the set from package');
  });

  it('register: drop the key, or ship the set from the package the key names, then rebuild', () => {
    const refusal = judgePermissionSetOwnerBinding(set('com.acme.other'), 'probe_set', 'com.acme.crm', 'register')!;
    expect(refusal.message.indexOf("Drop `packageId` from permission set 'probe_set', or ship the set from package 'com.acme.other', then build and install the package again.")).toBe(0);
    expect(refusal.message).toContain("it is registered under package 'com.acme.crm'");
    expect(refusal.issueMessage).toContain("('com.acme.crm')");
    expect(refusal.issueMessage).toContain("ship the set from package 'com.acme.other'");
  });
});
