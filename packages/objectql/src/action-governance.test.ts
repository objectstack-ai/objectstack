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
 *
 * The second describe block pins the router's registry rung. The measured
 * defect: on the in-process boot (`new AppPlugin(...)` then
 * `kernel.bootstrap()`), `meta.loadMany('action')` answers `[]` while
 * `registry.getItem('action', name)` answers the declaration, so every
 * object-LESS `defineAction` was named as a "registered handler with NO
 * declaration ... REFUSED at dispatch" in the same boot in which the router
 * resolved it at rung 2 and dispatched it. Pinned here: the two boots (the
 * registry holds it, the plane does not), both call forms (object-bound and
 * object-less), a positive control that must stay reported, the ownership
 * test that keeps the rung from clearing a foreign declaration, and the
 * second warning holding its exact wording while the first changes.
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

describe('runActionGovernanceInventory — the router registry rung (#14123)', () => {
    /** `registry.getItem('action', name)`, as the plugin injects it. */
    const registryOf = (items: Record<string, any>) => (name: string) => items[name];

    const applyAction = { name: 'duly_catalog_apply', type: 'script', locations: [] };

    it('clears an object-LESS declaration the registry holds and the plane does not', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
            objects: [],                              // no object embeds it
            loadStandaloneActions: async () => [],    // in-process boot: the plane is empty
            lookupRegistryAction: registryOf({ duly_catalog_apply: applyAction }),
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('clears an object-BOUND declaration the registry holds and the plane does not', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'todo_task', actionName: 'archive_task' }],
            objects: [{ name: 'todo_task', actions: [] }],
            loadStandaloneActions: async () => [],
            lookupRegistryAction: registryOf({
                archive_task: { name: 'archive_task', objectName: 'todo_task', type: 'script' },
            }),
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL — a handler no source declares is still named', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [
                { objectName: 'global', actionName: 'duly_catalog_apply' },
                { objectName: 'global', actionName: 'ghostProbe' },
                { objectName: 'todo_task', actionName: 'ghostBound' },
            ],
            objects: [{ name: 'todo_task', actions: [] }],
            loadStandaloneActions: async () => [],
            lookupRegistryAction: registryOf({ duly_catalog_apply: applyAction }),
            logger,
        });

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/registered handlers with NO declaration/),
            expect.objectContaining({ count: 2, handlers: ['global:ghostProbe', 'todo_task:ghostBound'] }),
        );
    });

    it('applies the router ownership test — a foreign object-bound item does not cover the route', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'todo_task', actionName: 'archive_task' }],
            objects: [{ name: 'todo_task', actions: [] }],
            lookupRegistryAction: registryOf({
                archive_task: { name: 'archive_task', objectName: 'crm_lead', type: 'script' },
            }),
            logger,
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/registered handlers with NO declaration/),
            expect.objectContaining({ handlers: ['todo_task:archive_task'] }),
        );
    });

    it('stops asserting a dispatch outcome it did not check, and names the sources it did read', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'ghostProbe' }],
            objects: [],
            logger,
        });

        const [message] = logger.warn.mock.calls[0];
        expect(message).not.toMatch(/REFUSED at dispatch/);
        expect(message).not.toMatch(/there is no opt-out/);
        expect(message).not.toMatch(/drop the registration/);
        expect(message).toMatch(/it did not dispatch/);
        expect(message).toMatch(/object-embedded `actions\[\]`/);
        expect(message).toMatch(/the engine registry standalone `action` items/);
        expect(message).toMatch(/the metadata service `action` rows/);
    });

    it('leaves the OTHER warning byte-identical — a registry item is not folded into the declaration set', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [],
            objects: todoObjects,
            lookupRegistryAction: registryOf({
                // A registry-only script declaration with no handler anywhere. It must
                // not join `unboundDeclarations`: the router never enumerates the
                // registry, so neither does this audit.
                orphan_action: { name: 'orphan_action', type: 'script', target: 'orphanHandler' },
            }),
            logger,
        });

        expect(logger.warn).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            '[action-governance] declared script actions with NO handler — a button wired to '
            + 'nothing (ADR-0078); add a `body`, or register a handler under the declared `target`',
            { count: 1, actions: ['todo_task:complete_task'] },
        );
    });

    it('keeps the handler when the registry lookup throws — and never throws itself', async () => {
        const logger = makeLogger();
        await expect(runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
            objects: [],
            lookupRegistryAction: () => { throw new Error('registry unreadable'); },
            logger,
        })).resolves.toBeDefined();

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/registered handlers with NO declaration/),
            expect.objectContaining({ handlers: ['global:duly_catalog_apply'] }),
        );
    });

    it('fingerprints the FILTERED set, so a rung-cleared boot reports and remembers nothing', async () => {
        const logger = makeLogger();
        const fp = await runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
            objects: [],
            lookupRegistryAction: registryOf({ duly_catalog_apply: applyAction }),
            logger,
        });

        expect(fp).toBe('');
        expect(logger.warn).not.toHaveBeenCalled();

        // The declaration disappears on a later reload: the finding is new, so it reports.
        await runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
            objects: [],
            lookupRegistryAction: registryOf({}),
            logger,
            lastFingerprint: fp,
        });

        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('is unchanged when no rung is injected — two sources, and the finding stands', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'global', actionName: 'duly_catalog_apply' }],
            objects: [],
            logger,
        });

        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringMatching(/registered handlers with NO declaration/),
            expect.objectContaining({ handlers: ['global:duly_catalog_apply'] }),
        );
    });
});
