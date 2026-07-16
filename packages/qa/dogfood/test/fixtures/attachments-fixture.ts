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
// No custom SecurityPlugin: a fresh signUp member falls back to the real
// `member_default` wildcard-CRUD set — exactly the posture the issue's
// permission matrix questions (the gates under test are the ones layered on
// TOP of that wildcard).

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
export function attachmentsFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, attachmentManagerSet],
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
