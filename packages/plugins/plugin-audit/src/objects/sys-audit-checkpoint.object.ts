// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audit_checkpoint — one Merkle root per chain per window, chained and
 * signed (ADR-0154 D4).
 *
 * A checkpoint seals one chain's rows of one window of a sealed object: the
 * chain is that object × one organization, or × the deployment for rows about
 * no organization (D5). The sealer in this plugin writes these rows; nothing
 * else does, and nothing updates or deletes one except the expiry of a whole
 * prefix of a chain (D8).
 *
 * Its integrity is not its access control but its chain and its signature:
 * `previous_digest` links each checkpoint to the one before it, and
 * `signature` covers every column of the signed body (see
 * `audit-seal/signed-body.ts`). `id`, `chain_key` and `signature` are the only
 * columns outside that body. `chain_key` exists for the unique index alone —
 * NULL is distinct from NULL in a SQL unique index, so the deployment chain's
 * NULL `tenant_id` could not stop two sealers taking one sequence.
 *
 * Not itself a sealed object, and kept out of the audit writer
 * (`AUDIT_EXCLUDED_OBJECTS`): a checkpoint written would otherwise write a
 * ledger row, which the next pass would seal into a new checkpoint.
 *
 * @namespace sys
 */
export const SysAuditCheckpoint = ObjectSchema.create({
  name: 'sys_audit_checkpoint',
  label: 'Audit Checkpoint',
  pluralLabel: 'Audit Checkpoints',
  icon: 'shield-check',
  isSystem: true,
  managedBy: 'append-only',
  // [ADR-0131 D7] Deployment-level, as the ledger it seals: the organization a
  // chain is about is the plain attribution field `tenant_id` below.
  systemFields: { tenant: false },
  // Private by default: only platform administrators (the posture-gated
  // superuser bypass) and `os audit verify` (system context) read it.
  access: { default: 'private' },
  defaultRowScope: {
    name: 'sys_audit_checkpoint_none',
    operation: 'select',
    using: 'id == null',
  },
  description: 'Signed Merkle checkpoints of the audit ledger. Written only by the platform sealer.',
  displayNameField: 'sealed_object',
  nameField: 'sealed_object',

  fields: {
    id: Field.text({ label: 'Checkpoint ID', required: true, readonly: true }),
    sealed_object: Field.text({
      label: 'Sealed Object',
      required: true,
      readonly: true,
      description: 'The object whose rows this checkpoint seals',
    }),
    chain_key: Field.text({
      label: 'Chain Key',
      required: true,
      readonly: true,
      description: '`org:` and the organization id, or `deployment` for rows about no organization',
    }),
    tenant_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      description: 'The organization this chain is about; empty for the deployment chain',
    }),
    sequence: Field.number({ label: 'Sequence', required: true, readonly: true, description: 'Position in the chain, from 0' }),
    kind: Field.select(
      {
        options: [
          { label: 'Window', value: 'window' },
          { label: 'Late', value: 'late' },
        ],
        label: 'Kind',
        required: true,
        readonly: true,
        description: 'A window sealed on time, or rows that arrived after their window was sealed',
      },
    ),
    window_start: Field.datetime({ label: 'Window Start', required: true, readonly: true }),
    window_end: Field.datetime({ label: 'Window End', required: true, readonly: true }),
    sealed_through: Field.datetime({
      label: 'Sealed Through',
      required: true,
      readonly: true,
      description: 'The end of the last window the sealing pass had completed for every chain of the object',
    }),
    leaf_count: Field.number({ label: 'Leaf Count', required: true, readonly: true }),
    row_ids: Field.textarea({ label: 'Row IDs', required: true, readonly: true, description: 'JSON array of the sealed row ids' }),
    root: Field.text({ label: 'Merkle Root', required: true, readonly: true }),
    previous_digest: Field.text({
      label: 'Previous Digest',
      required: false,
      readonly: true,
      description: "SHA-256 of the chain's previous checkpoint's signed body; empty for the first",
    }),
    columns: Field.textarea({
      label: 'Columns',
      required: true,
      readonly: true,
      description: 'JSON: the columns sealed in clear and as commitments',
    }),
    canon_version: Field.number({ label: 'Canonical Form Version', required: true, readonly: true }),
    seed_handle: Field.text({
      label: 'Seed Handle',
      required: true,
      readonly: true,
      description: 'The sys_secret row holding the sealed seed that salts the value columns of this checkpoint',
    }),
    fencing_token: Field.text({ label: 'Fencing Token', required: true, readonly: true }),
    sealed_at: Field.datetime({ label: 'Sealed At', required: true, readonly: true }),
    signing_key_id: Field.text({ label: 'Signing Key', required: true, readonly: true }),
    signature: Field.text({ label: 'Signature', required: true, readonly: true }),
  },

  indexes: [
    // [ADR-0154 D3] One checkpoint per sequence per chain: a sealer whose lease
    // lapsed mid-pass cannot write a second checkpoint at a sequence another
    // already took.
    { fields: ['sealed_object', 'chain_key', 'sequence'], unique: 'global' },
    { fields: ['sealed_object', 'window_start'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    clone: false,
  },
});
