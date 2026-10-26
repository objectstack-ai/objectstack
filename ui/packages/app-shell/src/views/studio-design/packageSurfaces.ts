// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Load the rail entries for one metadata type inside a Studio package pillar:
 * the PUBLISHED items unioned with the pending DRAFT items, deduped by name.
 *
 * Why the union: `client.list(type, { packageId })` only returns
 * published/active metadata. A freshly-authored item that hasn't been published
 * yet (or a whole fresh writable-base package whose items are all still drafts)
 * would therefore render an empty rail even though the author just created it —
 * and the "N pending changes" counter would show the draft exists while the rail
 * itself hid it. Merging `client.listDrafts({ packageId, type })` keeps the item
 * designable between authoring and its first publish.
 *
 * This is the canonical form of the merge the Data / Interfaces / Access pillars
 * already do inline; extracting it (a) fixes the Automations pillar, which was
 * the sole rail that listed only published items and hid draft-only flows, and
 * (b) makes the behaviour unit-testable without rendering a heavy pillar tree.
 *
 * A draft-only item reads as the label its `_drafts` row carries
 * (objectui#11862): since objectstack-ai/objectstack#22200 each row carries the
 * draft body's own label, or `null` when the body declares none, so the label
 * is read off the row and the item is never read for it (seat ruling
 * `6053526025`, question 1). A locale map resolves in the `locale` the rail is
 * drawn in, through the spec's own `resolveI18nLabel`. Only a row with no label
 * shows its machine name.
 */

import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { isPackageLessDraft, isPackageLessItem } from './studioScope.js';

/** Minimal structural view of the metadata client this helper needs. */
export interface PackageSurfaceClient {
  list(type: string, options?: { packageId?: string }): Promise<unknown>;
  /**
   * The `_drafts` rows: the members read here are the name, the package and
   * the label the draft body declares (`ListDraftsResponseSchema` `drafts[]`).
   */
  listDrafts(
    options?: { packageId?: string; type?: string },
  ): Promise<Array<{ name?: string | null; packageId?: string | null; label?: I18nLabel | null }>>;
}

/** One `_drafts` row, as {@link PackageSurfaceClient.listDrafts} answers it. */
type DraftRow = Awaited<ReturnType<PackageSurfaceClient['listDrafts']>>[number];

/** One rail entry — mirrors the `Surface` shape used by the pillars. */
export interface PackageSurface {
  type: string;
  name: string;
  label: string;
}

/**
 * Fetch published + pending-draft items of `type` for `packageId` and merge them
 * into rail entries. Published rows win on name collision (their real label is
 * kept); draft-only items are appended with the label their `_drafts` row
 * carries, in `locale`, else the machine name.
 *
 * `listDrafts` failures are tolerated (an older server without the drafts
 * endpoint, or a transient error) — the rail still renders the published set
 * rather than erroring out, matching the sibling pillars' `.catch(() => [])`.
 */
export async function loadPackageSurfaces(
  client: PackageSurfaceClient,
  type: string,
  packageId: string,
  locale?: string,
): Promise<PackageSurface[]> {
  const [published, draftHeaders] = await Promise.all([
    client.list(type, { packageId }) as Promise<Array<Record<string, unknown>> | null | undefined>,
    client
      .listDrafts({ packageId, type })
      .catch(() => [] as DraftRow[]),
  ]);
  return mergeSurfaces(type, published, draftHeaders, locale);
}

/**
 * The rail entries for one metadata type in the PACKAGE-LESS scope
 * (objectui#11553): the published items that belong to no package, unioned
 * with the pending drafts that belong to no package, by the same merge.
 *
 * Both reads are UNSCOPED, which is the only way to see such an item: a
 * package-scoped list keeps exactly the items whose `_packageId` names that
 * package, so an item with none is in no package's list. The unscoped list
 * also carries every PACKAGED item, so each half is narrowed by its own
 * declared binding (`isPackageLessItem` on the served `_packageId`,
 * `isPackageLessDraft` on the draft header's `packageId`). Drafts fail soft
 * here exactly as in {@link loadPackageSurfaces}.
 */
export async function loadPackageLessSurfaces(
  client: PackageSurfaceClient,
  type: string,
  locale?: string,
): Promise<PackageSurface[]> {
  const [published, draftHeaders] = await Promise.all([
    client.list(type) as Promise<Array<Record<string, unknown>> | null | undefined>,
    client
      .listDrafts({ type })
      .catch(() => [] as DraftRow[]),
  ]);
  return mergeSurfaces(
    type,
    (published || []).filter((o) => isPackageLessItem(o)),
    (draftHeaders || []).filter((d) => isPackageLessDraft(d)),
    locale,
  );
}

/** The published-wins union both loaders above share. */
function mergeSurfaces(
  type: string,
  published: Array<Record<string, unknown>> | null | undefined,
  draftHeaders: DraftRow[] | null | undefined,
  locale: string | undefined,
): PackageSurface[] {
  const items: PackageSurface[] = (published || [])
    .map((o) => ({
      type,
      name: String(o.name ?? ''),
      label: String(o.label ?? o.name ?? ''),
    }))
    .filter((o) => o.name);

  const known = new Set(items.map((o) => o.name));
  for (const d of draftHeaders || []) {
    const name = String(d?.name ?? '');
    if (name && !known.has(name)) {
      const label = resolveI18nLabel(d?.label ?? undefined, locale)?.trim();
      items.push({ type, name, label: label || name });
      known.add(name);
    }
  }

  return items;
}
