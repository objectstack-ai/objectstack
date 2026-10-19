// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineWebhook } from '@objectstack/spec/automation';

/**
 * Outbound webhook — fans out task lifecycle events (create/update/delete)
 * to an external endpoint. No `label` / `description`: a declared webhook has
 * no Setup row to show them on, and the liveness ledger marks both dead.
 * Authored via `defineStack({ webhooks })`; the webhooks plugin's dispatcher
 * reads this declaration from the registry (ADR-0131 D2) — no `sys_webhook`
 * row is written for it.
 *
 * Shipped INACTIVE on purpose: `hooks.example` is a placeholder endpoint, so an
 * active subscription would emit a failed HTTP delivery on every task change.
 * A declared webhook is read-only (ADR-0131 D6, regime C). The demo flow is to
 * author a copy under a new name in Setup → Integrations → Webhooks, pointed at
 * a real endpoint; this declaration itself is switched on or off with
 * `POST /api/v1/security/_activation/webhook/showcase_task_changed` and
 * `{ "enabled": true }`, which survives redeploys.
 */
export const TaskChangedWebhook = defineWebhook({
  name: 'showcase_task_changed',
  object: 'showcase_task',
  triggers: ['create', 'update', 'delete'],
  url: 'https://hooks.example/showcase/task',
  method: 'POST',
  isActive: false,
});

export const allWebhooks = [TaskChangedWebhook];
