// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_platform_setting — the settings cascade's GLOBAL rung (ADR-0131 D7).
 *
 * One row per `(namespace, key)` for the whole deployment: the value an
 * operator changes at runtime, in Setup, without a restart (mail transport, SMS
 * and storage providers, AI and knowledge endpoints, auth policy, the lifecycle
 * retention defaults). It used to be the `scope: 'global'` limb of `sys_setting`,
 * a tenant-scoped object, where the injected organization column only ever held
 * NULL and a walled posture hid it from every reader. ADR-0131 D7 moved it out:
 * the global rung leaves the tenant-scoped table, and a tenant-less object holds
 * only values an operator must change without a restart.
 *
 * ## No organization column, governed by object permission
 *
 * `systemFields: { tenant: false }` — no writer attributes a row to an
 * organization. The only writer is `SettingsService.setMany` for a key whose
 * declared scope is `global`, under a system context and with a row that names
 * no organization. With no column there is no tenant wall, so who may read is
 * object permission (D7): the platform-only capability below. Every manifest
 * whose keys land here already requires the same capability to read or write
 * through the settings door, so the door and the table agree.
 *
 * ## Resolution
 *
 * `SettingsService` reads this object as the cascade's global rung and nothing
 * else does: env > global (this object) > tenant > user (`sys_setting`) >
 * manifest default. `sys_setting` no longer stores a global row, and the service
 * reads none from it — there is one source per rung.
 *
 * Encryption: as on `sys_setting`, a row with `encrypted = true` keeps the
 * `sys_secret` handle in `value_enc` and leaves `value` null. The handle's
 * ciphertext is bound to the settings producer's `(namespace, key)` (ADR-0128
 * D1), never to the holder object or an organization, so a handle moved here
 * from a `sys_setting` row opens unchanged.
 *
 * managedBy: 'engine-owned' — reads are open to the capability holder for a
 * diagnostic grid; every write flows through the settings door.
 *
 * See ADR-0007 (Settings Manifest + K/V Store + Resolver) and ADR-0131 D7.
 *
 * @namespace sys
 */
export const SysPlatformSetting = ObjectSchema.create({
  name: 'sys_platform_setting',
  label: 'Platform Setting',
  pluralLabel: 'Platform Settings',
  icon: 'sliders',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Deployment-level runtime settings: NO tenant column, and
  // reads are platform-only.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  description: 'Deployment-wide settings values: the global rung of the settings cascade.',
  displayNameField: 'key',
  nameField: 'key', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{namespace}.{key}',
  highlightFields: ['namespace', 'key', 'updated_at'],

  fields: {
    id: Field.text({
      label: 'Setting ID',
      required: true,
      readonly: true,
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      defaultValue: 'NOW()',
      readonly: true,
    }),

    namespace: Field.text({
      label: 'Namespace',
      required: true,
      maxLength: 64,
      description: 'Manifest namespace (e.g. mail, storage, ai).',
    }),

    key: Field.text({
      label: 'Key',
      required: true,
      maxLength: 128,
      description: 'Specifier key inside the namespace (snake_case).',
    }),

    value: Field.json({
      label: 'Value',
      description: 'JSON-encoded value. Null when encrypted=true (see value_enc).',
    }),

    encrypted: Field.boolean({
      label: 'Encrypted',
      defaultValue: false,
      description: 'When true, the value is stored encrypted-at-rest in value_enc; value column is null.',
    }),

    locked: Field.boolean({
      label: 'Locked',
      defaultValue: false,
      description:
        'When true, tenant and user rows cannot override this value; writes against those scopes return 409.',
    }),

    locked_reason: Field.text({
      label: 'Lock Reason',
      description: 'Human-readable explanation surfaced in the UI tooltip when locked=true.',
    }),

    value_enc: Field.text({
      label: 'Encrypted Value',
      readonly: true,
      description: 'Handle of the sys_secret row holding the ciphertext. Set only when encrypted=true.',
    }),

    updated_by: Field.lookup('sys_user', {
      label: 'Updated By',
      readonly: true,
      description: 'Last actor who wrote this row through the settings service.',
    }),
  },

  indexes: [
    // The row identity, and the read path: one value per key for the whole
    // deployment. Spelled `'global'` explicitly (ADR-0120 D1) — there is no
    // organization column to scope by, and both key parts are NOT NULL, so the
    // NULL-distinct hole `sys_setting`'s identity needed a runtime index for
    // does not exist here.
    { fields: ['namespace', 'key'], unique: 'global' },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Reads for a diagnostic grid; writes go through /api/settings/:namespace
    // so the resolver, the lock check and both audit ledgers run.
    apiMethods: ['get', 'list'],
  },
});
