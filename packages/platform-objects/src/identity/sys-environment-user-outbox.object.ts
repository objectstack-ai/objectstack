// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_environment_user_outbox — on a cloud-managed environment, the durable
 * record of the calls the environment makes to its environment-user host (the
 * cloud) about one person's invitation: sent when a pending person is added or
 * re-added, cancelled when a pending person is deactivated or removed, and
 * re-sent when a person is reactivated. The deactivation of a person who has
 * signed in is asked of the host but not recorded here.
 *
 * Why it exists: the execution terms of the hosting rulings (relayed on the
 * pending-people card) ask for "a durable outbox with retry … with per-row
 * invitation status in Setup → Users". The door that acts still makes the
 * first call itself, outside any database transaction, so a host's typed
 * refusal (the developer member cap, an organization owner or admin) reaches
 * the administrator on that request, row by row. This object is what makes
 * the call durable: a call the host did not take stays `pending` here and
 * plugin-auth's worker (`environment-user-outbox.ts`) retries it with backoff
 * until the host takes it or the attempts run out (`failed`).
 *
 * One row per call, never updated into another call: a re-send writes a new
 * row and marks the older unsent one `superseded`. The newest row of a person
 * is their invitation status:
 *
 *  - `added` + `pending` / `in_flight`: the invitation is being sent;
 *  - `added` + `sent`: invited, not signed in yet;
 *  - `added` + `accepted`: the person's first platform sign-in cleared the
 *    pending marker;
 *  - any kind + `failed`: the host refused it (`refusal_code`) or the
 *    attempts ran out (`last_error`);
 *  - `deactivated` / `removed` + `sent`: the invitation was cancelled.
 *
 * `user_id` is text, not a lookup: the row outlives a removed person, which
 * is exactly when the cancellation it records matters.
 *
 * Writers: plugin-auth only, as the system (`managedBy: 'engine-owned'`, no
 * data-API writes). Readers: platform administrators, through the data API
 * (`get` / `list`), which is what Setup → Users reads.
 *
 * Lifecycle: no `lifecycle` block on purpose. A pending person who never
 * accepts keeps a status for as long as they are pending, and a person's
 * rows are one per administrator action, so there is nothing to reap.
 *
 * @namespace sys
 */
export const SysEnvironmentUserOutbox = ObjectSchema.create({
  name: 'sys_environment_user_outbox',
  label: 'Environment User Invitation',
  pluralLabel: 'Environment User Invitations',
  icon: 'send',
  isSystem: true,
  managedBy: 'engine-owned',
  // [ADR-0131 D7] Deployment-level: people are the environment's, not an
  // organization's, and the worker drains every row under the system
  // context, so there is no organization to stamp. Who may read is object
  // permission: the platform-only capability below.
  systemFields: { tenant: false },
  requiredPermissions: ['manage_platform_settings'],
  protection: {
    lock: 'full',
    reason: 'Written only by plugin-auth: the record of each call to the environment-user host.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  userActions: { create: false, edit: false, delete: false, import: false },
  description:
    "Invitations sent to and cancelled at the hosting organisation for this environment's people, one row per call, with its delivery status.",
  nameField: 'email', // [ADR-0079] canonical primary-title pointer
  displayNameField: 'email',
  highlightFields: ['email', 'kind', 'status', 'attempts', 'last_error'],

  listViews: {
    recent: {
      type: 'grid',
      name: 'recent',
      label: 'Recent',
      data: { provider: 'object', object: 'sys_environment_user_outbox' },
      columns: ['email', 'kind', 'status', 'attempts', 'last_error', 'updated_at'],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
    failed: {
      type: 'grid',
      name: 'failed',
      label: 'Failed',
      data: { provider: 'object', object: 'sys_environment_user_outbox' },
      columns: ['email', 'kind', 'attempts', 'refusal_code', 'last_error', 'updated_at'],
      filter: [{ field: 'status', operator: 'equals', value: 'failed' }],
      sort: [{ field: 'updated_at', order: 'desc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
      description: 'Row id. Sent to the host as the delivery id, so it can drop a repeat of the same call.',
    }),

    user_id: Field.text({
      label: 'User ID',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The person the call is about. Text, not a lookup: the row outlives a removed person.',
    }),

    email: Field.text({
      label: 'Email',
      required: true,
      readonly: true,
      maxLength: 320,
      description: "The person's email address when the call was made.",
    }),

    kind: Field.select({
      label: 'Kind',
      required: true,
      readonly: true,
      description: 'What the host is told: an invitation sent, cancelled or re-sent.',
      options: [
        { value: 'added', label: 'Invited' },
        { value: 'deactivated', label: 'Deactivated' },
        { value: 'reactivated', label: 'Reactivated' },
        { value: 'removed', label: 'Removed' },
      ],
    }),

    status: Field.select({
      label: 'Status',
      required: true,
      readonly: true,
      defaultValue: 'pending',
      description:
        'Pending and Sending: the host has not taken the call yet and it is retried. Sent: the host took it. '
        + 'Accepted: the person signed in. Failed: the host refused it or the retries ran out. Superseded: a '
        + 'later call about the same person replaced it.',
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'in_flight', label: 'Sending' },
        { value: 'sent', label: 'Sent' },
        { value: 'accepted', label: 'Accepted' },
        { value: 'failed', label: 'Failed' },
        { value: 'superseded', label: 'Superseded' },
      ],
    }),

    attempts: Field.number({
      label: 'Attempts',
      required: true,
      readonly: true,
      defaultValue: 0,
      description: 'How many times the host has been called for this row.',
    }),

    next_attempt_at: Field.number({
      label: 'Next Attempt At (ms)',
      required: false,
      readonly: true,
      description: 'When a pending row is next tried, in epoch milliseconds.',
    }),

    claimed_until: Field.number({
      label: 'Claimed Until (ms)',
      required: false,
      readonly: true,
      description: 'While a call is in flight: when the claim lapses and another worker may try the row again.',
    }),

    claim_token: Field.text({
      label: 'Claim Token',
      required: false,
      readonly: true,
      maxLength: 64,
      description: 'Names the one claim that holds an in-flight row.',
    }),

    last_attempt_at: Field.datetime({
      label: 'Last Attempt At',
      required: false,
      readonly: true,
    }),

    last_error: Field.textarea({
      label: 'Last Error',
      required: false,
      readonly: true,
      description: "Why the last call did not land: the host's own sentence for a refusal, else what failed.",
    }),

    refusal_code: Field.text({
      label: 'Refusal Code',
      required: false,
      readonly: true,
      maxLength: 128,
      description: "The host's machine code when it refused the call.",
    }),

    event_json: Field.textarea({
      label: 'Event',
      required: true,
      readonly: true,
      description:
        'The event the host is told, as built when the administrator acted: the person, the administrator and '
        + 'their cloud user id. A retry sends it unchanged.',
    }),

    sent_at: Field.datetime({
      label: 'Sent At',
      required: false,
      readonly: true,
    }),

    accepted_at: Field.datetime({
      label: 'Accepted At',
      required: false,
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['status', 'next_attempt_at'] },
    { fields: ['user_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    // Read-only over the data API: plugin-auth is the only writer.
    apiMethods: ['get', 'list'],
  },
});
