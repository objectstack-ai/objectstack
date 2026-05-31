// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_webhook — Outbound HTTP integration configuration (runtime).
 *
 * Persists a single {@link Webhook} envelope per row so administrators
 * can author, enable/disable, and edit webhook subscriptions from the
 * Studio UI without code changes. The canonical Zod schema for the
 * `definition_json` envelope lives at `@objectstack/spec/automation/webhook`.
 *
 * One row per `name`. The automation runtime
 * (`@objectstack/service-automation`, built-in `http_request` node) loads
 * active rows on boot + on `sys_webhook:changed` events, registers
 * `afterInsert` / `afterUpdate` / `afterDelete` listeners for the
 * targeted object, and dispatches outbound HTTP calls when matching
 * record events fire.
 *
 * Platform-wide on purpose: every project (standalone, single-tenant,
 * cloud) can integrate with external systems (Slack, Stripe, internal
 * services) the same way. The control-plane-only `sys_environment*`
 * objects live in @objectstack/service-tenant; webhooks are
 * orthogonal and ship with every kernel.
 *
 * @namespace sys
 */
export const SysWebhook = ObjectSchema.create({
  name: 'sys_webhook',
  label: 'Webhook',
  pluralLabel: 'Webhooks',
  icon: 'webhook',
  isSystem: true,
  managedBy: 'config',
  // Authoring a webhook from the UI requires a structured form for the
  // headers / auth / retry / payload blocks — the generic JSON textarea
  // is acceptable as a v1 until a dedicated builder lands. Re-enable
  // create/edit/delete so admins can at least toggle `active` and edit
  // simple URL/method fields without round-tripping through code.
  userActions: { create: true, edit: true, delete: true, import: false },
  description: 'Outbound HTTP webhook subscription. Authored via defineWebhook() in code or the Studio editor; executed by the HTTP connector plugin.',
  displayNameField: 'name',
  titleFormat: '{label}',
  compactLayout: ['name', 'object_name', 'url', 'active', 'updated_at'],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    by_object: {
      type: 'grid',
      name: 'by_object',
      label: 'By Object',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['object_name', 'label', 'url', 'active', 'updated_at'],
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'label', order: 'asc' }],
      grouping: { fields: [{ field: 'object_name', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_webhooks: {
      type: 'grid',
      name: 'all_webhooks',
      label: 'All',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'Webhook ID', required: true, readonly: true, group: 'System' }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      description: 'Unique snake_case name — referenced in logs and audit',
      group: 'Definition',
    }),

    label: Field.text({
      label: 'Display Label',
      required: false,
      maxLength: 200,
      group: 'Definition',
    }),

    object_name: Field.text({
      label: 'Object',
      required: false,
      maxLength: 100,
      description: 'Short object name whose events fire this webhook (blank = manual / API-triggered)',
      group: 'Definition',
    }),

    triggers: Field.text({
      label: 'Triggers',
      required: false,
      maxLength: 200,
      description: 'Comma-separated event list: create,update,delete,undelete,api',
      group: 'Definition',
    }),

    url: Field.text({
      label: 'Target URL',
      required: true,
      maxLength: 2048,
      description: 'External endpoint that receives the POST',
      group: 'Definition',
    }),

    method: Field.text({
      label: 'HTTP Method',
      required: true,
      defaultValue: 'POST',
      maxLength: 10,
      description: 'GET / POST / PUT / PATCH / DELETE',
      group: 'Definition',
    }),

    description: Field.textarea({ label: 'Description', required: false, group: 'Definition' }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      description: 'Inactive webhooks are skipped by the dispatcher',
      group: 'Definition',
    }),

    definition_json: Field.textarea({
      label: 'Definition',
      required: true,
      description: 'Serialised Webhook JSON (see @objectstack/spec/automation/webhook) — full headers/auth/retry/payload config',
      group: 'Definition',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    { fields: ['name'], unique: true },
    { fields: ['object_name'] },
    { fields: ['active', 'object_name'] },
  ],
});
