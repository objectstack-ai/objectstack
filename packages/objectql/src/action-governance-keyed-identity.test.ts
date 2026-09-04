// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14423 — the audit and the router, defined on ONE identity and ONE set of
 * sources.
 *
 * ---------------------------------------------------------------------------
 * The two disagreements this pins shut
 * ---------------------------------------------------------------------------
 * The D5 bijection has two halves, and each could contradict the router for
 * its own reason:
 *
 *  - IDENTITY. The declaration half enumerated the metadata plane with
 *    `loadMany` and keyed the result by `body.name`. A body is not required to
 *    name itself (#14205: identity is the key the STORE holds the item under),
 *    so a `sys_metadata` row keyed by its `name` COLUMN, or a
 *    `FilesystemLoader` file whose identity is its path, came back UNNAMED and
 *    was dropped — while the router, resolving the same row BY NAME through
 *    `loadDiagnosed`, served it and dispatched. The audit then printed
 *    "registered handler with NO declaration" about a working route.
 *
 *  - AVAILABILITY. The handler half rested on that same plural read. A loader
 *    fault is SWALLOWED by a plural read and INVISIBLE to a by-name read, so
 *    one unreachable loader turned every handler it declares into an
 *    accusation, in a run that reported nothing else wrong.
 *
 * Both are closed the same way: mirror the router. The declaration half
 * enumerates KEYED (`loadStandaloneActionsKeyed`), the handler half asks BY
 * NAME (`lookupMetadataAction`, the router's third rung, injected exactly like
 * its second).
 *
 * ---------------------------------------------------------------------------
 * The population change, and its BEFORE
 * ---------------------------------------------------------------------------
 * `unboundDeclarations` gains the rows the old keying dropped. Its BEFORE is
 * ZERO and STRUCTURALLY so — not sampled: a nameless row never reached the
 * reconciliation at all, so it could not be reported as unbound however many
 * of them a plane held. The first block below pins both directions of that in
 * one pair of cases.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Ordinary red. Reverting the keyed source (dropping `loadStandaloneActionsKeyed`
 * so `collectEngineActionDeclarations` reads `loadMany` again) reds the
 * identity block; reverting the by-name rung (dropping `lookupMetadataAction`)
 * reds the availability block. Each control case — the ones asserting a
 * handler IS still named — must stay GREEN through both reversions, because a
 * fix that silences the audit everywhere would pass a suite that only checked
 * the accusations disappearing. The measured outcome is in the PR body.
 */

import { describe, it, expect, vi } from 'vitest';
import { runActionGovernanceInventory, collectEngineActionDeclarations } from './action-governance.js';

const makeLogger = () => ({ warn: vi.fn(), debug: vi.fn() });

/** The name under test and the object key an object-less action registers on. */
const ACTION = 'promote_lead';
const GLOBAL = 'global';

/** A body that does NOT name itself — its identity is the store's key. */
const namelessBody = { type: 'script', target: ACTION };

/** `registry.getItem('action', name)` / `meta.load…('action', name)`, as injected. */
const byName = (items: Record<string, unknown>) => (name: string) => items[name];

const undeclaredWarning = (logger: ReturnType<typeof makeLogger>) =>
    logger.warn.mock.calls.find(([m]) => typeof m === 'string' && m.includes('registered handlers with NO declaration'));

const unboundWarning = (logger: ReturnType<typeof makeLogger>) =>
    logger.warn.mock.calls.find(([m]) => typeof m === 'string' && m.includes('declared script actions with NO handler'));

describe('#14423 identity — the declaration half reads the plane KEYED', () => {
    it('BEFORE, structurally: through the UNKEYED read a nameless row is not a declaration at all', async () => {
        // Not a sampled zero. The row never reaches reconciliation, so neither
        // finding can mention it — it cannot be cleared, and it cannot be
        // reported as unbound.
        const declarations = await collectEngineActionDeclarations([], async () => [namelessBody]);
        expect(declarations).toEqual([]);

        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActions: async () => [namelessBody],
            logger,
        });

        // The defect: a handler the router serves from this very row, accused.
        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ handlers: [`${GLOBAL}:${ACTION}`] });
    });

    it('AFTER: the keyed read names it by the STORE key, and the accusation is gone', async () => {
        const declarations = await collectEngineActionDeclarations(
            [], undefined, async () => [{ name: ACTION, data: namelessBody }]);
        expect(declarations).toEqual([{ action: namelessBody, objectName: GLOBAL, storeKey: ACTION }]);

        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [{ name: ACTION, data: namelessBody }],
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('the ruled population change: a nameless row with NO handler now REACHES `unboundDeclarations`', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [],                            // nothing handles it
            objects: [],
            loadStandaloneActionsKeyed: async () => [{ name: ACTION, data: { type: 'script' } }],
            logger,
        });

        // Named by its store key — the only identity it has.
        expect(unboundWarning(logger)?.[1]).toMatchObject({ count: 1, actions: [`${GLOBAL}:${ACTION}`] });
    });

    it("a body that DOES name itself keeps its own name; the store key stays addressable beside it", async () => {
        // The router resolves `/actions/global/<store key>` by that key and then
        // derives handler keys from what came back, so both are addressable.
        const body = { name: 'declared_name', type: 'script' };
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: 'row_key' }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [{ name: 'row_key', data: body }],
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('the keyed source REPLACES the unkeyed one — the guess is not re-admitted alongside it', async () => {
        const declarations = await collectEngineActionDeclarations(
            [],
            async () => [{ name: 'from_unkeyed', type: 'script' }],
            async () => [{ name: ACTION, data: namelessBody }],
        );

        expect(declarations.map((d) => d.storeKey)).toEqual([ACTION]);
        expect(declarations.some((d) => (d.action as any)?.name === 'from_unkeyed')).toBe(false);
    });

    it('an object-embedded declaration still wins over a keyed standalone of the same identity', async () => {
        const embedded = { name: ACTION, type: 'script', target: 'embedded_handler' };
        const declarations = await collectEngineActionDeclarations(
            [{ name: GLOBAL, actions: [embedded] }],
            undefined,
            async () => [{ name: ACTION, data: namelessBody }],
        );

        expect(declarations).toEqual([{ action: embedded, objectName: GLOBAL }]);
    });

    it('a keyed source that throws degrades to "no standalone source", never to a boot failure', async () => {
        const logger = makeLogger();
        await expect(runActionGovernanceInventory({
            registered: [],
            objects: [],
            loadStandaloneActionsKeyed: async () => { throw new Error('plane unreachable'); },
            logger,
        })).resolves.toBeDefined();

        expect(logger.warn).not.toHaveBeenCalled();
    });
});

describe('#14423 availability — the handler half asks the plane BY NAME (the router\'s third rung)', () => {
    it("the defect, as an assertion: a swallowed loader fault turns a served handler into an accusation", async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            // The plural read swallowed the fault and answered short...
            loadStandaloneActionsKeyed: async () => [],
            lookupRegistryAction: () => undefined,
            logger,
        });

        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ handlers: [`${GLOBAL}:${ACTION}`] });
    });

    it('...and the by-name rung, which the same fault is invisible to, clears it', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [],   // enumeration: nothing
            lookupRegistryAction: () => undefined,
            lookupMetadataAction: byName({ [ACTION]: { name: ACTION, type: 'script' } }), // by name: SERVED
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('POSITIVE CONTROL — with all three rungs wired, a handler nothing declares is still named', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [
                { objectName: GLOBAL, actionName: ACTION },
                { objectName: GLOBAL, actionName: 'ghost_probe' },
            ],
            objects: [],
            loadStandaloneActionsKeyed: async () => [],
            lookupRegistryAction: () => undefined,
            lookupMetadataAction: byName({ [ACTION]: { name: ACTION, type: 'script' } }),
            logger,
        });

        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ count: 1, handlers: [`${GLOBAL}:ghost_probe`] });
    });

    it('CONSERVATIVE — a probe that throws leaves the handler ON the list', async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [],
            lookupMetadataAction: () => { throw new Error('metadata plane unreadable'); },
            logger,
        });

        // The audit may over-report a broken source; it must never clear a
        // handler on the strength of an answer it could not read.
        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ handlers: [`${GLOBAL}:${ACTION}`] });
    });

    it("one rung's failure does not suppress the other rung's answer", async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [],
            lookupRegistryAction: () => { throw new Error('registry unreadable'); },
            lookupMetadataAction: byName({ [ACTION]: { name: ACTION, type: 'script' } }),
            logger,
        });

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it("applies the router's ownership test — a foreign object-bound declaration does not cover the route", async () => {
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: 'todo_task', actionName: 'archive_task' }],
            objects: [{ name: 'todo_task', actions: [] }],
            lookupMetadataAction: byName({
                archive_task: { name: 'archive_task', objectName: 'crm_lead', type: 'script' },
            }),
            logger,
        });

        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ handlers: ['todo_task:archive_task'] });
    });

    it('COST — the by-name rungs are bounded by the accusation list, not the population', async () => {
        const probed: string[] = [];
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [
                { objectName: GLOBAL, actionName: ACTION },
                { objectName: GLOBAL, actionName: 'ghost_probe' },
            ],
            objects: [],
            // The enumeration already accounts for one of the two handlers.
            loadStandaloneActionsKeyed: async () => [{ name: ACTION, data: namelessBody }],
            lookupMetadataAction: (name: string) => { probed.push(name); return undefined; },
            logger,
        });

        // One `findOne`-equivalent, for the one handler still unaccounted for
        // — not one per declared action. A clean composition probes NOTHING.
        expect(probed).toEqual(['ghost_probe']);
        expect(undeclaredWarning(logger)?.[1]).toMatchObject({ handlers: [`${GLOBAL}:ghost_probe`] });
    });

    it('a clean composition runs ZERO by-name probes', async () => {
        const probed: string[] = [];
        const logger = makeLogger();
        await runActionGovernanceInventory({
            registered: [{ objectName: GLOBAL, actionName: ACTION }],
            objects: [],
            loadStandaloneActionsKeyed: async () => [{ name: ACTION, data: namelessBody }],
            lookupRegistryAction: (name: string) => { probed.push(`registry:${name}`); return undefined; },
            lookupMetadataAction: (name: string) => { probed.push(`meta:${name}`); return undefined; },
            logger,
        });

        expect(probed).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
    });
});
