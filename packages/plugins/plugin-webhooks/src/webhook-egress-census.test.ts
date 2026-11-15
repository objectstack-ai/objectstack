// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { createEgressGuard, createEnvEgressPolicy } from '@objectstack/core/egress';
import { LiteKernel } from '@objectstack/core';
import { censusWebhookEgressTargets } from './webhook-egress-census.js';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

/**
 * The boot says once how many stored webhook rows target an address the
 * outbound-request guard refuses, so the operator learns it before the first
 * delivery dead-letters — and it sends nothing to learn it.
 */

function engineOf(rows: Array<Record<string, unknown>>) {
    return { find: async () => rows } as any;
}

function capture() {
    const lines: Array<{ level: string; msg: string }> = [];
    return {
        lines,
        logger: {
            info: (msg: string) => lines.push({ level: 'info', msg }),
            warn: (msg: string) => lines.push({ level: 'warn', msg }),
        },
    };
}

const guard = (allowedTargets = '') =>
    createEgressGuard({
        policy: createEnvEgressPolicy({ allowedTargets }),
        resolve: async (host) => [{ address: host === 'hooks.internal' ? '10.0.0.5' : '93.184.215.14' }],
    });

describe('the boot census of stored webhook targets', () => {
    const rows = [
        { id: 'a', url: 'http://127.0.0.1:9000/hook' },
        { id: 'b', url: 'http://169.254.169.254/latest/meta-data/' },
        { id: 'c', url: 'https://hooks.internal/x', organization_id: 'org_1' },
        { id: 'd', url: 'https://example.com/hook' },
        { id: 'e', url: '' },
    ];

    it('counts the refused rows and says so once, at warn, naming the remedy', async () => {
        const { lines, logger } = capture();
        const census = await censusWebhookEgressTargets(engineOf(rows), guard(), logger);
        expect(census).toEqual({ scanned: 5, refused: 3 });
        expect(lines).toHaveLength(1);
        expect(lines[0]!.level).toBe('warn');
        expect(lines[0]!.msg).toMatch(/^\[webhook\] 3 of 5 sys_webhook row\(s\) target an address the outbound-request guard refuses/);
        expect(lines[0]!.msg).toContain('OS_EGRESS_ALLOWED_TARGETS');
    });

    it('an allowlisted target is not counted; a metadata target still is', async () => {
        const { logger } = capture();
        const census = await censusWebhookEgressTargets(engineOf(rows), guard('127.0.0.1,hooks.internal'), logger);
        expect(census).toEqual({ scanned: 5, refused: 1 });
    });

    it('CONTROL: no refused row says 0, once, at info', async () => {
        const { lines, logger } = capture();
        const census = await censusWebhookEgressTargets(engineOf([{ url: 'https://example.com/a' }]), guard(), logger);
        expect(census).toEqual({ scanned: 1, refused: 0 });
        expect(lines).toEqual([{ level: 'info', msg: '[webhook] 0 of 1 sys_webhook row(s) target an address the outbound-request guard refuses' }]);
    });

    it('a host that does not resolve is not counted', async () => {
        const g = createEgressGuard({ policy: createEnvEgressPolicy(), resolve: async () => { throw new Error('ENOTFOUND'); } });
        const census = await censusWebhookEgressTargets(engineOf([{ url: 'https://nowhere.invalid/' }]), g, capture().logger);
        expect(census).toEqual({ scanned: 1, refused: 0 });
    });
});

describe('the census runs at boot', () => {
    it('a booted kernel counts the stored row whose target the guard refuses', async () => {
        const engine = {
            registry: { listItems: () => [], getObject: () => undefined },
            async find(object: string) {
                return object === 'sys_webhook' ? [{ id: 'w1', url: 'http://127.0.0.1:9/hook', organization_id: 'org_1' }] : [];
            },
            registerHook() {},
            unregisterHooksByPackage() { return 0; },
        };
        const fixture = {
            name: 'com.objectstack.service.messaging',
            type: 'standard' as const,
            version: '1.0.0',
            providesServices: ['manifest', 'objectql', 'messaging'],
            init(ctx: any) {
                ctx.registerService('manifest', { register: () => {}, list: () => [] });
                ctx.registerService('objectql', engine);
                ctx.registerService('messaging', {
                    enqueueHttp: async () => ({ id: 'delivery_1' }),
                    isHttpDeliveryReady: () => true,
                    registerRedeliverGuard: () => {},
                });
            },
        };
        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(fixture as any);
        const plugin = new WebhookOutboxPlugin({ autoEnqueue: false });
        kernel.use(plugin);
        await kernel.bootstrap();
        try {
            expect(await plugin.egressCensus).toEqual({ scanned: 1, refused: 1 });
        } finally {
            await kernel.shutdown();
        }
    });
});
