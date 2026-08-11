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
 * ## Two rows were RULED (#7378); one is still a pinned divergence
 *
 * This file used to carry three `// DIVERGENCE` entries — three cases
 * `MetadataFacade` answered differently from every other implementation and
 * from the contract's reference double. The maintainer ruling of 2026-08-11
 * (#7378, option (a) — **the `name` argument is the effective key and
 * `data.name` never overrides it**) settled two of them, the contract TSDoc
 * now says so, and `MetadataFacade` was aligned to it:
 *
 *  - the effective key (`key-is-the-name-argument-object` / `-nonobject`) —
 *    now `RULED_1` below, asserting the ruled answer rather than the old
 *    `absent`;
 *  - the dropped non-object `data` (`primitive-data-roundtrips` and its array
 *    sibling) — no per-subject entry at all any more: the facade simply
 *    conforms, held to the table's own reference answer like every other
 *    subject.
 *
 * `DIVERGENCE_2` (the plural `objects` alias) survives, deliberately, with the
 * measurement for why the same ruling could not carry it — read it before
 * assuming it was overlooked.
 *
 * If you are here because one of these tests failed after a behaviour change:
 * that is the pin working. A RULED row going red means an implementation
 * drifted off a decided contract, and the fix belongs in the implementation;
 * update the pin only in the PR that changes the ruling.
 *
 * Refs #7223, #7378, #6725, PR #7211, #6745.
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
 * A per-subject answer that differs from the table's reference answer — either
 * because the subject DIVERGES from it (unruled, pinned as measured) or because
 * the ruling that settled the row prescribes a different observable shape for
 * this subject than the reference double's.
 *
 * - `absent` — the subject finds nothing under the key the case reads.
 * - `readable-as-last-write` — the document the case's final write carried.
 * - `readable-keyed-by-argument` — RULED (#7378): the authored document is
 *   readable under the `name` ARGUMENT, with its own `name` reconciled to that
 *   argument. This is what a document-keyed store must do to honour the ruling
 *   (see `MetadataFacade.toKeyedDefinition`), and it is a strictly STRONGER
 *   assertion than the `absent` pin it replaced: the document must come back,
 *   under the argument, carrying every other key it was authored with.
 */
type SubjectAnswer =
    | { readonly kind: 'absent'; readonly note: string }
    | { readonly kind: 'readable-as-last-write'; readonly note: string }
    | { readonly kind: 'readable-keyed-by-argument'; readonly note: string };

interface PinnedImplementation {
    readonly label: string;
    readonly documentFidelity: DocumentFidelity;
    /** Keyed by {@link MetadataRoundTripCase.id}. Every key is checked to exist. */
    readonly divergences?: Readonly<Record<string, SubjectAnswer>>;
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
 * ── RULED 1 — the effective key is the `name` ARGUMENT ──
 *
 * Cases `key-is-the-name-argument-object` / `-nonobject`. Was DIVERGENCE 1.
 *
 * `MetadataFacade.register` used to open with
 * `{ ...data, name: data.name ?? name }` and hand the DOCUMENT to
 * `SchemaRegistry.registerObject` / `registerItem`, which key on the document's
 * own `name`. The argument was therefore only a fallback for a document that
 * carried none: when the two disagreed the item landed under `data.name`, and
 * `get(type, <the name that was passed>)` answered `undefined`, `exists`
 * answered `false`, and `listNames` reported the other spelling.
 *
 * The maintainer ruling of 2026-08-11 (#7378, option (a)) settled it the other
 * way — the argument is the effective key, `data.name` never overrides it —
 * `IMetadataService.register` / `get` now say so, and the facade was aligned
 * (`toKeyedDefinition`). All five implementations answer this row the same way
 * today.
 *
 * What stays subject-specific is only the SHAPE of the answer, and only because
 * the facade's stores are keyed by the document itself: reconciling the
 * document to the argument means the `name` that comes back IS the argument,
 * where the verbatim subjects hand back the authored `name` under the argument
 * key. Both honour the ruling — the key is the argument in every case — so this
 * entry asserts the ruled answer rather than suppressing the row.
 */
const RULED_1 = 'MetadataFacade keys on the `name` argument (#7378 ruling (a)); reconciling its document-keyed stores to that argument also normalizes the stored `name` to it.';

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
 *
 * ── Why the #7378 ruling did NOT carry this row (measured 2026-08-11) ──
 *
 * The ruling aligned the facade on the other two rows and named this one with
 * them, but aligning it is not a facade-local change and the two candidate
 * routes are both worse than the divergence:
 *
 *  1. **The alias that decides this row is `SchemaRegistry`'s, not the
 *     facade's.** `registry.getItem` and `registry.listItems` special-case
 *     BOTH spellings straight to `getObject` / `getAllObjects`
 *     (`registry.ts`, "Special handling for 'object' and 'objects' types"), so
 *     the READ this case makes is aliased one layer below anything
 *     `metadata-facade.ts` controls. Narrowing the facade's own `isObjectType`
 *     to the singular would therefore make `register('objects', n, d)` write
 *     into `metadata['objects']` while `get('objects', n)` still resolves
 *     through `registry.getItem` → `getObject(n)` → `undefined`: the write
 *     lands nowhere any read looks. That is #6725 EXACTLY, re-opened for the
 *     plural spelling — the silent loss this whole table exists because of, and
 *     the row would go green while the bug got worse.
 *  2. **Removing the registry alias runs against the platform's own
 *     normalization direction.** Plural→singular folding is owned by the layers
 *     below this contract and is enforced there: `canonicalMetaType`
 *     (`PLURAL_TO_SINGULAR`) canonicalizes every `/meta` request type at the
 *     protocol boundary (#4432), `RestServer.metaTypeSingular` does it at the
 *     REST boundary, and `check:meta-type-normalized` is a CI gate whose whole
 *     job is to refuse a decision made on the un-normalized `:type` — three
 *     authorization bypasses (#3984, #5881, #6241) came from exactly that.
 *     `registry.test.ts` pins `listItems("objects")` as a deliberate alias.
 *     "The two spellings are one type" is a decided platform-wide position;
 *     this row asks for the opposite, and that is a ruling of its own, not an
 *     implementation detail this card can settle.
 *
 * So this stays pinned as measured, and the question — does `IMetadataService`
 * key its type stores on the raw string (reference semantics) or on the
 * canonical type (what the rest of the platform does)? — is escalated on #7378
 * rather than answered here.
 */
const DIVERGENCE_2 = 'MetadataFacade aliases the plural `objects` type to `object` — through SchemaRegistry\'s own read-side special-case, not its own; the other implementations keep one store per type string. Still pinned as measured: the #7378 ruling did not carry this row (see the note above), and the open question is escalated there.';

/**
 * ── RULED 3 — a non-object `data` value round-trips (no entry needed) ──
 *
 * Cases `primitive-data-roundtrips`, `array-data-roundtrips`. Was DIVERGENCE 3,
 * and is deliberately NOT replaced by an entry in `divergences` below: the
 * facade now conforms to the table's own reference answer, so the row is held
 * against it like every other subject's.
 *
 * What it used to measure: the contract declares `data: unknown`, and
 * `MetadataFacade.register` passed a non-object value through unchanged (its
 * `{ ...data }` branch is guarded on `typeof data === 'object' && data !== null`)
 * and then registered it under the document's own `name` — which a string does
 * not have. The write was ACCEPTED (no throw), the registry logged
 * `Registered setting: undefined`, and the value was readable back through
 * nothing. Silent loss, the same family as #6725.
 *
 * Under the #7378 ruling the argument is the key, so a value with no `name` of
 * its own HAS one; `toKeyedDefinition` boxes it as `{ name, content }`, which
 * is the shape this class's own reads already unwrap. The array row is the
 * sibling shape that `typeof data === 'object'` got wrong in the other
 * direction — spread into `{ 0: …, 1: … }` rather than dropped.
 */

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
            'key-is-the-name-argument-object': { kind: 'readable-keyed-by-argument', note: RULED_1 },
            'key-is-the-name-argument-nonobject': { kind: 'readable-keyed-by-argument', note: RULED_1 },
            'plural-objects-type-is-its-own-store': { kind: 'readable-as-last-write', note: DIVERGENCE_2 },
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
 * answer, unless the subject declares a per-subject answer for it.
 */
function expectationFor(
    implementation: PinnedImplementation,
    testCase: MetadataRoundTripCase,
): { kind: 'readable'; document: unknown } | { kind: 'absent' } {
    const answer = implementation.divergences?.[testCase.id];
    if (!answer) return testCase.expected;
    switch (answer.kind) {
        case 'absent':
            return { kind: 'absent' };
        case 'readable-as-last-write':
            return { kind: 'readable', document: lastWrittenDocument(testCase) };
        case 'readable-keyed-by-argument':
            // The authored document, with its own `name` reconciled to the
            // effective key — see RULED_1. Every other authored key is asserted
            // unchanged, so this cannot degrade into "something came back".
            return {
                kind: 'readable',
                document: {
                    ...(lastWrittenDocument(testCase) as Record<string, unknown>),
                    name: testCase.read.name,
                },
            };
    }
}

/**
 * The `name` a case's written document carries when that is NOT the key the
 * case reads — i.e. the spelling an implementation keying on `data.name` would
 * file the item under. `undefined` when the case does not pose the question.
 *
 * [#7378] Asserting this stale spelling is ABSENT from `listNames` is what
 * keeps the ruled rows from passing for the wrong reason: an implementation
 * that stored the item twice, or that kept the document's own name as a second
 * key, satisfies every other assertion on those rows and fails only this one.
 */
function staleDocumentName(testCase: MetadataRoundTripCase): string | undefined {
    const written = lastWrittenDocument(testCase);
    const documentName = (written as { name?: unknown } | undefined)?.name;
    return typeof documentName === 'string' && documentName !== testCase.read.name
        ? documentName
        : undefined;
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

                    // [#7378] …and never ALSO under the document's own name.
                    const stale = staleDocumentName(testCase);
                    if (stale !== undefined) expect(names).not.toContain(stale);
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
