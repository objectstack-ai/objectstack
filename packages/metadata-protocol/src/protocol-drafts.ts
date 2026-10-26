// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 12] The draft pair of `ObjectStackProtocolImplementation` — the
 * environment's pending drafts as the `_drafts` doors list them
 * (`listDrafts`) and the per-draft discard step the package batch doors share
 * (`discardDraftInItsScope`) — moved out of `protocol.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited: the same reads, the same
 * disabled-package filter and member projection, the same delete request.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps every method — the published `dist/*.d.ts` lists each one's
 * name, docblock and declared signature, `listDrafts`' declared return type
 * included — and each body is one literal of exactly the {@link DraftsHost}
 * members that method reads, plus a `.call`. A method is handed over as a
 * closure that calls it on the protocol at call time, so a test double or spy
 * set on the instance is still the one the body reaches. Every other reader of
 * these two methods keeps calling the class method.
 *
 * The field the bodies read, `engine`, goes as a GETTER, so each read happens
 * when the body makes it: tests replace it on a constructed protocol.
 *
 * The module-level declarations of `protocol.ts` the bodies read stay there,
 * where code that did not move reads them too, and are imported from there:
 * `isItemOfDisabledPackage` and `bundleMemberDiscriminator`. The module cycle
 * is evaluation-safe because each is read only inside a function body, never
 * while the two modules are first evaluated. `index.ts` names what it
 * publishes from `protocol.ts` one by one, so the `export` they gained for
 * this keeps them off the published surface, and nothing re-exports this
 * module, so the published surface does not move.
 */

import type { ObjectStackProtocolImplementation } from './protocol.js';
import { bundleMemberDiscriminator, isItemOfDisabledPackage } from './protocol.js';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import type { I18nLabel } from '@objectstack/spec/ui';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of the
 * members IT reads. Each is typed AS the class member (an indexed access on
 * the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 * See the module header for which members are getters.
 */
export interface DraftsHost {
    readonly engine: ObjectStackProtocolImplementation['engine'];
    ensureOverlayIndex: ObjectStackProtocolImplementation['ensureOverlayIndex'];
    getOverlayRepo: ObjectStackProtocolImplementation['getOverlayRepo'];
    deleteMetaItem: ObjectStackProtocolImplementation['deleteMetaItem'];
}

/** The body of `ObjectStackProtocolImplementation#listDrafts`; the method's docblock there is its contract. */
export async function listDrafts(
    this: Pick<DraftsHost, 'engine' | 'ensureOverlayIndex' | 'getOverlayRepo'>,
    request?: {
        packageId?: string;
        type?: string;
    }
): Promise<{
    drafts: Array<{
        type: string;
        name: string;
        /** [#23073] The bundle member the draft is (`'zh-CN'`, the canonical `'en-US'`); absent for a type with no members. */
        member?: string;
        /** The draft body's own top-level `label`, as authored; `null` when it declares none. */
        label: I18nLabel | null;
        packageId: string | null;
        updatedAt: string | null;
        updatedBy: string | null;
    }>;
}> {
    await this.ensureOverlayIndex();
    // [ADR-0131 D6] The environment's pending drafts.
    const repo = this.getOverlayRepo();
    const drafts = await repo.listDrafts({
        ...(request?.type ? { type: PLURAL_TO_SINGULAR[request.type] ?? request.type } : {}),
        ...(request?.packageId ? { packageId: request.packageId } : {}),
    });
    // [#23073] The declared header (`ListDraftsResponseSchema`), with the
    // row's stored member on every draft of a bundled type: absent there
    // means the canonical member, which is spelled out here.
    const served = drafts.filter((draft) => draft.type === 'package'
        || !isItemOfDisabledPackage(this.engine?.registry, { _packageId: draft.packageId }));
    return {
        drafts: served.map(({ member: stored, ...header }) => {
            const member = bundleMemberDiscriminator(header.type, stored);
            return member === undefined ? header : { ...header, member };
        }),
    };
}

/** The body of `ObjectStackProtocolImplementation#discardDraftInItsScope`; the method's docblock there is its contract. */
export async function discardDraftInItsScope(
    this: Pick<DraftsHost, 'deleteMetaItem'>,
    /**
     * [#22877] `member` — the draft's bundle member, as `listDrafts`
     * surfaced it: the discard removes THAT member's draft. Without it the
     * canonical member's was addressed for every draft of the name, so a
     * second locale's draft answered "no pending draft" and stayed.
     */
    draft: { type: string; name: string; member?: string; packageId?: string | null },
    actor: string | undefined,
): Promise<void> {
    await this.deleteMetaItem({
        type: draft.type,
        name: draft.name,
        state: 'draft',
        ...(actor ? { actor } : {}),
        ...(draft.member !== undefined ? { member: draft.member } : {}),
        // [#23165, ADR-0048] The package the draft was listed under: the
        // discard removes THAT package's draft, never another package's
        // draft of the same name.
        ...(draft.packageId !== undefined ? { packageId: draft.packageId } : {}),
    });
}
