// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineWebhook } from '@objectstack/spec/automation';

/**
 * Outbound webhook — fans out task changes to an external endpoint.
 * Authored via `defineStack({ webhooks })`; on boot the webhooks
 * plugin materializes this into a `sys_webhook` row (#3461) that the
 * auto-enqueuer dispatches off.
 *
 * Shipped INACTIVE on purpose: `hooks.example` is a placeholder endpoint, so an
 * active subscription would emit a failed HTTP delivery on every task change.
 * The demo flow is to open Setup → Integrations → Webhooks and flip this row to
 * Active (pointing it at a real endpoint) — that admin edit is remembered
 * (`customized: true`) and survives redeploys.
 */
export const TaskChangedWebhook = defineWebhook({
  name: 'showcase_task_changed',
  label: 'Task Changed → External',
  object: 'showcase_task',
  triggers: ['create', 'update', 'delete'],
  url: 'https://hooks.example/showcase/task',
  method: 'POST',
  isActive: false,
  description: 'Sends task lifecycle events to an external system. Activate in Setup and point at a real endpoint.',
});

export const allWebhooks = [TaskChangedWebhook];
