// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Webhook materialization fixture — the deterministic ADR-0054 proof for the
// `webhook-materialization` high-risk class.
//
// A webhook prop is `live` in the ledger because a stack-authored `webhooks:`
// entry is materialized into a dispatchable `sys_webhook` row on boot
// (#3461/#3489) — but "materialized" is not "reads the schema". The authored
// value crosses manifest-decomposition → the ObjectQL registry (type `webhook`)
// → `bootstrapDeclaredWebhooks` → `engine.insert('sys_webhook')`, and the break
// can live in any seam: the bridge was first gated BEHIND the realtime/messaging
// dispatch guard, so a boot without realtime silently materialized nothing (the
// exact silent no-op #3461 set out to kill). This fixture authors ONE webhook
// against ONE object, with ZERO dependence on an example app, so the proof can
// assert the runtime outcome: the sys_webhook row exists with the spec→runtime
// remap applied (`object`→`object_name`, `isActive`→`active`).

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { defineWebhook } from '@objectstack/spec/automation';

/** The one object the authored webhook subscribes to. */
export const WmTask = ObjectSchema.create({
  name: 'wm_task',
  // [ADR-0090 D1] grandfather stamp: this fixture's gate under test is webhook
  // materialization, not owner-sharing — keep RLS out of the way.
  sharingModel: 'public_read_write',
  label: 'WM Task',
  pluralLabel: 'WM Tasks',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
  },
});

/**
 * The stack-authored webhook. `object` (spec) must land as `object_name`
 * (runtime col) and `isActive` as `active` — the remap the proof asserts.
 */
export const wmTaskChanged = defineWebhook({
  name: 'wm_task_changed',
  label: 'WM Task Changed',
  object: 'wm_task',
  triggers: ['create', 'update'],
  url: 'https://hooks.example/wm-task',
  isActive: true,
});

export const webhookFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.webhook_fixture',
    namespace: 'wm',
    version: '0.0.0',
    type: 'app',
    name: 'Webhook Materialization Fixture',
    description: 'Single-object app that authors one webhook to prove stack `webhooks:` entries materialize into dispatchable sys_webhook rows (ADR-0054, #3461).',
  },
  objects: [WmTask],
  webhooks: [wmTaskChanged],
});
