// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21738, ADR-0010 §3.3 / §5] THE item-lock resolution: the one answer to
 * "which ADR-0010 `_lock` binds this item?", taken by every caller that
 * enforces a lock or reports one.
 *
 *  - The write doors' `_lock` gate (`getEffectiveLock` in `protocol.ts`, behind
 *    save, publish, rollback, delete and the package publish's promotion)
 *    reads its layers through {@link resolveItemLockLazily}.
 *  - Both item reads' protection envelope (`getMetaItem`,
 *    `getMetaItemLayered`, through `servedLockState`) and the per-type
 *    `locked` count of `getMetaDiagnostics` call {@link resolveItemLock}.
 *  - The lock family a served body carries (`mergeArtifactProtection`) calls
 *    it too, so a body never states a lock the envelope does not report.
 *
 * Before this module the reads took their lock from two derivations of their
 * own, and neither was the door's:
 *
 *  1. `mergeArtifactProtection` copied any declared artifact `_lock` over the
 *     stored row's, an explicit `'none'` included. A packaged item whose
 *     artifact declared `'none'` under a stored row declaring `'full'` read
 *     `editable: true` while the door refused the save with `ITEM_LOCKED`.
 *  2. `getMetaItemLayered` read the lock off `code ?? overlay`, so a packaged
 *     item whose artifact declared no lock read unlocked under a stored row
 *     declaring one, while `getMetaItem` and the door said locked.
 *
 * ## The rule
 *
 * The layers are read in {@link ITEM_LOCK_LAYERS} order. The first layer whose
 * declared `_lock` is not `'none'` binds, and the answer carries that layer's
 * lock and its prose (`_lockReason`, `_lockDocsUrl`, `_lockSource`). A layer
 * that declares `'none'`, or declares nothing, does not bind. `'none'` declares
 * no lock: it is not a grant over a lower layer's lock (the triage ruling on
 * #21738: an artifact's explicit `'none'` leaves an administrator's stored lock
 * binding, because letting it override would widen the door). When no layer
 * binds, the answer is `'none'` with no prose: a lock reason explains a
 * refusal, and there is none to explain.
 *
 * ## The layers ARE the resolution's inputs, by name
 *
 * {@link ITEM_LOCK_LAYERS} is both the precedence and the parameter set. The
 * resolver iterates it, the input types are derived from it, and the
 * acceptance pin (`protocol.lock-one-resolution.test.ts`) generates its rows
 * from it. A layer added here without an axis there turns that pin's
 * completeness check red, naming the layer.
 *
 * ## [#21761] The overlay layer is selected from the item's ADDRESS
 *
 * The `overlay` layer is not a row a caller picks. Every caller hands
 * {@link resolveOverlayLockLayer} the item's address ({@link ItemAddress}) and
 * a reader of stored rows, and that one function selects the rows in scope
 * and contributes their strictest lock. So the reads and the doors cannot
 * select differently: before it, each caller pre-selected the row it handed
 * this module, and on the package axis (ADR-0048) a read naming a package
 * reported that package's row while the `_lock` gate bound whichever row
 * `findOne` returned first.
 *
 *  - **The rows in scope.** ADR-0005 precedence, as the reads resolve it: the
 *    organization's rows when it holds any row of the item, else the env-wide
 *    rows. Within that scope every row of the item, whichever package it is
 *    bound to: the address's own package row, the package-less row, and any
 *    other package's row. Those are every row the doors could bind before this
 *    rule (they asked with no package, so `findOne` could return any of them).
 *    A row stored under the type's other spelling is in scope only for a
 *    caller that passes `otherSpelling` (the reads), and only when no row
 *    under the canonical spelling is in that scope (the one declared
 *    difference, #4432).
 *  - **The lock is the strictest among them.** A write is refused when any
 *    row in scope refuses it, and a delete likewise. So the lock is never
 *    more permissive than any row a door could bind before, and it does not
 *    depend on the order the store returns rows in. For two rows that refuse
 *    different verbs (`'no-overlay'` and `'no-delete'`) that is `'full'`, the
 *    state that refuses both.
 *  - **Content stays prefer-local** (ADR-0048). Only the lock is resolved
 *    across the rows in scope. The served document is still the row the
 *    address prefers, and its lock family is the binding layer's.
 *
 * ⛔ Not a policy of its own. Which artifact a caller hands the `artifact`
 * layer is still the caller's lookup.
 */
import {
    MetadataLockSchema,
    evaluateLockForDelete,
    evaluateLockForWrite,
    extractProtection,
    type MetadataLock,
    type MetadataLockSource,
} from '@objectstack/spec/kernel';

/**
 * The layers an item's lock can come from, in precedence order:
 *
 *  - `artifact`: the item a code package's loader registered (ADR-0010 §3.3,
 *    "an overlay cannot loosen a packaged lock");
 *  - `overlay`: the stored `sys_metadata` rows in the item's scope (ADR-0005),
 *    as {@link resolveOverlayLockLayer} selects them from the item's address.
 */
export const ITEM_LOCK_LAYERS = Object.freeze(['artifact', 'overlay'] as const);

/** One of {@link ITEM_LOCK_LAYERS}. */
export type ItemLockLayer = (typeof ITEM_LOCK_LAYERS)[number];

/** Per layer, the document that layer contributes, or `undefined` when it has none. */
export type ItemLockLayers = { readonly [L in ItemLockLayer]: unknown };

/** The resolution's answer. */
export interface ItemLock {
    /** The binding lock, or `'none'` when no layer binds. */
    readonly lock: MetadataLock;
    /** The binding layer's `_lockReason`. */
    readonly lockReason: string | undefined;
    /** The binding layer's `_lockDocsUrl`. */
    readonly lockDocsUrl: string | undefined;
    /** The binding layer's declared `_lockSource`. */
    readonly lockSource: MetadataLockSource | undefined;
    /** The layer whose lock binds, or `undefined` when none does. */
    readonly layer: ItemLockLayer | undefined;
}

const UNLOCKED: ItemLock = Object.freeze({
    lock: 'none',
    lockReason: undefined,
    lockDocsUrl: undefined,
    lockSource: undefined,
    layer: undefined,
});

/**
 * Resolve the item's lock from the documents its layers contribute.
 * See this module's header for the rule.
 */
export function resolveItemLock(layers: ItemLockLayers): ItemLock {
    for (const layer of ITEM_LOCK_LAYERS) {
        const declared = extractProtection(layers[layer]);
        if (declared.lock !== 'none') {
            return {
                lock: declared.lock,
                lockReason: declared.lockReason,
                lockDocsUrl: declared.lockDocsUrl,
                lockSource: declared.lockSource,
                layer,
            };
        }
    }
    return UNLOCKED;
}

/**
 * {@link resolveItemLock}, reading each layer only when no layer above it
 * binds. The answer is the same; what this saves is the reads below a binding
 * layer. The write doors use it, so a packaged lock is answered without a
 * `sys_metadata` read, and a store that cannot be read never turns a packaged
 * lock's `ITEM_LOCKED` into a 503.
 *
 * A reader's failure propagates: each caller owns its #5532 / #5706
 * discrimination.
 */
export async function resolveItemLockLazily(read: {
    readonly [L in ItemLockLayer]: () => unknown | Promise<unknown>;
}): Promise<ItemLock> {
    const layers = Object.fromEntries(ITEM_LOCK_LAYERS.map((layer) => [layer, undefined])) as Record<ItemLockLayer, unknown>;
    for (const layer of ITEM_LOCK_LAYERS) {
        layers[layer] = await read[layer]();
        const answer = resolveItemLock(layers);
        if (answer.layer !== undefined) return answer;
    }
    return UNLOCKED;
}

// ── [#21761] The overlay layer, selected from the item's address ─────────────

/**
 * The fields of an item's address, by name: what a read or a write door names
 * when it asks about one item. {@link ItemAddress} is derived from it, and the
 * acceptance pin (`protocol.lock-one-resolution.test.ts`) gives each field an
 * axis, so a field added here without one turns that pin's completeness check
 * red, naming the field.
 */
export const ITEM_ADDRESS_FIELDS = Object.freeze(['type', 'name', 'organizationId', 'packageId'] as const);

/** One of {@link ITEM_ADDRESS_FIELDS}. */
export type ItemAddressField = (typeof ITEM_ADDRESS_FIELDS)[number];

/**
 * An item's address:
 *
 *  - `type`: the canonical metadata type (#4432);
 *  - `name`: the item's name;
 *  - `organizationId`: the organization the request is scoped to, already
 *    gated by `organizationIdForMetaRead` (ADR-0005), or `undefined` for the
 *    env-wide scope alone;
 *  - `packageId`: the package the request names (ADR-0048 `?package=`), or
 *    `undefined`. It decides which row's prose the lock carries when several
 *    rows in scope declare the strictest lock, never which rows are in scope.
 */
export type ItemAddress = {
    readonly type: string;
    readonly name: string;
    readonly organizationId: string | undefined;
    readonly packageId: string | undefined;
} & { readonly [F in ItemAddressField]: unknown };

/** A stored `sys_metadata` row, as far as the overlay layer reads it. */
export interface StoredOverlayRow {
    readonly id?: unknown;
    readonly package_id?: string | null;
    readonly metadata?: unknown;
}

/**
 * The stored rows of the addressed item in one scope (`organizationId`, or
 * `null` for env-wide) under one spelling of its type: `'canonical'`, or
 * `'other'` (the type's singular/plural twin, pre-#4432 residue). Every row of
 * the item there, whichever package it is bound to. A failed read throws: each
 * caller owns its #5532 / #5706 discrimination.
 */
export type StoredOverlayRowReader = (
    organizationId: string | null,
    spelling: 'canonical' | 'other',
) => readonly StoredOverlayRow[] | Promise<readonly StoredOverlayRow[]>;

/**
 * The body a stored `sys_metadata` row holds, as written: the document a row
 * contributes, parsed the one way the `_lock` gate and both reads parse it. No
 * conversion is replayed: none touches the `_lock` family.
 */
export function storedRowDocument(row: { metadata?: unknown }): unknown {
    return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
}

/**
 * The strictest of `locks`: the state that refuses a write when any of them
 * does, and a delete when any of them does. Read off the lock algebra itself
 * (`evaluateLockForWrite` / `evaluateLockForDelete`), so `'no-overlay'` with
 * `'no-delete'` is `'full'`, and no lock is `'none'`.
 */
export function strictestLock(locks: readonly MetadataLock[]): MetadataLock {
    const refusesWrite = locks.some((lock) => evaluateLockForWrite(lock) !== null);
    const refusesDelete = locks.some((lock) => evaluateLockForDelete(lock) !== null);
    const strictest = MetadataLockSchema.options.find((state) =>
        (evaluateLockForWrite(state) !== null) === refusesWrite
        && (evaluateLockForDelete(state) !== null) === refusesDelete);
    if (strictest === undefined) {
        // Unreachable while the lock algebra covers all four verdict pairs; a
        // state added without a write/delete answer must fail here, loudly.
        throw new Error(`No ADR-0010 lock state refuses write=${refusesWrite}, delete=${refusesDelete}.`);
    }
    return strictest;
}

/** The ADR-0010 lock family a stored body carries, and nothing else. */
const LOCK_FAMILY_KEYS = Object.freeze(['_lock', '_lockReason', '_lockDocsUrl', '_lockSource'] as const);

/**
 * [#21761] THE overlay layer's selection. The document the `overlay` layer of
 * {@link resolveItemLock} gets for `address`: the strictest lock among the
 * stored rows in the address's scope, read through `rowsIn`. See this module's
 * header for the rule. `undefined` when no row is in scope or none of them
 * declares a lock.
 *
 * The document is the lock family alone. It is the family of the row that
 * declares the strictest lock, preferring the address's own package row, then
 * the package-less row, then the other packages' rows by package id, so its
 * prose (`_lockReason`, `_lockDocsUrl`, `_lockSource`) is the same whatever
 * order the store returned the rows in. When no single row declares it (one
 * row refuses writes and another deletes), the document is that lock with no
 * prose.
 *
 * Every caller that enforces or reports an item's lock passes its address
 * here: the `_lock` gate (`otherSpelling: false`, #4432), both item reads and
 * the list (`otherSpelling: true`). Rows are read scope by scope and stop at
 * the first scope that holds one, so the gate reads no more than it did when
 * it read one row.
 */
export async function resolveOverlayLockLayer(
    address: ItemAddress,
    rowsIn: StoredOverlayRowReader,
    options: { readonly otherSpelling: boolean },
): Promise<unknown> {
    const scopes: Array<string | null> = address.organizationId ? [address.organizationId, null] : [null];
    for (const scope of scopes) {
        let rows = await rowsIn(scope, 'canonical');
        if (rows.length === 0 && options.otherSpelling) rows = await rowsIn(scope, 'other');
        if (rows.length > 0) return strictestRowLockDocument(rows, address.packageId);
    }
    return undefined;
}

function strictestRowLockDocument(rows: readonly StoredOverlayRow[], packageId: string | undefined): unknown {
    const declared = rows.map((row) => {
        const document = storedRowDocument(row);
        return { row, document, lock: extractProtection(document).lock };
    });
    const lock = strictestLock(declared.map((d) => d.lock));
    if (lock === 'none') return undefined;
    const rank = (row: StoredOverlayRow): number => {
        const own = row.package_id ?? null;
        if (packageId !== undefined && own === packageId) return 0;
        return own === null ? 1 : 2;
    };
    const ordered = [...declared].sort((a, b) =>
        rank(a.row) - rank(b.row)
        || String(a.row.package_id ?? '').localeCompare(String(b.row.package_id ?? ''))
        || String(a.row.id ?? '').localeCompare(String(b.row.id ?? '')));
    const binding = ordered.find((d) => d.lock === lock);
    if (binding === undefined) return { _lock: lock };
    const source = binding.document as Record<string, unknown>;
    const family: Record<string, unknown> = {};
    for (const key of LOCK_FAMILY_KEYS) {
        if (source[key] !== undefined) family[key] = source[key];
    }
    return family;
}

/**
 * [#21761] `document` with the lock family of the `overlay` layer
 * ({@link resolveOverlayLockLayer}) when that layer binds, so a served body
 * states the lock the envelope reports even when the rows in scope that bind
 * are not the row the body was served from. A key that layer's document does
 * not declare is removed. Returns `document` itself when the overlay layer does
 * not bind or nothing changes (the binding row is the served row), and a copy
 * otherwise. The `artifact` layer's family is `mergeArtifactProtection`'s to
 * put, as before.
 */
export function withOverlayLockFamily(document: unknown, layers: ItemLockLayers): unknown {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return document;
    if (resolveItemLock(layers).layer !== 'overlay') return document;
    const family = layers.overlay as Record<string, unknown>;
    const current = document as Record<string, unknown>;
    if (LOCK_FAMILY_KEYS.every((key) => current[key] === family[key])) return document;
    const out: Record<string, unknown> = { ...current };
    for (const key of LOCK_FAMILY_KEYS) {
        if (family[key] === undefined) delete out[key];
        else out[key] = family[key];
    }
    return out;
}
