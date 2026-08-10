// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `METADATA_ROUNDTRIP_CASES` driver #2 — every `IMetadataService` this repo
 * SHIPS (#7223).
 *
 * The table lives in `@objectstack/spec`
 * (`contracts/metadata-service-roundtrip-conformance.ts`) together with the
 * reference answers and the argument for why it exists; this file is the thin
 * driver that replays it against real implementations. Read the table's header
 * first — in particular what `expected` does and does not claim.
 *
 * `packages/objectql` hosts it because it is the only package that can see all
 * three implementations at once: it depends on `@objectstack/metadata`
 * (`MetadataManager`) and `@objectstack/core` (`createMemoryMetadata`) and owns
 * `MetadataFacade`. That is the same argument
 * `metadata-service-getobject-equivalence.test.ts` (#6745) already makes for
 * living here, and it is why `packages/spec` cannot host this half.
 *
 * ## The four subjects, and why four for three implementations
 *
 * `MetadataManager` appears twice. Its `register` writes the in-memory registry
 * AND persists to every `datasource:` loader that declares write capability, so
 * a subject with no loaders never executes the second half. The writable-loader
 * subject is the one that would notice a `register` that threw, silently
 * skipped, or mutated the document on the way to `loader.save`.
 *
 * ## Two assertion strengths, declared per subject
 *
 * `documentFidelity` says whether a subject hands back the document it was
 * given. `MetadataManager` and `createMemoryMetadata` store and return the very
 * reference (`verbatim`), so they are held to exact equality. `MetadataFacade`
 * resolves objects through `SchemaRegistry`, which answers the RUNTIME-EFFECTIVE
 * object — system fields (`organization_id`, `created_at`, …) injected,
 * extensions merged — and copies non-object documents while filling in `name`.
 * `toEqual(input)` is therefore the wrong assertion for it, exactly as #7223
 * predicted; it is held to a recursive-subset match plus every key/visibility
 * assertion the others get. The weaker match is scoped to the ONE subject that
 * needs it rather than applied to the whole table.
 *
 * ## Divergences are PINNED, not resolved
 *
 * Three cases get different answers from `MetadataFacade` than from the other
 * implementations and the contract's reference double. Each is recorded below
 * as a `// DIVERGENCE` entry stating the measured behaviour — this file asserts
 * what each implementation does TODAY and changes no shipped behaviour. Which
 * answer is correct is a separate ruling, filed as its own card (see the
 * per-divergence notes). If you are here because one of these tests failed
 * after a behaviour change: that is the pin working. Update it in the PR that
 * makes the ruling, not silently.
 *
 * Refs #7223, #6725, PR #7211, #6745.
 */

import { describe, it, expect } from 'vitest';
import {
    METADATA_ROUNDTRIP_CASES,
    type MetadataRoundTripCase,
    type IMetadataService,
} from '@objectstack/spec/contracts';
import { SchemaRegistry } from './registry';
import { MetadataFacade } from './metadata-facade';
import { MetadataManager, type MetadataLoader } from '@objectstack/metadata';
import { createMemoryMetadata } from '@objectstack/core';

/**
 * The members the table exercises, and nothing else. Typed against the contract
 * rather than the concrete classes on purpose: a signature change on any of the
 * four should reach this file through `tsc`.
 */
type RoundTrippingService = Pick<IMetadataService, 'register' | 'get' | 'exists' | 'listNames' | 'unregister'>;

/**
 * How a subject answers a `readable` row.
 *
 * - `verbatim` — `get` returns the document `register` was handed. Asserted
 *   with exact equality.
 * - `runtime-effective` — `get` returns a derived document that CONTAINS the
 *   authored one. Asserted as a recursive subset.
 */
type DocumentFidelity = 'verbatim' | 'runtime-effective';

/**
 * A per-subject answer that differs from the table's reference answer.
 * `readable-as-last-write` means "the document the case's final write carried".
 */
type DivergentAnswer =
    | { readonly kind: 'absent'; readonly note: string }
    | { readonly kind: 'readable-as-last-write'; readonly note: string };

interface PinnedImplementation {
    readonly label: string;
    readonly documentFidelity: DocumentFidelity;
    /** Keyed by {@link MetadataRoundTripCase.id}. Every key is checked to exist. */
    readonly divergences?: Readonly<Record<string, DivergentAnswer>>;
    create(): RoundTrippingService;
}

/**
 * A minimal writable `datasource:` loader, so `MetadataManager.register`'s
 * persistence half actually runs. `save` AND `delete` are both required by
 * `assertWritableLoaderContract` — the sole gate into `MetadataManager`'s
 * loader map.
 */
class WritableFixtureLoader implements MetadataLoader {
    readonly contract: MetadataLoader['contract'] = {
        name: 'roundtrip-conformance-writable',
        protocol: 'datasource:',
        capabilities: { read: true, write: true, watch: false, list: true },
    };

    private readonly storage = new Map<string, unknown>();

    /**
     * NUL as the type/name separator, written as an escape rather than as a
     * literal byte -- a literal one makes git treat this file as binary and
     * trips `check:nul-bytes`. Neither a metadata type nor a name can contain
     * one, so no two distinct pairs can collide on a single key the way they
     * could with a `:` or `/` separator.
     */
    private key(type: string, name: string): string {
        return `${type}\u0000${name}`;
    }

    async save(type: string, name: string, data: unknown): Promise<void> {
        this.storage.set(this.key(type, name), data);
    }

    async delete(type: string, name: string): Promise<void> {
        this.storage.delete(this.key(type, name));
    }

    async load(type: string, name: string) {
        const data = this.storage.get(this.key(type, name));
        return data === undefined
            ? { data: null }
            : { data, source: this.contract.name, format: 'json' as const, loadTime: 0 };
    }

    async loadMany<T = unknown>(type: string): Promise<T[]> {
        return this.entriesOfType(type).map(([, value]) => value) as T[];
    }

    async exists(type: string, name: string): Promise<boolean> {
        return this.storage.has(this.key(type, name));
    }

    async stat() {
        return null;
    }

    async list(type: string): Promise<string[]> {
        return this.entriesOfType(type).map(([key]) => key.slice(type.length + 1));
    }

    private entriesOfType(type: string): Array<[string, unknown]> {
        return Array.from(this.storage.entries()).filter(([key]) => key.startsWith(`${type}\u0000`));
    }
}

/**
 * ── DIVERGENCE 1 — the effective key is `data.name`, not the `name` argument ──
 *
 * Cases `key-is-the-name-argument-object` / `-nonobject`.
 *
 * `MetadataFacade.register` opens with
 * `{ ...data, name: data.name ?? name }` and then hands the DOCUMENT to
 * `SchemaRegistry.registerObject` / `registerItem`, which key on the document's
 * own `name`. The `name` argument is therefore only a fallback for a document
 * that carries none: when the two disagree, the item lands under `data.name`
 * and `get(type, <the name that was passed>)` answers `undefined`, `exists`
 * answers `false`, and `listNames` reports the other spelling. Measured on both
 * an object-typed and a view-typed write.
 *
 * `MetadataManager` and `createMemoryMetadata` both key on the argument, as does
 * the contract's reference double. The contract TSDoc names the parameter on
 * both members (`@param name - Item name/identifier (snake_case)`) and says
 * nothing about `data.name`, so nothing in-tree currently RULES which is right —
 * which is why this is pinned as measured and filed, not fixed here.
 */
const DIVERGENCE_1 = 'MetadataFacade keys on `data.name` when it disagrees with the `name` argument; the other implementations key on the argument. Pinned as measured (#7223).';

/**
 * ── DIVERGENCE 2 — the plural `objects` type is aliased to `object` ──
 *
 * Case `plural-objects-type-is-its-own-store`.
 *
 * `MetadataFacade`'s `isObjectType` treats `'object'` and `'objects'` as the
 * same type on the WRITE side (deliberately, per its header: #6725 left the
 * plural with the same read/write split the singular had). The consequence this
 * case measures is on the READ side: a `register('objects', n, …)` is visible
 * through `get('object', n)`, `exists('object', n)` and `listNames('object')`.
 *
 * `MetadataManager` and `createMemoryMetadata` key their type stores on the
 * string they are handed, so the two spellings are two stores and the item is
 * invisible under the singular.
 */
const DIVERGENCE_2 = 'MetadataFacade aliases the plural `objects` type to `object`; the other implementations keep one store per type string. Pinned as measured (#7223).';

/**
 * ── DIVERGENCE 3 — a non-object `data` value is dropped ──
 *
 * Case `primitive-data-roundtrips`.
 *
 * The contract declares `data: unknown`. `MetadataFacade.register` passes a
 * non-object value through unchanged (its `{ ...data }` branch is guarded on
 * `typeof data === 'object' && data !== null`) and then registers it under the
 * document's own `name` — which a string does not have. The write is ACCEPTED
 * (no throw), the registry logs `Registered setting: undefined`, and the value
 * is readable back through nothing: `get` answers `undefined`, `exists` answers
 * `false`, `listNames` is empty. Silent loss, the same family of failure as
 * #6725 — which is the reason this row is in the table at all.
 *
 * `MetadataManager` and `createMemoryMetadata` store the value against the key
 * and hand it straight back.
 */
const DIVERGENCE_3 = 'MetadataFacade silently drops a non-object `data` value — accepted by `register`, readable back through no member. The other implementations round-trip it. Pinned as measured (#7223).';

const IMPLEMENTATIONS: readonly PinnedImplementation[] = [
    {
        label: 'MetadataManager (registry only)',
        documentFidelity: 'verbatim',
        create: () => new MetadataManager({ formats: ['json'], loaders: [] }),
    },
    {
        // The half a loader-less manager never executes: `register` persists to
        // every writable `datasource:` loader before it announces.
        label: 'MetadataManager (writable datasource loader)',
        documentFidelity: 'verbatim',
        create: () => new MetadataManager({ formats: ['json'], loaders: [new WritableFixtureLoader()] }),
    },
    {
        label: 'createMemoryMetadata',
        documentFidelity: 'verbatim',
        create: () => createMemoryMetadata(),
    },
    {
        label: 'MetadataFacade',
        documentFidelity: 'runtime-effective',
        divergences: {
            'key-is-the-name-argument-object': { kind: 'absent', note: DIVERGENCE_1 },
            'key-is-the-name-argument-nonobject': { kind: 'absent', note: DIVERGENCE_1 },
            'plural-objects-type-is-its-own-store': { kind: 'readable-as-last-write', note: DIVERGENCE_2 },
            'primitive-data-roundtrips': { kind: 'absent', note: DIVERGENCE_3 },
        },
        create: () => new MetadataFacade(new SchemaRegistry({ multiTenant: false })),
    },
];

/** The document a case's final write carried for the key being read. */
function lastWrittenDocument(testCase: MetadataRoundTripCase): unknown {
    return testCase.writes[testCase.writes.length - 1]?.data;
}

/**
 * The answer this subject is held to for this case: the table's reference
 * answer, unless the subject declares a divergence for it.
 */
function expectationFor(
    implementation: PinnedImplementation,
    testCase: MetadataRoundTripCase,
): { kind: 'readable'; document: unknown } | { kind: 'absent' } {
    const divergence = implementation.divergences?.[testCase.id];
    if (!divergence) return testCase.expected;
    return divergence.kind === 'absent'
        ? { kind: 'absent' }
        : { kind: 'readable', document: lastWrittenDocument(testCase) };
}

describe.each(IMPLEMENTATIONS)(
    'IMetadataService round-trip conformance [$label]',
    (implementation) => {
        it.each(METADATA_ROUNDTRIP_CASES.map((testCase) => [testCase.id, testCase] as const))(
            '%s',
            async (_id, testCase) => {
                const service = implementation.create();

                for (const write of testCase.writes) {
                    await service.register(write.type, write.name, write.data);
                }
                for (const removal of testCase.removes ?? []) {
                    await service.unregister(removal.type, removal.name);
                }

                const got = await service.get(testCase.read.type, testCase.read.name);
                const exists = await service.exists(testCase.read.type, testCase.read.name);
                const names = await service.listNames(testCase.read.type);
                const expected = expectationFor(implementation, testCase);

                if (expected.kind === 'readable') {
                    // Anti-vacuity: `toMatchObject` against an absent document
                    // would fail on its own, but stating this first makes a
                    // regression read as "nothing came back" rather than as a
                    // shape mismatch buried in a diff.
                    expect(got).toBeDefined();

                    if (implementation.documentFidelity === 'verbatim' || typeof expected.document !== 'object' || expected.document === null) {
                        expect(got).toEqual(expected.document);
                    } else {
                        // The runtime-effective document CONTAINS the authored one.
                        expect(got).toMatchObject(expected.document as Record<string, unknown>);
                    }

                    expect(exists).toBe(true);
                    // Exactly once: an implementation that appended instead of
                    // overwriting would satisfy every assertion above on the
                    // re-register rows and fail only this one.
                    expect(names.filter((name) => name === testCase.read.name)).toHaveLength(1);
                } else {
                    expect(got).toBeUndefined();
                    expect(exists).toBe(false);
                    expect(names).not.toContain(testCase.read.name);
                }
            },
        );
    },
);

describe('round-trip conformance table wiring', () => {
    it('declares no divergence for a case id the table does not contain', () => {
        // A renamed case would otherwise turn its divergence override into a
        // dead entry, and the subject would quietly be held to the reference
        // answer it is known to fail.
        const ids = new Set(METADATA_ROUNDTRIP_CASES.map((testCase) => testCase.id));
        for (const implementation of IMPLEMENTATIONS) {
            for (const id of Object.keys(implementation.divergences ?? {})) {
                expect(ids, `${implementation.label} → ${id}`).toContain(id);
            }
        }
    });

    it('holds at least one implementation to every case', () => {
        // Guards the opposite failure from the one above: a case that every
        // subject declared a divergence for would be pinned by nobody against
        // the reference answer.
        for (const testCase of METADATA_ROUNDTRIP_CASES) {
            const conforming = IMPLEMENTATIONS.filter((i) => !i.divergences?.[testCase.id]);
            expect(conforming.length, testCase.id).toBeGreaterThan(0);
        }
    });
});
