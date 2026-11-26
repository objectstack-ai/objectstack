// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The design surface's publish, moved out of `StudioDesignSurface.tsx`
 * unchanged by objectstack#37553 (a move-only split): the one publish every
 * door runs (概览's Pending tab, the review sheet), on a package's drafts
 * through the batch door or, in the package-less scope, flow by flow, and the
 * toast that says what went live, what was refused and what the backfill wrote.
 */

import * as React from 'react';
// The ONE draft-envelope reader (objectui#8181): unwrap AND strip the
// framework's read decorations in one place. This file used to carry its own
// copy that did the unwrap and skipped the strip.
// …and `formatMetadataError`, the one metadata-save error reader (objectui#11302).
// …and `dropServedPicklistOptions`, the served -> authored conversion of a
// picklist-bound field (objectui#10202), moved here by objectui#11692.
import {
  extractDraftBody,
  formatMetadataError,
} from '@object-ui/data-objectstack';
import type { MetadataClient, MetadataError } from '@object-ui/data-objectstack';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { toast } from 'sonner';
import { fetchPendingDrafts, type UsePendingDraftsResult } from '../../preview/usePendingDrafts.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import type { DraftPublishOptions } from '../../preview/DraftChangesPanel.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import {
  BATCH_ABORTED_CODE,
  causalPublishFailures,
  publishRefusal,
  type PublishFailure,
  type StudioRefusal,
} from './metadataError.js';
import type { StudioSaveCoordinator } from './studioSaveBar.js';
import { isOrgScopeDraft } from './studioScope.js';
import { NO_PUBLISH_REFUSALS, publishRefusalKey } from './studioSurfaceDrafts.js';

/** The batch door's `backfillApplied` receipt, by reference to what the client returns (objectui#12929). */
type PublishBackfillReceipt = NonNullable<
  Awaited<ReturnType<MetadataClient['publishPackageDrafts']>>['backfillApplied']
>;

/**
 * objectui#12929 — the batch door's backfill receipt as the author reads it:
 * one clause per field, in the order the publish named them, carrying the rows
 * the server says it wrote (`updated`) and, for a field that stopped short, the
 * server's reason. Nothing is derived or estimated here — not a total, and not
 * the record count the sheet showed before the publish.
 */
function formatBackfillReceipt(receipt: PublishBackfillReceipt, locale: string): string {
  return receipt.fields
    .map((f) =>
      tFormat(f.error ? 'engine.studio.backfillStopped' : 'engine.studio.backfillWritten', locale, {
        field: `${f.object}.${f.field}`,
        count: f.updated,
        error: f.error ?? '',
      }),
    )
    .join(' · ');
}

/** The surface's publish, and the toast's way to the package's permission sets. */
export function useStudioPublishAction({
  shellClient,
  packageId,
  pairId,
  draftScope,
  refreshPending,
  locale,
  heldEdit,
  saveBar,
  setPublishing,
  setPublishRefusals,
  setChangesOpen,
  setPublishNonce,
}: {
  shellClient: MetadataClient;
  packageId: string | null;
  pairId: string | null;
  draftScope: string | null;
  refreshPending: UsePendingDraftsResult['refresh'];
  locale: SupportedLocale;
  heldEdit: string | null;
  saveBar: StudioSaveCoordinator;
  setPublishing: React.Dispatch<React.SetStateAction<boolean>>;
  setPublishRefusals: React.Dispatch<React.SetStateAction<ReadonlyMap<string, StudioRefusal>>>;
  setChangesOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPublishNonce: React.Dispatch<React.SetStateAction<number>>;
}) {
  // The publish toast's way to the package's permission sets; set once the router's
  // navigate is in hand below.
  const openAccessRef = React.useRef<() => void>(() => {});

  // `options` is the review sheet's (objectui#12929): its checked backfill
  // choices, or nothing. Only the package batch door below carries it; the
  // sheet offers no choice in the package-less scope.
  const doPublish = React.useCallback(async (options?: DraftPublishOptions) => {
    if (heldEdit !== null) {
      toast.error(tFormat('engine.studio.held.publish', locale, { clause: heldEdit }));
      return;
    }
    // objectstack#36511 — a publish re-reads the open page from the server, so
    // it would drop edits still waiting for Save: they are saved or cancelled first.
    if (saveBar.dirty) {
      toast.error(t('engine.studio.save.publishFirst', locale));
      return;
    }
    setPublishing(true);
    // objectstack#26730 — a refusal is kept on each causal draft's entry, read
    // by the refused-save reader against the draft the publish judged, and the
    // toast says so. ⛔ It names no engine text: that stays under Details.
    const keepRefusals = async (failed: PublishFailure[]): Promise<void> => {
      const kept = await Promise.all(
        causalPublishFailures(failed).map(async (f) => {
          const type = canonicalMetaUrlType(f.type);
          // Only an issue has a place to point at; the read is best-effort.
          const body =
            Array.isArray(f.issues) && f.issues.length > 0
              ? await shellClient
                  .getDraft<Record<string, unknown>>(f.type, f.name, draftScope !== null ? { packageId: draftScope } : {})
                  .then((resp) => extractDraftBody(resp) as Record<string, unknown> | null, () => null)
              : null;
          return [publishRefusalKey(type, f.name), f.name, publishRefusal(f, type, body, locale)] as const;
        }),
      );
      setPublishRefusals(new Map(kept.map(([key, , refusal]) => [key, refusal])));
      const lines = kept.map(([, name, refusal]) => `${name}: ${refusal.message}`);
      if (failed.some((f) => f.code === BATCH_ABORTED_CODE)) lines.unshift(t('engine.studio.publishRefusedBatch', locale));
      toast.error(
        tFormat(kept.length === 1 ? 'engine.studio.publishRefusedOne' : 'engine.studio.publishRefused', locale, {
          count: kept.length,
        }),
        { description: lines.join('\n') },
      );
    };
    try {
      if (packageId === null) {
        // objectui#11553 — the package-less scope has no package to publish
        // as a batch: `POST /packages/:id/publish-drafts` cannot reach a draft
        // bound to none. Each package-less flow draft is promoted BY REFERENCE
        // instead, through the single-item door the client documents for
        // exactly that case (`publishDraft`), as Home's publish-all does for
        // its package-less drafts. Read fresh, never from the header's count,
        // and narrowed to what this scope reviewed: package-less flows.
        const pending = (await fetchPendingDrafts(null)).filter(isOrgScopeDraft);
        const failed: PublishFailure[] = [];
        for (const d of pending) {
          try {
            await shellClient.publishDraft('flow', d.name);
          } catch (e) {
            failed.push({
              type: 'flow',
              name: d.name,
              error: formatMetadataError(e),
              issues: (e as Partial<MetadataError> | null)?.issues,
            });
          }
        }
        if (failed.length > 0) {
          // Not all-or-nothing: the drafts that went live stay live, and the
          // ones that did not keep their reason on their entries.
          await keepRefusals(failed);
        } else if (pending.length === 0) {
          // objectui#11807 — nothing was pending by the time this read ran, so
          // nothing went live: said as such, never as a success.
          toast.info(t('engine.studio.publishNoneTitle', locale));
          setChangesOpen(false);
        } else {
          // objectui#11807 — how many went live: every draft read above, as
          // none failed.
          // The toast names what went live: one flow in its title, several
          // by count with their names in the description.
          setPublishRefusals(NO_PUBLISH_REFUSALS);
          const names = pending.map((d) => resolveI18nLabel(d.label, locale)?.trim() || d.name);
          if (names.length === 1) {
            toast.success(tFormat('engine.studio.publishedAllFlowsOne', locale, { label: names[0] }));
          } else {
            toast.success(tFormat('engine.studio.publishedAllFlows', locale, { count: names.length }), {
              description: names.join(', '),
            });
          }
          setChangesOpen(false);
        }
        setPublishNonce((n) => n + 1);
        emitMetadataRefresh();
        // The tail below the `finally` is the package path's; this one
        // re-reads the count itself before leaving.
        await refreshPending();
        return;
      }
      // objectui#10039 — through `MetadataClient`, not a bare `fetch`. The
      // route answers the runtime authoring gate's per-draft advisories on
      // each `published[]` element (objectstack#9343), and the client is the
      // seam that reports them: one advisory event per advised item, into the
      // same sink, renderer and wording every other write door on this surface
      // uses. A bare fetch had nothing to report THROUGH. Same move
      // PR objectui#10038 made for the two sibling call sites.
      // objectui#12929 — the sheet's options ride only when it gave some, so an
      // unchecked publish is the very call it was before.
      // objectstack#28562 — on a read-only base, its pair's drafts.
      const publishTarget = pairId ?? packageId;
      const payload = (await (options
        ? shellClient.publishPackageDrafts(publishTarget, options)
        : shellClient.publishPackageDrafts(publishTarget))) as {
        success?: boolean;
        outcome?: string;
        error?: { message?: string; details?: { issues?: unknown } };
        failed?: PublishFailure[];
        published?: unknown[];
        backfillApplied?: PublishBackfillReceipt;
      };
      // A non-2xx now throws inside the client, already carrying the server's
      // message AND the field-anchored `error.details.issues` on
      // `MetadataError.issues` — which is exactly what `formatMetadataError`
      // in the catch below reads, so the hard-failure branch keeps its shape
      // without restating it. What is left here is the 2xx batch verdict.
      //
      // `failed[]` off the body the client returns: it unwraps the
      // dispatcher's `{ success, data }` for this route (the one route whose
      // spec declaration says it arrives inside one), so the enveloped and
      // unenveloped compositions read through ONE spelling here.
      const failed = payload?.failed ?? [];
      if (payload?.outcome === 'nothing_to_publish') {
        // objectui#11807 — the batch's zero answer: nothing went live and
        // nothing was refused. `success` is false on it too, and the spec says
        // to read `outcome` rather than that boolean
        // (`PublishPackageDraftsResponseSchema`), so it is neither the failure
        // below nor a success.
        toast.info(t('engine.studio.publishNoneTitle', locale));
        setPublishRefusals(NO_PUBLISH_REFUSALS);
        setChangesOpen(false);
      } else if (failed.length > 0) {
        // Partial publish: some drafts did NOT go live. The server returns 200
        // with them buried in `failed[]`, so the UI used to claim success and
        // swallow the reason — surface which drafts failed and why instead.
        //
        // objectui#11807 — read BEFORE `success === false`, because a refusal
        // carries both: the batch's own `success` is false on `refused`, and
        // `failed[]` is where its reasons are. Asked in the other order (as
        // since objectui#10039 moved this call onto the client, which unwraps
        // the dispatcher's envelope and so hands back the batch's own
        // `success`), every refusal reached the author as "Action failed".
        await keepRefusals(failed);
      } else if (payload?.success === false && payload?.outcome !== 'published_unregistered') {
        // objectstack#33277 — `published_unregistered` answers `success: false`
        // over drafts that DID land: the registry refused an object, and that
        // object's `published[]` element carries the warning the client has
        // already reported. It reads as the published branch below, as it did
        // while the server answered `published` for it.
        //
        // The status is no longer in hand — a non-2xx threw above — so the
        // last rung is a sentence rather than "HTTP 200".
        throw Object.assign(
          new Error(
            // The sibling call site's own last rung for THIS route
            // (`PackagesPage`'s `publishDrafts`), reused rather than a new
            // key: one route, one sentence when the body carried no prose.
            readEnvelopeFailureText(payload) ||
              t('engine.packages.detail.actionFailed', locale),
          ),
          { issues: payload?.error?.details?.issues },
        );
      } else {
        // objectui#11807 — name how many items went live, read off the batch's
        // own `published[]` (every promoted draft, a draft that changed
        // nothing included). A runtime that answers without it gets the
        // sentence that names no number.
        setPublishRefusals(NO_PUBLISH_REFUSALS);
        const published = payload?.published;
        const title = Array.isArray(published)
          ? tFormat(
              published.length === 1 ? 'engine.studio.publishedAllCountOne' : 'engine.studio.publishedAllCount',
              locale,
              { count: published.length },
            )
          : t('engine.studio.publishedAll', locale);
        // objectui#12929 — the backfill receipt, present only when the sheet
        // named fields and the batch published: per field, the rows the server
        // wrote. A field that stopped short leaves the publish standing, so the
        // toast still says what went live, as a warning that carries why.
        const receipt = payload?.backfillApplied;
        // A published app or object reaches members only through a permission
        // set, so the toast points the author to Access.
        const reachesMembers =
          Array.isArray(published) &&
          published.some((p) => {
            const type = (p as { type?: unknown } | null)?.type;
            return type === 'app' || type === 'object';
          });
        const access = reachesMembers
          ? {
              action: {
                label: t('engine.studio.publishedOpenAccess', locale),
                onClick: () => openAccessRef.current(),
              },
            }
          : {};
        if (receipt) {
          const description = formatBackfillReceipt(receipt, locale);
          if (receipt.success === false) toast.warning(title, { description, ...access });
          else toast.success(title, { description, ...access });
        } else if (reachesMembers) {
          toast.success(title, { description: t('engine.studio.publishedAccessHint', locale), ...access });
        } else {
          toast.success(title);
        }
        setChangesOpen(false);
      }
      setPublishNonce((n) => n + 1);
      // objectui#5801 — announce the publish so the chat bar / home banner /
      // draft cards converge without their own polling.
      emitMetadataRefresh();
    } catch (e) {
      toast.error(formatMetadataError(e));
    } finally {
      setPublishing(false);
    }
    await refreshPending();
  }, [shellClient, packageId, pairId, draftScope, refreshPending, locale, heldEdit, saveBar.dirty]);
  return { openAccessRef, doPublish };
}
