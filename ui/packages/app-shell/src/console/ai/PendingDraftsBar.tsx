/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Standing "unpublished changes" affordance for the AI build surface
 * (objectui#5694).
 *
 * Before this bar, the ONLY way to publish a pending draft was the inline
 * 「发布 (N)」 button on whichever tool card staged it — buried however far up
 * the transcript the conversation had scrolled. In the 2026-08-22 staging E2E
 * (cloud#1584) a dashboard sat `state='draft'` through three repair rounds
 * with a working publish button off-screen the whole time; the user's actual
 * experience was a live menu entry answering 「未找到仪表板」.
 *
 * This bar floats above the composer while the conversation's bound package
 * has pending drafts: it survives scrolling, publishes through the SAME
 * governed path as the inline button and the Home banner
 * (`POST /packages/:id/publish-drafts` — the path that orders
 * structure-before-seeds and runs the ADR-0038 L3 probes), narrates probe
 * findings via the shared {@link publishHealthFromResponse} instead of a blind
 * "Published!", and disappears when the count reaches zero.
 *
 * objectui#10039 — that publish now goes through `MetadataClient`, not a bare
 * `fetch`. The route answers the runtime authoring gate's per-draft advisories
 * on each `published[]` element (objectstack#9343) and the client is the seam
 * that reports them: it emits one advisory event per advised item into the
 * same sink, renderer and wording every other write door uses. A bare fetch
 * had nothing to report THROUGH, so every one of those findings was parsed by
 * nobody — while the probe findings a few lines below were already shouting.
 * PR objectui#10038 did this for the two sibling call sites;
 * this is the same move, not a second mechanism.
 *
 * Count freshness: re-read when the package binding changes and whenever the
 * turn goes idle (`idle` flips true) — tool results that stage or publish
 * drafts land inside a turn, so idle edges are exactly when the count can
 * have changed. Sibling surfaces: `preview/UnpublishedAppBar` (the ADR-0045
 * app-level publish gate — a DIFFERENT axis: an app can be live while sibling
 * artifacts are draft, which is exactly the case above) and the Home
 * pending-drafts banner (environment-wide, not package-scoped).
 */

import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { publishHealthFromResponse } from '@object-ui/plugin-chatbot/core';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useMetadataClient } from '../../views/metadata-admin/useMetadata.js';
import { usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { readEnvelopeFailureText } from '../../utils/apiErrorEnvelope.js';

export interface PendingDraftsBarProps {
  /** The conversation's bound package (ADR-0057 A1.a); undefined = not bound yet. */
  packageId: string | undefined;
  /** True while no turn is streaming — the count refetch trigger. */
  idle: boolean;
}

export function PendingDraftsBar({ packageId, idle }: PendingDraftsBarProps) {
  const { refresh } = useMetadata();
  // The advisory seam. `useMetadataClient` is the layer that hands the
  // console's toast renderer to the client, so taking the client from here —
  // rather than firing the route by hand — is what makes the gate's findings
  // reach the author at all (objectui#10039).
  const client = useMetadataClient();
  const { t } = useObjectTranslation();
  const [publishing, setPublishing] = useState(false);
  // objectui#5801 — the shared pending-drafts source. The hook's bus
  // subscription replaces the post-publish `version` bump AND picks up
  // publishes made from OTHER surfaces (Studio topbar, home banner); the
  // idle-edge effect below keeps "refetch when the turn finishes" — the agent
  // may have just staged drafts.
  const { count, refresh: refreshCount } = usePendingDrafts({
    packageId,
    enabled: Boolean(packageId),
  });

  useEffect(() => {
    if (!packageId || !idle) return;
    void refreshCount();
  }, [idle, packageId, refreshCount]);

  const publish = useCallback(async () => {
    if (!packageId || publishing) return;
    setPublishing(true);
    try {
      let body: unknown;
      try {
        body = await client.publishPackageDrafts(packageId);
      } catch (e) {
        // A non-2xx now throws inside the client, carrying the server's own
        // message and the parsed body. Same sentence the bare `fetch` showed
        // (`parseError` reads it off `error.message`), with the ADR-0112
        // producer-marked `userMessage` preferred when the refusal carries
        // one — the rule `36fc74629` landed on the sibling call site.
        const marked = readEnvelopeFailureText((e as { body?: unknown } | null)?.body);
        const message =
          marked ||
          (e instanceof Error && e.message ? e.message : '') ||
          t('console.ai.pendingDrafts.failed', { defaultValue: 'Publish failed.' });
        toast.error(message);
        return;
      }
      const health = publishHealthFromResponse(body);
      const problems = (health?.issues ?? []).filter((i) => i.severity === 'error');
      if (health?.seedError || problems.length > 0) {
        toast.warning(
          t('console.ai.pendingDrafts.publishedWithFindings', {
            defaultValue: 'Published, but the runtime probes reported problems: {{detail}}',
            detail: [health?.seedError, ...problems.map((p) => p.message)].filter(Boolean).join('; '),
          }),
        );
      } else {
        toast.success(t('console.ai.pendingDrafts.published', { defaultValue: 'All pending changes are live.' }));
      }
      // The launcher/nav may have just gained entries — refresh the shared
      // metadata so the user's next click finds them, and announce the publish
      // on the bus so every other pending-drafts surface (home banner, Studio
      // topbar) converges too (objectui#5801).
      try {
        await refresh?.();
      } catch {
        /* metadata refresh is best-effort */
      }
      emitMetadataRefresh();
    } finally {
      setPublishing(false);
    }
  }, [client, packageId, publishing, refresh, t]);

  if (!packageId || (count ?? 0) <= 0) return null;

  return (
    <div
      data-testid="pending-drafts-bar"
      className="pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm shadow-sm backdrop-blur"
    >
      {/* objectui#13088 — the sentence wraps: it takes the row's free width
          and breaks onto more lines, never cut to one with an ellipsis. On a
          phone the row is narrower than the sentence, and the cut half is
          the part that says users cannot see the change yet. The button is
          `shrink-0`, so the publish action keeps its width on the bar. */}
      <span data-testid="pending-drafts-bar-sentence" className="min-w-0 flex-1">
        {t('console.ai.pendingDrafts.count', {
          defaultValue: '{{count}} change(s) are not published yet — users cannot see them.',
          count,
        })}
      </span>
      <Button size="sm" onClick={() => void publish()} disabled={publishing} className="shrink-0">
        {publishing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="mr-1 h-3.5 w-3.5" />}
        {t('console.ai.pendingDrafts.publish', { defaultValue: 'Publish' })}
      </Button>
    </div>
  );
}
