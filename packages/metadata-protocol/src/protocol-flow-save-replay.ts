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
 *
 * ## [#29557] The flow verdict body, one seam for every door that judges a flow
 *
 * {@link flowVerdictBody} below is the conversion the save door's fallback
 * verdict (#21982) applies, and {@link storedFlowVerdictBody} is that same
 * conversion asked of a STORED flow draft: the body the per-item publish, the
 * package publish (both through `promoteDraftForPublish`) and the draft read's
 * publish verdict (`draftPublishVerdict`) judge. One judge, one spelling: a
 * legacy D2 spelling the save door accepted and stored raw is accepted at
 * publish too, and what goes live is still the stored bytes.
 *
 * [#29696] The two other judges of a flow at rest judge through it too: the
 * read's `_diagnostics` schema half (`computeMetadataDiagnostics`, every read
 * exit that decorates) and the restore doors' runtime rules
 * (`refuseRestoredBodyTheSaveDoorRefuses`, for `rollbackMetaItem` and
 * `revertCommit`). Each serves or restores the body as stored.
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

/**
 * [#21982] The body a flow is JUDGED in when the save door's canonicalizer did
 * not resolve or threw: the request body with the spec's ADR-0087 D2
 * conversions applied (`applyConversionsToFlow`), the full chain minus
 * {@link FLOW_FALLBACK_VERDICT_NOT_REPLAYED}, with the retired entries when
 * `includeRetired` says so. For the VERDICT only: the caller stores the body
 * it was handed, never this one. A key no conversion rewrites is judged
 * exactly as written.
 */
export function flowVerdictBody(body: unknown, options: { includeRetired: boolean }): unknown {
    return applyConversionsToFlow(body, {
        includeRetired: options.includeRetired,
        excludeConversionIds: FLOW_FALLBACK_VERDICT_NOT_REPLAYED,
    });
}

/**
 * [#29557] The body a STORED flow is judged in: for a `flow`, the
 * {@link flowVerdictBody} of the row with the retired entries included; every
 * other type, the row as stored. The two publish doors and the draft read's
 * publish verdict judge a stored draft through here, [#29696] the read's
 * `_diagnostics` schema half judges a served row and the restore doors' runtime
 * rules a history version; each promotes, serves or restores the row as stored.
 *
 * A stored row is data at rest, so the chain is the one the automation engine
 * replays when it registers the row: its stored-flow canonicalizer
 * (`canonicalizeFlow` in `service-automation/src/flow-definitions.ts`), which
 * every caller but the save door calls with no options, so retired entries
 * included, and which excludes `CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION`. That
 * list and {@link FLOW_FALLBACK_VERDICT_NOT_REPLAYED} name the same one entry,
 * `flow-decision-mode-inclusive-explicit`, so this verdict replays exactly the
 * engine's chain. The entry is a DEFAULT FLIP, not a rescue: it writes
 * `mode: 'inclusive'` where a decision omits `mode`, and an omitted `mode`
 * parses (it means exclusive), so leaving it out never turns an accepted body
 * into a refused one; it only keeps the verdict from judging a meaning the row
 * does not have. By maintainer ruling (letter C on #15429) it is not replayed
 * over stored flows at all. No read path converts a flow either:
 * `convertStoredItem` skips `flow`, and `applyConversionsToStoredItem` is not
 * applied to it.
 *
 * The retired-entry predicate of the save door ({@link flowSaveReplaysRetired},
 * #23903 ruling B') is not asked again: it judges authored input, and the
 * row's own save asked it, in draft mode as in publish mode. `type` is the
 * singular type name.
 */
export function storedFlowVerdictBody(type: string, body: unknown): unknown {
    return type === 'flow' ? flowVerdictBody(body, { includeRetired: true }) : body;
}
