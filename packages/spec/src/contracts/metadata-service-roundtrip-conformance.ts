// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical conformance cases for the `IMetadataService` **write→read
 * round-trip** — `register(type, name, data)` followed by `get(type, name)`,
 * and the three members that must agree with `get` about the same key
 * (`exists`, `listNames`, `list`).
 *
 * ## Why this exists (#7223)
 *
 * `register` and `get` are this contract's first two CRUD members, and until
 * this table the round-trip between them was exercised in exactly ONE place —
 * `metadata-service.test.ts`, against a `Map`-of-`Map`s double written inside
 * the test itself. That file is the right thing for `packages/spec` to host
 * (the contract has no runtime, and spec is the dependency root), but it means
 * the round-trip was pinned against **no shipped implementation at all**: the
 * suite asserted that a `Map` behaves like a `Map`.
 *
 * That is not a hypothetical hole. It is the exact hole #6725 fell through:
 * `MetadataFacade.register('object', …)` wrote into a map none of its own reads
 * consulted, every read answered `undefined`, and the full `packages/objectql`
 * suite (167 files, 2917 tests) plus all 64 `lint.yml` gates stayed green while
 * a shipped, exported implementation of the platform's central metadata
 * contract could not perform its own most basic round-trip.
 *
 * ## How to use it
 *
 * Same shape as {@link ../data/filter-logic-conformance | FILTER_LOGIC_CASES}:
 * ONE table here, a thin driver per implementation. Each case is a short
 * sequence of writes (and optional removals) followed by exactly ONE read; the
 * driver replays it against its subject and asserts {@link MetadataRoundTripCase.expected}.
 *
 * Two drivers run this table today:
 *
 * | Driver | Subject |
 * |---|---|
 * | `metadata-service-roundtrip-conformance.test.ts` (this directory) | the contract's own `Map`-of-`Map`s reference double |
 * | `packages/objectql/src/metadata-service-roundtrip-conformance.test.ts` | `MetadataManager`, `MetadataManager` + writable loader, `createMemoryMetadata`, `MetadataFacade` |
 *
 * `packages/objectql` hosts the shipped-implementation driver because it is the
 * only package that can see all three at once — it depends on
 * `@objectstack/metadata` and `@objectstack/core` and owns `MetadataFacade` —
 * the same argument `metadata-service-getobject-equivalence.test.ts` (#6745)
 * already makes for living there.
 *
 * ## What `expected` means, precisely
 *
 * **The reference semantics: a store keyed by `type` × the `name` ARGUMENT.**
 * That is what the contract's own double implements, and what its parameter
 * names say (`@param name - Item name/identifier (snake_case)` on both
 * members). It is deliberately NOT a ruling that every shipped implementation
 * currently satisfies it — three cases below are answered differently by
 * `MetadataFacade` today, and those answers are pinned as measured, with a
 * `// DIVERGENCE` marker, in the objectql driver. Pinning ≠ blessing: read the
 * divergence notes there and the card they link before treating either answer
 * as the intended one.
 *
 * ## Deliberate scope
 *
 * The write→read round-trip only. `unregister` appears in exactly one case, as
 * the anti-vacuity control for the `absent` expectation — proof that the
 * `absent` assertions can flip — not as coverage of the removal contract.
 * Overlays, `query`, bulk writes, watch/subscribe and the loader fallback are
 * all out; the loader fallback is `metadata-service-getobject-equivalence.test.ts`'s
 * subject and is reached without a `register` at all.
 *
 * A case belongs here only if it is a question every occupant of the `metadata`
 * service slot has to answer. Where the answers currently differ, the case
 * still belongs — that divergence is the finding.
 *
 * Refs #7223, #6725, PR #7211, #6745, #6505 / PR #6723.
 */

/** One `register(type, name, data)` call in a case's setup. */
export interface MetadataRoundTripWrite {
    readonly type: string;
    readonly name: string;
    readonly data: unknown;
}

/** One `unregister(type, name)` call, applied after every write in the case. */
export interface MetadataRoundTripRemoval {
    readonly type: string;
    readonly name: string;
}

/**
 * What the single read of a case is expected to find.
 *
 * `readable` carries the document the write put there, so a driver never has to
 * re-derive "which write won" by searching the setup. Drivers assert it as a
 * recursive SUBSET of what `get` returns, because an implementation may answer
 * the runtime-effective document rather than the stored one — `MetadataFacade`
 * resolves objects through `SchemaRegistry`, which injects system fields
 * (`organization_id`, `created_at`, …) that the author never wrote. A driver
 * whose subject is known to answer verbatim SHOULD additionally assert exact
 * equality; the objectql driver does this via `documentFidelity`.
 */
export type MetadataRoundTripExpectation =
    | { readonly kind: 'readable'; readonly document: unknown }
    | { readonly kind: 'absent' };

export interface MetadataRoundTripCase {
    /** Stable id — what a divergence override in a driver keys off. */
    readonly id: string;
    /** Sentence stating the proposition, used as the test title. */
    readonly title: string;
    /** Applied in order, through `register(type, name, data)`. */
    readonly writes: readonly MetadataRoundTripWrite[];
    /** Applied after every write, through `unregister(type, name)`. */
    readonly removes?: readonly MetadataRoundTripRemoval[];
    /** The ONE read the case makes, through `get` / `exists` / `listNames`. */
    readonly read: { readonly type: string; readonly name: string };
    readonly expected: MetadataRoundTripExpectation;
    /** Why the case is in the table — what breaks if it is dropped. */
    readonly why: string;
}

const objectDocument = (name: string, label = name) => ({
    name,
    label,
    fields: { title: { type: 'text', label: 'Title' } },
});

const viewDocument = (name: string, label = `${name} view`) => ({
    name,
    label,
    type: 'grid',
});

/** The `object` document every plain-round-trip case writes. */
const PIN_ACCOUNT = objectDocument('pin_account');
/** The non-`object` document, so the type special-casing is exercised on both sides. */
const PIN_GRID = viewDocument('pin_grid');

const PIN_DUP_FIRST = objectDocument('pin_dup', 'First label');
const PIN_DUP_SECOND = objectDocument('pin_dup', 'Second label');
const PIN_DUP_VIEW_FIRST = viewDocument('pin_dup_view', 'First label');
const PIN_DUP_VIEW_SECOND = viewDocument('pin_dup_view', 'Second label');

const PIN_SCOPED_VIEW = viewDocument('pin_scoped');
const PIN_SCOPED_OBJECT = objectDocument('pin_scoped_obj');

/** Deliberately not snake_case — the case-sensitivity rows need a cased name. */
const PIN_CASED = objectDocument('Pin_Cased');

/** `data.name` disagrees with the `name` argument — see the two cases using it. */
const PIN_KEYED_OBJECT = objectDocument('pin_data_name');
const PIN_KEYED_VIEW = viewDocument('pin_data_name_view');

const PIN_PLURAL = objectDocument('pin_plural');

const PIN_REMOVED = objectDocument('pin_removed');

export const METADATA_ROUNDTRIP_CASES: readonly MetadataRoundTripCase[] = [
    {
        id: 'object-roundtrip',
        title: "register('object', n, d) is readable back through get('object', n)",
        writes: [{ type: 'object', name: 'pin_account', data: PIN_ACCOUNT }],
        read: { type: 'object', name: 'pin_account' },
        expected: { kind: 'readable', document: PIN_ACCOUNT },
        why: 'The contract\'s first two CRUD members, on the type whose reads are special-cased. This is the row #6725 would have failed.',
    },
    {
        id: 'nonobject-roundtrip',
        title: "register('view', n, d) is readable back through get('view', n)",
        writes: [{ type: 'view', name: 'pin_grid', data: PIN_GRID }],
        read: { type: 'view', name: 'pin_grid' },
        expected: { kind: 'readable', document: PIN_GRID },
        why: 'The generic type store — NOT special-cased on the read side of SchemaRegistry, which is the asymmetry that produced #6725. An implementation can pass one of these two rows and fail the other.',
    },
    {
        id: 'get-before-register-object',
        title: "get('object', n) is absent before anything registers n",
        writes: [],
        read: { type: 'object', name: 'pin_never_written' },
        expected: { kind: 'absent' },
        why: 'The miss shape. Without it, an implementation that answers a truthy default for every key would satisfy every `readable` row above.',
    },
    {
        id: 'get-before-register-nonobject',
        title: "get('view', n) is absent before anything registers n",
        writes: [],
        read: { type: 'view', name: 'pin_never_written' },
        expected: { kind: 'absent' },
        why: 'The miss shape on the generic store, for the same reason the round-trip is pinned on both.',
    },
    {
        id: 're-register-object',
        title: "re-registering the same object type+name resolves to the LAST write",
        writes: [
            { type: 'object', name: 'pin_dup', data: PIN_DUP_FIRST },
            { type: 'object', name: 'pin_dup', data: PIN_DUP_SECOND },
        ],
        read: { type: 'object', name: 'pin_dup' },
        expected: { kind: 'readable', document: PIN_DUP_SECOND },
        why: 'Overwrite-vs-reject is unstated in the contract TSDoc. Every shipped implementation currently OVERWRITES and keeps one entry; this pins that, so a future implementation that rejects or duplicates has to say so rather than drift.',
    },
    {
        id: 're-register-nonobject',
        title: 're-registering the same view type+name resolves to the LAST write',
        writes: [
            { type: 'view', name: 'pin_dup_view', data: PIN_DUP_VIEW_FIRST },
            { type: 'view', name: 'pin_dup_view', data: PIN_DUP_VIEW_SECOND },
        ],
        read: { type: 'view', name: 'pin_dup_view' },
        expected: { kind: 'readable', document: PIN_DUP_VIEW_SECOND },
        why: 'The object write path reaches two stores and the generic one reaches a single map, so overwrite semantics are worth asserting on both.',
    },
    {
        id: 'type-scopes-view-away-from-object',
        title: "get('object', n) does not see a register('view', n, …)",
        writes: [{ type: 'view', name: 'pin_scoped', data: PIN_SCOPED_VIEW }],
        read: { type: 'object', name: 'pin_scoped' },
        expected: { kind: 'absent' },
        why: 'Type scoping, in the direction that matters most: a view leaking into the object store would be dispatched on by the data plane.',
    },
    {
        id: 'type-scopes-object-away-from-view',
        title: "get('view', n) does not see a register('object', n, …)",
        writes: [{ type: 'object', name: 'pin_scoped_obj', data: PIN_SCOPED_OBJECT }],
        read: { type: 'view', name: 'pin_scoped_obj' },
        expected: { kind: 'absent' },
        why: 'The other direction, which a single shared name-keyed map would fail while passing the one above.',
    },
    {
        id: 'name-is-case-sensitive-exact-hit',
        title: 'a cased name is readable back under its exact spelling',
        writes: [{ type: 'object', name: 'Pin_Cased', data: PIN_CASED }],
        read: { type: 'object', name: 'Pin_Cased' },
        expected: { kind: 'readable', document: PIN_CASED },
        why: 'The control for the row below: without it, an implementation that dropped cased names entirely would pass the miss assertion for the wrong reason.',
    },
    {
        id: 'name-is-case-sensitive-lower-miss',
        title: 'a cased name is NOT readable back under a lowercased spelling',
        writes: [{ type: 'object', name: 'Pin_Cased', data: PIN_CASED }],
        read: { type: 'object', name: 'pin_cased' },
        expected: { kind: 'absent' },
        why: 'No shipped implementation normalizes name case today. Pinning that keeps a future one from folding case silently — which would make two authored items collide into one.',
    },
    {
        id: 'key-is-the-name-argument-object',
        title: "get('object', n) finds a write made under n even when data.name differs",
        writes: [{ type: 'object', name: 'pin_key', data: PIN_KEYED_OBJECT }],
        read: { type: 'object', name: 'pin_key' },
        expected: { kind: 'readable', document: PIN_KEYED_OBJECT },
        why: 'Whether `name` or `data.name` is the key is the whole round-trip. The contract names the parameter on both members and says nothing about `data.name`, so the reference answer is the argument. **Shipped implementations disagree here** — see the DIVERGENCE notes in the objectql driver.',
    },
    {
        id: 'key-is-the-name-argument-nonobject',
        title: "get('view', n) finds a write made under n even when data.name differs",
        writes: [{ type: 'view', name: 'pin_key_view', data: PIN_KEYED_VIEW }],
        read: { type: 'view', name: 'pin_key_view' },
        expected: { kind: 'readable', document: PIN_KEYED_VIEW },
        why: 'The same question on the generic store, so a divergence cannot be mistaken for object-specific special-casing.',
    },
    {
        id: 'plural-objects-type-is-its-own-store',
        title: "get('object', n) does not see a register('objects', n, …)",
        writes: [{ type: 'objects', name: 'pin_plural', data: PIN_PLURAL }],
        read: { type: 'object', name: 'pin_plural' },
        expected: { kind: 'absent' },
        why: 'The two spellings of the object type. The reference store keys on the string it is given; some implementations alias the plural to the singular. **Shipped implementations disagree here** — see the DIVERGENCE notes in the objectql driver.',
    },
    {
        id: 'primitive-data-roundtrips',
        title: 'a non-object `data` value is readable back unchanged',
        writes: [{ type: 'setting', name: 'pin_flag', data: 'enabled' }],
        read: { type: 'setting', name: 'pin_flag' },
        expected: { kind: 'readable', document: 'enabled' },
        why: '`data` is declared `unknown`, not `object`. An implementation that derives its key from `data.name` has nothing to derive it from here. **Shipped implementations disagree here** — see the DIVERGENCE notes in the objectql driver.',
    },
    {
        id: 'absent-after-unregister',
        title: 'a registered item is absent again after unregister',
        writes: [{ type: 'object', name: 'pin_removed', data: PIN_REMOVED }],
        removes: [{ type: 'object', name: 'pin_removed' }],
        read: { type: 'object', name: 'pin_removed' },
        expected: { kind: 'absent' },
        why: 'Anti-vacuity control for every `absent` row: it is the one whose subject definitely existed a moment earlier, so a driver that silently failed to write anything cannot pass it alongside the readable rows.',
    },
];
