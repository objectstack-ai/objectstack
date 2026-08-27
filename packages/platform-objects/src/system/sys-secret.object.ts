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
 * writes flow through an `ICryptoProvider` on one of three privileged
 * producer paths (#4270): `SettingsService` (encrypted settings specifiers),
 * the engine's own `secret`-field encryption (`encryptSecretFields` — the
 * generic write path of any object carrying a `Field.secret()`), and the
 * datasource credential binder. Because the producers span domains and the
 * engine fails CLOSED without this store, it is registered by
 * `PlatformObjectsPlugin` (platform infrastructure), not by service-settings.
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
  description:
    'Cipher store written by three privileged producers (see managedBy); each holds its handle in its own column. Never holds plaintext.',
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
      description:
        'Opaque handle. The reference lives in the writing producer\'s own holder column — `sys_setting.value_enc`, a `secret:` ref on a business row, or a datasource `credentialsRef` — so a row unreferenced by `sys_setting` is not thereby unreferenced.',
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
     * `(namespace, key)` is a PRODUCER-SCOPED pair, not an owner. Each of the
     * three producers named in `managedBy` (#4270) fills it from its own
     * vocabulary, and the reference to the resulting row lives in a different
     * column for each:
     *
     *  - `SettingsService` — settings namespace + specifier key; referenced by
     *    `sys_setting.value_enc`.
     *  - the engine's `secret`-field encryption (`encryptSecretFields`) —
     *    object name + field name; referenced by a `secret:<id>` ref stored on
     *    the business row itself.
     *  - the datasource credential binder — caller-supplied namespace (default
     *    `datasource`) + datasource name; referenced by the artefact's
     *    `sys_secret:<id>` credentialsRef.
     *
     * ⛔ So the pair does NOT attribute a row to a producer, and a lookup that
     * finds no `sys_setting` behind a pair has found nothing: #8103's
     * re-measurement rejected exactly that reading, which is why
     * `service-settings/src/sys-secret-orphan-report.ts` reports a row it
     * cannot attribute as `'unattributable'` rather than `'orphaned'`. The pair
     * is for inspecting and rotating a known secret, never for deciding what a
     * row belongs to.
     */
    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 128,
      description:
        'Producer-scoped label, not a settings namespace in general: `SettingsService` writes the settings namespace, the engine\'s `secret`-field encryption writes the object name, the datasource binder writes its caller-supplied scope (default `datasource`). See managedBy.',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
      description:
        'Producer-scoped label paired with `namespace`: the settings specifier key, the encrypted `secret` field\'s name, or the datasource name. The pair records how the producer addressed the value; it does not identify which producer wrote the row.',
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
    // reads (ciphertext only; decryption is a separate privileged path). Since
    // #3391 an empty array fails CLOSED (deny-all) — this list stays explicit
    // because reads ARE offered, not as protection against fail-open.
    apiMethods: ['get', 'list'],
  },
});
