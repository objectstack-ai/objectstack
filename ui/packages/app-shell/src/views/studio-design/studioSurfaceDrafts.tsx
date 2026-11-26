// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's publish and drafts state, moved out of
 * `StudioDesignSurface.tsx` unchanged by objectstack#37553 (a move-only
 * split): the Pending changes sheet (opened from `?changes=review`), the
 * publish and draft-save nonces, the pending-drafts ledger the badges count
 * and 概览's Pending tab lists, and the refusals a publish leaves on its
 * entries.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import type { StudioPendingDrafts } from './studioItemDraftStatus.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import type { StudioSavedDraft } from './StudioPillarKit.js';
import { usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { STUDIO_CHANGES_PARAM, STUDIO_CHANGES_REVIEW } from './studioChangesLink.js';
import type { StudioRefusal } from './metadataError.js';
import { isOrgScopeDraft } from './studioScope.js';
import type { SupportedLocale } from '../metadata-admin/i18n.js';
import type { DraftChangeEntry } from '../../preview/DraftChangesPanel.js';

/**
 * objectstack#26730 — which Pending changes entry a kept publish refusal
 * belongs to: the draft's canonical type and name. The `_drafts` feed and
 * `failed[]` may spell a type either way; the panel's entries are folded.
 */
export function publishRefusalKey(type: string, name: string): string {
  return `${canonicalMetaUrlType(type)}/${name}`;
}

export const NO_PUBLISH_REFUSALS: ReadonlyMap<string, StudioRefusal> = new Map();

/** The Pending changes sheet's open state and the nonces a publish and a draft save move. */
export function useStudioChangesSheet() {
  // Package-level publish (ADR-0033/0037/0048): drafts are per item, STAMPED
  // with this package (each save passes packageId → the draft row's
  // sys_metadata.package_id). Publishing promotes exactly THIS package's drafts in
  // one atomic pass (POST /packages/:id/publish-drafts), reviewed as a whole in
  // DraftChangesPanel. objectstack#36511 — an editor converted to the top bar's
  // Save writes its item's draft and publishes that one item at once
  // (`publishSavedItem`), so it leaves no draft; Changes and Publish are for the
  // drafts other writers (the copilot) and the editors not yet converted leave.
  const [changesOpen, setChangesOpen] = React.useState(false);
  // objectui#12517 — the sheet opened to confirm from the top bar's Publish;
  // objectstack#37456 — that Publish is gone (概览's Pending tab publishes), so
  // every door left opens the sheet to review, the panel's own default.
  // objectui#12894 — the drawer's one way in from outside the top bar:
  // `?changes=review` (`studioChangesLink.ts`), written by the copilot's
  // applied card (查看变更并发布). Opened to review, then the param is dropped
  // (replace) so a refresh or a Back does not reopen it. Read on every change,
  // not only at mount: the Studio copilot writes it while the surface is up.
  const [searchParams, setSearchParams] = useSearchParams();
  const changesRequest = searchParams.get(STUDIO_CHANGES_PARAM);
  React.useEffect(() => {
    if (changesRequest === null) return;
    if (changesRequest === STUDIO_CHANGES_REVIEW) {
      setChangesOpen(true);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(STUDIO_CHANGES_PARAM);
        return next;
      },
      { replace: true },
    );
    // Keyed on the param's value alone: `setSearchParams` is re-minted with
    // every search change (objectui#8640 — never key on a hook's identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changesRequest]);
  const [publishing, setPublishing] = React.useState(false);
  const [publishNonce, setPublishNonce] = React.useState(0); // ↑ → pillars re-read the published baseline
  const [draftNonce, setDraftNonce] = React.useState(0); // ↑ → a draft save landed (`onDraftSaved`)
  return {
    changesOpen,
    setChangesOpen,
    publishing,
    setPublishing,
    publishNonce,
    setPublishNonce,
    draftNonce,
    setDraftNonce,
  };
}

/** The pending-drafts ledger, its count and the refusals kept on its entries. */
export function useStudioDraftLedger({
  packageId,
  draftScope,
  publishNonce,
  setDraftNonce,
  locale,
}: {
  packageId: string | null;
  draftScope: string | null;
  publishNonce: number;
  setDraftNonce: React.Dispatch<React.SetStateAction<number>>;
  locale: SupportedLocale;
}) {
  // objectstack#26730 — what the last publish refused, by draft
  // (`publishRefusalKey`), each shown on its Pending changes entry until it is
  // resolved: the draft saved again, a publish that lets it through, or the
  // draft no longer pending. A toast alone was gone in four seconds.
  const [publishRefusals, setPublishRefusals] = React.useState(NO_PUBLISH_REFUSALS);

  // objectui#5801 — the shared pending-drafts source: same fetch, same count,
  // and the assistant bus's metadata-refresh pulse keeps this topbar in step
  // with every OTHER surface's publishes (chat bar, home banner) — previously
  // a publish from the right dock never updated this count.
  //
  // objectui#11553 — the package-less scope reads the env-wide feed and counts
  // only what it shows and publishes: package-less FLOW drafts. Still `null`
  // while the feed is unknown, so the header keeps telling unknown from zero.
  const {
    count: feedCount,
    entries: pendingEntries,
    refresh: refreshPending,
    behindSave,
  } = usePendingDrafts({ packageId: draftScope });
  const pendingCount =
    packageId !== null ? feedCount : feedCount === null ? null : pendingEntries.filter(isOrgScopeDraft).length;

  // A draft save asks for its own read (`onDraftSaved` below, objectui#11787);
  // this one serves the mount and a publish.
  React.useEffect(() => {
    void refreshPending();
  }, [refreshPending, publishNonce]);
  const refreshPendingRef = React.useRef(refreshPending);
  React.useLayoutEffect(() => {
    refreshPendingRef.current = refreshPending;
  });
  // A kept refusal whose draft the ledger no longer lists has nothing left to
  // fix (discarded, or published from another surface), so it is not shown.
  // Read only off a known ledger: an unknown one (`feedCount === null`) lists nothing.
  const listedPublishRefusals = React.useMemo(() => {
    if (feedCount === null || publishRefusals.size === 0) return publishRefusals;
    const listed = new Set(pendingEntries.map((e) => publishRefusalKey(e.type, e.name)));
    return new Map([...publishRefusals].filter(([key]) => listed.has(key)));
  }, [feedCount, pendingEntries, publishRefusals]);
  // objectui#11787 — a Studio draft save reports here when it lands, and the
  // count follows it: the read it asks for is sent after the save, never
  // answered by a read already on the wire, and until that read answers the
  // count is at least the one draft the save wrote (`behindSave`). So the
  // header stops saying "No drafts pending publish" in the same render that
  // shows an item's "Unpublished draft" chip, both being set by the save that
  // landed. Pinned by `StudioDesignSurface.changesCount-11787.test.tsx`.
  //
  // objectstack#26730 — `saved` names the draft the save wrote, and a refusal
  // its last publish left is dropped: the author has changed what was judged.
  const onDraftSaved = React.useCallback((saved?: StudioSavedDraft) => {
    if (saved) {
      const key = publishRefusalKey(saved.type, saved.name);
      setPublishRefusals((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
    setDraftNonce((n) => n + 1);
    void refreshPendingRef.current({ afterSave: true });
  }, []);
  // objectstack#26730 — the refusal kept for an entry, under its row in the
  // sheet. No "Show me" there: the sheet's way to an item is its own link, and
  // the strip's opens an input only in the pillar that holds the item.
  const renderPublishRefusal = React.useCallback(
    (entry: DraftChangeEntry) => {
      const refusal = listedPublishRefusals.get(publishRefusalKey(entry.type, entry.name));
      return refusal ? <StudioRefusalStrip refusal={refusal} locale={locale} className="px-2 py-1.5 text-xs" /> : null;
    },
    [listedPublishRefusals, locale],
  );
  // objectstack#30064 — the same kept refusal, for the All metadata area's
  // editor of the item it refused (a customized dataset), shown at the item.
  const publishRefusalFor = React.useCallback(
    (type: string, name: string): StudioRefusal | null => listedPublishRefusals.get(publishRefusalKey(type, name)) ?? null,
    [listedPublishRefusals],
  );
  const shownPendingCount = behindSave ? Math.max(pendingCount ?? 0, 1) : pendingCount;
  // objectui#12725 — the same ledger and number, for the pillars' item headers
  // (「草稿 · N 项未发布」): the rows the count above counts, so the package-less
  // scope offers its org-scope flow drafts only.
  const pillarPendingDrafts = React.useMemo<StudioPendingDrafts>(
    () => ({
      count: shownPendingCount,
      entries: packageId !== null ? pendingEntries : pendingEntries.filter(isOrgScopeDraft),
      behindSave,
    }),
    [shownPendingCount, packageId, pendingEntries, behindSave],
  );
  return {
    setPublishRefusals,
    refreshPending,
    onDraftSaved,
    renderPublishRefusal,
    publishRefusalFor,
    shownPendingCount,
    pillarPendingDrafts,
  };
}
