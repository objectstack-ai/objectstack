// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 18] The flow save's retired-spelling replay verdict of
 * `ObjectStackProtocolImplementation` (`flowSaveReplaysRetired`, #23903
 * ruling B′): whether a flow save may keep the full conversion chain, because
 * every retired spelling its body carries is one a stored row already carries,
 * moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. The function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same retired set, the same
 * conversion pass and site naming, and the same stored-row reads in the same
 * order.
 *
 * ## How the moved body reaches the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps the method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link FlowSaveReplayHost} members it reads, plus a `.call`. The overlay
 * repository is handed over as a closure that calls the method on the protocol
 * at call time, so a test double or spy set on the instance is still the one
 * the body reaches. Every other reader of the method keeps calling the class
 * method.
 *
 * What the body reads of `protocol.ts`'s own module-level declarations it
 * imports from it; what it imports from elsewhere, it imports from where
 * `protocol.ts` imported it. Nothing re-exports this module, so the published
 * surface does not move.
 */

import { ALL_CONVERSIONS, applyConversionsToFlow, type ConversionNotice } from '@objectstack/spec';
import { itemDiscriminator } from '@objectstack/metadata-core';
import type { MetadataWriteFace, ObjectStackProtocolImplementation } from './protocol.js';
import { FLOW_FALLBACK_VERDICT_NOT_REPLAYED } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the function below reads —
 * every one of them, and no other; the function's `this` is the `Pick` of the
 * members it reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface FlowSaveReplayHost {
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
}

/** The body of `ObjectStackProtocolImplementation#flowSaveReplaysRetired`; the method's docblock there is its contract. */
export async function flowSaveReplaysRetired(
    this: Pick<FlowSaveReplayHost, 'getOverlayRepo'>,
    request: {
        name: string;
        item?: unknown;
        packageId?: string | null;
        source?: string;
        writeFace?: MetadataWriteFace;
    },
    mode: 'draft' | 'publish'
): Promise<boolean> {
    if (request.source !== undefined) return true;
    if (request.writeFace === 'package-duplicate' || request.writeFace === 'package-unmanaged-import') return true;
    const retired = new Set(ALL_CONVERSIONS.filter((c) => c.retiredFromLoadPath).map((c) => c.id));
    // The site of a notice's path, ids standing in for the indexes of the
    // array elements that carry one, read on the converted body it names.
    const siteOf = (root: unknown, path: string): string => {
        let at: unknown = root;
        let site = '';
        for (const [, key, index] of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
            if (key !== undefined) {
                site += site === '' ? key : `.${key}`;
                at = at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined;
                continue;
            }
            const element: unknown = Array.isArray(at) ? at[Number(index)] : undefined;
            const id = element !== null && typeof element === 'object' ? (element as { id?: unknown }).id : undefined;
            site += typeof id === 'string' && id !== '' ? `[#${id}]` : '[' + index + ']';
            at = element;
        }
        return site;
    };
    const retiredHits = (body: unknown): Set<string> => {
        const fired: ConversionNotice[] = [];
        const converted = applyConversionsToFlow(body, {
            includeRetired: true,
            excludeConversionIds: FLOW_FALLBACK_VERDICT_NOT_REPLAYED,
            onNotice: (n) => { if (retired.has(n.conversionId)) fired.push(n); },
        });
        const root = { flows: [converted] };
        return new Set(fired.map((n) => `${n.conversionId}|${n.from}|${siteOf(root, n.path)}`));
    };
    // The request's retired hits; each one a stored row carries is struck off.
    const uncarried = retiredHits(request.item);
    const strikeCarried = (body: unknown): void => {
        if (uncarried.size === 0) return;
        for (const hit of retiredHits(body)) uncarried.delete(hit);
    };
    const repo = this.getOverlayRepo();
    const ref = { type: 'flow', name: request.name, org: 'env' } as Parameters<typeof repo.headAt>[0];
    const member = itemDiscriminator('flow', request.item);
    const state: 'active' | 'draft' = mode === 'draft' ? 'draft' : 'active';
    const target = await repo.headAt(ref, { state, packageId: request.packageId ?? null, member });
    if (target.head) {
        strikeCarried(target.head.body);
        if (uncarried.size === 0) return true;
        if (state !== 'draft') return false;
    } else if (state !== 'draft') {
        return false;
    }
    const active = (await repo.headAt(ref, { state: 'active', packageId: target.packageId, member })).head;
    if (!active) return false;
    strikeCarried(active.body);
    return uncarried.size === 0;
}
