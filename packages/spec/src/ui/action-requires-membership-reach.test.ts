// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `requiresMembershipReach` sugar as `ActionSchema` wires it: lowered at
// parse time into `visible`, stripped from the output, and ordered ahead of
// the `requiresFeature` lowering so a feature gate stays the last term. The
// lowering's own branches are pinned beside the table
// (`identity/membership-reach.test.ts`); this file pins the wiring.

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ActionParamSchema, ActionSchema } from './action.zod';

const INVITE_GATE =
  "'org_owner' in current_user.positions || 'org_admin' in current_user.positions"
  + " || 'delegated_admin' in current_user.positions";
const OWNER_GATE = "'org_owner' in current_user.positions";

const invite = {
  name: 'invite_user',
  label: 'Invite',
  type: 'api',
  target: '/api/v1/auth/organization/invite-member',
} as const satisfies Partial<z.input<typeof ActionSchema>>;

describe('ActionSchema — requiresMembershipReach', () => {
  it('lowers to the reach predicate and does not survive into the parsed action', () => {
    const result = ActionSchema.parse({ ...invite, requiresMembershipReach: 'invite_member' });
    expect(result.visible).toEqual({ dialect: 'cel', source: INVITE_GATE });
    expect(result).not.toHaveProperty('requiresMembershipReach');
  });

  it('composes ahead of requiresFeature — the feature gate stays the last term', () => {
    const result = ActionSchema.parse({
      ...invite,
      requiresMembershipReach: 'invite_member',
      requiresFeature: 'organization',
    });
    expect(result.visible).toEqual({
      dialect: 'cel',
      source: `(${INVITE_GATE}) && features.organization != false`,
    });
    expect(result).not.toHaveProperty('requiresMembershipReach');
    expect(result).not.toHaveProperty('requiresFeature');
  });

  it('composes onto an authored record predicate, then the feature gate onto both', () => {
    const result = ActionSchema.parse({
      name: 'transfer_ownership',
      label: 'Transfer Ownership',
      type: 'api',
      target: '/api/v1/auth/organization/update-member-role',
      visible: "has(record.role) && record.role != 'owner'",
      requiresMembershipReach: 'transfer_ownership',
      requiresFeature: 'organization',
    });
    expect(result.visible).toEqual({
      dialect: 'cel',
      source: `((has(record.role) && record.role != 'owner') && ${OWNER_GATE}) && features.organization != false`,
    });
  });

  it('refuses composition with `visible: false` at the sugar key', () => {
    const result = ActionSchema.safeParse({ ...invite, visible: false, requiresMembershipReach: 'invite_member' });
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path.join('.') === 'requiresMembershipReach');
    expect(issue).toMatchObject({ code: 'custom', path: ['requiresMembershipReach'] });
  });

  it('refuses a name that is not a reach-table row, at the sugar key', () => {
    const result = ActionSchema.safeParse({ ...invite, requiresMembershipReach: 'invite_members' });
    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path.join('.') === 'requiresMembershipReach');
    expect(issue).toMatchObject({ code: 'invalid_value', path: ['requiresMembershipReach'] });
  });

  it('is an action-level key only — a param refuses it as unknown', () => {
    const result = ActionParamSchema.safeParse({ name: 'email', requiresMembershipReach: 'invite_member' });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('leaves an action without the sugar untouched', () => {
    const result = ActionSchema.parse({ ...invite, requiresFeature: 'organization' });
    expect(result.visible).toEqual({ dialect: 'cel', source: 'features.organization != false' });
  });
});
