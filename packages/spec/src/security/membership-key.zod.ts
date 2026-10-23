// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { RESERVED_RLS_MEMBERSHIP_KEYS } from '../contracts/rls-membership-resolver';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * # Declarative membership keys (ADR-0105 D11, the metadata twin; #25234 ruling A)
 *
 * A membership key is a `current_user.KEY` set an RLS policy reads with `in`
 * (`supplier in current_user.portal_supplier_ids`). Until this key, the only
 * producer was a registered code resolver ({@link IRlsMembershipResolver}),
 * which hosted environments cannot run. A declaration on the ROSTER object X
 * names the same set in metadata:
 *
 * > `current_user.KEY` = the distinct non-null values of `valueField` (F) on the
 * > rows of X whose `userField` (U) equals the caller's user id and on which
 * > `filter` holds.
 *
 * X is implied by the declaring object, as `defaultRowScope` implies its object.
 * The map is record-keyed (`ObjectSchema.membershipKeys`), so one object cannot
 * declare a key twice; `defineStack` and `composeStacks` refuse one key declared
 * on two objects.
 *
 * What the shape itself makes unwritable (refusals 1, 2, 8, 9 and 10 of the
 * ruled list, and the U = F half of 6):
 *
 * - an unknown member, or a key name that is not snake_case (strict shape);
 * - a key named like a kernel context value ({@link RESERVED_RLS_MEMBERSHIP_KEYS},
 *   read from the contract, never copied);
 * - `valueField` naming the same column as `userField`;
 * - a cycle or a chain: there is no member that names another key, and no
 *   member sets a size (the bound is a platform constant of
 *   {@link MEMBERSHIP_KEY_MAX_VALUES}, overflow fails closed);
 * - a declaration from another package: `ObjectExtensionSchema` has no slot
 *   for this key.
 *
 * Judged against the merged object at authoring and publish, not here
 * (refusals 3 at the runtime gate, 4, 5, 6, 7, 11, 12 and 13): whether U is a
 * single-valued user reference and F a reference column on X, whether `filter`
 * lowers and reads no `current_user.*`, a key a registered resolver also owns,
 * and how a policy compares the key.
 *
 * Not read yet: the security plugin's request staging is the reader (the
 * liveness row is `planned`).
 */

/**
 * The most values one membership key may resolve to for one request. A cost
 * ceiling, not an authorable setting: a set larger than this is left
 * unresolved, so every policy reading it fails closed. Raised only by a ruling.
 */
export const MEMBERSHIP_KEY_MAX_VALUES = 1000;

/**
 * A membership key's name: the `KEY` of `current_user.KEY`. snake_case, and
 * never one of the kernel-resolved context values, which carry authorization
 * meaning no declaration may redefine.
 */
export const MembershipKeyNameSchema = lazySchema(() => SnakeCaseIdentifierSchema.refine(
  (name) => !RESERVED_RLS_MEMBERSHIP_KEYS.includes(name),
  {
    message:
      `A membership key may not be named ${RESERVED_RLS_MEMBERSHIP_KEYS.map((k) => `'${k}'`).join(', ')}: `
      + 'the kernel resolves those `current_user.*` values itself. Choose a name that says what the set holds, '
      + 'e.g. "portal_supplier_ids".',
  },
).describe('The membership key name: policies read the set as `current_user.KEY`'));

/**
 * One declarative membership key on the roster object. See the module docblock
 * for its meaning; every member names a column of the declaring object.
 */
export const MembershipKeySchema = lazySchema(() => strictObject(
  {
    surface: 'this membership key',
    history:
      'A key this declaration does not define is refused rather than dropped: a dropped member of a '
      + 'membership key would change which rows the set holds, and so which records a policy lets through.',
    aliases: {
      user: 'userField',
      userColumn: 'userField',
      ownerField: 'userField',
      value: 'valueField',
      valueColumn: 'valueField',
      field: 'valueField',
      where: 'filter',
      condition: 'filter',
      using: 'filter',
    },
    guidance: {
      object:
        '`object` is implied on a membership key: the key is declared on the roster object whose rows define it. '
        + 'Delete `object`, and declare the key under that object\'s `membershipKeys`.',
      limit:
        'A membership key has no authorable size: one key resolves to at most 1,000 values per request, a '
        + 'platform constant, and a larger set fails closed. Narrow the set with `filter` instead.',
      maxValues:
        'A membership key has no authorable size: one key resolves to at most 1,000 values per request, a '
        + 'platform constant, and a larger set fails closed. Narrow the set with `filter` instead.',
    },
  },
  {
    /**
     * U: the column holding the roster row's user. A single-valued user
     * reference on this object (`user`, or a `lookup` / `master_detail` to
     * `sys_user`); a row counts for the caller when U equals their user id.
     */
    userField: SnakeCaseIdentifierSchema.describe(
      'The column of this object that holds the user a row belongs to: a single-valued user reference '
      + '(`user`, or a `lookup` / `master_detail` to `sys_user`). A row counts for the signed-in user when this '
      + 'column holds their user id.',
    ).meta({ title: 'User field' }),

    /**
     * F: the column whose values form the set. A reference column on this
     * object (`lookup`, `master_detail` or `user`); a multi-valued one is
     * flattened and de-duplicated.
     */
    valueField: SnakeCaseIdentifierSchema.describe(
      'The column of this object whose values form the set: a reference (`lookup`, `master_detail` or '
      + '`user`), multi-valued allowed. A policy compares the set with a column that references the same '
      + 'object, or with `id` on that object. Never the same column as `userField`.',
    ).meta({ title: 'Value field' }),

    /**
     * Optional narrowing over this object's own columns, in the RLS lowerable
     * subset (the grammar of a policy's `using`). It reads no `current_user.*`
     * value, which is what keeps a key from being built from another key.
     */
    filter: z.string().optional().describe(
      'Optional condition a roster row must also meet, in canonical CEL over this object\'s own columns and '
      + 'within the row-level security subset a policy\'s `using` lowers (e.g. "active == true"). It may not '
      + 'read any `current_user.*` value.',
    ).meta({ title: 'Filter' }),

    label: z.string().optional().describe('Human-readable name of the set').meta({ title: 'Label' }),

    description: z.string().optional().describe('What the set holds and who it is for').meta({ title: 'Description' }),
  },
).superRefine((key, ctx) => {
  if (key.valueField === key.userField) {
    ctx.addIssue({
      code: 'custom',
      path: ['valueField'],
      message:
        `\`valueField\` names the same column as \`userField\` ('${key.userField}'): the set would hold only `
        + 'the caller\'s own user id. Point `valueField` at the reference column whose values the policies '
        + 'compare, such as the supplier a contact belongs to.',
    });
  }
}));

export type MembershipKey = z.input<typeof MembershipKeySchema>;
export type MembershipKeyParsed = z.output<typeof MembershipKeySchema>;

/**
 * `ObjectSchema.membershipKeys`: the membership keys this roster object
 * declares, by name.
 */
export const MembershipKeysSchema = lazySchema(() => z.record(z.string(), MembershipKeySchema).superRefine(
  // The name is judged here, not as the record's key schema: a refused record
  // key surfaces only as zod's generic "Invalid key in record", which would hide
  // WHICH rule the name broke. Each broken rule is one issue at the key's path.
  (keys, ctx) => {
    for (const name of Object.keys(keys)) {
      const verdict = MembershipKeyNameSchema.safeParse(name);
      if (verdict.success) continue;
      for (const issue of verdict.error.issues) {
        ctx.addIssue({ code: 'custom', path: [name], message: `Membership key '${name}': ${issue.message}` });
      }
    }
  },
));

export type MembershipKeys = z.input<typeof MembershipKeysSchema>;
