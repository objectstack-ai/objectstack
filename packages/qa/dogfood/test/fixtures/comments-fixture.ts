// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Comments permission-matrix fixture (#4630).
//
// Four tiny objects spanning the enforcement axes of the `sys_comment`
// collaboration surface. `enable.feeds` is opt-OUT (spec default `true`), so
// every one of them has comments on unless it says otherwise — which is
// exactly why record-level authorization has to come from the PARENT record:
//
//   cmt_open     — public_read_write: any member reads AND edits it, so any
//                  member may comment on it and moderate its thread.
//   cmt_private  — DEFAULT sharing model (omitted ⇒ private, ADR-0090) + an
//                  `owner_id` field: the sharing service read-filters rows to
//                  the owner, so a non-owner member can neither read the
//                  record nor (now) see or post comments on it. This is the
//                  `crm_opportunity` of the #4630 report.
//   cmt_readonly — public_read: every member READS it, only the owner EDITS.
//                  The case that separates "read is enough to comment" from
//                  "edit is required to moderate someone else's comment".
//   cmt_nofeeds  — enable.feeds:false: plugin-audit's FEEDS_DISABLED
//                  capability gate, which is ORTHOGONAL to this authorization
//                  and must keep behaving exactly as before.
//
// A fresh signUp member falls back to the fixture's OWN permissive baseline
// (`cmt_fixture_baseline` below) — exactly the posture #4630 reported against
// (the gates under test are the ones layered on TOP of that wildcard, which by
// itself scopes nothing). Before #5491 the same posture arrived implicitly from
// the platform's `member_default`; it is now declared here.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const CmtOpen = ObjectSchema.create({
  name: 'cmt_open',
  label: 'Comment Open Record',
  pluralLabel: 'Comment Open Records',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const CmtPrivate = ObjectSchema.create({
  name: 'cmt_private',
  label: 'Comment Private Record',
  pluralLabel: 'Comment Private Records',
  // sharingModel omitted — a custom object defaults to PRIVATE (ADR-0090);
  // owner_id is the sharing service's owner anchor.
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

export const CmtReadonly = ObjectSchema.create({
  name: 'cmt_readonly',
  label: 'Comment Readonly Record',
  pluralLabel: 'Comment Readonly Records',
  sharingModel: 'public_read',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

export const CmtNoFeeds = ObjectSchema.create({
  name: 'cmt_nofeeds',
  label: 'Comment-Free Record',
  pluralLabel: 'Comment-Free Records',
  sharingModel: 'public_read_write',
  enable: { feeds: false },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/**
 * The domain grant a real app ships when it lets members manage a thread:
 * `member_default` (the `everyone` anchor baseline) carries NO `allowDelete`
 * (ADR-0090 D5 — delete is not a baseline right), so deleting a comment needs
 * an ordinary position-distributed set with the delete bit on `sys_comment`.
 */
export const commentManagerSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cmt_comment_manager',
  label: 'Comments Fixture — comment manager',
  objects: {
    sys_comment: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/** SecurityPlugin carrying the platform defaults + the fixture's domain set. */

/**
 * [#5491] The permissive baseline this matrix runs on, now DECLARED by the
 * fixture instead of inherited from the platform.
 *
 * Until #5491 the platform's `member_default` shipped
 * `objects['*'] = {allowRead, allowCreate, allowEdit}` and union-merged it into
 * every authenticated member, so this fixture got the posture for free — and the
 * header above says so in as many words. That wildcard is exactly what the
 * maintainer removed (2026-08-07): as a PLATFORM baseline it erased app-declared
 * explicit-allow gates on three axes.
 *
 * Re-declaring it HERE is not the same thing and is not a re-opening. It is one
 * fixture modelling one deliberately permissive app, which is the posture the
 * matrix questions: every gate under test is layered ON TOP of a wildcard that
 * by itself scopes nothing, so removing the wildcard would delete the matrix's
 * premise rather than migrate it. `allowDelete` stays absent — the delete bit is
 * what the domain set below adds, and that contrast is half of what the matrix
 * measures.
 */
export const cmtFixtureBaselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cmt_fixture_baseline',
  label: 'Fixture baseline — the wildcard posture this matrix questions',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

export function commentsFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, cmtFixtureBaselineSet, commentManagerSet],
    // [#5491] The platform baseline no longer grants objects, so the fixture's
    // own permissive baseline is what a grant-less signUp member falls back to.
    fallbackPermissionSet: cmtFixtureBaselineSet.name,
  });
}

export const commentsFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.comments_fixture',
    namespace: 'cmt',
    version: '0.0.0',
    type: 'app',
    name: 'Comments Permission Matrix Fixture',
    description:
      'Four-object app exercising the #4630 comment permission matrix: thread visibility, author/parent-editor writes, the enable.feeds gate.',
  },
  objects: [CmtOpen, CmtPrivate, CmtReadonly, CmtNoFeeds],
});
