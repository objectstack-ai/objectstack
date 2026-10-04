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
 * ⛔ Not a policy of its own. Each caller decides which document it hands each
 * layer: the door hands the canonical-spelling, package-agnostic row; the reads
 * hand the row they serve (see `findServedOverlayRow` for the one declared
 * difference between the two).
 */
import { extractProtection, type MetadataLock, type MetadataLockSource } from '@objectstack/spec/kernel';

/**
 * The layers an item's lock can come from, in precedence order:
 *
 *  - `artifact`: the item a code package's loader registered (ADR-0010 §3.3,
 *    "an overlay cannot loosen a packaged lock");
 *  - `overlay`: the stored `sys_metadata` row (ADR-0005), as the caller
 *    resolved it.
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
