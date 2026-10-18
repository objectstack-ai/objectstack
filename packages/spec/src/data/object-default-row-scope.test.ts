// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectSchema.defaultRowScope` — the object's default row scope, the
 * permission-set row policy shape without `object` (#24164 ruling E′, item 1).
 *
 * What is pinned, on the authoring door (`ObjectSchema`) and on the metadata
 * write door (the `object` registry binding):
 *
 * - a policy WITHOUT `object` parses, defaults applied (`enabled: true`);
 * - a policy CARRYING `object` is refused, by name, at the key's own path;
 * - an unknown key is still refused (the shape is closed);
 * - control: an object that does not declare the key parses as before and its
 *   parsed output carries no `defaultRowScope`.
 *
 * And, because "minus `object`" must keep every other rule of the policy
 * shape: both cross-field rules still hold (at least one of `using` / `check`;
 * no `check` on a `select` policy), the members are the policy schema's own
 * instances, and the input type is the policy type without `object` and its two
 * value-less tombstones (`priority`, `tags`), which are refused here as well.
 *
 * No runtime reads the key until the security plugin's collection step does
 * (#24340), so nothing here asserts a filter: this is the contract's shape.
 */

import { describe, expect, it } from 'vitest';

import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import {
  DefaultRowScopeSchema,
  RowLevelSecurityPolicySchema,
  type DefaultRowScope,
  type RowLevelSecurityPolicy,
} from '../security/rls.zod';
import { ObjectSchema } from './object.zod';

const OBJECT = { name: 'support_case', fields: { subject: { type: 'text' } } } as const;

/** A `_self` scope, in the shape the shipped sets' identity-table policies take, minus `object`. */
const SCOPE = {
  name: 'support_case_self',
  operation: 'all',
  using: 'owner_id == current_user.id',
} as const;

const withScope = (scope: Record<string, unknown>) => ({ ...OBJECT, defaultRowScope: scope });

/** The one issue a refused parse raised — asserted to be exactly one. */
function onlyIssue(result: ReturnType<typeof ObjectSchema.safeParse>) {
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  expect(result.error.issues).toHaveLength(1);
  return result.error.issues[0]!;
}

// ── compile-time half: the input type IS the policy type without `object` ──
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

describe('ObjectSchema.defaultRowScope — the RLS policy shape without `object`', () => {
  it('parses a policy without `object`, defaults applied', () => {
    const r = ObjectSchema.safeParse(withScope(SCOPE));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.defaultRowScope).toEqual({ ...SCOPE, enabled: true });
  });

  it('refuses a policy carrying `object`, by name, at the key — with the implied-object guidance', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withScope({ ...SCOPE, object: 'support_case' })));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['defaultRowScope']);
    expect((issue as { keys?: string[] }).keys).toEqual(['object']);
    // The prescription names the fix: the key is implied, delete it.
    expect(issue.message).toContain('`object` is implied on a default row scope');
  });

  it('still refuses an unknown key — the shape is closed', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withScope({ ...SCOPE, appliesTo: 'members' })));
    expect(issue.code).toBe('unrecognized_keys');
    expect(issue.path).toEqual(['defaultRowScope']);
    expect((issue as { keys?: string[] }).keys).toEqual(['appliesTo']);
  });

  it('control: an object without the key parses as before, and its output carries no default', () => {
    const r = ObjectSchema.safeParse(OBJECT);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect('defaultRowScope' in r.data).toBe(false);
  });

  it('the metadata write door (the `object` registry binding) applies the same shape', () => {
    const door = getMetadataTypeSchema('object');
    expect(door).toBeDefined();
    expect(door!.safeParse(withScope(SCOPE)).success).toBe(true);
    const refused = door!.safeParse(withScope({ ...SCOPE, object: 'support_case' }));
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.issues.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', ['defaultRowScope']]]);
  });
});

describe('ObjectSchema.defaultRowScope — every rule of the policy shape that does not need `object` holds', () => {
  it('refuses a scope with neither `using` nor `check`', () => {
    const issue = onlyIssue(ObjectSchema.safeParse(withScope({ name: 'no_clause', operation: 'select' })));
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['defaultRowScope']);
  });

  it('refuses a `check` on a `select` scope, at the `check` path', () => {
    const issue = onlyIssue(
      ObjectSchema.safeParse(withScope({ ...SCOPE, operation: 'select', check: 'owner_id == current_user.id' })),
    );
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual(['defaultRowScope', 'check']);
  });

  it('its input type is the policy type without `object` and the two tombstones (compile-time; tsconfig.test.json)', () => {
    // `priority` / `tags` are `retiredKey()` tombstones on the policy: they accept no
    // value, so leaving them out changes nothing either schema accepts.
    const scopeIsPolicyMinusObject: Assert<
      Equal<DefaultRowScope, Omit<RowLevelSecurityPolicy, 'object' | 'priority' | 'tags'>>
    > = true;
    expect(scopeIsPolicyMinusObject).toBe(true);
  });

  it('its members are the policy schema\'s own member instances: `object` and the two tombstones left out', () => {
    const policy = RowLevelSecurityPolicySchema.shape as Record<string, unknown>;
    const scope = DefaultRowScopeSchema.shape as Record<string, unknown>;
    const leftOut = ['object', 'priority', 'tags'];
    expect(Object.keys(scope)).toEqual(Object.keys(policy).filter((k) => !leftOut.includes(k)));
    for (const key of Object.keys(scope)) expect(scope[key], key).toBe(policy[key]);
  });

  it('a tombstoned policy key is refused here too, as an unknown key', () => {
    for (const key of ['priority', 'tags']) {
      const issue = onlyIssue(ObjectSchema.safeParse(withScope({ ...SCOPE, [key]: key === 'tags' ? ['a'] : 1 })));
      expect(issue.code, key).toBe('unrecognized_keys');
      expect(issue.path, key).toEqual(['defaultRowScope']);
      expect((issue as { keys?: string[] }).keys, key).toEqual([key]);
    }
  });
});
