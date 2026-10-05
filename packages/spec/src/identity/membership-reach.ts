// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { z } from 'zod';
import {
  BUILTIN_MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_ADMIN,
  MEMBERSHIP_ROLE_DELEGATED_ADMIN,
  MEMBERSHIP_ROLE_OWNER,
  type BuiltinMembershipRole,
} from './membership-role';
import { mapMembershipRole } from './eval-user.zod';

/**
 * # Membership reach — which grade reaches which organization endpoint
 *
 * `membership-role.ts` keeps three facts apart that look like one (what names
 * exist · which names mean administrative authority · how a name projects into
 * an identity). This module is a FOURTH, and it is not merged into any of them
 * (ADR-0108 D4):
 *
 *  4. **which membership grades reach which better-auth organization
 *     endpoint** — the table below.
 *
 * Reach is not authority (ADR-0108 D1: a grade decides what a principal may
 * REACH). `delegated_admin` reaches `/organization/invite-member` and is still
 * not an administrative grade; what the endpoint then permits is decided by its
 * own door — better-auth's statement check, plus plugin-auth's invitation role
 * cap and the ADR-0105 D8 placement gate behind it.
 *
 * ## Where the rows come from
 *
 * They are read off better-auth's own access-control statements — the
 * `defaultRoles` that `better-auth/plugins/organization/access` exports — plus
 * the one role plugin-auth registers beside them, `delegated_admin`
 * (`invitation: ['create']` on top of a plain member's statements). Each row
 * names the statement the endpoint's door checks with `hasPermission`, and the
 * grades whose statements carry it. Two rules on top of the statements:
 *
 * - `creatorRoleOnly` — better-auth refuses to SET the creator role (`owner`,
 *   its `creatorRole` default) on a member unless the caller holds it, whatever
 *   their statements say. Ownership transfer is that request shape.
 * - Endpoints no grade gates are not rows. `/organization/add-member` is
 *   ObjectStack's mount over the vendor's server-only `addMember`, gated on
 *   platform-admin standing (ADR-0068), not on a membership grade.
 *
 * plugin-auth's `membership-reach-table.test.ts` pins every row equal to the
 * roles map plugin-auth actually hands better-auth, and each row's statement
 * equal to the check the installed vendor endpoint performs — so a vendor bump
 * or a registration change that moves the door turns that test red instead of
 * leaving this table quietly wrong.
 *
 * ## What reads it
 *
 * The `requiresMembershipReach` sugar on actions (`ui/action.zod.ts`): lowered
 * at parse time by {@link lowerRequiresMembershipReach} into the canonical
 * `visible` predicate over `current_user.positions`, using the names
 * `mapMembershipRole` projects the grades to (`org_owner`, `org_admin`,
 * `delegated_admin`). The capability channel (`current_user.can`) stays
 * grade-free, as ADR-0108 rules.
 *
 * It is UI courtesy, not authorization: the button follows the door, and the
 * door stays the authority (ADR-0066 D4 — for a `type: 'api'` action the server
 * half is the endpoint's own check).
 *
 * This module carries constants and pure lowering helpers only (Prime
 * Directive #2), and imports nothing beyond its two sibling identity modules,
 * so schema modules can depend on it file-directly.
 */

/** A better-auth organization access-control statement: one resource, one action. */
export type MembershipReachStatement = {
  /** The resource key in better-auth's organization `defaultStatements`. */
  resource: 'organization' | 'member' | 'invitation' | 'team' | 'ac';
  /** The action on that resource the endpoint's door checks. */
  action: string;
};

export type MembershipReachEntry = {
  /** The better-auth organization endpoint, relative to the auth base path. */
  endpoint: `/organization/${string}`;
  /** The statement the endpoint's door checks with `hasPermission`. */
  statement: MembershipReachStatement;
  /**
   * The request also passes better-auth's creator-role rule: setting the
   * creator role on a member is refused unless the caller holds it.
   */
  creatorRoleOnly?: true;
  /** The grades that reach it, in {@link BUILTIN_MEMBERSHIP_ROLES} order. */
  grades: readonly BuiltinMembershipRole[];
};

const OWNER_ADMIN = [MEMBERSHIP_ROLE_OWNER, MEMBERSHIP_ROLE_ADMIN] as const;

/**
 * The reach table. Keys are the names the `requiresMembershipReach` sugar
 * accepts; each names one grade-gated organization request.
 */
export const MEMBERSHIP_REACH = {
  invite_member: {
    endpoint: '/organization/invite-member',
    statement: { resource: 'invitation', action: 'create' },
    grades: [MEMBERSHIP_ROLE_OWNER, MEMBERSHIP_ROLE_ADMIN, MEMBERSHIP_ROLE_DELEGATED_ADMIN],
  },
  cancel_invitation: {
    endpoint: '/organization/cancel-invitation',
    statement: { resource: 'invitation', action: 'cancel' },
    grades: OWNER_ADMIN,
  },
  update_member_role: {
    endpoint: '/organization/update-member-role',
    statement: { resource: 'member', action: 'update' },
    grades: OWNER_ADMIN,
  },
  transfer_ownership: {
    endpoint: '/organization/update-member-role',
    statement: { resource: 'member', action: 'update' },
    creatorRoleOnly: true,
    grades: [MEMBERSHIP_ROLE_OWNER],
  },
  remove_member: {
    endpoint: '/organization/remove-member',
    statement: { resource: 'member', action: 'delete' },
    grades: OWNER_ADMIN,
  },
  create_team: {
    endpoint: '/organization/create-team',
    statement: { resource: 'team', action: 'create' },
    grades: OWNER_ADMIN,
  },
  update_team: {
    endpoint: '/organization/update-team',
    statement: { resource: 'team', action: 'update' },
    grades: OWNER_ADMIN,
  },
  remove_team: {
    endpoint: '/organization/remove-team',
    statement: { resource: 'team', action: 'delete' },
    grades: OWNER_ADMIN,
  },
  add_team_member: {
    endpoint: '/organization/add-team-member',
    statement: { resource: 'member', action: 'update' },
    grades: OWNER_ADMIN,
  },
  remove_team_member: {
    endpoint: '/organization/remove-team-member',
    statement: { resource: 'member', action: 'delete' },
    grades: OWNER_ADMIN,
  },
} as const satisfies Record<string, MembershipReachEntry>;

export type MembershipReachName = keyof typeof MEMBERSHIP_REACH;

/** Tuple of table keys — feeds `z.enum(...)` for the `requiresMembershipReach` sugar. */
export const MEMBERSHIP_REACH_NAMES = Object.keys(MEMBERSHIP_REACH) as [
  MembershipReachName,
  ...MembershipReachName[],
];

/**
 * The canonical CEL gate for a row: one `'<name>' in current_user.positions`
 * term per grade, joined with `||`, where `<name>` is what `mapMembershipRole`
 * projects the grade to. Grade order follows {@link BUILTIN_MEMBERSHIP_ROLES},
 * so the text is stable whatever order a row lists its grades in.
 */
export function membershipReachPredicate(name: MembershipReachName): string {
  const grades: readonly string[] = MEMBERSHIP_REACH[name].grades;
  return BUILTIN_MEMBERSHIP_ROLES
    .filter((grade) => grades.includes(grade))
    .map((grade) => `'${mapMembershipRole(grade)}' in current_user.positions`)
    .join(' || ');
}

/** Object shape the lowering transform operates on (post field-level parse). */
type WithRequiresMembershipReach = {
  requiresMembershipReach?: MembershipReachName;
  /** Normalized to the `{dialect, source}` envelope, or the boolean literal arm. */
  visible?: boolean | ({ dialect?: unknown; source?: unknown } & Record<string, unknown>);
};

/**
 * Lower the declarative `requiresMembershipReach: '<row>'` sugar into the
 * canonical `visible` CEL predicate and strip the sugar key from the output —
 * the mechanism of `lowerRequiresFeature` (`kernel/public-auth-features.ts`),
 * branch for branch, so persisted artifacts, lint, runtime and objectui only
 * ever see the canonical envelope:
 *
 * - No existing `visible`, or `visible: true` → the gate alone.
 * - Existing CEL `visible` with a non-blank `source` → `(<existing>) && <gate>`,
 *   the gate parenthesised when it has more than one term.
 * - Existing `visible: false` → loud parse error: `false && <gate>` is `false`
 *   whatever the caller's grade, so the gate could never take effect (ADR-0078).
 * - Existing `visible` that is non-CEL or AST-only → loud parse error.
 * - Existing CEL `visible` whose `source` is blank after trimming → loud parse
 *   error: composing onto it would parenthesise nothing.
 *
 * Wired on `ActionSchema` AHEAD of the `requiresFeature` lowering, so a feature
 * gate stays the last term of the composed predicate.
 */
export function lowerRequiresMembershipReach<T extends WithRequiresMembershipReach>(
  input: T,
  ctx: z.core.$RefinementCtx,
): Omit<T, 'requiresMembershipReach'> {
  const { requiresMembershipReach, ...rest } = input;
  if (requiresMembershipReach === undefined) return rest as Omit<T, 'requiresMembershipReach'>;

  const gate = membershipReachPredicate(requiresMembershipReach);
  // Annotated rather than inferred, for the reason `lowerRequiresFeature` gives:
  // `rest.visible` is a deferred indexed access control flow cannot narrow.
  const existing: WithRequiresMembershipReach['visible'] = rest.visible;
  if (existing === undefined || existing === true) {
    return { ...rest, visible: { dialect: 'cel', source: gate } } as Omit<T, 'requiresMembershipReach'>;
  }
  if (existing === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresMembershipReach'],
      message:
        '`requiresMembershipReach` cannot compose with `visible: false` — the literal already hides this '
        + 'unconditionally, so the membership gate can never take effect. Drop `requiresMembershipReach` to '
        + 'keep it hidden, or drop `visible: false` to let the caller\'s membership grade decide.',
    });
    return rest as Omit<T, 'requiresMembershipReach'>;
  }
  if (existing.dialect !== 'cel' || typeof existing.source !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresMembershipReach'],
      message:
        '`requiresMembershipReach` composes only with a CEL `visible` carrying a `source` string; '
        + 'this expression is AST-only or non-CEL — write the combined predicate by hand.',
    });
    return rest as Omit<T, 'requiresMembershipReach'>;
  }
  if (existing.source.trim().length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['requiresMembershipReach'],
      message:
        '`requiresMembershipReach` composes only with a CEL `visible` carrying a NON-BLANK `source`; this '
        + '`source` is blank after trimming, so composing the membership gate onto it would parenthesise '
        + 'nothing, and no CEL parse accepts the result on any scope. The gate would fault at evaluation '
        + 'instead of gating, so the caller\'s grade would decide nothing. Drop the blank `visible` and '
        + '`requiresMembershipReach` emits the gate alone, or put the predicate the gate should compose '
        + 'with in `source`.',
    });
    return rest as Omit<T, 'requiresMembershipReach'>;
  }
  const term = MEMBERSHIP_REACH[requiresMembershipReach].grades.length > 1 ? `(${gate})` : gate;
  return {
    ...rest,
    visible: { ...existing, source: `(${existing.source}) && ${term}` },
  } as Omit<T, 'requiresMembershipReach'>;
}
