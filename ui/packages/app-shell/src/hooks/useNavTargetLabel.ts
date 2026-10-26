/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useNavTargetLabel — the console's answer to "what is this navigation target
 * called NOW?", for navigation entries that carry no `label` (objectui#9868).
 *
 * `@objectstack/spec` 17.5.0 made a navigation entry's `label` optional (on the
 * nav-item base every `NavigationItemSchema` entry arm shares) with a declared
 * semantic (the cloud#2021 letter-A ruling): an ABSENT label means the
 * entry shows, at render time, the CURRENT label of what it opens — the view's
 * label when it names a labelled view, else the object's / dashboard's label.
 * `@object-ui/layout`'s `resolveNavItemLabel` walks that ladder; this hook is
 * the metadata it asks, as a {@link NavTargetLabelResolver}.
 *
 * ## What it reads — the metadata the shell already holds, no fetch of its own
 *
 * `useMetadata()` — `MetadataProvider`'s per-type cache, read lazily per
 * target kind:
 *
 *  - an object's `label` from `objects` (the object schema — what a rename in
 *    the object designer changes). The sidebar already reads `objects` for its
 *    runtime-capability gate, so the type is loaded either way;
 *  - a view's `label` from that object's `listViews`, which `MetadataProvider`
 *    merges in from the eagerly-loaded `view` type. The nav entry's `viewName`
 *    is matched against the view ids by `resolveViewId` — the one matcher the
 *    object page itself uses — so an entry names the same view it opens;
 *  - a dashboard's `label` from `dashboards`, read ONLY when a dashboard target
 *    is asked about. One list request for the whole type (the cache's), never
 *    one per nav entry; the console's `NavigationSyncEffect` loads it anyway.
 *
 * Nothing is written back and nothing is memoised across metadata versions, so
 * a renamed target shows its new name on the next render (the ruling accepts a
 * reload). A metadata label that is an inline locale map resolves through the
 * spec's own `resolveI18nLabel` in the active language, and the result passes
 * through the same convention-based bundle lookup (`useObjectLabel`) the rest
 * of the console applies to object / view / dashboard names, so the nav shows
 * the name the target's own page shows.
 *
 * A target with no label answers `undefined` — the renderer then falls through
 * the spec's ladder and, at the bottom, to the target's machine name.
 *
 * ## A designer's pending drafts — the last rung (objectui#11862)
 *
 * A draft-only object or dashboard is in no published list, so the metadata
 * above cannot name it, and a label-less entry that opens one read as its
 * machine name in the Studio's nav editor. Where a designer holds its
 * package's pending drafts, it hands them to {@link DraftTargetLabels}, and the
 * label a draft's `_drafts` row carries (objectstack-ai/objectstack#22200) is
 * asked last: only when the metadata has no label for the target, so a
 * published label still wins. Nothing is fetched for it — the rows are the
 * ones the designer already read. Without a provider the list is empty and
 * this hook answers exactly as before, which is the console's case.
 */

import { createContext, useContext, useMemo } from 'react';
import { canonicalMetaUrlType } from '@objectstack/spec/shared';
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { resolveViewId } from '@object-ui/core';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { NavLabelTarget, NavTargetLabelResolver } from '@object-ui/layout';
import { useMetadata } from '../providers/MetadataProvider.js';

/**
 * A metadata label (plain string or inline locale map) as display text, or
 * `undefined` when there is none. Shared with `useRecentItemLabel`, which asks
 * the same question of a page or a report (objectui#11678).
 */
export function metadataText(label: unknown, language: string | undefined): string | undefined {
  const text = resolveInlineI18nLabel(label as Parameters<typeof resolveInlineI18nLabel>[0], language);
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

/** `''` from a bundle lookup that found nothing and had no metadata to fall back to. */
function nonEmpty(text: string | undefined): string | undefined {
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

/** The two members this hook reads off a cached metadata record. */
export interface LabelledRecord {
  name?: unknown;
  label?: unknown;
  listViews?: unknown;
}

/** The cached metadata record named `name`, or `undefined`. Shared with `useRecentItemLabel`. */
export function findByName(items: readonly unknown[] | undefined, name: string): LabelledRecord | undefined {
  return (items ?? []).find(
    (item): item is LabelledRecord =>
      !!item && typeof item === 'object' && (item as LabelledRecord).name === name,
  );
}

/**
 * A pending draft as a designer holds it: the type its row is stored under,
 * its name, and the label its `_drafts` row carries (absent or `null` when the
 * draft body declares none).
 */
export interface DraftTargetLabel {
  type: string;
  name: string;
  label?: unknown;
}

/**
 * The pending drafts a designer holds, for the last rung above. Internal to
 * app-shell: the Studio surface provides the `_drafts` rows it reads for its
 * Changes count; nothing else does.
 */
export const DraftTargetLabels = createContext<ReadonlyArray<DraftTargetLabel>>([]);

/** The label of the pending draft of `type` named `name`, as display text, or `undefined`. */
function draftText(
  drafts: ReadonlyArray<DraftTargetLabel>,
  type: string,
  name: string,
  language: string | undefined,
): string | undefined {
  // A stored type spelling is folded as every `/meta` reader folds it.
  const draft = drafts.find((d) => d.name === name && canonicalMetaUrlType(d.type) === type);
  return draft ? metadataText(draft.label, language) : undefined;
}

/** An object's merged `listViews` map (`<object>.<key>` → view), or `{}` when it has none. */
function listViewsOf(def: LabelledRecord | undefined): Record<string, LabelledRecord | undefined> {
  const views = def?.listViews;
  return views && typeof views === 'object' ? (views as Record<string, LabelledRecord | undefined>) : {};
}

export function useNavTargetLabel(): NavTargetLabelResolver {
  const metadata = useMetadata();
  const { objectLabel, viewLabel, dashboardLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  const drafts = useContext(DraftTargetLabels);

  return useMemo<NavTargetLabelResolver>(
    () => (target: NavLabelTarget) => {
      switch (target.kind) {
        case 'object': {
          const def = findByName(metadata.objects, target.objectName);
          const text =
            metadataText(def?.label, language) ?? draftText(drafts, 'object', target.objectName, language);
          return nonEmpty(objectLabel({ name: target.objectName, label: text ?? '' }));
        }
        case 'view': {
          const views = listViewsOf(findByName(metadata.objects, target.objectName));
          const id = resolveViewId(target.viewName, Object.keys(views), target.objectName);
          const text = metadataText(id ? views[id]?.label : undefined, language);
          return nonEmpty(viewLabel(target.objectName, target.viewName, text ?? ''));
        }
        case 'dashboard': {
          const def = findByName(metadata.dashboards, target.dashboardName);
          const text =
            metadataText(def?.label, language) ?? draftText(drafts, 'dashboard', target.dashboardName, language);
          return nonEmpty(dashboardLabel({ name: target.dashboardName, label: text ?? '' }));
        }
        default:
          return undefined;
      }
    },
    [metadata, objectLabel, viewLabel, dashboardLabel, language, drafts],
  );
}
