// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15005 — `@objectstack/runtime` reads its collections out of `packages[]`
 * (ADR-0130 D4 / option B, ruled on #14512 comment 5528589044).
 *
 * The program's acceptance pin lives one package away
 * (`packages/cli/test/option-b-reader-acceptance.pin.test.ts`, #15004) because
 * it has to drive `@objectstack/cli` and `@objectstack/plugin-security` too.
 * This file is the runtime side's OWN regression cover, and it pins the two
 * things that pin cannot separate:
 *
 *   - the option-B shape is READ (a multi-package artifact whose collections
 *     live only under `packages[]` reaches every collector and the scheduler);
 *   - today's ADDITIVE shape is read exactly ONCE. That direction is the risk
 *     this change actually takes: `composeStacks(…, { manifest: 'preserve' })`
 *     emits every definition twice — flattened AND under `packages[]` — so a
 *     reader that simply concatenated both would register every action, hook,
 *     job and seed dataset twice on every multi-package artifact shipping
 *     today, and the acceptance pin's rows (`length > 0`) would not notice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';

import {
    AppPlugin,
    collectBundleActions,
    collectBundleFunctionEntries,
    collectBundleHooks,
} from './app-plugin.js';

const field = { name: 'name', type: 'text', label: 'Name' } as const;

/** The App half: an object carrying an EMBEDDED action, plus a seed dataset. */
const coreBody = () => ({
    id: 'com.test.optionb.core',
    name: 'Option-B Core',
    version: '1.0.0',
    type: 'app',
    objects: [{
        name: 'ob_account',
        label: 'Account',
        fields: { name: field },
        actions: [{
            name: 'ob_object_action',
            label: 'Object Action',
            objectName: 'ob_account',
            type: 'script',
            body: { language: 'js', source: 'return 1;' },
        }],
    }],
    data: [{ object: 'ob_account', mode: 'upsert', externalId: 'name', records: [{ name: 'seeded' }] }],
});

/** The module half: a global action, a hook, a declared function and a job. */
const ordersBody = () => ({
    id: 'com.test.optionb.orders',
    name: 'Option-B Orders',
    version: '1.0.0',
    type: 'module',
    dependencies: { 'com.test.optionb.core': '^1.0.0' },
    objects: [{ name: 'ob_order', label: 'Order', fields: { name: field } }],
    actions: [{ name: 'ob_global_action', label: 'Global Action', type: 'script', body: { language: 'js', source: 'return 1;' } }],
    hooks: [{
        name: 'ob_before_insert',
        label: 'Before Insert',
        object: 'ob_order',
        events: ['beforeInsert'],
        body: { language: 'js', source: 'return;' },
    }],
    jobs: [{ name: 'ob_nightly', label: 'Nightly', schedule: { type: 'cron', expression: '0 3 * * *', timezone: 'UTC' }, handler: 'obSweep' }],
});

const manifest = { id: 'com.test.optionb.core', name: 'Option-B Core', version: '1.0.0', type: 'app' };

/** `packages[]` carries every definition once; the top level carries none. */
const optionBBundle = (extra: Record<string, unknown> = {}) => ({
    manifest,
    packages: [{ manifest: ordersBody() }, { manifest: coreBody() }],
    ...extra,
});

/**
 * What the platform emits TODAY: the flattened top level AND `packages[]`, from
 * the same definitions. Built by flattening the same bodies, so a reader that
 * counted both copies reads double here.
 */
const additiveBundle = (extra: Record<string, unknown> = {}) => {
    const core = coreBody();
    const orders = ordersBody();
    return {
        manifest,
        objects: [...orders.objects, ...core.objects],
        actions: [...orders.actions],
        hooks: [...orders.hooks],
        jobs: [...orders.jobs],
        data: [...core.data],
        packages: [{ manifest: orders }, { manifest: core }],
        ...extra,
    };
};

describe('#15005 — runtime collectors resolve `packages[]`', () => {
    it('reads actions — global AND object-embedded — out of `packages[]`', () => {
        const names = collectBundleActions(optionBBundle()).map((a) => `${a.object ?? 'global'}:${a.name}`);
        // The embedded one is the widening #14512 comment 5523603341 measured:
        // it rides on `objects[]`, so it disappears with the top-level objects
        // array rather than with `actions`.
        expect(names.sort()).toEqual(['global:ob_global_action', 'ob_account:ob_object_action']);
    });

    it('reads hooks and declared functions out of `packages[]`', () => {
        expect(collectBundleHooks(optionBBundle()).map((h) => h.name)).toEqual(['ob_before_insert']);
        const declared = { obSweep: { handler: () => undefined, effect: 'writes' } };
        const entries = collectBundleFunctionEntries(
            optionBBundle({ packages: [{ manifest: { ...ordersBody(), functions: declared } }, { manifest: coreBody() }] }),
        );
        // The DECLARATION survives, not just the callable: an entry read back as
        // `effect: 'pure'` is #4396's silent un-declaring of a writer.
        expect(entries.obSweep?.effect).toBe('writes');
    });

    it('reads today\'s ADDITIVE artifact exactly once — no doubling', () => {
        expect(collectBundleActions(additiveBundle())).toHaveLength(2);
        expect(collectBundleHooks(additiveBundle())).toHaveLength(1);
    });

    it('is unchanged for a single-package bundle', () => {
        const single = { manifest, actions: [{ name: 'solo', label: 'Solo', type: 'script' }] };
        expect(collectBundleActions(single).map((a) => a.name)).toEqual(['solo']);
        expect(collectBundleHooks(single)).toEqual([]);
    });
});

describe('#15005 — AppPlugin schedules and hands out `packages[]` collections', () => {
    let scheduled: Array<{ name: string; run: (c: unknown) => Promise<unknown> }>;
    let readyHooks: Array<() => Promise<void>>;
    let ctx: PluginContext;
    let mappingRules: unknown[];

    beforeEach(() => {
        scheduled = [];
        readyHooks = [];
        mappingRules = [];
        ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => {
                if (name === 'job') {
                    return {
                        schedule: async (jobName: string, _s: unknown, run: (c: unknown) => Promise<unknown>) => {
                            scheduled.push({ name: jobName, run });
                            return { id: jobName };
                        },
                    };
                }
                if (name === 'objectql') {
                    return { setDatasourceMapping: (rules: unknown[]) => { mappingRules = rules; } };
                }
                return undefined;
            }),
            getServices: vi.fn(() => []),
            hook: vi.fn((event: string, cb: () => Promise<void>) => {
                if (event === 'kernel:ready') readyHooks.push(cb);
            }),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    });

    const fireReady = async () => { for (const cb of readyHooks) await cb(); };

    it('schedules a job declared in a package body, and its handler context carries the RESOLVED bundle', async () => {
        const sweep = vi.fn(async () => undefined);
        const plugin = new AppPlugin(optionBBundle({
            packages: [
                { manifest: { ...ordersBody(), functions: { obSweep: sweep } } },
                { manifest: coreBody() },
            ],
        }));

        await plugin.start!(ctx);
        await fireReady();

        expect(scheduled.map((s) => s.name)).toEqual(['ob_nightly']);

        // #14094 hands the handler `ctx.bundle` as its data reach. Reading
        // `bundle.objects` off the RAW option-B artifact answers `undefined`
        // with nothing thrown, so the resolved view is what is handed over.
        let handed: any;
        sweep.mockImplementation(async (jobCtx: any) => { handed = jobCtx.bundle; return undefined; });
        await scheduled[0].run({});
        expect(sweep).toHaveBeenCalledTimes(1);
        // Package order (`core` before `orders`, which depends on it), from
        // `resolveArtifactPackageOrder` — not the array's own order.
        expect(handed.objects.map((o: any) => o.name)).toEqual(['ob_account', 'ob_order']);
        // Envelope keys stay the caller's own references.
        expect(handed.manifest).toBe(manifest);
    });

    it('routes objects with a `datasourceMapping` declared in a package body', async () => {
        const rules = [{ datasource: 'ob_primary', default: true }];
        const plugin = new AppPlugin(optionBBundle({
            packages: [{ manifest: ordersBody() }, { manifest: { ...coreBody(), datasourceMapping: rules } }],
        }));

        await plugin.start!(ctx);

        expect(mappingRules).toEqual(rules);
    });
});
