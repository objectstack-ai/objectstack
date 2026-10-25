// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 (Target item 5) — the item header's draft line,
 * 「草稿 · N 项未发布」: the open item has a pending draft, and N is the number
 * the top bar's 变更 badge shows.
 *
 * ## One source with the badge
 *
 * The line reads the same `_drafts` ledger the badge counts
 * (`usePendingDrafts` in `StudioDesignSurface`), provided to the pillars by
 * {@link StudioPendingDraftsContext}. The ledger is re-read on the surface's
 * mount, on a publish, on a Studio draft save, and on the assistant bus's
 * pulse, which the copilot sends the moment a `drafted` tool result lands
 * (`ChatPane`). So a draft the copilot wrote to the open item shows on its
 * header as it lands, and the line goes when a publish or a discard takes the
 * item off the ledger, whichever door did it.
 *
 * The pillar's own reading of its item (`hasDraft`, set when it loads or saves
 * the item) is taken once at load and is not re-read on the pulse: on its own
 * it would miss a draft the copilot wrote after the load, and keep a draft that
 * a discard elsewhere removed. It counts here only while the ledger is behind
 * a save this surface made (`behindSave`, objectui#11787), so the line shows
 * from the render the save lands in.
 *
 * ## N
 *
 * The package's pending count: publishing is package-level (every pending
 * draft of the package goes live together; there is no per-item publish), so
 * the line tells the author this item is one of N unpublished changes, the N
 * the badge and the copilot's 「已存为草稿 · N 项」 card both show.
 *
 * ## Where the ledger is not in hand
 *
 * A pillar mounted without the surface (no context), or a ledger that could
 * not be read (`count: null`), keeps the chip it always had: the pillar's own
 * reading, labelled "Unpublished draft", with no count it does not know.
 */

import * as React from 'react';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { t, tFormat } from '../metadata-admin/i18n.js';
import type { StudioItemStatus } from './StudioItemHeader.js';

/** The pending-drafts ledger as the surface holds it for its pillars. */
export interface StudioPendingDrafts {
  /** The 变更 badge's number; `null` while the ledger is unknown. */
  count: number | null;
  /** The ledger's rows the badge counts: each row's stored type and name. */
  entries: ReadonlyArray<{ type: string; name: string }>;
  /** A Studio draft save landed and no ledger read sent after it has answered. */
  behindSave: boolean;
}

/** Provided by `StudioDesignSurface` around its pillars. */
export const StudioPendingDraftsContext = React.createContext<StudioPendingDrafts | null>(null);

/** The item a pillar's header names, as `/meta` addresses it. */
export interface StudioDraftItem {
  type: string;
  name: string;
}

/**
 * The header's status chip for `item`, or `undefined` for none. `ownDraft` is
 * the pillar's own reading of the item (a pending draft found at load or
 * written by its save).
 */
export function studioItemDraftStatus(
  pending: StudioPendingDrafts | null,
  item: StudioDraftItem | null,
  ownDraft: boolean,
  locale: string | undefined,
): StudioItemStatus | undefined {
  if (!item) return undefined;
  if (pending === null || pending.count === null) {
    return ownDraft ? { label: t('engine.studio.unpublishedDraft', locale) } : undefined;
  }
  // A stored type spelling is folded as every `/meta` reader folds it.
  const listed = pending.entries.some(
    (entry) => entry.name === item.name && canonicalMetaUrlType(entry.type) === item.type,
  );
  if (!listed && !(ownDraft && pending.behindSave)) return undefined;
  // The badge's number, which is at least one while a save is uncounted.
  const count = Math.max(pending.count, 1);
  return {
    label: tFormat('engine.studio.itemDraftPending', locale, { count }),
    title: tFormat('engine.studio.itemDraftPendingTitle', locale, { count }),
  };
}

/** {@link studioItemDraftStatus} over the surface's ledger. */
export function useStudioItemDraftStatus(
  item: StudioDraftItem | null,
  ownDraft: boolean,
  locale: string | undefined,
): StudioItemStatus | undefined {
  const pending = React.useContext(StudioPendingDraftsContext);
  return studioItemDraftStatus(pending, item, ownDraft, locale);
}
