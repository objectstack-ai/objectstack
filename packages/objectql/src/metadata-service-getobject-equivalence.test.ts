// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Conformance pin — `getObject(name)` ≡ `get('object', name)` (#6745).
 *
 * `IMetadataService.getObject` (`packages/spec/src/contracts/metadata-service.ts`)
 * DECLARES that the pair resolves through one lookup in every implementation this
 * repo ships, and that both members hand back the identical object. PR #6723 (for
 * #6505) wrote that down after measuring it with a throwaway probe, which left the
 * statement declared-but-ungated: nothing failed if a later edit made the pair
 * diverge, and the contract TSDoc would then simply be lying. This file is the gate.
 *
 * `packages/objectql` is the only package that can see all three implementations —
 * it depends on both `@objectstack/metadata` (MetadataManager) and
 * `@objectstack/core` (createMemoryMetadata), and owns MetadataFacade itself.
 * `packages/spec` cannot host it: the contract has no runtime.
 *
 * Two things about the shape here are load-bearing, and both are the difference
 * between this pin and a green-but-empty one:
 *
 * 1. **The facade is seeded through `registry.registerObject`, never through
 *    `facade.register('object', …)`.** Those are not interchangeable: the facade
 *    writes objects through `SchemaRegistry.registerItem`, which stores into the
 *    generic `metadata` map, while BOTH of its object reads resolve from
 *    `objectContributors` (`registry.getItem` special-cases the `object` type
 *    straight back to `registry.getObject`). An object written the first way is
 *    readable back through neither member — measured, both `undefined` — so a pin
 *    that seeded that way would compare `undefined` to `undefined` and call it
 *    equivalence. That write/read split is a separate, already-filed finding
 *    (#6725); this file deliberately does not assert on it, and the
 *    `expect(...).toBeDefined()` in the present-object case is what stops the
 *    vacuous version from ever passing here again.
 *
 * 2. **MetadataManager appears twice, under both of its resolution paths.** Its
 *    `get` answers from the in-memory registry when it can and falls back to the
 *    loaders otherwise; `getObject` delegates to `get`, so a future edit that
 *    re-implemented `getObject` against the registry alone would still agree on
 *    every registry-seeded case and diverge only on a loader-backed one. Seeding
 *    one subject through each path is what makes that break visible.
 *
 * Reference identity (`toBe`), not deep equality, is the assertion because
 * identity is what each implementation's mechanism actually delivers today —
 * measured on all four subjects, on both call orders — and it is what the contract
 * claims. `MetadataManager.getObject` literally returns `this.get('object', name)`;
 * `createMemoryMetadata` reads one `Map` from both members; the facade's two paths
 * converge on `SchemaRegistry.getObject`, whose merge result is memoized in
 * `mergedObjectCache`, so both members hand back the same instance.
 *
 * Refs #6745, #6505, PR #6723, #6725.
 */

import { describe, it, expect } from 'vitest';
import type { IMetadataService } from '@objectstack/spec/contracts';
import { SchemaRegistry } from './registry';
import { MetadataFacade } from './metadata-facade';
import { MetadataManager, type MetadataLoader } from '@objectstack/metadata';
import { createMemoryMetadata } from '@objectstack/core';

/**
 * The two contract members under test, and nothing else. Typing the subjects
 * against `IMetadataService` rather than against the concrete classes is
 * deliberate: it is the contract's declaration this file is pinning, so a
 * signature change on either member should reach this file through `tsc`.
 */
type ObjectResolvingService = Pick<IMetadataService, 'get' | 'getObject'>;

interface ObjectFixture {
    readonly name: string;
    readonly definition: Record<string, unknown>;
}

const objectFixture = (name: string): ObjectFixture => ({
    name,
    definition: {
        name,
        label: name.replace(/_/g, ' '),
        fields: { title: { type: 'text', label: 'Title' } },
    },
});

/**
 * A shipped implementation plus the seeding channel ITS OWN object reads observe.
 * The channel is part of the subject, not an incidental detail — see note 1 in
 * the file header.
 */
interface PinnedImplementation {
    readonly label: string;
    create(objects: readonly ObjectFixture[]): Promise<ObjectResolvingService>;
}

/** Minimal read-only loader, so MetadataManager's loader-fallback path is real. */
class FixtureLoader implements MetadataLoader {
    readonly contract: MetadataLoader['contract'] = {
        name: 'getobject-equivalence-fixture',
        protocol: 'memory:',
        capabilities: { read: true, write: false, watch: false, list: true },
    };

    private readonly storage = new Map<string, unknown>();

    constructor(objects: readonly ObjectFixture[]) {
        for (const object of objects) {
            this.storage.set(object.name, object.definition);
        }
    }

    async load(type: string, name: string) {
        const data = type === 'object' ? this.storage.get(name) : undefined;
        return data
            ? { data, source: this.contract.name, format: 'json' as const, loadTime: 0 }
            : { data: null };
    }

    async loadMany<T = unknown>(type: string): Promise<T[]> {
        return (type === 'object' ? Array.from(this.storage.values()) : []) as T[];
    }

    async exists(type: string, name: string): Promise<boolean> {
        return type === 'object' && this.storage.has(name);
    }

    async stat() {
        return null;
    }

    async list(type: string): Promise<string[]> {
        return type === 'object' ? Array.from(this.storage.keys()) : [];
    }
}

const IMPLEMENTATIONS: readonly PinnedImplementation[] = [
    {
        // `get` answers from the in-memory registry on this one.
        label: 'MetadataManager (registry hit)',
        async create(objects) {
            const manager = new MetadataManager({ formats: ['json'], loaders: [] });
            for (const object of objects) {
                await manager.register('object', object.name, object.definition);
            }
            return manager;
        },
    },
    {
        // Nothing is registered, so `get` can only answer through the loaders —
        // the second of MetadataManager's two resolution paths.
        label: 'MetadataManager (loader fallback)',
        async create(objects) {
            return new MetadataManager({ formats: ['json'], loaders: [new FixtureLoader(objects)] });
        },
    },
    {
        label: 'createMemoryMetadata',
        async create(objects) {
            const memory = createMemoryMetadata();
            for (const object of objects) {
                await memory.register('object', object.name, object.definition);
            }
            return memory;
        },
    },
    {
        label: 'MetadataFacade',
        async create(objects) {
            const registry = new SchemaRegistry({ multiTenant: false });
            for (const object of objects) {
                // NOT `facade.register('object', …)` — that writes where neither of
                // the facade's object reads look (#6725), which would make the
                // present-object case below compare undefined to undefined.
                registry.registerObject(object.definition as never, 'com.example.pin');
            }
            return new MetadataFacade(registry);
        },
    },
];

describe.each(IMPLEMENTATIONS)(
    'IMetadataService conformance — getObject(n) ≡ get(\'object\', n) [$label]',
    ({ create }) => {
        it('answers a present object identically through both members', async () => {
            const alpha = objectFixture('pin_alpha');
            const service = await create([alpha]);

            const viaGetObject = await service.getObject(alpha.name);
            const viaGet = await service.get('object', alpha.name);

            // Anti-vacuity: without this, a subject that resolved NOTHING would
            // satisfy the equivalence below by answering undefined twice.
            expect(viaGetObject).toBeDefined();
            expect((viaGetObject as { name?: string }).name).toBe(alpha.name);

            expect(viaGetObject).toBe(viaGet);
        });

        it('answers undefined through both members for an object nothing registered', async () => {
            const service = await create([objectFixture('pin_alpha')]);

            const viaGetObject = await service.getObject('pin_absent');
            const viaGet = await service.get('object', 'pin_absent');

            expect(viaGetObject).toBeUndefined();
            expect(viaGet).toBeUndefined();
        });

        it('keeps the pair name-discriminating when several objects are registered', async () => {
            const alpha = objectFixture('pin_alpha');
            const beta = objectFixture('pin_beta');
            const service = await create([alpha, beta]);

            const alphaViaGetObject = await service.getObject(alpha.name);
            const alphaViaGet = await service.get('object', alpha.name);
            const betaViaGetObject = await service.getObject(beta.name);
            const betaViaGet = await service.get('object', beta.name);

            expect(alphaViaGetObject).toBeDefined();
            expect(betaViaGetObject).toBeDefined();

            expect(alphaViaGetObject).toBe(alphaViaGet);
            expect(betaViaGetObject).toBe(betaViaGet);

            // A member that ignored `name` and returned the first object would
            // agree with itself on every case above; it cannot survive this one.
            expect(alphaViaGetObject).not.toBe(betaViaGetObject);
            expect((alphaViaGetObject as { name?: string }).name).toBe(alpha.name);
            expect((betaViaGetObject as { name?: string }).name).toBe(beta.name);
        });
    },
);
