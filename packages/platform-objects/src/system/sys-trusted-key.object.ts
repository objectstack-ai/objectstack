// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_trusted_key — the environment's trusted plugin-publisher PUBLIC keys
 * (ADR-0025 §3.5 M1 / §3.7).
 *
 * One row per publisher key this environment accepts a plugin signature from.
 * `os plugin install ./x.osplugin` reads the `keyId` out of the artifact's
 * `ed25519:KEYID:SIG` sidecar, resolves it here and verifies the artifact bytes
 * with that row's `public_key` (`verifyPluginArtifact`, `@objectstack/core`).
 * A key id with no row, or whose row is `revoked`, is refused by name.
 *
 * ## Public keys only
 *
 * ⛔ A private key never enters this store, nor any other platform surface:
 * publisher keys stay with the publisher (ADR-0025 §7). `os plugin keygen`
 * writes the pair as two files on the developer's disk, and
 * `os plugin trust add` accepts a public-key PEM only — it refuses a
 * private-key PEM by name rather than deriving the public half from it.
 *
 * ## What is not a row
 *
 * The platform's own ROOT keys (the marketplace counter-signature, §3.7) ship
 * in code and rotate by release; they are never rows here. `source` reserves
 * `platform` and `cloud` for the keys M2 / M3 cache from that chain; M1 writes
 * `local` only.
 *
 * ## Writers
 *
 * `managedBy: 'engine-owned'` and a read-only API: rows are written only by the
 * CLI's `os plugin trust add` / `os plugin trust revoke`, a one-shot boot
 * against this environment's database under the system context — an operator
 * act at the host, recorded by the audit CRUD mirror. A revoked row is never
 * deleted or re-activated: its key id stays refused, so a revoked key cannot
 * come back under the same handle.
 *
 * Registered by `PlatformObjectsPlugin` (`../plugin.ts`) beside `sys_secret`:
 * its readers span domains — the CLI's install command today, and ADR-0025
 * M1's boot-time loader in the runtime once it is built — and no capability
 * plugin owns plugin distribution (ADR-0029 D1/D2).
 *
 * @namespace sys
 */
export const SysTrustedKey = ObjectSchema.create({
  name: 'sys_trusted_key',
  label: 'Trusted Key',
  pluralLabel: 'Trusted Keys',
  icon: 'key-round',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Environment-scoped, deployment-level: the trust set belongs
  // to the environment, never to one organization, and every writer and
  // reader acts under the system context. Who may read is object permission:
  // the platform-only capability below.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description:
    "Publisher public keys this environment accepts a plugin artifact's signature from. Public keys only; written by `os plugin trust`.",
  nameField: 'key_id',
  titleFormat: '{key_id}',
  highlightFields: ['key_id', 'status', 'source', 'fingerprint', 'added_at'],
  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All Trusted Keys',
      columns: ['key_id', 'status', 'source', 'fingerprint', 'added_by', 'added_at'],
    },
  },

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
    }),

    key_id: Field.text({
      label: 'Key ID',
      required: true,
      readonly: true,
      maxLength: 128,
      description:
        'The key id a signature names (`ed25519:KEYID:SIG`, set by `os plugin sign --key-id`). Unique in the environment and never reused, revoked rows included.',
    }),

    public_key: Field.textarea({
      label: 'Public Key',
      required: true,
      readonly: true,
      maxLength: 1024,
      description: 'The Ed25519 public key, SPKI PEM. Never a private key.',
    }),

    fingerprint: Field.text({
      label: 'Fingerprint',
      required: true,
      readonly: true,
      maxLength: 80,
      description: 'sha256 of the key\'s SPKI DER bytes, `sha256:` + 64 lowercase hex digits.',
    }),

    source: Field.select(
      [
        { label: 'Local', value: 'local' },
        { label: 'Platform', value: 'platform' },
        { label: 'Cloud', value: 'cloud' },
      ],
      {
        label: 'Source',
        required: true,
        readonly: true,
        defaultValue: 'local',
        description:
          'Where the key came from. `local`: added on this host by `os plugin trust add`. `platform` and `cloud` are reserved for keys cached from the marketplace chain (ADR-0025 M2 / M3); nothing writes them yet.',
      },
    ),

    status: Field.select(
      [
        { label: 'Active', value: 'active' },
        { label: 'Revoked', value: 'revoked' },
      ],
      {
        label: 'Status',
        required: true,
        defaultValue: 'active',
        description: '`active` keys verify plugin signatures; a `revoked` key is refused by name and never re-activated.',
      },
    ),

    added_by: Field.text({
      label: 'Added By',
      readonly: true,
      maxLength: 255,
      description: 'Who added the key: for a `local` key, the operating-system account that ran `os plugin trust add`.',
    }),

    added_at: Field.datetime({
      label: 'Added At',
      required: true,
      readonly: true,
      description: 'When the key was added to this environment.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      readonly: true,
    }),
  },

  indexes: [
    // One key id names one key across the environment, revoked rows included.
    { fields: ['key_id'], unique: 'global' },
    { fields: ['fingerprint'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Diagnostic read surface only — writes go through `os plugin trust`
    // (system context), so no API caller can add or revive a trusted key.
    apiMethods: ['get', 'list'],
  },
});
