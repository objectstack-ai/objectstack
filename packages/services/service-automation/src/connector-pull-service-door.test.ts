// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20281 stage ③ — the connector sync executor on the `automation` SERVICE.
 *
 * Before this, `pullConnectorSource` was reachable only as an
 * `AutomationServicePlugin` instance method, which no other package holds: the
 * registered `automation` service is the ENGINE, and the contract
 * (`IAutomationService`) declared no pull. A job's `pull` run form binds
 * through the service registry, so the contract gains `pullConnectorSource`
 * and the engine serves it from the executor the plugin attaches at `init()`
 * (`setConnectorPullSource`) — the plugin keeps the materialized-connector map,
 * the engine is handed the call.
 *
 * Pinned: the bare engine refuses with an ADR-0112 envelope rather than
 * answering a pull that never ran; an attached executor receives the request
 * as sent and its answer comes back unchanged; and a booted kernel's
 * `automation` service reaches the plugin's executor. The end-to-end pull
 * through the service, over a real `rest` connector, is in
 * `connector-pull.integration.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { ConnectorSourcePullResult, IAutomationService } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

const RESULT: ConnectorSourcePullResult = {
    mapping: 'orders_pull',
    targetObject: 'order',
    connector: 'orders_api',
    action: 'request',
    pulled: 1,
    summary: { total: 1, processed: 1, created: 1, updated: 0, skipped: 0, errors: 0, ok: 1, cancelled: false },
};

describe('#20281 stage ③: IAutomationService.pullConnectorSource, served by the engine', () => {
    it('a bare engine — no executor attached — refuses with SERVICE_UNAVAILABLE 503 and pulls nothing', async () => {
        const engine = new AutomationEngine(silent);
        await expect(engine.pullConnectorSource({ mapping: 'orders_pull' })).rejects.toMatchObject({
            code: 'SERVICE_UNAVAILABLE',
            status: 503,
        });
    });

    it('an attached executor receives the request as sent, and its answer comes back unchanged', async () => {
        const engine = new AutomationEngine(silent);
        const source = vi.fn(async () => RESULT);
        engine.setConnectorPullSource(source);

        const request = { mapping: 'orders_pull', context: { isSystem: true, tenantId: 'org_a' } };
        await expect(engine.pullConnectorSource(request)).resolves.toBe(RESULT);
        expect(source).toHaveBeenCalledWith(request);
    });

    it('a booted kernel\'s `automation` service reaches the plugin\'s executor — the door a job pull binds through', async () => {
        const plugin = new AutomationServicePlugin({ suspendedRunStore: 'memory' });
        const executor = vi.spyOn(plugin, 'pullConnectorSource').mockResolvedValue(RESULT as any);
        const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
        kernel.use(plugin);
        await kernel.bootstrap();
        try {
            const service = kernel.getService<IAutomationService>('automation');
            expect(typeof service.pullConnectorSource).toBe('function');

            const request = { mapping: 'orders_pull', context: { isSystem: true } };
            await expect(service.pullConnectorSource!(request)).resolves.toBe(RESULT);
            expect(executor).toHaveBeenCalledWith(request);
        } finally {
            await kernel.shutdown();
        }
    });
});
