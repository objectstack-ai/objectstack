// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0110 D5] The engine-owned governance inventory.
 *
 * The reconciliation itself is pinned by @objectstack/runtime's
 * action-reconciliation tests (through the back-compat wrapper). These pin
 * the REPORTING layer that moved here with it: that the inventory names the
 * orphans, that a clean registry stays silent, that duplicate findings are
 * fingerprint-suppressed across `metadata:reloaded` re-runs, and that a
 * failing declaration source degrades to a debug line instead of throwing —
 * a diagnostic must never be the reason a kernel fails to boot.
 */

import { describe, it, expect, vi } from 'vitest';
import { runActionGovernanceInventory } from './action-governance.js';

const makeLogger = () => ({ warn: vi.fn(), debug: vi.fn() });

const todoObjects = [{
    name: 'todo_task',
    actions: [{ name: 'complete_task', type: 'script', target: 'completeTask' }],
}];

describe('runActionGovernanceInventory (ADR-0110 D5)', () => {
    it('names a registered handler that no declaration addresses', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [
                { objectName: 'todo_task', actionName: 'completeTask' },
                { objectName: 'todo_task', actionName: 'ghostProbe' },
            ],
            objects: todoObjects,
            logger,
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/registered handlers with NO declaration/),
            expect.objectContaining({ count: 1, handlers: ['todo_task:ghostProbe'] }),
        );
    });

    it('names a declared script action bound to no handler', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [],
            objects: todoObjects,
            logger,
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/declared script actions with NO handler/),
            expect.objectContaining({ actions: ['todo_task:complete_task'] }),
        );
    });

    it('stays silent when both sides reconcile', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'todo_task', actionName: 'completeTask' }],
            objects: todoObjects,
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('folds standalone `action` items in, embedded declaration winning', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [
                { objectName: 'todo_task', actionName: 'completeTask' },
                { objectName: 'global', actionName: 'logCall' },
            ],
            objects: todoObjects,
            loadStandaloneActions: async () => [
                { name: 'log_call', type: 'script', target: 'logCall' }, // object-less
            ],
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('suppresses a byte-identical repeat via the fingerprint', async () => {
        const logger = makeLogger();
        const args = {
            registered: [{ objectName: 'todo_task', actionName: 'ghostProbe' }],
            objects: [] as any[],
            logger,
        };
        const fp = await runActionGovernanceInventory(args);
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // metadata:reloaded with nothing action-related changed → no repeat.
        await runActionGovernanceInventory({ ...args, lastFingerprint: fp });
        expect(logger.warn).toHaveBeenCalledTimes(1);

        // A CHANGED finding set logs again.
        await runActionGovernanceInventory({
            ...args,
            registered: [...args.registered, { objectName: 'todo_task', actionName: 'ghostProbe2' }],
            lastFingerprint: fp,
        });
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });

    it('degrades to debug when the declaration source throws — never throws itself', async () => {
        const logger = makeLogger();
        await expect(runActionGovernanceInventory({
            registered: [{ objectName: 'todo_task', actionName: 'x' }],
            // A poisoned objects array: property access explodes.
            objects: [new Proxy({}, { get() { throw new Error('boom'); } })],
            logger,
        })).resolves.toBeDefined();

        expect(logger.debug).toHaveBeenCalledWith(
            expect.stringMatching(/inventory skipped/),
            expect.objectContaining({ error: 'boom' }),
        );
    });
});
