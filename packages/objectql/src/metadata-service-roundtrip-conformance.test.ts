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
 * ## All three rows are now RULED (#7378) — and the table lags the ruling
 *
 * This file's `// DIVERGENCE` era is over. The maintainer's three-cell ruling
 * of 2026-08-12 (#7378, 裁定人:维护者 huangyiirene), quoted verbatim and
 * untranslated:
 *
 * > 1. **Row 1(key 归属)= (c) 响亮拒绝。** `register(type, name, data)` 中
 * >    `name` 参数与 `data.name` 不一致时,所有实现统一拒绝并报错定位。
 * > 2. **Row 2(objects/object 别名)= 所有实现一个答案,与
 * >    `check:meta-type-normalized` 收敛。**
 * > 3. **Row 3(非对象 data 静默丢弃)= 响亮拒绝(throw)。**
 * >
 * > 三格的 `// DIVERGENCE` pin 在裁定 PR 内同步更新(该测试文件设计意图即如此)。
 *
 * Every shipped implementation now enforces it through ONE shared guard —
 * `assertMetadataRegisterContract` / `canonicalMetadataServiceType`
 * (`@objectstack/core/metadata-service-contract`), whose header carries the
 * full ruling text and the row-2 convergence rationale (the direction is
 * `check:meta-type-normalized`'s: normalize once at the entry, decide on the
 * normalized value — the gate's header carries #3984/#5881/#6241).
 *
 * **{@link RULED_CONTRACT_ANSWERS} below overrides the table's `expected` for
 * the five ruled case rows.** The table's own reference answers still describe
 * the PRE-ruling reference semantics, because the table — and the contract's
 * reference double beside it — live under `packages/spec/src/**`, whose half
 * of this ruling is the `domain:spec` seat's, tracked on #7378. When that half
 * lands (table rows re-ruled, reference double refusing/folding), the
 * `table lags the ruling` wiring test below goes red on purpose: delete the
 * override for each row it names and hold every subject to the table again.
 *
 * ## Two assertion strengths, declared per subject
 *
 * `documentFidelity` says whether a subject hands back the document it was
 * given. `MetadataManager` and `createMemoryMetadata` store and return the very
 * reference (`verbatim`), so they are held to exact equality. `MetadataFacade`
 * resolves objects through `SchemaRegistry`, which answers the RUNTIME-EFFECTIVE
 * object — system fields (`organization_id`, `created_at`, …) injected,
 * extensions merged. `toEqual(input)` is therefore the wrong assertion for it,
 * exactly as #7223 predicted; it is held to a recursive-subset match plus every
 * key/visibility assertion the others get. The weaker match is scoped to the
 * ONE subject that needs it rather than applied to the whole table.
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
import { StandardErrorCode } from '@objectstack/spec/api';
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

interface ShippedImplementation {
    readonly label: string;
    readonly documentFidelity: DocumentFidelity;
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
 * The RULED contract answer for a case, where the 2026-08-12 ruling and the
 * table's (spec-side, still pre-ruling) `expected` disagree — see the header
 * for why the two can disagree at all and for when each entry here dies.
 *
 * - `refused` — `register` must reject the case's write with the ADR-0112
 *   envelope (`code` AND `status`), a locating message, and NOTHING stored.
 * - `readable` — the case's final write is readable back, even though the
 *   table still says `absent`.
 */
type RuledAnswer =
    | { readonly kind: 'refused'; readonly note: string }
    | { readonly kind: 'readable'; readonly note: string };

const RULED_1 =
    'Row 1 (#7378, 2026-08-12): a data.name disagreeing with the name argument is REFUSED loudly by every implementation — silent resolution in either direction can misplace the item. Replaces the option-(a) argument-wins ruling of 2026-08-11 that the table still describes.';

const RULED_2 =
    "Row 2 (#7378, 2026-08-12): all implementations give ONE answer, converged with check:meta-type-normalized's enforced direction — plural folds to singular before any decision, so 'objects' and 'object' address one store. The table's `absent` still describes the pre-ruling reference semantics (raw-string type keys).";

const RULED_3 =
    'Row 3 (#7378, 2026-08-12): a non-object data is REFUSED (throw) by every implementation — accept-then-drop was indefensible, and coercing into storability (the interim { name, content } box) is equally forbidden. The table still expects the value readable back.';

const RULED_CONTRACT_ANSWERS: Readonly<Record<string, RuledAnswer>> = {
    'key-is-the-name-argument-object': { kind: 'refused', note: RULED_1 },
    'key-is-the-name-argument-nonobject': { kind: 'refused', note: RULED_1 },
    'primitive-data-roundtrips': { kind: 'refused', note: RULED_3 },
    'array-data-roundtrips': { kind: 'refused', note: RULED_3 },
    'plural-objects-type-is-its-own-store': { kind: 'readable', note: RULED_2 },
};

const IMPLEMENTATIONS: readonly ShippedImplementation[] = [
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
        create: () => new MetadataFacade(new SchemaRegistry({ multiTenant: false })),
    },
];

/** The document a case's final write carried for the key being read. */
function lastWrittenDocument(testCase: MetadataRoundTripCase): unknown {
    return testCase.writes[testCase.writes.length - 1]?.data;
}

/**
 * The `name` a case's written document carries when that is NOT the key the
 * case reads — i.e. the spelling an implementation keying on `data.name` would
 * file the item under. `undefined` when the case does not pose the question.
 *
 * [#7378] On the refused rows this is what the locating message must NAME, and
 * what the absence assertions probe: an implementation that "refused" but
 * still filed the item under the document's own name satisfies the rejection
 * assertion and fails only these.
 */
function staleDocumentName(testCase: MetadataRoundTripCase): string | undefined {
    const written = lastWrittenDocument(testCase);
    const documentName = (written as { name?: unknown } | undefined)?.name;
    return typeof documentName === 'string' && documentName !== testCase.read.name
        ? documentName
        : undefined;
}

/**
 * Replay a REFUSED row (#7378 rows 1/3): the single write must reject with the
 * ADR-0112 envelope — `code` AND `status`, a rejection test that checks one is
 * not a rejection test — locate the problem in its message, and store NOTHING,
 * neither under the argument key nor under the document's own name.
 */
async function assertRefused(service: RoundTrippingService, testCase: MetadataRoundTripCase): Promise<void> {
    // The refused rows are single-write by construction; a second write would
    // make "nothing stored" ambiguous about which write was refused.
    expect(testCase.writes).toHaveLength(1);
    const write = testCase.writes[0];

    const error = await service.register(write.type, write.name, write.data).then(
        () => undefined,
        (thrown: unknown) => thrown as Error & { code?: string; status?: number },
    );
    expect(error, `register must REFUSE this write (#7378): ${testCase.id}`).toBeDefined();
    expect(error).toMatchObject({
        code: StandardErrorCode.enum.VALIDATION_ERROR,
        status: 400,
    });

    // 报错定位 — the message names the write's coordinates…
    const message = String(error?.message ?? '');
    expect(message).toContain(`'${write.type}'`);
    expect(message).toContain(`'${write.name}'`);
    // …and, on the mismatch rows, BOTH disagreeing spellings.
    const stale = staleDocumentName(testCase);
    if (stale !== undefined) {
        expect(message).toContain(`'${stale}'`);
    }

    // The refusal wrote nothing: absent under the argument key…
    expect(await service.get(testCase.read.type, testCase.read.name)).toBeUndefined();
    expect(await service.exists(testCase.read.type, testCase.read.name)).toBe(false);
    const names = await service.listNames(testCase.read.type);
    expect(names).not.toContain(testCase.read.name);
    // …and never under the document's own name either — the misplacement the
    // ruling exists to make impossible.
    if (stale !== undefined) {
        expect(await service.get(testCase.read.type, stale)).toBeUndefined();
        expect(names).not.toContain(stale);
    }
}

describe.each(IMPLEMENTATIONS)(
    'IMetadataService round-trip conformance [$label]',
    (implementation) => {
        it.each(METADATA_ROUNDTRIP_CASES.map((testCase) => [testCase.id, testCase] as const))(
            '%s',
            async (_id, testCase) => {
                const service = implementation.create();
                const ruled = RULED_CONTRACT_ANSWERS[testCase.id];

                if (ruled?.kind === 'refused') {
                    await assertRefused(service, testCase);
                    return;
                }

                for (const write of testCase.writes) {
                    await service.register(write.type, write.name, write.data);
                }
                for (const removal of testCase.removes ?? []) {
                    await service.unregister(removal.type, removal.name);
                }

                const got = await service.get(testCase.read.type, testCase.read.name);
                const exists = await service.exists(testCase.read.type, testCase.read.name);
                const names = await service.listNames(testCase.read.type);
                const expected =
                    ruled?.kind === 'readable'
                        ? { kind: 'readable' as const, document: lastWrittenDocument(testCase) }
                        : testCase.expected;

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

/**
 * [#7378 rows 1/2] Driver-local pins the table does not carry (the table is the
 * spec seat's half — see the header). These keep the ruled behaviour from
 * passing for a wrong, narrower reason.
 */
describe.each(IMPLEMENTATIONS)('#7378 ruled behaviour, beyond the table [$label]', (implementation) => {
    it('row 1 is a MISMATCH rule: a document with NO name of its own registers under the argument', async () => {
        // The refusal must not widen into "data must carry a name": absence is
        // not a disagreement, and the argument is the key either way.
        const service = implementation.create();
        await service.register('view', 'pin_nameless', { label: 'No name key at all', type: 'grid' });
        const got = (await service.get('view', 'pin_nameless')) as Record<string, unknown> | undefined;
        expect(got).toBeDefined();
        expect(got).toMatchObject({ label: 'No name key at all' });
        expect(await service.exists('view', 'pin_nameless')).toBe(true);
        expect(await service.listNames('view')).toContain('pin_nameless');
    });

    it('row 1 is not refusal-happy: a data.name that AGREES with the argument registers', async () => {
        // The negative pin the ruling's own wording implies: only 不一致 is
        // refused. (The table's plain round-trip rows pin this too; stated
        // here so the pair — refuse mismatch, admit match — sits together.)
        const service = implementation.create();
        await service.register('view', 'pin_agreeing', { name: 'pin_agreeing', label: 'Agrees', type: 'grid' });
        expect(await service.exists('view', 'pin_agreeing')).toBe(true);
    });

    it("row 2 converges in BOTH directions: register('object', …) is readable through the plural spelling", async () => {
        // The table's ruled row covers plural-write → singular-read; this is
        // the reverse read, so the fold cannot be a write-side special case —
        // the direction check:meta-type-normalized's incidents were about
        // (#3984: the plural spelling walking past singular-literal gates).
        const service = implementation.create();
        await service.register('object', 'pin_both_ways', {
            name: 'pin_both_ways',
            label: 'Both spellings, one store',
            fields: { title: { type: 'text', label: 'Title' } },
        });
        const viaPlural = (await service.get('objects', 'pin_both_ways')) as Record<string, unknown> | undefined;
        expect(viaPlural).toBeDefined();
        expect(viaPlural).toMatchObject({ name: 'pin_both_ways' });
        expect(await service.exists('objects', 'pin_both_ways')).toBe(true);
        expect(await service.listNames('objects')).toContain('pin_both_ways');
    });
});

describe('round-trip conformance table wiring', () => {
    const ids = new Set(METADATA_ROUNDTRIP_CASES.map((testCase) => testCase.id));

    it('declares no ruled override for a case id the table does not contain', () => {
        // A renamed case would otherwise turn its override into a dead entry,
        // and every subject would quietly be held to the pre-ruling reference
        // answer it is known to fail.
        for (const id of Object.keys(RULED_CONTRACT_ANSWERS)) {
            expect(ids, id).toContain(id);
        }
    });

    it('the table still lags the 2026-08-12 ruling — this red is the handoff signal', () => {
        // The overrides above exist ONLY because the table and the reference
        // double live under `packages/spec/src/**`, the `domain:spec` seat's
        // half of #7378. When that half lands, each assertion here goes red:
        // delete the corresponding RULED_CONTRACT_ANSWERS entry and let every
        // subject be held to the table's (then-ruled) answer directly.
        for (const [id, ruled] of Object.entries(RULED_CONTRACT_ANSWERS)) {
            const testCase = METADATA_ROUNDTRIP_CASES.find((candidate) => candidate.id === id);
            if (!testCase) continue; // the wiring test above owns this failure
            if (ruled.kind === 'refused') {
                expect(testCase.expected.kind, `${id}: table updated? delete its override`).toBe('readable');
            } else {
                expect(testCase.expected.kind, `${id}: table updated? delete its override`).toBe('absent');
            }
        }
    });
});
