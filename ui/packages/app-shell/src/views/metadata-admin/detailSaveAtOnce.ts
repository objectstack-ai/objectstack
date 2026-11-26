// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36902 (epic objectstack#36890 decisions 1 and 14) — the generic
 * item page's Save takes effect at once, as the Studio designers' Save does
 * (objectstack#36511): the item's draft, then that one item's own publish
 * (`POST /meta/:type/:name/publish`), never the package's batch.
 *
 * Invariants:
 *  - The publish addresses what the draft save wrote: the same package
 *    (`?package=`) and, for a bundle, the same member. The designers' helper
 *    (`studioSaveBar.tsx` `publishSavedItem`) names no member, which is why
 *    this page carries its own.
 *  - Pinned (`pinned`, the buffer's `DraftSaveGuard.publish`), the publish
 *    sends the published version the buffer was loaded at, so a Save over a
 *    row another editor published since is asked about (reload, overwrite or
 *    keep editing) instead of replacing it.
 *  - Refused, the draft the save wrote is taken back when no other draft of
 *    the item was pending before it (`hadDraft` false): a refused Save leaves
 *    nothing behind and the edits stay on the page, unsaved. A draft that was
 *    pending before (the AI assistant's, or a person's from before Save took
 *    effect at once) is kept: it now carries the page's edits too.
 *  - A reload after a conflict takes the saved draft back BEFORE the buffer
 *    is re-read, and that discard is not best-effort: a draft left behind
 *    would be re-read as the buffer and published by the next Save.
 *  - Every path tells the ledger (`emitMetadataRefresh`), so Changes and the
 *    app re-read what went live.
 *  - objectstack#37440 — `draftVersion`, the version the Save's OWN draft
 *    write returned, pins the publish to that draft: a draft another writer
 *    changed in between is refused and nothing is published on their behalf.
 *    That draft now holds the other writer's change and is ⛔ never taken
 *    back; every take-back of the Save's own draft is pinned to the same
 *    version (`If-Match`), so the server removes only that draft.
 */

import type { DraftChange, MetadataClient } from '@object-ui/data-objectstack';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { isAgentDraftSurface } from '../studio-design/StudioDraftMark.js';
import { isDraftVersionConflict, isPublishDraftMoved, type DraftSaveGuard } from './draftVersionGuard.js';

/** The item a Save wrote, at the address its draft save wrote it. */
export interface DetailPublishTarget {
  type: string;
  name: string;
  /** The folded `?package=` binding; absent when the page holds none. */
  packageId?: string;
  /** The bundle member the draft belongs to; absent for the canonical one. */
  member?: string;
  /**
   * objectstack#37440 — the version the Save's own draft write returned (its
   * receipt's `version`), which pins the publish to that draft. Absent, the
   * publish goes unpinned, as before.
   */
  draftVersion?: string;
}

/** What {@link publishDetailSave} did. */
export type DetailPublishOutcome =
  /** The item is live. */
  | { kind: 'published' }
  /** The published row moved and the author chose to reload: the caller's load re-reads the buffer. */
  | { kind: 'reloaded'; draftDiscarded: boolean }
  /** Refused, or the author kept editing after a conflict; `draftDiscarded` says the saved draft was taken back. */
  | { kind: 'refused'; error: unknown; draftDiscarded: boolean };

/** Make the draft a Save just wrote live (see the module docblock). */
export async function publishDetailSave(
  client: Pick<MetadataClient, 'publish' | 'reset' | 'getDraft'>,
  target: DetailPublishTarget,
  hadDraft: boolean,
  pinned?: DraftSaveGuard['publish'],
): Promise<DetailPublishOutcome> {
  const scope = {
    ...(target.packageId ? { packageId: target.packageId } : {}),
    ...(target.member ? { member: target.member } : {}),
  };
  const { draftVersion } = target;
  const publishScope = draftVersion ? { ...scope, draftVersion } : scope;
  // The refusal is the draft pin's: the guard said so, or no other pin was sent.
  const draftMoved = (error: unknown): boolean =>
    isPublishDraftMoved(error) || (!pinned && !!draftVersion && isDraftVersionConflict(error));
  let draftDiscarded = false;
  const takeBack = async (): Promise<void> => {
    await client.reset(target.type, target.name, {
      state: 'draft',
      ...scope,
      ...(draftVersion ? { ifMatch: draftVersion } : {}),
    });
    draftDiscarded = true;
  };
  try {
    if (pinned) {
      const outcome = await pinned(client, target.type, target.name, publishScope, hadDraft ? undefined : takeBack);
      if (outcome === 'reloaded') {
        emitMetadataRefresh();
        return { kind: 'reloaded', draftDiscarded };
      }
    } else {
      await client.publish(target.type, target.name, publishScope);
    }
  } catch (error) {
    // objectstack#37440 — another writer's change is in the draft now: kept.
    if (!hadDraft && !draftDiscarded && !draftMoved(error)) {
      try {
        await takeBack();
      } catch (discardError) {
        // The draft stays pending, listed under Changes, where it can be discarded.
        console.error('[metadata] a refused publish left the saved draft pending:', discardError);
      }
    }
    emitMetadataRefresh();
    return { kind: 'refused', error, draftDiscarded };
  }
  emitMetadataRefresh();
  return { kind: 'published' };
}

/**
 * Whether a pending draft is the AI assistant's: some key of it was last
 * written by the copilot or an MCP client (`draftChanges[].by`), the rule the
 * designers' notice reads (`StudioDraftMark.tsx`). A draft whose read recorded
 * no provenance (`null`) is a person's.
 */
export function isAiDraft(changes: readonly DraftChange[] | null | undefined): boolean {
  return (changes ?? []).some((change) => isAgentDraftSurface(change.by));
}
