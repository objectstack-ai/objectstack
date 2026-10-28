// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_connector_credential — the WRITE-ONLY store an administrator fills a
 * declarative connector's credential into (#27237, ruling A on #27230).
 *
 * A provider-bound `connectors:` entry names its secret, never carries it:
 * `auth: { type, credentialRef }` (ADR-0097 §3). The metadata author writes the
 * name; the administrator who installs the app holds the value. Before this
 * object the open tier resolved the name from `process.env` alone, so on a
 * hosted environment — where the administrator has no server environment —
 * every connector-bearing app installed and could never be credentialed.
 *
 * One row per `credentialRef` the administrator has set. The resolver chain
 * reads it second: an environment variable of the same name wins (a self-hosted
 * operator keeps today's path), then this row, then the host's injected
 * resolver (a vault) if it wired one (`connector-credentials.ts`).
 *
 * `value` is `type: 'secret'` — the #7799 seam `sys_flow_credential` uses,
 * unchanged: the engine encrypts it on write through the host's
 * `ICryptoProvider` (fail-closed with no provider), masks it on every read
 * path, and only the privileged `resolveSecretField()` dereferences it, when a
 * connector instance materializes. ⛔ No second secret mechanism.
 *
 * Environment-level: a connector instance is environment-level (ADR-0097), so
 * its credential is too, and the store carries no organization column. Per
 * organization credentials on a shared environment are ruled not supported
 * (S1 on #27230); the routes that write this object refuse on a walled posture.
 *
 * Writers: the automation plugin's credential door (set, clear) and its
 * reconcile (`status`, `last_verified_at`), under a system context that
 * carries the caller's user id, so the audit columns record who changed which
 * reference and when. Readers: the same plugin — never the generic data door,
 * which is closed below.
 *
 * @namespace sys
 */
export const SysConnectorCredential = ObjectSchema.create({
  name: 'sys_connector_credential',
  label: 'Connector Credential',
  pluralLabel: 'Connector Credentials',
  icon: 'key',
  isSystem: true,
  managedBy: 'engine-owned',
  // Environment-level (S1 on #27230): read by the connector instance that names
  // it, under the system context, never by organization.
  systemFields: { tenant: false },
  // ADR-0066 secure-by-default: a credential store is not covered by the
  // wildcard grant. Everything reads and writes it through the automation
  // plugin under a system context.
  access: { default: 'private' },
  description:
    "Write-only store of declarative connector credentials, one encrypted row per `credentialRef` an administrator set. Read second in the resolver chain: an environment variable of the same name wins.",
  displayNameField: 'ref',
  nameField: 'ref', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['ref', 'status', 'connector_name', 'updated_at'],

  fields: {
    ref: Field.text({
      label: 'Credential Reference',
      required: true,
      readonly: true,
      // The producer is an authored `auth.credentialRef` — in practice an
      // environment-variable-shaped name. The unique index needs a bound, and
      // the credential door refuses a longer reference before any write.
      maxLength: 255,
      description: 'The `auth.credentialRef` a declarative connector instance names, exactly as authored.',
    }),

    value: Field.secret({
      label: 'Value',
      required: true,
      description:
        'The credential, encrypted at rest by the host crypto provider and masked on every read. Resolved only server-side, when a connector instance naming this reference materializes.',
    }),

    revision: Field.number({
      label: 'Revision',
      required: true,
      readonly: true,
      defaultValue: 1,
      description:
        "Raised on every value write. The connector reconcile's change signal: an instance naming this reference re-materializes when it moves. Never derived from the value.",
    }),

    connector_name: Field.text({
      label: 'Connectors',
      readonly: true,
      description: 'The declarative connector instances that named this reference when it was last set, comma-separated. Informational.',
    }),

    package_id: Field.text({
      label: 'Packages',
      readonly: true,
      description: 'The packages that declared those instances when this reference was last set, comma-separated. Informational.',
    }),

    status: Field.select(['set', 'rejected'], {
      label: 'Status',
      required: true,
      defaultValue: 'set',
      description:
        "`set` when a value is stored; `rejected` when an upstream refused it while an instance materialized. A reference no source answers for is `missing` in the listing and has no row.",
    }),

    status_reason: Field.textarea({
      label: 'Status Reason',
      readonly: true,
      description: "The connector's own message when the upstream refused the credential. Never the value.",
    }),

    last_verified_at: Field.datetime({
      label: 'Last Materialized At',
      readonly: true,
      description:
        'When a connector instance last materialized with this value. A provider that contacts its upstream at materialization (mcp) proves the credential there; the others first use it on a dispatch.',
    }),
  },

  indexes: [
    // One row per reference in the environment — the door's upsert key.
    { fields: ['ref'], unique: 'global' },
  ],

  enable: {
    // Engine-owned and write-only: no generic data door at all. The value is
    // masked on every engine read regardless; closing the door also keeps the
    // reference list out of reach of a caller without `manage_metadata`.
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
