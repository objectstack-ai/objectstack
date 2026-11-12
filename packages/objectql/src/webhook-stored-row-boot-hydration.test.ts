// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31699 PR 2 round 2, R2-B] How a stored webhook row reaches the registry at
 * boot, for one holder and two.
 *
 * The metadata boot priming pass never reads a webhook row: it walks
 * `DEFAULT_METADATA_TYPE_REGISTRY`, which lists no webhook
 * (`database-loader.test.ts`, the #32458 CONTROL). The path that does is the
 * protocol's boot hydration, `loadMetaFromDb` (`ObjectQLPlugin.start()`),
 * which hands every environment row of every type to
 * `hydrateOverlayIntoRegistry`, and so to `registerItem` under the row's
 * package. The declared-webhook reader dispatches each holder's
 * `getPackageScopedItem` (`declared-webhooks.test.ts`), so the slot a row lands
 * in is the declaration that holder's events are sent with.
 *
 * Measured the same with and without this PR's type-set flips: a row naming a
 * holder lands in that holder's slot and in no other. A webhook overlay of a
 * shipped declaration is sealed (ADR-0131 D6), so such a row is residue an
 * older release stored, and the boot census names it with its remedy.
 *
 * The harness is the one `protocol.hydrate-overlay-canonical-type.test.ts`
 * uses: an engine double answering `find` over the stored rows, with the real
 * `SchemaRegistry` and the real `ObjectStackProtocolImplementation`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';

const A = 'com.acme.alpha';
const B = 'com.acme.beta';
const T = 'task_changed';
const hook = (url: string) => ({ name: T, label: 'Task changed', object: 'showcase_task', triggers: ['create'], url });
const shipped = (id: string) => `https://hooks.example/${id.split('.').pop()}`;

/** The registry with each id installed as a code package declaring {@link T}, in this order. */
function registryShipping(ids: string[]): SchemaRegistry {
    const registry = new SchemaRegistry();
    registry.logLevel = 'silent';
    for (const id of ids) {
        registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
        registry.registerItem('webhook', hook(shipped(id)), 'name' as never, id);
    }
    return registry;
}

/** The boot hydration over `rows` (stored environment rows of {@link T}), then each holder's slot. */
async function hydrate(ids: string[], rows: Array<{ packageId: string | null; url: string }>) {
    const registry = registryShipping(ids);
    const stored = rows.map((r, i) => ({
        id: `row_${i}`, type: 'webhook', name: T, organization_id: null, package_id: r.packageId, state: 'active',
        metadata: JSON.stringify(hook(r.url)),
    }));
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const where = opts?.where ?? {};
            const rows = stored.filter((r) => Object.entries(where).every(([k, v]) => v === undefined || (r as any)[k] === v));
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
        },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query);
            return null;
        },
        registry,
    };
    const load = await new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_prod').loadMetaFromDb();
    const slot = (id: string) => (registry.getPackageScopedItem('webhook', T, id) as { url?: string } | undefined)?.url;
    return {
        load,
        holders: [...registry.packageScopedHoldersOf('webhook', T)].sort(),
        environment: registry.getEnvironmentScopedItem('webhook', T),
        slots: Object.fromEntries(ids.map((id) => [id, slot(id)])),
    };
}

describe('a stored webhook row at boot: loadMetaFromDb registers it in its own holder\'s slot (#31699 R2-B)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); });

    it('CONTROL — one holder: a row naming it, or naming no package (D8), is its slot; no environment holder appears', async () => {
        for (const packageId of [A, null]) {
            const got = await hydrate([A], [{ packageId, url: 'https://stored.example/row' }]);
            expect(got.load).toMatchObject({ loaded: 1, errors: 0 });
            expect([got.holders, got.environment, got.slots], String(packageId)).toEqual([[A], undefined, { [A]: 'https://stored.example/row' }]);
        }
        // The boot census names the sealed residue row (ADR-0131 D6).
        expect(warn.mock.calls.some((call: unknown[]) => String(call[0]).includes('metadata_sealed_overlay_unserved'))).toBe(true);
    });

    for (const order of [[A, B], [B, A]]) {
        it(`two holders (${order[0] === A ? 'alpha' : 'beta'} first): a row naming one holder is that holder's slot, and the other keeps its declaration`, async () => {
            for (const [own, other] of [[A, B], [B, A]]) {
                const got = await hydrate(order, [{ packageId: own, url: 'https://stored.example/row' }]);
                expect(got.load).toMatchObject({ loaded: 1, errors: 0 });
                expect([got.holders, got.environment], own).toEqual([[A, B], undefined]);
                expect(got.slots, own).toEqual({ [own]: 'https://stored.example/row', [other]: shipped(other) });
            }
        });
    }
});
