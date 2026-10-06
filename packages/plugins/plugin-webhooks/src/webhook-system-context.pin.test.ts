// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21913] This plugin's two `sys_webhook` reads carry the explicit system
 * opt-in (`isSystem: true`): the auto-enqueuer's subscription cache refresh
 * (`AutoEnqueuer.refresh`, boot and timer) and the redeliver guard's
 * subscription lookup (`createWebhookRedeliverGuard`).
 *
 * Both used to reach the data engine with no context at all — no principal and
 * no system opt-in — and passed the security middleware only through its
 * principal-less hand-off (ADR-0096 E1), which D5 closes. The refresh has no
 * caller; the guard runs inside the redeliver path after the delivery row was
 * read under the requesting caller's organization, and what it reads is the
 * subscription's existence, name and secret posture.
 */

import { describe, it, expect } from 'vitest';
import { AutoEnqueuer } from './auto-enqueuer.js';
import { createWebhookRedeliverGuard } from './redeliver-guard.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

type Call = { verb: string; object: string; context: unknown };

/** A read-only double: a write this pin does not expect has no method to land on. */
function recordingEngine(rows: Array<Record<string, unknown>>) {
    const calls: Call[] = [];
    const ctxOf = (query: any, options: any) => options?.context ?? query?.context;
    const engine = {
        async find(object: string, query: any, options?: any) {
            calls.push({ verb: 'find', object, context: ctxOf(query, options) });
            return rows;
        },
        async findOne(object: string, query: any, options?: any) {
            assertEngineFindOnePredicate(object, query);
            calls.push({ verb: 'findOne', object, context: ctxOf(query, options) });
            return rows.find((r) => r.id === query?.where?.id) ?? null;
        },
    };
    return { engine: engine as any, calls };
}

describe('[#21913] plugin-webhooks sys_webhook reads carry the explicit system opt-in', () => {
    it('AutoEnqueuer.refresh reads the subscriptions under isSystem', async () => {
        const { engine, calls } = recordingEngine([]);
        const realtime = { subscribe: async () => 'sub_1', unsubscribe: async () => {} } as any;
        const ae = new AutoEnqueuer(engine, realtime, async () => 'del_1', { refreshIntervalMs: 0 });
        await ae.refresh();
        expect(calls).toEqual([{ verb: 'find', object: 'sys_webhook', context: { isSystem: true } }]);
    });

    it('the redeliver guard reads the subscription under isSystem', async () => {
        const { engine, calls } = recordingEngine([{ id: 'wh_1', name: 'hook', signing_secret: null }]);
        const guard = createWebhookRedeliverGuard(engine);
        // A subscription that stores no secret is allowed: the read ran and answered.
        expect(await guard({ source: 'webhook', refId: 'wh_1' })).toBeUndefined();
        expect(calls).toEqual([{ verb: 'findOne', object: 'sys_webhook', context: { isSystem: true } }]);
    });
});
