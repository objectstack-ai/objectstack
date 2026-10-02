// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_approval_token — single-use actionable-link tokens (ADR-0043).
 *
 * One row per issued approve/reject link. Only the SHA-256 **hash** of the
 * raw token is stored — a database leak yields no usable links. A token is
 * dead once any of these holds: `consumed_at` set, `expires_at` passed, the
 * request left `pending`, or the bound approver no longer holds a slot
 * (the last two are re-checked at redemption, not materialized here).
 *
 * @namespace sys
 */
export const SysApprovalToken = ObjectSchema.create({
  name: 'sys_approval_token',
  label: 'Approval Action Token',
  pluralLabel: 'Approval Action Tokens',
  icon: 'key',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Single-use tokens behind actionable approval links',
  displayNameField: 'id',
  nameField: 'id', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)

  fields: {
    id: Field.text({ label: 'Token ID', required: true, readonly: true, group: 'System' }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      group: 'System',
    }),

    // [#21197] `internal: true` — the approval token's digest is withheld from
    // every generic exit: this object's get/list doors and the compliance
    // ledger's CRUD mirror, which honours the same flag. The approval service
    // only FILTERS by it (`where: { token_hash }`); storage, the index and that
    // lookup are untouched, and nothing reads it back off a row.
    token_hash: Field.text({
      label: 'Token Hash',
      required: true,
      maxLength: 100,
      readonly: true,
      internal: true,
      description: 'SHA-256 hex of the raw token — the raw value is never stored',
      group: 'Token',
    }),

    request_id: Field.text({
      label: 'Request',
      required: true,
      maxLength: 100,
      readonly: true,
      group: 'Token',
    }),

    action: Field.select(['approve', 'reject'], {
      label: 'Action',
      required: true,
      readonly: true,
      group: 'Token',
    }),

    approver_id: Field.text({
      label: 'Approver',
      required: true,
      maxLength: 200,
      readonly: true,
      description: 'Identity the token is bound to; the decision is audited as this approver',
      group: 'Token',
    }),

    expires_at: Field.datetime({
      label: 'Expires At',
      required: true,
      readonly: true,
      group: 'Lifecycle',
    }),

    consumed_at: Field.datetime({
      label: 'Consumed At',
      required: false,
      group: 'Lifecycle',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
  },

  indexes: [
    { fields: ['token_hash'] },
    { fields: ['request_id'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: one-time email-approval tokens are minted and
    // consumed by the approval engine (SYSTEM_CTX), never via the data API.
    apiMethods: ['get', 'list'],
  },
});
