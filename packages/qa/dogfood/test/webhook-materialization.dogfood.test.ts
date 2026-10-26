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
// A webhook prop being `live` means the dispatcher READS it — necessary but not
// sufficient. This boots the real stack with the webhook + messaging plugins,
// authors a webhook via the app config's `webhooks:` array, and asserts the
// observable runtime outcome of ADR-0131 D2 (the declared-webhook seeder is
// retired): NO `sys_webhook` row is written for the declaration, the plugin
// binds the declared-webhook reader (`declaredWebhooks`) over the registry the
// manifest decomposition filled, and a dispatcher reading through that service
// delivers a matching record event with the spec→runtime remap applied
// (`object`→`object_name`, `isActive`→the switch). The fixture still boots
// WITHOUT realtime: the reader is bound on the data engine alone, so a binding
// re-gated behind the dispatch prerequisites would bind nothing and this proof
// would fail.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MessagingServicePlugin } from '@objectstack/service-messaging';
import { AutoEnqueuer, WebhookOutboxPlugin } from '@objectstack/plugin-webhooks';
import { webhookFixtureStack } from './fixtures/webhook-materialization-fixture.js';

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** The realtime surface the dispatcher subscribes through, driven by hand. */
function handRealtime() {
  const subs = new Map<string, { handler: (e: any) => unknown; opts?: { object?: string } }>();
  let n = 0;
  return {
    async publish(event: any) {
      for (const s of subs.values()) {
        if (s.opts?.object && s.opts.object !== event.object) continue;
        await s.handler(event);
      }
    },
    async subscribe(_channel: string, handler: (e: any) => unknown, opts?: { object?: string }) {
      const id = `s-${++n}`;
      subs.set(id, { handler, opts });
      return id;
    },
    async unsubscribe(id: string) {
      subs.delete(id);
    },
  };
}

describe('objectstack verify WEBHOOK: a declared webhook is dispatched from the registry, never materialized (#webhook-materialization)', () => {
  let stack: VerifyStack;

  beforeAll(async () => {
    // `extraPlugins` mirrors the capability plugins `objectstack serve` mounts
    // for `requires: ['webhooks']` — messaging first (WebhookOutboxPlugin
    // depends on it), then the webhook plugin. Deliberately NO realtime service.
    stack = await bootStack(webhookFixtureStack, {
      extraPlugins: [new MessagingServicePlugin(), new WebhookOutboxPlugin()],
    });
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('writes no sys_webhook row for the declared webhook, and dispatches it with object→object_name applied', async () => {
    const engine = (await stack.kernel.getServiceAsync('objectql')) as any;
    const rows = await engine.find('sys_webhook', {
      filter: { name: 'wm_task_changed' },
      context: SYSTEM_CTX,
    });
    expect(rows, 'the retired seeder wrote a sys_webhook row for a declared webhook').toEqual([]);

    // The reader the plugin bound on the data engine alone — no realtime here.
    const declaredWebhooks = (await stack.kernel.getServiceAsync('declaredWebhooks')) as any;
    expect(declaredWebhooks, 'the declared-webhook reader was not bound').toBeTruthy();
    const declared = await declaredWebhooks.declaredWebhookNamed('wm_task_changed');
    expect(declared?.webhook.object, 'the registry does not hold the authored webhook').toBe('wm_task');
    expect(declared?.active, 'spec `isActive:true` did not become the switch').toBe(true);

    // The dispatcher, reading through that same service, delivers a matching
    // record event: the remap reached the subscription it keys on.
    const realtime = handRealtime();
    const enqueued: any[] = [];
    const enqueuer = new AutoEnqueuer(engine, realtime as any, async (input) => {
      enqueued.push(input);
      return 'd1';
    }, { refreshIntervalMs: 0, declaredWebhooks });
    await enqueuer.start();
    try {
      await realtime.publish({
        type: 'data.record.created',
        object: 'wm_task',
        payload: { recordId: 't1' },
        timestamp: '2026-10-19T00:00:00.000Z',
      });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      await enqueuer.stop();
    }
    expect(enqueued, 'spec `object` did not remap to the runtime subscription key').toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      source: 'webhook',
      refId: 'declared:wm_task_changed',
      url: 'https://hooks.example/wm-task',
    });
  });
});
