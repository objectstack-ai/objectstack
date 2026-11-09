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
  /**
   * objectstack#30046 — a `view` row's bound object and family (`viewKind`,
   * `list` | `form`), as the published item declares them (ADR-0017's
   * `{ name, object, viewKind }`). Absent on every other type, and on a
   * draft-only view: its `_drafts` header carries no body.
   */
  object?: string;
  viewKind?: string;
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
 *
 * `keep` narrows the PUBLISHED rows, which carry the item's body: the type's
 * own list filter (a `MetadataResourceConfig.listFilter`), so a rail lists
 * what Setup › Metadata lists — `view`'s leaves out the aggregated container
 * the server keeps beside its expanded items (objectstack#26889). A draft
 * header carries no body, so no filter reads it.
 */
export async function loadPackageSurfaces(
  client: PackageSurfaceClient,
  type: string,
  packageId: string,
  locale?: string,
  keep?: (item: Record<string, unknown>) => boolean,
): Promise<PackageSurface[]> {
  const [published, draftHeaders] = await Promise.all([
    client.list(type, { packageId }) as Promise<Array<Record<string, unknown>> | null | undefined>,
    client
      .listDrafts({ packageId, type })
      .catch(() => [] as DraftRow[]),
  ]);
  return mergeSurfaces(type, keep ? (published || []).filter(keep) : published, draftHeaders, locale);
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
      ...(type === 'view' ? viewBindingOf(o) : {}),
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

/**
 * objectstack#30046 — a view item's bound object and family, where the item
 * declares them as strings: the members {@link PackageSurface} carries for a
 * `view` row. Used for a published row and for a draft-overlaid one alike.
 */
export function viewBindingOf(item: Record<string, unknown>): Pick<PackageSurface, 'object' | 'viewKind'> {
  return {
    ...(typeof item.object === 'string' && item.object ? { object: item.object } : {}),
    ...(typeof item.viewKind === 'string' && item.viewKind ? { viewKind: item.viewKind } : {}),
  };
}

/** The draft-overlaid read {@link withDraftViewBindings} asks: the metadata client's preview door. */
export interface DraftViewBindingClient {
  withPreviewDrafts(on: boolean): { list(type: string, options?: { packageId?: string }): Promise<unknown> };
}

/**
 * objectstack#30046 — the `view` rows of {@link loadPackageSurfaces} with the
 * bound object and family of each draft-only row filled in. A `_drafts`
 * header carries no body, so a view only drafted here (one made with New view)
 * is read from the draft-overlaid list (`withPreviewDrafts`), which serves
 * each pending draft's body. Asked only when some row lacks them; a failed or
 * refused read returns the rows as they were, so nothing listed is lost.
 */
export async function withDraftViewBindings(
  client: DraftViewBindingClient,
  packageId: string,
  items: PackageSurface[],
): Promise<PackageSurface[]> {
  if (items.every((item) => item.viewKind)) return items;
  let rows: unknown;
  try {
    rows = await client.withPreviewDrafts(true).list('view', { packageId });
  } catch {
    return items;
  }
  const byName = new Map<string, Pick<PackageSurface, 'object' | 'viewKind'>>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && typeof row === 'object' && typeof (row as { name?: unknown }).name === 'string') {
      byName.set((row as { name: string }).name, viewBindingOf(row as Record<string, unknown>));
    }
  }
  return items.map((item) => (item.viewKind ? item : { ...item, ...byName.get(item.name) }));
}
