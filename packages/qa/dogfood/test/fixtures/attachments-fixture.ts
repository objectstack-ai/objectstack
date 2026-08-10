// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Attachments permission-matrix fixture (#2755).
//
// Three tiny objects spanning the enforcement axes of the generic
// Attachments surface (#2727):
//
//   att_case    — enable.files + public sharing model: any member can read
//                 (and per Salesforce "can edit parent ⇒ can manage its
//                 attachments", any member can detach from it).
//   att_secret  — enable.files + DEFAULT sharing model (omitted ⇒ private,
//                 ADR-0090) + an `owner_id` field: the sharing service
//                 read-filters rows to the owner, so a fresh member cannot
//                 read (→ cannot attach to) another user's record, and
//                 `canEdit` denies non-owners (→ cannot delete another
//                 user's attachments on it).
//   att_nofiles — NO enable.files: the #2727 opt-in gate (FILES_DISABLED).
//
// A fresh signUp member falls back to the fixture's OWN permissive baseline
// (`att_fixture_baseline` below) — exactly the posture the issue's permission
// matrix questions (the gates under test are the ones layered on TOP of that
// wildcard). Before #5491 the same posture arrived implicitly from the
// platform's `member_default`; it is now declared here.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const AttCase = ObjectSchema.create({
  name: 'att_case',
  label: 'Attachment Case',
  pluralLabel: 'Attachment Cases',
  sharingModel: 'public_read_write',
  enable: { files: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const AttSecret = ObjectSchema.create({
  name: 'att_secret',
  label: 'Attachment Secret',
  pluralLabel: 'Attachment Secrets',
  // sharingModel omitted — custom object defaults to PRIVATE (ADR-0090);
  // owner_id is the sharing service's owner anchor.
  enable: { files: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

export const AttNoFiles = ObjectSchema.create({
  name: 'att_nofiles',
  label: 'No Files Here',
  pluralLabel: 'No Files Here',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

export const AttReadonly = ObjectSchema.create({
  name: 'att_readonly',
  label: 'Attachment Readonly',
  pluralLabel: 'Attachment Readonlys',
  // public_read: every member can READ, only the owner can EDIT — the case
  // that distinguishes edit-on-parent (#2970 item 3) from read visibility.
  sharingModel: 'public_read',
  enable: { files: true },
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    owner_id: Field.text({ label: 'Owner' }),
  },
});

/**
 * The domain grant a real app ships when it turns the attachments panel on
 * for members: `member_default` (the `everyone` anchor baseline) carries NO
 * `allowDelete` (ADR-0090 D5 — delete is not a baseline right), so managing
 * attachments requires an ordinary position-distributed set with the delete
 * bit on `sys_attachment`. The matrix grants this to some members and pins
 * the no-grant baseline with another.
 */
export const attachmentManagerSet: PermissionSet = PermissionSetSchema.parse({
  name: 'att_attachment_manager',
  label: 'Attachments Fixture — attachment manager',
  objects: {
    sys_attachment: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
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
export const attFixtureBaselineSet: PermissionSet = PermissionSetSchema.parse({
  name: 'att_fixture_baseline',
  label: 'Fixture baseline — the wildcard posture this matrix questions',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true },
  },
});

export function attachmentsFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, attFixtureBaselineSet, attachmentManagerSet],
    // [#5491] The platform baseline no longer grants objects, so the fixture's
    // own permissive baseline is what a grant-less signUp member falls back to.
    fallbackPermissionSet: attFixtureBaselineSet.name,
  });
}

export const attachmentsFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.attachments_fixture',
    namespace: 'att',
    version: '0.0.0',
    type: 'app',
    name: 'Attachments Permission Matrix Fixture',
    description:
      'Three-object app exercising the #2755 attachment permission matrix: parent visibility, uploader/editor delete, enable.files gate.',
  },
  objects: [AttCase, AttSecret, AttNoFiles, AttReadonly],
});
