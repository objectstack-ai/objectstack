// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#14010] The card's symptom, as a bootable app: a column that must be
// COMPUTED and never hand-written, maintained by a cross-object hook.
//
// The requirement the downstream app wrote down is "通过界面、批量导入、数据接口
// 任何途径都不能人工写入" — no channel may write this column by hand. The two
// halves could not both be had:
//
//   • author `editable: false` for the persona  → the direct PATCH is refused,
//   • …and the hook that maintains the column   → refused by the SAME check.
//
// The guard and the legitimate writer were the same door, because a hook's
// `ctx.api` is a ScopedContext over the TRIGGERING write's context. This
// fixture keeps both halves in one app so a single boot can show the guard
// still shut and the declared writer now through it.
//
// Deliberately TWO trigger objects rather than two hooks on one, because each
// hook aborts its own triggering write: `hookrunas_rating` fires the hook that
// declares `runAs: 'system'`, and `hookrunas_legacy_rating` fires an
// identical-but-undeclared one, which is the pre-#14010 behaviour and must stay
// exactly that (the ruling's zero-migration claim, measured rather than
// asserted).
//
// The declared hook ships as an L2 BODY on purpose: that is the shape the
// downstream app ships, and the surface that had no elevation at all before
// this card (`sudo()` is not marshalled into the sandbox — #14044). The
// undeclared control is an in-process handler, so the file also shows the two
// execution surfaces side by side.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The object carrying the computed column. */
export const HookRunAsAccount = ObjectSchema.create({
  name: 'hookrunas_account',
  // [ADR-0090 D1] grandfather stamp: the gate under test here is FIELD-level
  // security, so row-level sharing is deliberately wide open — an RLS refusal
  // would be indistinguishable from the FLS one this fixture is about.
  sharingModel: 'public_read_write',
  label: 'Hook RunAs Account',
  pluralLabel: 'Hook RunAs Accounts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    /** The computed column: system-maintained, never hand-written. */
    current_grade: Field.text({ label: 'Current grade' }),
    /** An ordinary column the same persona MAY edit — the positive control. */
    note: Field.text({ label: 'Note' }),
  },
});

/** Inserting one of these fires the hook that DECLARES `runAs: 'system'`. */
export const HookRunAsRating = ObjectSchema.create({
  name: 'hookrunas_rating',
  sharingModel: 'public_read_write',
  label: 'Hook RunAs Rating',
  pluralLabel: 'Hook RunAs Ratings',
  fields: {
    account_id: Field.text({ label: 'Account', required: true }),
    grade: Field.text({ label: 'Grade', required: true }),
  },
});

/** Inserting one of these fires the UNDECLARED hook — today's behaviour. */
export const HookRunAsLegacyRating = ObjectSchema.create({
  name: 'hookrunas_legacy_rating',
  sharingModel: 'public_read_write',
  label: 'Hook RunAs Legacy Rating',
  pluralLabel: 'Hook RunAs Legacy Ratings',
  fields: {
    account_id: Field.text({ label: 'Account', required: true }),
    grade: Field.text({ label: 'Grade', required: true }),
  },
});

const STAMP_SOURCE = `
  await ctx.api.object('hookrunas_account').update({
    id: ctx.input.account_id,
    current_grade: ctx.input.grade,
  });
`;

export const hookRunAsFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.hookrunas_fixture',
    namespace: 'hookrunas',
    version: '0.0.0',
    type: 'app',
    name: 'Hook runAs Fixture',
    description:
      'A computed column protected by field-level editable:false and maintained by a hook.',
  },
  objects: [HookRunAsAccount, HookRunAsRating, HookRunAsLegacyRating],
  hooks: [
    {
      name: 'stamp_grade_declared',
      label: 'Stamp the computed grade (declared system)',
      object: 'hookrunas_rating',
      events: ['afterInsert'],
      runAs: 'system',
      body: { language: 'js', source: STAMP_SOURCE, capabilities: ['api.read', 'api.write'] },
    },
    {
      name: 'stamp_grade_undeclared',
      label: 'Stamp the computed grade (no runAs — the pre-runAs behaviour)',
      object: 'hookrunas_legacy_rating',
      events: ['afterInsert'],
      handler: async (ctx: any) => {
        await ctx.api.object('hookrunas_account').update({
          id: ctx.input.account_id,
          current_grade: ctx.input.grade,
        });
      },
    },
  ],
} as any);

const FIXTURE_MEMBER_SET = 'hookrunas_fixture_member';

/**
 * The persona: full CRUD on all three objects, and ONE field denied for
 * editing — `hookrunas_account.current_grade`, object-qualified (a bare
 * `current_grade` key enforces nothing; that spelling trap is what the
 * permission-zoo audit found). `readable: true` keeps the column visible, which
 * is what the app wants: shown everywhere, writable nowhere by hand.
 */
export const hookRunAsMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: FIXTURE_MEMBER_SET,
  label: 'Hook RunAs Fixture Member — the computed column is read-only',
  objects: {
    hookrunas_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    hookrunas_rating: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    hookrunas_legacy_rating: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  fields: {
    'hookrunas_account.current_grade': { readable: true, editable: false },
  },
});

export function hookRunAsFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, hookRunAsMemberSet],
    fallbackPermissionSet: hookRunAsMemberSet.name,
  });
}
