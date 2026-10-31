// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The record page payload (`POST /data/:object/:id/page`) under a member who
// is NOT an admin, with every read gate the page's parts pass through in play:
//
//  - `rp_account` is the page's record: wide open at the row level, so the
//    record read answers and the parts are what is under test. Its `rating`
//    is unreadable to the member (field-level security on the record itself).
//  - `rp_note` is a related list under row-level security: an owner policy on
//    `created_by`, so the member counts and sees only the notes they wrote.
//    Its `secret` is unreadable to the member (field-level security on rows).
//  - `rp_task` is a related list the member reads whole, scoped by a declared
//    filter the page sends.
//  - `rp_ledger` is a related list the member may not read at all (no object
//    grant), so its list contributes neither a count nor rows.
//  - `rp_private` is a record the member cannot read (owner-private sharing),
//    for the whole-request refusal.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, RLS, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const RecordPageAccount = ObjectSchema.create({
  name: 'rp_account',
  // [ADR-0090 D1] grandfather stamp: the record itself is readable, so the
  // parts below are the gates under test.
  sharingModel: 'public_read_write',
  label: 'RP Account',
  pluralLabel: 'RP Accounts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    rating: Field.text({ label: 'Rating' }),
  },
});

export const RecordPageNote = ObjectSchema.create({
  name: 'rp_note',
  // Row scope comes from the member set's owner policy below.
  sharingModel: 'public_read_write',
  label: 'RP Note',
  pluralLabel: 'RP Notes',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    secret: Field.text({ label: 'Secret' }),
    account: Field.lookup('rp_account', { label: 'Account' }),
  },
});

export const RecordPageTask = ObjectSchema.create({
  name: 'rp_task',
  sharingModel: 'public_read_write',
  label: 'RP Task',
  pluralLabel: 'RP Tasks',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Done', value: 'done' },
      ],
    }),
    account: Field.lookup('rp_account', { label: 'Account' }),
  },
});

export const RecordPageLedger = ObjectSchema.create({
  name: 'rp_ledger',
  sharingModel: 'public_read_write',
  label: 'RP Ledger',
  pluralLabel: 'RP Ledger Entries',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    account: Field.lookup('rp_account', { label: 'Account' }),
  },
});

export const RecordPagePrivate = ObjectSchema.create({
  name: 'rp_private',
  sharingModel: 'private',
  label: 'RP Private',
  pluralLabel: 'RP Privates',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
  },
});

export const recordPageFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.record-page-fixture',
    namespace: 'rp',
    version: '0.0.0',
    type: 'app',
    name: 'Record Page Fixture',
    description: 'A record page whose related lists sit behind row-level security, field-level security and an object grant the reader lacks.',
  },
  objects: [RecordPageAccount, RecordPageNote, RecordPageTask, RecordPageLedger, RecordPagePrivate],
} as any);

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } as const;

/** The member: CRUD on everything but the ledger, notes owner-scoped, two fields unreadable. */
export const recordPageMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'rp_fixture_member',
  label: 'RP Fixture Member — owner-scoped notes, no ledger',
  objects: { rp_account: crud, rp_note: crud, rp_task: crud, rp_private: crud },
  fields: {
    'rp_account.rating': { readable: false, editable: false },
    'rp_note.secret': { readable: false, editable: false },
  },
  rowLevelSecurity: [RLS.ownerPolicy('rp_note', 'created_by')],
});

export function recordPageFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, recordPageMemberSet],
    fallbackPermissionSet: recordPageMemberSet.name,
  });
}
