// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a refused `POST /packages/:id/publish-drafts` batch names to the author
 * (objectui#11922). Shared by the two doors that publish a package's drafts
 * outside Studio: the package sheet (`PackagesPage`'s `publishDrafts`) and
 * Home's *Publish all* with the draft-preview bar (`usePublishAllDrafts`).
 *
 * A refusal answers 200 with the batch's own `success: false` AND its per-item
 * story in `failed[]` (`PublishPackageDraftsResponseSchema`: `outcome` is
 * `refused` if and only if `failed` is non-empty). Both doors asked `success`
 * first and threw before they reached `failed[]`, so the author read "Action
 * failed" or "publish-drafts did not publish this package": no item, no reason.
 * Each door now reads `failed[]` first and names the items through this.
 *
 * Which items: every element that is not a `BATCH_ABORTED` sibling. On the
 * ADR-0067 D2 rollback that is the causal item, the one carrying the real
 * error; its siblings only say the batch rolled back because of it. On a
 * pre-flight refusal no element is aborted, so every refused item is named.
 * When every element is aborted (the producer could not attribute the
 * failure), the first one's sentence is still the server's own.
 *
 * Not `formatPublishFailures` (`studio-design/metadataError.ts`): its banner is
 * English, where the package sheet answers in its own localized rows. The two
 * also tell a rolled-back sibling apart differently: `errorCodeIs` here ignores
 * case, while `formatPublishFailures` matches the producer's `BATCH_ABORTED`
 * exactly (objectui#11985).
 */

import { errorCodeIs } from '@object-ui/types';
import type { MetadataClient } from '@object-ui/data-objectstack';

/** One `failed[]` element of the batch, as the client hands it back (the spec's shape). */
type PublishDraftsFailure = NonNullable<
  Awaited<ReturnType<MetadataClient['publishPackageDrafts']>>['failed']
>[number];

/** `type/name: reason` for each refused item, in the server's own words. */
export function refusedItemsText(failed: readonly PublishDraftsFailure[]): string {
  const refused = failed.filter((f) => !errorCodeIs(f, 'BATCH_ABORTED'));
  return (refused.length > 0 ? refused : failed.slice(0, 1))
    .map((f) => `${f.type}/${f.name}: ${f.error}`)
    .join('; ');
}
