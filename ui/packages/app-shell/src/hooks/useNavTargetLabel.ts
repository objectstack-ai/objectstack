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
 *    one per nav entry.
 *
 * Nothing is written back and nothing is memoised across metadata versions, so
 * a renamed target shows its new name on the next render (the ruling accepts a
 * reload). A metadata label that is an inline locale map resolves through the
 * spec's own `resolveI18nLabel` in the active language. A served label is
 * already translated by the server, by its label order for an overridden item,
 * and is drawn as given: an object's (every object in the cache is a served
 * document), a served view's (`isServedView`, the question the object page's
 * view tabs ask) and a dashboard's (objectstack#30244, objectstack#30311). The
 * convention-based bundle lookup (`useObjectLabel`) is asked only for text no
 * server translated: a view the client derived, a pending draft's label, or a
 * target with no served label. Running the bundle over a served label was a
 * second translation pass in which the base package's string won a rename
 * back.
 *
 * A target with no label answers `undefined` — the renderer then falls through
 * the spec's ladder and, at the bottom, to the target's machine name.
 *
 * The app's report index (`reportIndex`, a `report` entry with no
 * `reportName`, objectstack#27525) is named by no metadata record: it answers
 * the console's own wording for that page, `sidebar.allReports`, the text the
 * console's injected index row showed before navigation declared it.
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
import { resolveViewId } from '@object-ui/core';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { NavLabelTarget, NavTargetLabelResolver } from '@object-ui/layout';
import { useMetadata } from '../providers/MetadataProvider.js';
import { bundledFirst, useBundledReads } from '../providers/bundledReads.js';
import { readObjectsByName, useReadItemsByName } from './useObjectPresence.js';
import { isServedView } from './useServedViewItems.js';
import { metadataText } from './servedObjectLabel.js';

export {
  metadataText,
  servedObjectLabel,
  servedObjectPluralLabel,
  type ObjectLabelLookup,
  type ObjectPluralLabelLookup,
} from './servedObjectLabel.js';

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

/** One identity for an absent read. */
const NO_ITEMS: readonly unknown[] = Object.freeze([]);

/**
 * What a `view` target reads (objectstack#30311): its object, with the views
 * merged in, and the two served reads `isServedView` asks of it — the
 * `/meta/view` documents and the object documents as served, before the merge.
 * By name, all three come from the one names-only scope read
 * `readObjectsByName` makes; otherwise from the whole lists, as
 * `useServedViewItems` reads them outside an app scope.
 */
function readViewTarget(
  metadata: ReturnType<typeof useMetadata>,
  byName: boolean,
  objectName: string,
): { objects: readonly unknown[]; served: { views: readonly unknown[]; objects: readonly unknown[] } } {
  const { readObjectScope, getTypeStatus } = metadata;
  if (byName && readObjectScope && getTypeStatus?.('object') === 'idle' && objectName) {
    // `views` rides beside the published shape for this package's own readers.
    const scope = readObjectScope({ names: [objectName] }) as { objects: unknown[]; served?: unknown; views?: unknown };
    return {
      objects: scope.objects,
      served: {
        views: Array.isArray(scope.views) ? scope.views : NO_ITEMS,
        objects: Array.isArray(scope.served) ? scope.served : NO_ITEMS,
      },
    };
  }
  const objects = byName ? readObjectsByName(metadata, [objectName], { views: true }) : metadata.objects;
  return {
    objects: objects ?? NO_ITEMS,
    served: { views: metadata.getItemsByType?.('view') ?? NO_ITEMS, objects: metadata.getItemsByType?.('object') ?? NO_ITEMS },
  };
}

/**
 * How the resolver reads an object (objectstack#29121). By default from the
 * whole `objects` list, as the Studio's and the search page's callers do. With
 * `byName`, an `object` or `view` target reads its object by name
 * (`readObjectsByName`) while nothing has loaded the whole list, so a surface
 * that names a few objects (Home's recent rows, the app sidebar) never loads
 * the registry for their labels; a `view` target's object is read with its
 * views, which its label is. A `dashboard` target the app bundle does not hold
 * is read by name the same way (`useReadItemsByName`, objectstack#29235),
 * never through the whole `/meta/dashboard` list.
 */
export interface NavTargetLabelOptions {
  byName?: boolean;
}

export function useNavTargetLabel(options?: NavTargetLabelOptions): NavTargetLabelResolver {
  const metadata = useMetadata();
  const byName = options?.byName === true;
  const readItemsByName = useReadItemsByName(metadata);
  const bundledReads = useBundledReads();
  const { objectLabel, viewLabel, dashboardLabel } = useObjectLabel();
  const { language, t } = useObjectTranslation();
  const drafts = useContext(DraftTargetLabels);

  return useMemo<NavTargetLabelResolver>(
    () => (target: NavLabelTarget) => {
      switch (target.kind) {
        case 'object': {
          const objects = byName ? readObjectsByName(metadata, [target.objectName]) : metadata.objects;
          const def = findByName(objects, target.objectName);
          // A served object's label is already translated (objectstack#30311):
          // drawn as given. A pending draft's label, which no server
          // translated, still goes through the bundle.
          return metadataText(def?.label, language)
            ?? nonEmpty(objectLabel({
              name: target.objectName,
              label: draftText(drafts, 'object', target.objectName, language) ?? '',
            }));
        }
        case 'view': {
          const { objects, served } = readViewTarget(metadata, byName, target.objectName);
          const views = listViewsOf(findByName(objects, target.objectName));
          const id = resolveViewId(target.viewName, Object.keys(views), target.objectName);
          const text = metadataText(id ? views[id]?.label : undefined, language);
          // A served view's label is already translated (objectstack#30311),
          // as its tab on the object page draws it; a view the client derived
          // still goes through the bundle.
          if (text !== undefined && isServedView(served, target.objectName, id)) return text;
          return nonEmpty(viewLabel(target.objectName, target.viewName, text ?? ''));
        }
        case 'dashboard': {
          // objectstack#28645 — the app bundle holds every dashboard its
          // navigation names; the list is read only for one it does not hold.
          const def = bundledFirst(bundledReads, 'dashboard', target.dashboardName, () =>
            byName ? readItemsByName('dashboard', [target.dashboardName], () => metadata.dashboards) : metadata.dashboards,
          );
          // A served dashboard's label is already translated
          // (objectstack#30244): drawn as given. A pending draft's label,
          // which no server translated, still goes through the bundle.
          return metadataText(def?.label, language)
            ?? nonEmpty(dashboardLabel({
              name: target.dashboardName,
              label: draftText(drafts, 'dashboard', target.dashboardName, language) ?? '',
            }));
        }
        case 'reportIndex':
          return nonEmpty(t('sidebar.allReports', { defaultValue: 'All reports' }));
        default:
          return undefined;
      }
    },
    [metadata, byName, readItemsByName, bundledReads, objectLabel, viewLabel, dashboardLabel, language, t, drafts],
  );
}
