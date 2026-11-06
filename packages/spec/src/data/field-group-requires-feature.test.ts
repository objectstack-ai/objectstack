// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ObjectFieldGroupSchema, ObjectSchema } from './object.zod';
import { featureGatePredicate, lowerRequiresFeature } from '../kernel/public-auth-features';

/**
 * `fieldGroups[].requiresFeature` — the field-group twin of the action-level
 * `requiresFeature`. It names a flag of `PUBLIC_AUTH_FEATURES`, is lowered at
 * parse time into the group's `visibleWhen` by the same helper the action key
 * uses, and is stripped from the output. These pins hold the four facts a
 * consumer relies on: the lowering, the strip, the refusal of an unknown flag,
 * and the composition with an authored `visibleWhen`.
 */
describe('ObjectFieldGroupSchema.requiresFeature', () => {
  const gate = featureGatePredicate('multiOrgEnabled');

  it('lowers into visibleWhen and strips the key', () => {
    const out = ObjectFieldGroupSchema.parse({
      key: 'group_structure',
      label: 'Group Structure',
      requiresFeature: 'multiOrgEnabled',
    });
    expect(out.visibleWhen).toEqual({ dialect: 'cel', source: 'features.multiOrgEnabled != false' });
    expect(out.visibleWhen).toEqual({ dialect: 'cel', source: gate });
    expect('requiresFeature' in out).toBe(false);
  });

  it('lowers an opt-in flag to its own gate, the one an action gets', () => {
    const out = ObjectFieldGroupSchema.parse({ key: 'mfa', label: 'MFA', requiresFeature: 'twoFactor' });
    expect(out.visibleWhen).toEqual({ dialect: 'cel', source: 'features.twoFactor == true' });
  });

  it('refuses a flag outside the public feature registry, at requiresFeature', () => {
    const res = ObjectFieldGroupSchema.safeParse({ key: 'g', label: 'G', requiresFeature: 'multiOrg' });
    expect(res.success).toBe(false);
    const issue = res.error!.issues[0]!;
    expect(issue.code).toBe('invalid_value');
    expect(issue.path).toEqual(['requiresFeature']);
  });

  it('AND-composes with an authored visibleWhen: the author first, the gate last', () => {
    const fromString = ObjectFieldGroupSchema.parse({
      key: 'g',
      label: 'G',
      visibleWhen: "record.kind == 'child'",
      requiresFeature: 'multiOrgEnabled',
    });
    expect(fromString.visibleWhen).toEqual({
      dialect: 'cel',
      source: `(record.kind == 'child') && ${gate}`,
    });

    const fromEnvelope = ObjectFieldGroupSchema.parse({
      key: 'g',
      label: 'G',
      visibleWhen: { dialect: 'cel', source: "record.kind == 'child'" },
      requiresFeature: 'multiOrgEnabled',
    });
    expect(fromEnvelope.visibleWhen).toEqual(fromString.visibleWhen);
  });

  it('leaves a group without the key exactly as before', () => {
    const out = ObjectFieldGroupSchema.parse({ key: 'g', label: 'G', visibleWhen: 'record.x == 1' });
    expect(out.visibleWhen).toEqual({ dialect: 'cel', source: 'record.x == 1' });
    expect('requiresFeature' in out).toBe(false);
    expect(ObjectFieldGroupSchema.parse({ key: 'g', label: 'G' }).visibleWhen).toBeUndefined();
  });

  it('lowers inside an object, where authors write it', () => {
    const obj = ObjectSchema.create({
      name: 'acme_unit',
      label: 'Unit',
      fields: {
        title: { type: 'text', label: 'Title', group: 'basics' },
        parent_note: { type: 'text', label: 'Parent note', group: 'tree' },
      },
      fieldGroups: [
        { key: 'basics', label: 'Basics' },
        { key: 'tree', label: 'Tree', requiresFeature: 'multiOrgEnabled' },
      ],
    });
    const [basics, tree] = obj.fieldGroups!;
    expect(basics!.visibleWhen).toBeUndefined();
    expect(tree!.visibleWhen).toEqual({ dialect: 'cel', source: gate });
    expect('requiresFeature' in tree!).toBe(false);
  });
});

describe('lowerRequiresFeature: the slot is keyed on the shape', () => {
  const ctx = { addIssue: () => undefined } as unknown as z.core.$RefinementCtx;
  type ActionLike = { name: string; requiresFeature?: 'multiOrgEnabled'; visible?: boolean };
  type GroupLike = { key: string; requiresFeature?: 'multiOrgEnabled'; visibleWhen?: { dialect: 'cel'; source: string } };
  const action: ActionLike = { name: 'a', requiresFeature: 'multiOrgEnabled' };
  const group: GroupLike = { key: 'g', requiresFeature: 'multiOrgEnabled' };
  const gate = featureGatePredicate('multiOrgEnabled');

  it('lowers each shape into its own slot, and a slot the shape does not read fails to compile', () => {
    expect(lowerRequiresFeature(action, ctx)).toEqual({ name: 'a', visible: { dialect: 'cel', source: gate } });
    expect(lowerRequiresFeature(group, ctx, 'visibleWhen')).toEqual({ key: 'g', visibleWhen: { dialect: 'cel', source: gate } });
    // The two calls below are compile-time pins (check:test-typecheck holds
    // them): each would write the gate into a key its schema never reads.
    // @ts-expect-error an action's predicate slot is `visible`, not `visibleWhen`
    lowerRequiresFeature(action, ctx, 'visibleWhen');
    // @ts-expect-error a field group's predicate slot is `visibleWhen`; the default slot is `visible`
    lowerRequiresFeature(group, ctx);
  });
});
