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
import { emitMetadataRefresh } from '../assistant/assistantBus.js';
import { lintDraftCapabilityReferences } from './capabilityLint.js';
import { refusedItemsText } from './publishRefusal.js';
// The one authority for the narrowed `t` (objectui#8261) — imported, not
// re-declared. The local copy this replaces differed only in its parameter's
// NAME (`opts`), which TypeScript does not compare, so no caller's contract moves.
import type { TranslateFn } from '@object-ui/i18n';

export interface PublishAllResult {
  ok: boolean;
  /** Count of drafts the call attempted to publish. */
  attempted: number;
}

export function usePublishAllDrafts(t: TranslateFn) {
  const client = useMetadataClient();
  const [publishing, setPublishing] = useState(false);

  const publishAll = useCallback(async (): Promise<PublishAllResult> => {
    setPublishing(true);
    try {
      const pending = ((await client.listDrafts?.({})) || [])
        .filter((d) => d && typeof d.type === 'string' && typeof d.name === 'string')
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

      const seedProblems: string[] = [];
      const probeProblems: string[] = [];
      let seededRows = 0;
      const recordHealth = (health: PublishHealth | undefined) => {
        if (!health) return;
        if (health.seedError) seedProblems.push(health.seedError);
        if (typeof health.seededRows === 'number') seededRows += health.seededRows;
        for (const issue of health.issues ?? []) {
          if (issue.severity === 'error') probeProblems.push(issue.message);
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
        if ((payload as { success?: boolean }).success === false) {
          const error = (payload as { error?: { message?: string } }).error;
          throw new Error(error?.message || 'publish-drafts did not publish this package');
        }
        recordHealth(publishHealthFromResponse(payload));
      }

      const ordered = [
        ...orphans.filter((d) => d.type !== 'seed'),
        ...orphans.filter((d) => d.type === 'seed'),
      ];
      for (const d of ordered) {
        // A member row publishes THAT member (`?member=`); a by-name publish
        // naming none promotes the canonical member's draft instead. A row
        // without one sends no selector — the door refuses it on a type with
        // no members.
        const res = await client.publishDraft(d.type, d.name, d.member ? { member: d.member } : {});
        const seedApplied = (res as any)?.seedApplied;
        if (seedApplied && seedApplied.success === false) {
          seedProblems.push(seedApplied.error ?? `${d.name}: sample data failed to load`);
        }
      }

      if (probeProblems.length > 0) {
        toast.warning(
          t('home.pendingDrafts.probeWarn', { defaultValue: 'Published, but verification found problems.' }),
          { description: probeProblems[0] },
        );
      } else if (seedProblems.length > 0) {
        toast.warning(
          t('home.pendingDrafts.seedWarn', { defaultValue: 'Published, but some sample data failed to load.' }),
          { description: seedProblems[0] },
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
      return { ok: true, attempted: pending.length };
    } catch (e) {
      toast.error(
        `${t('home.pendingDrafts.publishFailed', { defaultValue: 'Publish failed' })}: ${(e as Error).message}`,
      );
      return { ok: false, attempted: 0 };
    } finally {
      setPublishing(false);
    }
  }, [client, t]);

  return { publishAll, publishing };
}
