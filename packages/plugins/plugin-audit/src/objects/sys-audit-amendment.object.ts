// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audit_amendment — a signed record of a sanctioned change to sealed rows
 * (ADR-0154 D7, D8).
 *
 * Two kinds, one object, with the columns of the other kind left empty:
 *
 *  - **`redaction`** (D7) — written BEFORE a migration rewrites a value column
 *    of a sealed row: the checkpoint that sealed the row, the row and the
 *    column, the commitment the checkpoint sealed and the commitment of the
 *    rewritten value under the same salt, and which migration rewrote it. A
 *    verifier that finds the row's current commitment equal to the rewritten
 *    one rebuilds the leaf with the sealed one and reports the row `redacted`.
 *  - **`expiry`** (D8) — written BEFORE retention removes a prefix of a chain:
 *    the first and last sequence removed, the windows they covered, the digest
 *    of the last removed checkpoint (so the first remaining one still links),
 *    and the policy with its value, under the signature.
 *
 * Signed, not chained: deleting an amendment turns its rows from `redacted`
 * into `modified` (or an expired range into `missing`), which is loud, so a
 * chain over amendments would add no detection. `id`, `chain_key` and
 * `signature` are the only columns outside the signed body
 * (`audit-seal/signed-body.ts`).
 *
 * Kept out of the audit writer (`AUDIT_EXCLUDED_OBJECTS`), so an expiry never
 * writes ledger rows about its own record.
 *
 * @namespace sys
 */
export const SysAuditAmendment = ObjectSchema.create({
  name: 'sys_audit_amendment',
  label: 'Audit Amendment',
  pluralLabel: 'Audit Amendments',
  icon: 'file-pen',
  isSystem: true,
  managedBy: 'append-only',
  // [ADR-0131 D7] Deployment-level, as the ledger it amends.
  systemFields: { tenant: false },
  access: { default: 'private' },
  defaultRowScope: {
    name: 'sys_audit_amendment_none',
    operation: 'select',
    using: 'id == null',
  },
  description: 'Signed records of redactions and expiries of sealed audit rows. Written only by the platform.',
  displayNameField: 'kind',
  nameField: 'kind',

  fields: {
    id: Field.text({ label: 'Amendment ID', required: true, readonly: true }),
    kind: Field.select(
      {
        options: [
          { label: 'Redaction', value: 'redaction' },
          { label: 'Expiry', value: 'expiry' },
        ],
        label: 'Kind',
        required: true,
        readonly: true,
      },
    ),
    // Keyed columns are bounded (#11374). An object name, which the sealer
    // reads off the registry, bounded as `sys_audit_log.object_name`.
    sealed_object: Field.text({ label: 'Sealed Object', required: true, readonly: true, maxLength: 255 }),
    // `org:` (4 characters) and an organization id, a stored row's id: the
    // `varchar(255)` primary key `driver-sql` creates. 4 + 255.
    chain_key: Field.text({
      label: 'Chain Key',
      required: true,
      readonly: true,
      maxLength: 259,
      description: '`org:` and the organization id, or `deployment` for rows about no organization',
    }),
    tenant_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      description: 'The organization of the amended chain; empty for the deployment chain',
    }),
    amended_at: Field.datetime({ label: 'Amended At', required: true, readonly: true }),

    // ── redaction ────────────────────────────────────────────────
    checkpoint_id: Field.text({ label: 'Checkpoint', required: false, readonly: true }),
    // A sealed row's id: the `varchar(255)` primary key `driver-sql` creates.
    row_id: Field.text({ label: 'Row ID', required: false, readonly: true, maxLength: 255 }),
    column_name: Field.text({ label: 'Column', required: false, readonly: true }),
    sealed_commitment: Field.text({ label: 'Sealed Commitment', required: false, readonly: true }),
    rewritten_commitment: Field.text({ label: 'Rewritten Commitment', required: false, readonly: true }),
    rewritten_by: Field.text({ label: 'Rewritten By', required: false, readonly: true, description: 'The migration that rewrote the value' }),

    // ── expiry ───────────────────────────────────────────────────
    first_sequence: Field.number({ label: 'First Sequence', required: false, readonly: true }),
    last_sequence: Field.number({ label: 'Last Sequence', required: false, readonly: true }),
    covered_from: Field.datetime({ label: 'Covered From', required: false, readonly: true }),
    covered_to: Field.datetime({ label: 'Covered To', required: false, readonly: true }),
    last_removed_digest: Field.text({ label: 'Last Removed Digest', required: false, readonly: true }),
    policy: Field.text({ label: 'Policy', required: false, readonly: true, description: 'The retention policy that expired the range, e.g. archive.keep' }),
    policy_value: Field.text({ label: 'Policy Value', required: false, readonly: true }),

    signing_key_id: Field.text({ label: 'Signing Key', required: true, readonly: true }),
    signature: Field.text({ label: 'Signature', required: true, readonly: true }),
  },

  indexes: [
    { fields: ['sealed_object', 'chain_key', 'kind'] },
    { fields: ['row_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    clone: false,
  },
});
