// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_secret — Separated cipher store for sensitive settings values.
 *
 * Phase 3 of the settings roadmap splits secret material out of
 * `sys_setting` so they can carry their own retention/rotation/KMS
 * policies without bloating the regular settings audit trail. The
 * value column in `sys_setting` for an encrypted specifier holds a
 * *handle* (the `id` of a row here), never the ciphertext itself —
 * the resolver dereferences on read.
 *
 * Why split:
 *  1. **Key rotation.** KMS adapters (AWS/GCP) rotate keys on a
 *     different cadence than user-visible settings; tracking
 *     `kms_key_id` + `version` per cipher lets us re-wrap without
 *     touching the value lifecycle.
 *  2. **Backup hygiene.** Operators can replicate `sys_setting` to
 *     analytics/lower environments while keeping `sys_secret` pinned
 *     to the primary KMS region.
 *  3. **Audit symmetry.** Every secret read can record an access row
 *     (Phase 4) without polluting `sys_setting_audit` with plaintext
 *     reads of e.g. feature flags.
 *
 * managedBy: 'engine-owned' — never edited from a generic Object grid. All
 * writes flow through `SettingsService` and an `ICryptoProvider`.
 *
 * @namespace sys
 */
export const SysSecret = ObjectSchema.create({
  name: 'sys_secret',
  label: 'Secret',
  pluralLabel: 'Secrets',
  icon: 'key',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0066 D2/④] Secure-by-default: the environment's encrypted-secrets
  // store (settings/datasource credentials). Not covered by the wildcard `'*'`
  // grant — ordinary members get 403 from the generic data layer. Platform
  // admins retain access via the posture-gated superuser bypass. Internal
  // readers are unaffected: `engine.resolveSecret` reads at DRIVER level,
  // SettingsService / the datasource secret-binder read with no principal
  // (middleware falls open for principal-less internal calls).
  access: { default: 'private' },
  description: 'Cipher store referenced by sys_setting handles. Never holds plaintext.',
  highlightFields: ['namespace', 'key', 'kms_key_id', 'version', 'rotated_at'],
  listViews: {
    all: {
      type: 'grid',
      name: 'all',
      label: 'All Secrets',
      columns: ['namespace', 'key', 'kms_key_id', 'version', 'rotated_at', 'created_at'],
    },
  },

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
      description: 'Opaque handle referenced by `sys_setting.value_enc`.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      readonly: true,
      description: 'When the cipher was first written.',
    }),

    rotated_at: Field.datetime({
      label: 'Rotated At',
      readonly: true,
      description: 'When the cipher was last re-wrapped under a new KMS key.',
    }),

    /**
     * Namespace/key duplicated from `sys_setting` for forensic
     * convenience — lets operators answer "which secret backs
     * mail.api_key right now?" without joining the K/V table.
     * The authoritative link is `sys_setting.value_enc → sys_secret.id`.
     */
    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 128,
      description: 'Settings namespace this secret belongs to.',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
      description: 'Specifier key within the namespace.',
    }),

    /** Identifier of the KMS key used to wrap `ciphertext`. */
    kms_key_id: Field.text({
      label: 'KMS Key ID',
      required: true,
      maxLength: 256,
      description: 'External KMS handle (ARN, GCP resource id, or `local`).',
    }),

    /** Algorithm tag (e.g. `aes-256-gcm`). Used by the provider on decrypt. */
    alg: Field.text({
      label: 'Algorithm',
      required: true,
      defaultValue: 'aes-256-gcm',
      maxLength: 64,
      description: 'Cipher/AEAD algorithm tag.',
    }),

    /** Wrapping version — bumps on every rotate(). */
    version: Field.number({
      label: 'Version',
      required: true,
      defaultValue: 1,
      description: 'Bumps each time rotateKey() re-wraps this row.',
    }),

    ciphertext: Field.text({
      label: 'Ciphertext',
      required: true,
      readonly: true,
      description:
        'Provider-encoded ciphertext blob (base64 / JSON). Implementation-defined; only the matching ICryptoProvider can read it.',
    }),
  },

  indexes: [
    // Operators frequently look up by (namespace, key) to inspect or rotate.
    { fields: ['namespace', 'key'], unique: false },
    { fields: ['kms_key_id'], unique: false },
  ],

  enable: {
    trackHistory: false, // rotation events are recorded by sys_setting_audit
    // [ADR-0103] Engine-owned: secrets are minted/rotated only by the settings /
    // secret service (SYSTEM_CTX), never via the generic data API. Locked to
    // reads (ciphertext only; decryption is a separate privileged path) — an
    // empty apiMethods array would fail OPEN, so this list is explicit.
    apiMethods: ['get', 'list'],
  },
});
