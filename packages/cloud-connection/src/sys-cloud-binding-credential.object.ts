// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_cloud_binding_credential — the binding credential a SELF-HOSTED runtime
 * received at bind time (cloud ADR-0008), kept where EVERY replica of the
 * deployment reads it, when the deployment declares more than one replica
 * over the Redis cluster driver.
 *
 * A single node keeps the credential in a file that follows `OS_HOME`:
 * `<OS_HOME>/cloud-connection.json`, or `<cwd>/.objectstack/cloud-connection.json`
 * when `OS_HOME` is unset (`resolveConnectionCredentialPath` in
 * `connection-credential-store.ts`), and never registers this object. Several
 * replicas cannot: a bind lands on whichever replica served the request, and a
 * file under that replica's working directory is invisible to the others, so
 * their online licence check and every control-plane call they make present no
 * credential. With replicas declared (`OS_CLUSTER_REPLICAS` > 1 or
 * `OS_EXPECT_MULTI_NODE=true`) and the Redis cluster driver, the plugin keeps
 * the credential here instead (`connection-credential-ledger.ts`).
 *
 * Why the database and not the cluster key-value store: the credential is the
 * system of record for this deployment's identity at the control plane, minted
 * ONCE by the bind. The cluster KV is coordination state, explicitly not a
 * database (`IKV`), and the customer's Redis need not persist, so a Redis
 * restart would unbind every replica at once. The database is what every
 * replica already shares and what the operator backs up.
 *
 * One row, keyed `slot = 'runtime'`. `runtime_token` is `type: 'secret'`, the
 * seam `sys_connector_credential` uses, unchanged: the engine seals it on
 * write through the host's `ICryptoProvider` (fail-closed with no provider),
 * masks it on every read path, and only the privileged `resolveSecretField()`
 * dereferences it. ⛔ No second secret mechanism. An unbind that keeps the
 * runtime identity (ADR runtime-identity-binding §2.1) leaves the row with
 * `runtime_token` null and `runtime_id` set, the same residual the file keeps.
 *
 * Writers and readers: `CloudConnectionPlugin` alone, under a system context.
 * No generic data door: the object is closed below.
 *
 * @namespace sys
 */
export const SysCloudBindingCredential = ObjectSchema.create({
  name: 'sys_cloud_binding_credential',
  label: 'Cloud Binding Credential',
  pluralLabel: 'Cloud Binding Credentials',
  icon: 'key',
  isSystem: true,
  managedBy: 'engine-owned',
  // Deployment-level: a runtime binds once, for the whole deployment, so the
  // row carries no organization column.
  systemFields: { tenant: false },
  // ADR-0066 secure-by-default: a credential store is not covered by the
  // wildcard grant. Only the cloud connection plugin reads and writes it,
  // under a system context.
  access: { default: 'private' },
  description:
    "This deployment's cloud binding credential, kept where every replica reads it. Registered only when several replicas are declared over the Redis cluster driver; a single node keeps the credential in its local credential file.",
  displayNameField: 'slot',
  nameField: 'slot', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['slot', 'runtime_id', 'bound_at'],

  fields: {
    slot: Field.text({
      label: 'Slot',
      required: true,
      readonly: true,
      // The unique index needs a bound. The only value written is `runtime`.
      maxLength: 32,
      description: 'Always `runtime`: a deployment holds one binding.',
    }),

    runtime_token: Field.secret({
      label: 'Runtime Token',
      description:
        'The runtime bearer the bind returned once, encrypted at rest by the host crypto provider and masked on every read. Empty after an unbind that keeps the runtime identity.',
    }),

    runtime_id: Field.text({
      label: 'Runtime ID',
      readonly: true,
      maxLength: 255,
      description: 'The durable runtime identity the cloud minted. Presented on a re-bind so the registration survives token rotation.',
    }),

    environment_id: Field.text({
      label: 'Environment ID',
      readonly: true,
      maxLength: 255,
      description: 'The control-plane environment the binding targeted, when it targeted one.',
    }),

    control_plane_url: Field.text({
      label: 'Control Plane URL',
      readonly: true,
      maxLength: 2048,
      description: 'The control-plane base URL the binding was made against.',
    }),

    // Not `organization_id`: that is the tenancy column name, and this row has
    // no tenant. This is the organization at the CONTROL PLANE that owns the binding.
    cloud_organization_id: Field.text({
      label: 'Cloud Organization ID',
      readonly: true,
      maxLength: 255,
      description: 'The control-plane organization that approved the binding.',
    }),

    account_email: Field.text({
      label: 'Account Email',
      readonly: true,
      maxLength: 320,
      description: 'The control-plane account that approved the binding.',
    }),

    bound_at: Field.text({
      label: 'Bound At',
      readonly: true,
      maxLength: 64,
      description: 'When the binding was made, as the control plane reported it (ISO 8601).',
    }),
  },

  indexes: [
    // One row per deployment — the ledger's upsert key.
    { fields: ['slot'], unique: 'global' },
  ],

  enable: {
    // Engine-owned: no generic data door at all. The token is masked on every
    // engine read regardless.
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
