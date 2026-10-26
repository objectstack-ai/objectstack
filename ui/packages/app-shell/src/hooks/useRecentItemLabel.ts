/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useRecentItemLabel — what a "recently accessed" entry is called NOW, in the
 * current language (objectui#11678).
 *
 * An object, dashboard, page, report or Studio package entry stores its
 * identity only (`RecentNamedItem`: `type` + `name`), so this hook is where its
 * text comes from — on every render, never stored. A rename, or a switch of
 * language, shows on the next render; nothing is minted from the route.
 *
 * It holds no labelling rule of its own. Each kind asks what the console
 * already asks for that kind:
 *
 *  - an object: what the page the entry opens — the object's LIST — is titled,
 *    `useObjectLabel`'s `objectPluralLabel` over the object's cached metadata
 *    (the translated plural, else the declared `pluralLabel`, else the label
 *    the singular rung reads; objectui#11733). ⛔ Not {@link useNavTargetLabel}:
 *    its object rung is the spec's step 3 for an UNLABELLED NAVIGATION ENTRY
 *    ("the object's label", the singular), a ruling this entry does not reopen;
 *  - a dashboard: {@link useNavTargetLabel} — the text the sidebar shows for an
 *    unlabelled navigation entry that opens the same target (the metadata
 *    label, an inline locale map read in the active language, through the
 *    `useObjectLabel` bundle lookup);
 *  - a list view (objectui#12604): {@link useNavTargetLabel} again — the text
 *    the sidebar shows for an unlabelled navigation entry that opens the same
 *    view (the view's label from its object's `listViews`, through the
 *    `viewLabel` bundle lookup). A view the cache does not hold — one a user
 *    saved for themself — is drawn as the list it opens: the object's, as an
 *    object entry is;
 *  - a page or a report: the same pair for that kind — the page's / report's
 *    cached metadata `label`, through `useObjectLabel`'s `pageLabel` /
 *    `reportLabel`. `useNavTargetLabel` has no page or report target because
 *    the navigation ruling names none, so the pair is composed here from the
 *    same two helpers it uses;
 *  - a Studio package (objectui#11863): the `name` its row in `packages` has —
 *    the package list the rendering surface loaded, as the Studio landing does
 *    with `fetchPackages()`. A package has no metadata cache behind it, so the
 *    list is handed in rather than read here. The spec's manifest `name` is a
 *    plain string with no per-language form, so a rename shows on the next
 *    render and a switch of language leaves it as declared.
 *
 * With no label anywhere the entry shows its machine name — the backstop the
 * navigation renderer uses too, including before the type's metadata has
 * loaded. That covers a package missing from `packages`, or a call that passes
 * no list: ⛔ so a surface that has no package list does not draw package
 * entries at all, rather than show their ids (the app sidebar leaves them out
 * for that reason).
 *
 * A record or a Studio metadata item (`RecentTextItem`) carries its own text,
 * which is returned as stored.
 */

import { useMemo } from 'react';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';
import type { RecentItem } from '../context/RecentItemsProvider.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { findByName, metadataText, useNavTargetLabel, type LabelledRecord } from './useNavTargetLabel.js';

/** Answers the display text of a recent entry, in the current language. */
export type RecentItemLabelResolver = (item: RecentItem) => string;

/** `''` from a bundle lookup that found nothing and had no metadata to fall back to. */
function nonEmpty(text: string | undefined): string | undefined {
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

export function useRecentItemLabel(
  sources: {
    /** The package list the surface loaded, which labels a `package` entry by its row's `name`. */
    packages?: ReadonlyArray<{ id: string; name: string }> | null;
  } = {},
): RecentItemLabelResolver {
  const { packages } = sources;
  const targetLabel = useNavTargetLabel();
  const metadata = useMetadata();
  const { objectPluralLabel, pageLabel, reportLabel } = useObjectLabel();
  const { language } = useObjectTranslation();

  return useMemo<RecentItemLabelResolver>(
    () => (item: RecentItem) => {
      /** What an object's list is titled — an `object` entry's label, and a view's fallback. */
      const listTitle = (objectName: string): string => {
        const def = findByName(metadata.objects, objectName) as (LabelledRecord & { pluralLabel?: unknown }) | undefined;
        // The singular half is read exactly as `useNavTargetLabel` reads it;
        // `pluralLabel` is a plain string in the spec, so only a string is one.
        const text = metadataText(def?.label, language);
        const plural = typeof def?.pluralLabel === 'string' ? def.pluralLabel : undefined;
        return nonEmpty(objectPluralLabel({ name: objectName, label: text ?? '', pluralLabel: plural })) ?? objectName;
      };
      switch (item.type) {
        case 'object':
          return listTitle(item.name);
        case 'view':
          return targetLabel({ kind: 'view', objectName: item.object, viewName: item.name }) ?? listTitle(item.object);
        case 'dashboard':
          return targetLabel({ kind: 'dashboard', dashboardName: item.name }) ?? item.name;
        case 'page': {
          const text = metadataText(findByName(metadata.pages, item.name)?.label, language);
          return nonEmpty(pageLabel({ name: item.name, label: text ?? '' })) ?? item.name;
        }
        case 'report': {
          const text = metadataText(findByName(metadata.reports, item.name)?.label, language);
          return nonEmpty(reportLabel({ name: item.name, label: text ?? '' })) ?? item.name;
        }
        case 'package':
          return nonEmpty(packages?.find((p) => p.id === item.name)?.name) ?? item.name;
        default:
          return item.label;
      }
    },
    [targetLabel, metadata, objectPluralLabel, pageLabel, reportLabel, language, packages],
  );
}
