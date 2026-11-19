/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One-click "publish everything pending" — shared by the Home pending-drafts
 * banner and the ADR-0037 draft-preview bar, so both surfaces publish through
 * the SAME governed path and report the SAME health.
 *
 * Package-bound drafts go through `POST /packages/:id/publish-drafts` — the
 * path that orders structure-before-seeds server-side and runs the ADR-0038
 * L3 runtime probes; findings surface as a loud warning toast instead of a
 * blind "Published!". Package-less drafts fall back to by-reference publish
 * (structure first, seeds last) so they never dead-end.
 *
 * Both halves of that call now run through `MetadataClient` (`ce986aafc`):
 * the batch one so the runtime authoring gate's per-draft advisories reach the
 * console's advisory toast, the by-reference one because it always did. The
 * asymmetry this closes was inside this very function — its own client-side
 * capability lint raised a toast while the server's findings, on the same
 * button, were dropped for want of a seam to report through.
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { publishHealthFromResponse, type PublishHealth } from '@object-ui/plugin-chatbot/core';
import { useMetadataClient } from '../views/metadata-admin/useMetadata.js';
import { emitMetadataRefresh, emitPublishReceipt } from '../assistant/assistantBus.js';
import { lintDraftCapabilityReferences } from './capabilityLint.js';
import { appDraftPackages } from './usePendingDrafts.js';
import { refusedItemsText } from './publishRefusal.js';
import { isNavigationTargetType, useNavigationWrites } from '../hooks/useNavigationSync.js';
// The one authority for the narrowed `t` (objectui#8261) — imported, not
// re-declared. The local copy this replaces differed only in its parameter's
// NAME (`opts`), which TypeScript does not compare, so no caller's contract moves.
import type { TranslateFn } from '@object-ui/i18n';

export interface PublishAllResult {
  ok: boolean;
  /** Count of drafts the call attempted to publish. */
  attempted: number;
}

export interface PublishAllOptions {
  /**
   * objectstack#34610 — publish only this app's pending drafts: those in its
   * package or its paired customization package (`appDraftPackages`), the
   * draft bar's scope, the one its count and its changes panel read. Absent,
   * every pending draft in the environment (Home's *Publish all*).
   */
  packageId?: string | null;
}

export function usePublishAllDrafts(t: TranslateFn) {
  const client = useMetadataClient();
  const navigationWrites = useNavigationWrites();
  const [publishing, setPublishing] = useState(false);

  const publishAll = useCallback(async (opts: PublishAllOptions = {}): Promise<PublishAllResult> => {
    const scope = opts.packageId ?? null;
    setPublishing(true);
    try {
      // One app's drafts come off the env-wide list: its customization pair
      // may not be installed, and a `?package=` read refuses one that is not.
      const appScope = scope ? appDraftPackages(scope) : null;
      const pending = ((await client.listDrafts?.({})) || [])
        .filter((d) => d && typeof d.type === 'string' && typeof d.name === 'string')
        .filter((d) => appScope === null || (typeof d.packageId === 'string' && appScope.includes(d.packageId)))
        .map((d) => ({
          type: d.type as string,
          name: d.name as string,
          packageId: typeof d.packageId === 'string' && d.packageId ? (d.packageId as string) : null,
          // objectui#12402 — the row's bundle member, as `_drafts` served it
          // (`ListDraftsResponseSchema.drafts[].member`, present only for a
          // type whose identity is a pair, today `email_template`). Two
          // languages of one template are two rows with one `type` and
          // `name`; only `member` tells them apart. Kept when it is a
          // non-empty string, absent otherwise. Read through the declared row,
          // `MetadataDraftHeader.member` (objectui#12413), not through a cast.
          ...(typeof d.member === 'string' && d.member ? { member: d.member } : {}),
        }));
      if (pending.length === 0) {
        toast.info(t('home.pendingDrafts.nothing', { defaultValue: 'Nothing to publish.' }));
        return { ok: true, attempted: 0 };
      }

      // ADR-0066 ⑨ — advisory capability-reference lint over the pending
      // drafts (a `requiredPermissions` naming a capability registered
      // nowhere is almost certainly a typo; it fails closed at runtime).
      // Never blocks: warnings surface as a toast after publish.
      const capWarnings = await lintDraftCapabilityReferences(client as any, pending);

      const packageIds = [...new Set(pending.map((d) => d.packageId).filter((p): p is string => p !== null))];
      const orphans = pending.filter((d) => d.packageId === null);

      // objectstack#35141 — whether any seed failed, on either door below. The
      // toast says that in the pack's sentence, as the chat's publish-health
      // line does (objectstack#32984): `seedFailed` is the failure, and the
      // loader's own text (`seedError`, `seedApplied.error`) is engine text
      // for whoever repairs the seed, never the customer's sentence.
      let seedFailed = false;
      const probeProblems: NonNullable<PublishHealth['issues']> = [];
      let seededRows = 0;
      const recordHealth = (health: PublishHealth | undefined) => {
        if (!health) return;
        if (health.seedFailed === true || health.seedError) seedFailed = true;
        if (typeof health.seededRows === 'number') seededRows += health.seededRows;
        for (const issue of health.issues ?? []) {
          if (issue.severity === 'error') probeProblems.push(issue);
        }
      };

      for (const packageId of packageIds) {
        // `ce986aafc` — through `MetadataClient`, not a bare `fetch`. The
        // route now answers the runtime authoring gate's per-draft advisories
        // on each `published[]` element (objectstack#9343), and the client is
        // the seam that reports them: it emits one advisory event per advised
        // item into the same sink, renderer and wording the save and
        // single-item publish doors use. A bare fetch had nothing to report
        // THROUGH — which is why this door stayed silent while the L3 probe
        // findings a few lines below were already shouting.
        const payload = await client.publishPackageDrafts(packageId);
        // A non-2xx now throws inside the client, with the server's own
        // message. What is left to check here is the batch verdict.
        //
        // objectui#11922 — `failed[]` BEFORE the batch's own `success`: a
        // refusal answers both, and only `failed[]` says which item and why.
        const failed = Array.isArray(payload.failed) ? payload.failed : [];
        if (failed.length > 0) throw new Error(refusedItemsText(failed));
        // objectstack#33277 — `published_unregistered` answers `success: false`
        // over drafts that DID land (the registry refused an object, whose
        // warning the client has already reported): not a failure here, as it
        // was not while the server answered `published` for it.
        if ((payload as { success?: boolean }).success === false && payload.outcome !== 'published_unregistered') {
          const error = (payload as { error?: { message?: string } }).error;
          throw new Error(error?.message || 'publish-drafts did not publish this package');
        }
        recordHealth(publishHealthFromResponse(payload));
      }

      const ordered = [
        ...orphans.filter((d) => d.type !== 'seed'),
        ...orphans.filter((d) => d.type === 'seed'),
      ];
      /** Package-less pages and dashboards this run published for the first time. */
      const created: { type: string; name: string }[] = [];
      for (const d of ordered) {
        // objectstack#28680 — a package-less page or dashboard whose draft is
        // its only layer is CREATED by this publish, and joins app navigation
        // below. Asked before the publish, because after it the item has a
        // layer either way; an item that already had one is an update.
        const firstPublish = isNavigationTargetType(d.type) && (await holdsNoPublishedLayer(client, d));
        // A member row publishes THAT member (`?member=`); a by-name publish
        // naming none promotes the canonical member's draft instead. A row
        // without one sends no selector — the door refuses it on a type with
        // no members.
        const res = await client.publishDraft(d.type, d.name, d.member ? { member: d.member } : {});
        if (firstPublish) created.push({ type: d.type, name: d.name });
        const seedApplied = (res as any)?.seedApplied;
        if (seedApplied && seedApplied.success === false) seedFailed = true;
      }

      if (probeProblems.length > 0) {
        // objectstack#32984 ruling B, as the chat's publish-health line reads
        // it: a finding speaks only through its producer's customer sentence
        // (`userMessage`, already in the request's language). `message` and
        // `fix` are the agent's text and never reach the toast. With no
        // sentence on any error, the line's generic sentence for an error set.
        const voiced = probeProblems.find((issue) => issue.userMessage)?.userMessage;
        toast.warning(
          t('home.pendingDrafts.probeWarn', { defaultValue: 'Published, but verification found problems.' }),
          {
            description:
              voiced ??
              t('chatbot.build.issuesSummary', {
                defaultValue:
                  'Some parts of this build need fixing before it is ready. Reply "fix the problems" and the assistant will repair them.',
              }),
          },
        );
      } else if (seedFailed) {
        toast.warning(
          t('home.pendingDrafts.seedWarn', { defaultValue: 'Published, but some sample data failed to load.' }),
          { description: t('chatbot.build.health.seedFailed', { defaultValue: 'Sample data failed to load.' }) },
        );
      } else {
        toast.success(
          seededRows > 0
            ? t('home.pendingDrafts.publishedVerified', {
                count: seededRows,
                defaultValue: 'Published & verified — {{count}} sample row(s) live.',
              })
            : t('home.pendingDrafts.published', { defaultValue: 'Published! Your changes are live.' }),
        );
      }
      if (capWarnings.length > 0) {
        toast.warning(
          t('home.pendingDrafts.capabilityWarn', {
            count: capWarnings.length,
            defaultValue: 'Authoring check: {{count}} capability reference(s) resolve nowhere.',
          }),
          { description: capWarnings[0], duration: 10000 },
        );
      }
      // objectui#5801 — announce the publish so every pending-drafts surface
      // (home banner, Studio topbar, chat bar) converges without a reload.
      emitMetadataRefresh();
      // objectstack#34610 — and tell the chat, which draws no Publish of its
      // own, so it can show a receipt.
      emitPublishReceipt({ packageId: scope });
      // objectstack#28680 — each first-published page or dashboard joins app
      // navigation. Each app write reports itself (a toast with Undo).
      for (const c of created) await navigationWrites.created(c.type, c.name);
      return { ok: true, attempted: pending.length };
    } catch (e) {
      toast.error(
        `${t('home.pendingDrafts.publishFailed', { defaultValue: 'Publish failed' })}: ${(e as Error).message}`,
      );
      return { ok: false, attempted: 0 };
    } finally {
      setPublishing(false);
    }
  }, [client, navigationWrites, t]);

  return { publishAll, publishing };
}

/**
 * Whether a package-less draft's item holds no layer yet: no packaged
 * baseline, no published row, no effective value. That is what
 * `MetadataClient.layered()` resolves for the server's 404. A read that fails
 * answers `false`, so an unknown item is never taken for a new one (a second
 * navigation entry is worse than a missing one, which the author can add).
 */
async function holdsNoPublishedLayer(
  client: ReturnType<typeof useMetadataClient>,
  d: { type: string; name: string; member?: string },
): Promise<boolean> {
  try {
    const lay = await client.layered<unknown>(d.type, d.name, d.member ? { member: d.member } : {});
    return lay.code == null && lay.overlay == null && lay.effective == null;
  } catch {
    return false;
  }
}
