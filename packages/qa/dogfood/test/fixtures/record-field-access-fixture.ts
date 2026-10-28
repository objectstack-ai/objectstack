// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A row-conditioned field lock, as a bootable app: a contract whose legal
// summary is locked only from `approved` onward (`FieldPermissionSchema.when`).
// The shape the downstream contract app ships for its finance persona — "fill
// it on the draft you launch, never touch it once approved".
//
// Two objects:
//
//  - `rfa_contract` is wide open at the row level (`public_read_write`), so the
//    only gate in play on it is FIELD-level security — the one this fixture is
//    about. Its `summary` carries the conditioned lock; `title` carries none
//    and is the positive control; `ref_no` carries an unconditioned lock, so a
//    row-blind lock is shown to stay a lock on every row.
//  - `rfa_memo` is `private`: a member reads only the rows they own. It is the
//    row the caller cannot read, for the existence-leak leg.
//  - `rfa_notice` is `public_read`: everyone reads, only the owner writes. A
//    row someone else owns is one the member may READ but not WRITE — the
//    row-level write scope `editable` leaves out and `writable` answers,
//    measured against the PATCH.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

export const RecordFieldAccessContract = ObjectSchema.create({
  name: 'rfa_contract',
  // [ADR-0090 D1] grandfather stamp: row-level sharing is wide open so a row
  // refusal can never be mistaken for the field-level answer under test.
  sharingModel: 'public_read_write',
  label: 'RFA Contract',
  pluralLabel: 'RFA Contracts',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Approved', value: 'approved' },
      ],
    }),
    /** Locked only on approved rows — the conditioned lock. */
    summary: Field.text({ label: 'Summary' }),
    /** Locked on every row — the unconditioned control. */
    ref_no: Field.text({ label: 'Reference number' }),
  },
});

export const RecordFieldAccessMemo = ObjectSchema.create({
  name: 'rfa_memo',
  sharingModel: 'private',
  label: 'RFA Memo',
  pluralLabel: 'RFA Memos',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    summary: Field.text({ label: 'Summary' }),
  },
});

export const RecordFieldAccessNotice = ObjectSchema.create({
  name: 'rfa_notice',
  sharingModel: 'public_read',
  label: 'RFA Notice',
  pluralLabel: 'RFA Notices',
  fields: {
    title: Field.text({ label: 'Title', required: true }),
    summary: Field.text({ label: 'Summary' }),
  },
});

export const recordFieldAccessFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.record-field-access-fixture',
    namespace: 'rfa',
    version: '0.0.0',
    type: 'app',
    name: 'Record Field Access Fixture',
    description: 'A field lock that holds only from a stage onward (field permission `when`).',
  },
  objects: [RecordFieldAccessContract, RecordFieldAccessMemo, RecordFieldAccessNotice],
} as any);

/** The `when` the conditioned entry carries, as authored. */
export const APPROVED_ONLY = "status in ['approved']";

/**
 * The persona: full CRUD on both objects; `rfa_contract.summary` locked on
 * approved rows only, `rfa_contract.ref_no` locked everywhere, and
 * `rfa_memo.summary` locked on approved-titled rows (a condition on a row the
 * caller may not read at all).
 */
export const recordFieldAccessMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'rfa_fixture_member',
  label: 'RFA Fixture Member — the summary locks from approval on',
  objects: {
    rfa_contract: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    rfa_memo: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    rfa_notice: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  fields: {
    'rfa_contract.summary': { readable: true, editable: false, when: APPROVED_ONLY },
    'rfa_contract.ref_no': { readable: true, editable: false },
    'rfa_memo.summary': { readable: true, editable: false, when: "title == 'approved'" },
  },
});

export function recordFieldAccessFixtureSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, recordFieldAccessMemberSet],
    fallbackPermissionSet: recordFieldAccessMemberSet.name,
  });
}
