// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_audit_signing_key — the public halves of the deployment's audit signing
 * keys (ADR-0154 D6).
 *
 * One active Ed25519 key per deployment signs every checkpoint and amendment
 * of every chain. A row holds a key's public half, its fingerprint (the key
 * id: lowercase hex SHA-256 of the raw public key), its status, and the
 * `sys_secret` handle of its wrapped private half — sealed under scope
 * `audit_seal` with the fingerprint as the context's key, so the ciphertext is
 * bound to the public half it belongs to. Rotation retires the active key and
 * writes a new one; a retired key's row and its wrapped private half are kept
 * as long as anything it signed is.
 *
 * ⛔ A row here is never trusted because it exists. A verifier opens the
 * wrapped private half under the row's own fingerprint, derives the public
 * half from it, and trusts the key only when that equals `public_key`. Writing
 * a key the check accepts therefore takes the crypto provider's master key:
 * database write access alone cannot add one.
 *
 * Kept out of the audit writer (`AUDIT_EXCLUDED_OBJECTS`); the key's creation
 * and each rotation are recorded instead as one deployment-level
 * `audit_signing_key_change` ledger row.
 *
 * @namespace sys
 */
export const SysAuditSigningKey = ObjectSchema.create({
  name: 'sys_audit_signing_key',
  label: 'Audit Signing Key',
  pluralLabel: 'Audit Signing Keys',
  icon: 'key-round',
  isSystem: true,
  managedBy: 'append-only',
  systemFields: { tenant: false },
  access: { default: 'private' },
  defaultRowScope: {
    name: 'sys_audit_signing_key_none',
    operation: 'select',
    using: 'id == null',
  },
  description: 'Public halves of the keys that sign audit checkpoints. Written only by the platform.',
  displayNameField: 'fingerprint',
  nameField: 'fingerprint',

  fields: {
    id: Field.text({ label: 'Key Row ID', required: true, readonly: true }),
    fingerprint: Field.text({
      label: 'Fingerprint',
      required: true,
      readonly: true,
      unique: true,
      description: 'The key id: lowercase hex SHA-256 of the raw public key',
    }),
    public_key: Field.text({ label: 'Public Key', required: true, readonly: true, description: 'Raw Ed25519 public key, base64' }),
    status: Field.select(
      {
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Retired', value: 'retired' },
        ],
        label: 'Status',
        required: true,
        readonly: true,
      },
    ),
    created_at: Field.datetime({ label: 'Created At', required: true, readonly: true }),
    retired_at: Field.datetime({ label: 'Retired At', required: false, readonly: true }),
    private_handle: Field.text({
      label: 'Private Key Handle',
      required: true,
      readonly: true,
      description: 'The sys_secret row holding the wrapped private half',
    }),
  },

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list'],
    clone: false,
  },
});
