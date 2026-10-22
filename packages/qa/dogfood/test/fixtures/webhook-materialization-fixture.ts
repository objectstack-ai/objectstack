// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Webhook materialization fixture — the deterministic ADR-0054 proof for the
// `webhook-materialization` high-risk class.
//
// A webhook prop is `live` in the ledger because the dispatcher reads it — but
// "read" is not "reads the schema". Since ADR-0131 D2 retired the boot seeder,
// the authored value crosses manifest-decomposition → the ObjectQL registry
// (type `webhook`) → plugin-webhooks' declared-webhook reader (bound as the
// `declaredWebhooks` service on the data engine alone) → the dispatcher's
// subscription, with NO `sys_webhook` row in between, and the break can live in
// any seam: the old bridge was first gated BEHIND the realtime/messaging
// dispatch guard, so a boot without realtime silently did nothing. This fixture
// authors ONE webhook against ONE object, with ZERO dependence on an example
// app, so the proof can assert the runtime outcome: no row, and a delivery with
// the spec→runtime remap applied (`object`→`object_name`, `isActive`→the
// switch).

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
 * The stack-authored webhook. `object` (spec) must land as the dispatcher's
 * `object_name` and `isActive` as its switch — the remap the proof asserts.
 */
export const wmTaskChanged = defineWebhook({
  name: 'wm_task_changed',
  label: 'WM Task Changed',
  object: 'wm_task',
  triggers: ['create', 'update'],
  url: 'https://hooks.example/wm-task',
  isActive: true,
});

/**
 * Built with `strict: false`, on purpose — DECLARED, not an oversight. This
 * stack declares a webhook and no `requires`, so `defineStack`'s default
 * judgement refuses it (`STACK_WEBHOOK_CAPABILITY_REQUIRED`: a declared webhook
 * owes `requires: ['webhooks', 'realtime']`, ruling A on #24910), and every
 * authoring door would stop it at load. What this fixture models is the one
 * composition that judgement cannot reach: a host that wires the stack by hand,
 * with the webhook plugin and NO realtime service, which is exactly what the
 * proof needs — the declared-webhook reader must bind on the data engine alone.
 * Declaring the pair instead would have `bootStack` mount realtime the way
 * `serve` does, and a reader re-gated behind the dispatch prerequisites would
 * then pass unseen. Everything else about the stack is an ordinary authored
 * package.
 */
export const webhookFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.webhook-fixture',
    namespace: 'wm',
    version: '0.0.0',
    type: 'app',
    name: 'Webhook Materialization Fixture',
    description: 'Single-object app that authors one webhook to prove stack `webhooks:` entries reach the dispatcher from the registry, with no sys_webhook row (ADR-0054, ADR-0131 D2).',
  },
  objects: [WmTask],
  webhooks: [wmTaskChanged],
}, { strict: false });
