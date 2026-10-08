// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_flow_credential — the WRITE-ONLY channel a flow's credentials live in
 * (#20790, on the #7799 seam).
 *
 * A flow definition holds two credentials, each a literal in one node kind's
 * `config` (`flow-credential-projection.ts`, `FLOW_NODE_CREDENTIAL_KEYS`): the
 * inbound hook's HMAC secret on the start node, and an `http` node's outbound
 * signing secret. Before this object the stored definition carried both in
 * cleartext — in the stored metadata row, in every version-history row, and in
 * the row's content hash — so each read exit had to project them away one
 * door at a time (#20552, #21086, #21228). A projection hides the value from
 * one class of reads; this object removes the class: the metadata save door
 * moves every explicit value here and stores the definition without it.
 *
 * One row per credential POSITION of one flow in one lifecycle state:
 * `(flow_name, state, node_id, credential_key)`. `node_id` because a flow's
 * node ids are one space across every region (the carry-forward walks them the
 * same way), and `state` because a DRAFT save must not rotate the live hook —
 * a draft's row is promoted when the draft is published. The unique index
 * keys on `position`, a fixed-width digest of the `(node_id, credential_key)`
 * pair, because a node id is author text with no declared bound and an index
 * key must have one (MySQL refuses an unbounded keyed column).
 *
 * `value` is `type: 'secret'` — the #7799 seam, unchanged: the engine encrypts
 * it on write through the host's `ICryptoProvider` (fail-closed with no
 * provider), masks it on every read path, and only the privileged
 * `resolveSecretField()` dereferences it, at verification and execution time.
 *
 * Env-wide, like the engine's flow map, which keys flows by bare name: a flow
 * declares `allowOrgOverride: false`, so its stored rows are env-wide too.
 *
 * Writers: the automation plugin's credential channel (the metadata save door,
 * the publish promotion, a delete, the one-time migration), under a system
 * context. Readers: the same channel and the engine's verification and `http`
 * execution — never the generic data door, which is closed below.
 *
 * @namespace sys
 */
export const SysFlowCredential = ObjectSchema.create({
  name: 'sys_flow_credential',
  label: 'Flow Credential',
  pluralLabel: 'Flow Credentials',
  icon: 'key',
  isSystem: true,
  managedBy: 'engine-owned',
  // ADR-0066 secure-by-default: a credential store is not covered by the
  // wildcard grant. Everything reads and writes it through the engine under a
  // system context.
  access: { default: 'private' },
  description:
    "Write-only store of flow credentials (an inbound hook's secret, an http node's signing secret), one encrypted row per credential position of a flow in one lifecycle state. The flow definition keeps no copy.",
  displayNameField: 'flow_name',
  nameField: 'flow_name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['flow_name', 'state', 'node_id', 'credential_key'],

  fields: {
    flow_name: Field.text({
      label: 'Flow',
      required: true,
      readonly: true,
      // The producer is the stored flow row's name — `sys_metadata.name`, 255.
      maxLength: 255,
      description: 'The machine name of the flow this credential belongs to.',
    }),

    state: Field.select(['draft', 'active'], {
      label: 'State',
      required: true,
      description:
        "The lifecycle state of the stored flow row this credential belongs to. A draft's credential is promoted when the draft is published, so a draft save never rotates the live one.",
    }),

    node_id: Field.text({
      label: 'Node',
      required: true,
      readonly: true,
      description: "The id of the flow node whose config holds this credential.",
    }),

    credential_key: Field.text({
      label: 'Credential Key',
      required: true,
      readonly: true,
      description: "The node config key that holds this credential (`secret` on a start node, `signingSecret` on an http node).",
    }),

    position: Field.text({
      label: 'Position',
      required: true,
      readonly: true,
      // The producer is the channel: a SHA-256 hex digest, 64 characters.
      maxLength: 64,
      description: 'SHA-256 of the (node id, credential key) pair, computed by the channel — the bounded key the unique index carries.',
    }),

    value: Field.secret({
      label: 'Value',
      required: true,
      description:
        'The credential, encrypted at rest by the host crypto provider and masked on every read. Resolved only server-side, when a hook post is verified or an http node signs a delivery.',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    // One credential per position per state — the channel's upsert key.
    { fields: ['flow_name', 'state', 'position'], unique: 'global' },
  ],

  enable: {
    // Engine-owned and write-only: no generic data door at all. The value is
    // masked on every engine read regardless; closing the door also keeps the
    // positions out of reach.
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
