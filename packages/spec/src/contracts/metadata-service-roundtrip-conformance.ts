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
 * **The reference semantics, ruled by the maintainer on 2026-08-12 (#7378,
 * three cells): a store keyed by the CANONICAL type × the `name` ARGUMENT,
 * refusing loudly what it cannot key.**
 *
 * - a `data.name` disagreeing with the `name` argument is refused
 *   (the `refused` rows) — a disagreement is almost always an authoring bug,
 *   and silent resolution in either direction can misplace the item;
 * - a non-object (or array) `data` is refused — never accepted-and-dropped,
 *   never coerced into storability;
 * - the type folds plural→singular (`PLURAL_TO_SINGULAR`, `../shared`)
 *   before any store decision, so the two spellings of the object type
 *   address ONE store.
 *
 * This supersedes the 2026-08-11 option-(a) reference semantics (a
 * disagreeing `data.name` silently outranked by the argument; non-object
 * `data` accepted; raw-string type keys) that this table's `expected` column
 * stated until the ruling's spec-side half landed. Every shipped
 * implementation enforces the same three cells through ONE shared guard —
 * `assertMetadataRegisterContract` / `canonicalMetadataServiceType`
 * (`@objectstack/core`, whose header carries the verbatim ruling); the
 * reference double beside this table restates the semantics locally, because
 * `packages/spec` is the dependency root and cannot import core.
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
 *
 * `refused` (#7378, 2026-08-12) means the case's SINGLE write must be
 * rejected with the ADR-0112 envelope — the standard catalog's
 * `VALIDATION_ERROR` as the error's `code` AND `status` 400; a bare
 * `toThrow()` is not a conformance assertion — with a locating message that
 * names the type, the `name` argument and, on mismatch rows, BOTH disagreeing
 * spellings; and with NOTHING stored: the case's read key answers absent, and
 * so does the document's own `name` when it disagrees (the misplacement the
 * ruling exists to make impossible).
 */
export type MetadataRoundTripExpectation =
    | { readonly kind: 'readable'; readonly document: unknown }
    | { readonly kind: 'absent' }
    | { readonly kind: 'refused' };

export interface MetadataRoundTripCase {
    /** Stable id — unique per row; what a driver names when it reports a row. */
    readonly id: string;
    /** Sentence stating the proposition, used as the test title. */
    readonly title: string;
    /** Applied in order, through `register(type, name, data)`. */
    readonly writes: readonly MetadataRoundTripWrite[];
    /** Applied after every write, through `unregister(type, name)`. */
    readonly removes?: readonly MetadataRoundTripRemoval[];
    /**
     * The ONE read the case makes, through `get` / `exists` / `listNames`.
     * On a `refused` row it is the key the refusal must have left absent.
     */
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

/**
 * A non-object `data` that is nonetheless `typeof 'object'` — the shape a
 * spread-to-key implementation corrupts rather than drops.
 */
const PIN_ARRAY = ['alpha', 'beta'];

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
        id: 'data-name-mismatch-refused-object',
        title: "register('object', n, d) REFUSES a d whose own name disagrees with n",
        writes: [{ type: 'object', name: 'pin_key', data: PIN_KEYED_OBJECT }],
        read: { type: 'object', name: 'pin_key' },
        expected: { kind: 'refused' },
        why: 'Whether `name` or `data.name` is the key is the whole round-trip. **Ruled** (#7378, maintainer 2026-08-12, row 1, superseding the 2026-08-11 option (a) this row used to state): a disagreement is refused loudly — it is almost always an authoring bug, and silent resolution in EITHER direction can file the item under a key the author never wrote. A document with no `name` of its own still registers under the argument; the objectql driver pins that boundary.',
    },
    {
        id: 'data-name-mismatch-refused-nonobject',
        title: "register('view', n, d) REFUSES a d whose own name disagrees with n",
        writes: [{ type: 'view', name: 'pin_key_view', data: PIN_KEYED_VIEW }],
        read: { type: 'view', name: 'pin_key_view' },
        expected: { kind: 'refused' },
        why: 'The same refusal on the generic store, so a conforming answer cannot be mistaken for object-specific special-casing.',
    },
    {
        id: 'plural-type-folds-to-canonical-store',
        title: "get('object', n) sees a register('objects', n, …) — the plural spelling folds to the canonical type",
        writes: [{ type: 'objects', name: 'pin_plural', data: PIN_PLURAL }],
        read: { type: 'object', name: 'pin_plural' },
        expected: { kind: 'readable', document: PIN_PLURAL },
        why: "The two spellings of the object type address ONE store. **Ruled** (#7378, maintainer 2026-08-12, row 2): every implementation gives one answer, converged with `check:meta-type-normalized`'s enforced direction — the type folds plural→singular (`PLURAL_TO_SINGULAR`, `../shared`) before any store decision. This row was `plural-objects-type-is-its-own-store` (expected `absent`) while the answer was still a measured divergence; the reverse read direction is pinned driver-locally in objectql.",
    },
    {
        id: 'primitive-data-refused',
        title: 'a non-object `data` value is REFUSED, never accepted-and-dropped',
        writes: [{ type: 'setting', name: 'pin_flag', data: 'enabled' }],
        read: { type: 'setting', name: 'pin_flag' },
        expected: { kind: 'refused' },
        why: '`data` is declared `unknown`, not `object`, so this is a runtime refusal (#7378, maintainer 2026-08-12, row 3): a value the service cannot key was measured as accept-then-drop — written, then readable back through NO member — which is indefensible; and coercing it into storability is equally forbidden. The ruling fixes 「接受再丢」, it does not demand 「必须存下」.',
    },
    {
        id: 'array-data-refused',
        title: 'an array `data` value is REFUSED with the primitives',
        writes: [{ type: 'setting', name: 'pin_list', data: PIN_ARRAY }],
        read: { type: 'setting', name: 'pin_list' },
        expected: { kind: 'refused' },
        why: 'The sibling shape of the row above, and the one a `typeof data === "object"` guard admits WRONGLY: an array passes that test, carries no document identity, and an implementation that keys by spreading the document turns [a, b] into { 0: a, 1: b } — silent corruption where the primitive row measured silent loss. The ruling\'s ban on coercion-into-storability decides this row with the primitive one.',
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
