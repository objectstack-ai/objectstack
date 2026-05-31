// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';

/**
 * A lightweight fake PluginContext — enough surface for the plugin's init():
 * a logger, a service registry, and a `manifest` service that records objects.
 * Avoids a full kernel bootstrap, mirroring the unit-test style used by the
 * automation builtin-node tests.
 */
function fakeCtx() {
    const services = new Map<string, unknown>();
    const inserts: Array<{ object: string; row: any }> = [];
    const registeredObjects: unknown[] = [];

    services.set('manifest', {
        register(m: { objects?: unknown[] }) {
            registeredObjects.push(...(m.objects ?? []));
        },
    });
    services.set('data', {
        async insert(object: string, row: any) {
            inserts.push({ object, row });
            return { id: `row_${inserts.length}`, ...row };
        },
        async find() { return []; },
        async findOne() { return null; },
        async update() { return {}; },
        async delete() { return {}; },
    });

    const ctx = {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ctx.logger },
        registerService(name: string, svc: unknown) {
            services.set(name, svc);
        },
        getService<T>(name: string): T {
            return services.get(name) as T;
        },
    } as any;

    return { ctx, services, inserts, registeredObjects };
}

describe('MessagingServicePlugin', () => {
    it('registers the messaging service with the always-on inbox channel', async () => {
        const { ctx, services } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const messaging = services.get('messaging') as MessagingService;
        expect(messaging).toBeDefined();
        expect(messaging.getRegisteredChannels()).toEqual(['inbox']);
    });

    it('registers the sys_inbox_message object via the manifest service', async () => {
        const { ctx, registeredObjects } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const names = registeredObjects.map((o: any) => o?.name);
        expect(names).toContain('sys_inbox_message');
    });

    it('end-to-end: emit() through the registered service writes an inbox row', async () => {
        const { ctx, services, inserts } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const messaging = services.get('messaging') as MessagingService;
        const result = await messaging.emit({
            topic: 'deal.won',
            title: 'Deal closed',
            body: 'Acme signed 🎉',
            recipients: ['user_1'],
        });

        expect(result.delivered).toBe(1);
        expect(inserts).toHaveLength(1);
        expect(inserts[0].object).toBe('sys_inbox_message');
        expect(inserts[0].row).toMatchObject({ user_id: 'user_1', title: 'Deal closed', read: false });
    });

    it('can be constructed without the inbox channel for an empty registry', async () => {
        const { ctx, services } = fakeCtx();
        await new MessagingServicePlugin({ registerInbox: false }).init(ctx);
        const messaging = services.get('messaging') as MessagingService;
        expect(messaging.getRegisteredChannels()).toEqual([]);
    });
});
