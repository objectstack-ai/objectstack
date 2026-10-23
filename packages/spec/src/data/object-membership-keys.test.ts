// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectSchema.membershipKeys` — declarative membership keys on the roster
 * object (ADR-0105 D11's metadata twin; #25234 ruling A, PR 1, the spec half).
 *
 * What is pinned, on the authoring door (`ObjectSchema`), the metadata write
 * door (the `object` registry binding), and the stack doors:
 *
 * - the design's worked example (hotsrm's supplier contact) parses, unchanged;
 * - the refusals the SHAPE makes unwritable: an unknown member (`object` and a
 *   size key with their prescriptions), a key name that is not snake_case, a
 *   kernel context name (read from `RESERVED_RLS_MEMBERSHIP_KEYS`, not copied),
 *   `valueField` equal to `userField`, and the key on an object extension;
 * - one key declared on two objects, refused by `defineStack` and by
 *   `composeStacks` (refusal 3), with controls for each door;
 * - control: an object without the key parses and its output has no key.
 *
 * No server reads the key yet (the liveness row is `planned`), so nothing here
 * asserts a staged set: this is the contract's shape.
 */

import { describe, expect, it } from 'vitest';

import { RESERVED_RLS_MEMBERSHIP_KEYS } from '../contracts/rls-membership-resolver';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MembershipKeySchema, MEMBERSHIP_KEY_MAX_VALUES } from '../security/membership-key.zod';
import { composeStacks, defineStack } from '../stack.zod';
import { ObjectExtensionSchema, ObjectSchema } from './object.zod';

/** The design's worked example: hotsrm's supplier-contact roster. */
const SUPPLIER_CONTACT = {
  name: 'srm_supplier_contact',
  fields: {
    user: { type: 'user' as const, required: true },
    supplier: { type: 'lookup' as const, reference: 'srm_supplier', required: true },
    active: { type: 'boolean' as const, defaultValue: true },
  },
  membershipKeys: {
    portal_supplier_ids: {
      userField: 'user',
      valueField: 'supplier',
      filter: 'active == true',
      description: 'Suppliers the signed-in user is an active contact of',
    },
  },
};

const KEY = SUPPLIER_CONTACT.membershipKeys.portal_supplier_ids;

const withKeys = (membershipKeys: Record<string, unknown>) => ({ ...SUPPLIER_CONTACT, membershipKeys });

/** The one issue a refused parse raised — asserted to be exactly one. */
function onlyIssue(result: ReturnType<typeof ObjectSchema.safeParse>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  expect(result.error.issues).toHaveLength(1);
  return result.error.issues[0]!;
}

describe('ObjectSchema.membershipKeys — the closed shape', () => {
  it("parses the design's worked example unchanged (hotsrm's supplier contact)", () => {
    const r = ObjectSchema.safeParse(SUPPLIER_CONTACT);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.membershipKeys).toEqual(SUPPLIER_CONTACT.membershipKeys);
  });

  it('parses the minimal declaration: `userField` and `valueField` only', () => {
    const r = ObjectSchema.safeParse(withKeys({ portal_supplier_ids: { userField: 'user', valueField: 'supplier' } }));
    expect(r.success).toBe(true);
  });

  it('the metadata write door (the `object` registry binding) applies the same shape', () => {
    const door = getMetadataTypeSchema('object');
    expect(door).toBeDefined();
    expect(door!.safeParse(SUPPLIER_CONTACT).success).toBe(true);
    const refused = door!.safeParse(withKeys({ positions: KEY }));
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.issues.map((i) => [i.code, i.path])).toEqual([['custom', ['membershipKeys', 'positions']]]);
  });

  it('control: an object without the key parses as before, and its output carries no key', () => {
    const { membershipKeys: _absent, ...plain } = SUPPLIER_CONTACT;
    const r = ObjectSchema.safeParse(plain);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect('membershipKeys' in r.data).toBe(false);
  });

  it('the size bound is a platform constant of 1,000, not a member', () => {
    expect(MEMBERSHIP_KEY_MAX_VALUES).toBe(1000);
    expect(Object.keys(MembershipKeySchema.shape)).toEqual(['userField', 'valueField', 'filter', 'label', 'description']);
  });
});

describe('ObjectSchema.membershipKeys — what the shape refuses', () => {
  it.each([...RESERVED_RLS_MEMBERSHIP_KEYS])("refuses a key named like the kernel context value '%s', at the key", (name) => {
    const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ [name]: KEY })));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['membershipKeys', name]);
    expect(issue.message).toContain('the kernel resolves those `current_user.*` values itself');
  });

  it('refuses a key name that is not snake_case, at the key', () => {
    for (const name of ['PortalSupplierIds', 'portal-supplier-ids', '1st_ids']) {
      const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ [name]: KEY })));
      expect(issue.code, name).toBe('custom');
      expect(issue.path, name).toEqual(['membershipKeys', name]);
      expect(issue.message, name).toContain('snake_case');
    }
  });

  it('refuses `valueField` naming the same column as `userField`, at `valueField`', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ my_ids: { userField: 'user', valueField: 'user' } })));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['membershipKeys', 'my_ids', 'valueField']);
  });

  it('refuses `object` by name, with the implied-object prescription', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ portal_supplier_ids: { ...KEY, object: 'srm_supplier_contact' } })));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['membershipKeys', 'portal_supplier_ids']);
    expect((issue as { keys?: string[] }).keys).toEqual(['object']);
    expect(issue.message).toContain('`object` is implied on a membership key');
  });

  it('refuses an authored size, with the platform-constant prescription', () => {
    for (const sizeKey of ['limit', 'maxValues']) {
      const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ portal_supplier_ids: { ...KEY, [sizeKey]: 5 } })));
      expect(issue.code, sizeKey).toBe('unrecognized_keys');
      expect((issue as { keys?: string[] }).keys, sizeKey).toEqual([sizeKey]);
      expect(issue.message, sizeKey).toContain('no authorable size');
    }
  });

  it('refuses any other unknown member — no member names another key, so a chain cannot be spelled', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ portal_supplier_ids: { ...KEY, fromKey: 'other_ids' } })));
    expect(issue.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] }).keys).toEqual(['fromKey']);
  });

  it('refuses a declaration missing `userField` or `valueField`', () => {
    for (const member of ['userField', 'valueField'] as const) {
      const { [member]: _gone, ...rest } = KEY;
      const issue = onlyIssue(ObjectSchema.safeParse(withKeys({ portal_supplier_ids: rest })));
      expect(issue.code, member).toBe('invalid_type');
      expect(issue.path, member).toEqual(['membershipKeys', 'portal_supplier_ids', member]);
    }
  });

  it('refuses the key on an object extension: another package cannot declare a key on this object', () => {
    const r = ObjectExtensionSchema.safeParse({ extend: 'srm_supplier_contact', membershipKeys: SUPPLIER_CONTACT.membershipKeys });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    const issue = r.error.issues[0]!;
    expect(issue.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] }).keys).toEqual(['membershipKeys']);
    expect(issue.message).toContain('`membershipKeys` cannot be contributed through an object extension');
  });
});

// ── refusal 3: one key, two objects ─────────────────────────────────────────

type Refusal = Error & { code?: string; status?: number; issues?: readonly string[] };

function refusalOf(fn: () => unknown): Refusal | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e as Refusal;
  }
}

const manifest = (id: string) => ({ id, name: id.split('.').pop()!, version: '1.0.0', type: 'app' as const });

/** A second roster that declares a key of its own (or, per test, the same key). */
const buyerRoster = (keyName = 'buyer_supplier_ids') => ({
  name: 'srm_buyer_assignment',
  fields: {
    buyer: { type: 'user' as const },
    supplier: { type: 'lookup' as const, reference: 'srm_supplier' },
  },
  membershipKeys: { [keyName]: { userField: 'buyer', valueField: 'supplier' } },
});

describe('defineStack — one membership key declared on two objects of one stack', () => {
  it('is refused, naming the key and both objects with their positions', () => {
    const err = refusalOf(() => defineStack({
      manifest: manifest('com.example.mk'),
      objects: [SUPPLIER_CONTACT, buyerRoster('portal_supplier_ids')],
    }));
    expect(err, 'the stack was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toContain(
      "Membership key 'portal_supplier_ids' is declared on two objects in `objects`: "
        + "'srm_supplier_contact' (stack.objects[0]) and 'srm_buyer_assignment' (stack.objects[1])",
    );
  });

  it('control: two objects declaring two different keys are accepted', () => {
    expect(() => defineStack({ manifest: manifest('com.example.mk'), objects: [SUPPLIER_CONTACT, buyerRoster()] })).not.toThrow();
  });
});

describe('composeStacks — one membership key declared on two objects across the stacks it composes', () => {
  const a = () => defineStack({ manifest: manifest('com.example.mk-a'), objects: [SUPPLIER_CONTACT] });
  const b = (keyName: string) => defineStack({ manifest: manifest('com.example.mk-b'), objects: [buyerRoster(keyName)] });

  it("is refused, naming both objects and the stacks that define them", () => {
    const err = refusalOf(() => composeStacks([a(), b('portal_supplier_ids')]));
    expect(err, 'the composition was refused').toBeDefined();
    expect({ code: err!.code, status: err!.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
    expect(err!.issues).toHaveLength(1);
    expect(err!.issues![0]).toContain(
      "Membership key 'portal_supplier_ids' is declared on two objects in the composed stacks: "
        + "'srm_supplier_contact' ('com.example.mk-a' (stack #0)) and 'srm_buyer_assignment' ('com.example.mk-b' (stack #1))",
    );
    expect(err!.message).toContain('composeStacks artifact cross-reference validation failed (1 issue):');
  });

  it("is refused under `manifest: 'preserve'` too — one deployment, one key namespace", () => {
    const err = refusalOf(() => composeStacks([a(), b('portal_supplier_ids')], { manifest: 'preserve' }));
    expect(err?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });

  it('control: two different keys on two objects compose', () => {
    expect(() => composeStacks([a(), b('buyer_supplier_ids')])).not.toThrow();
  });

  it("control: one object both stacks declare identically under `'merge'` counts once", () => {
    const again = () => defineStack({ manifest: manifest('com.example.mk-c'), objects: [SUPPLIER_CONTACT] });
    expect(() => composeStacks([a(), again()], { objectConflict: 'merge' })).not.toThrow();
  });

  it("a different declaration of one key on one object under `'merge'` is the collection refusal, not this one", () => {
    const other = () => defineStack({
      manifest: manifest('com.example.mk-c'),
      objects: [withKeys({ portal_supplier_ids: { ...KEY, filter: 'active == false' } })],
    });
    const err = refusalOf(() => composeStacks([a(), other()], { objectConflict: 'merge' }));
    expect(err?.message).toContain("its 'membershipKeys' is declared with different values");
  });
});
