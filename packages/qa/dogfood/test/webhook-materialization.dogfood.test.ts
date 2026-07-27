// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// WEBHOOK MATERIALIZATION proof (ADR-0054), exercised end-to-end through the
// real in-process stack.
//
// @proof: webhook-materialization
// ADR-0054 runtime proof for the webhook-materialization high-risk class.
// Referenced by the liveness ledger entry `webhook.object`
// (packages/spec/liveness/webhook.json); the spec liveness gate fails if this
// tag is removed. See proof-registry.mts.
//
// A webhook prop being `live` means the materializer + dispatcher READ it —
// necessary but not sufficient. This boots the real stack with the webhook +
// messaging plugins, authors a webhook via the app config's `webhooks:` array,
// and asserts the observable runtime outcome: a dispatchable `sys_webhook` row
// materialized on boot with the spec→runtime remap applied (`object`→
// `object_name`, `isActive`→`active`). It also pins the #3461 integration bug:
// the fixture boots WITHOUT realtime, so a materializer re-gated behind the
// dispatch guard would materialize nothing and this proof would fail.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { webhookFixtureStack } from './fixtures/webhook-materialization-fixture.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

describe('objectstack verify WEBHOOK: authored webhook materializes into sys_webhook (#webhook-materialization)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    // `extraPlugins` mirrors the capability plugins `objectstack serve` mounts
    // for `requires: ['webhooks']` — messaging first (WebhookOutboxPlugin
    // depends on it), then the webhook plugin. Deliberately NO realtime service:
    // materialization must run on the data engine alone (bootDeclaredWebhooks),
    // independent of the auto-enqueue dispatch prerequisites.
    stack = await bootStack(webhookFixtureStack, {
      extraPlugins: [new MessagingServicePlugin(), new WebhookOutboxPlugin()],
    });
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('materializes the stack-authored webhook into a sys_webhook row (object→object_name, isActive→active)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (await stack.kernel.getServiceAsync('objectql')) as any;
    const rows = await engine.find('sys_webhook', {
      filter: { name: 'wm_task_changed' },
      context: SYSTEM_CTX,
    });

    expect(rows, 'authored webhook was NOT materialized into a sys_webhook row').toHaveLength(1);
    const row = rows[0];

    // The remaps that are the whole point of the bridge.
    expect(row.object_name, 'spec `object` did not remap to runtime `object_name`').toBe('wm_task');
    expect(row.active, 'spec `isActive:true` did not remap to runtime `active`').toBeTruthy();

    // Boot-seeded provenance (seed-not-clobber): a package row, not admin.
    expect(row.managed_by).toBe('package');

    // The full envelope is stashed for the dispatcher's advanced-config read.
    const defn = JSON.parse(row.definition_json);
    expect(defn.object).toBe('wm_task');
    expect(defn.triggers).toEqual(['create', 'update']);
  });
});
