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
 *    the served `pluralLabel`, else the served `label` (objectui#11733). The
 *    server translated both, by its label order for an overridden item, so
 *    they are drawn as given (objectstack#30311); `useObjectLabel`'s
 *    `objectPluralLabel` under the object's name is asked only when the cache
 *    holds neither. ⛔ Not {@link useNavTargetLabel}: its object rung is the
 *    spec's step 3 for an UNLABELLED NAVIGATION ENTRY ("the object's label",
 *    the singular), a ruling this entry does not reopen;
 *  - a dashboard: {@link useNavTargetLabel} — the text the sidebar shows for an
 *    unlabelled navigation entry that opens the same target (the served
 *    label, an inline locale map read in the active language, drawn as given;
 *    the `useObjectLabel` bundle lookup only when the read carries none);
 *  - a list view (objectui#12604): {@link useNavTargetLabel} again — the text
 *    the sidebar shows for an unlabelled navigation entry that opens the same
 *    view (a served view's label from its object's `listViews` as given, a
 *    view the client derived through the `viewLabel` bundle lookup). A view
 *    the cache does not hold — one a user
 *    saved for themself — is drawn as the list it opens: the object's, as an
 *    object entry is;
 *  - a page or a report: the same rule for that kind — the page's / report's
 *    cached metadata `label` as served, else `useObjectLabel`'s `pageLabel` /
 *    `reportLabel` under its name. `useNavTargetLabel` has no page or report
 *    target because the navigation ruling names none, so the rule is composed
 *    here from the same two helpers it uses;
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
import { bundledFirst, useBundledReads } from '../providers/bundledReads.js';
import {
  findByName,
  metadataText,
  servedObjectPluralLabel,
  useNavTargetLabel,
  type LabelledRecord,
  type NavTargetLabelOptions,
} from './useNavTargetLabel.js';
import { readObjectsByName, useReadItemsByName } from './useObjectPresence.js';

const BY_NAME: NavTargetLabelOptions = { byName: true };

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
  // objectstack#29121 — a row names its object by name, never by loading the
  // whole registry: a few recent entries, on Home before anything else asks it.
  const targetLabel = useNavTargetLabel(BY_NAME);
  const metadata = useMetadata();
  // objectstack#29235 — a page or report row reads its item by name, never its
  // type's whole list (a dashboard row does too, through `targetLabel`).
  const readItemsByName = useReadItemsByName(metadata);
  const bundledReads = useBundledReads();
  const { objectPluralLabel, pageLabel, reportLabel } = useObjectLabel();
  const { language } = useObjectTranslation();

  return useMemo<RecentItemLabelResolver>(
    () => (item: RecentItem) => {
      /** What an object's list is titled — an `object` entry's label, and a view's fallback. */
      const listTitle = (objectName: string): string => {
        const def = findByName(readObjectsByName(metadata, [objectName]), objectName) as (LabelledRecord & { pluralLabel?: unknown }) | undefined;
        // A served object's labels are already translated (objectstack#30311):
        // drawn as given, as the list page the entry opens titles itself.
        return nonEmpty(servedObjectPluralLabel({ ...def, name: objectName }, language, objectPluralLabel)) ?? objectName;
      };
      switch (item.type) {
        case 'object':
          return listTitle(item.name);
        case 'view':
          return targetLabel({ kind: 'view', objectName: item.object, viewName: item.name }) ?? listTitle(item.object);
        case 'dashboard':
          return targetLabel({ kind: 'dashboard', dashboardName: item.name }) ?? item.name;
        // A served page's or report's label is already translated
        // (objectstack#30244): drawn as given, the bundle asked only when the
        // read carries none.
        case 'page': {
          const pages = () => readItemsByName('page', [item.name], () => metadata.pages);
          return metadataText(bundledFirst(bundledReads, 'page', item.name, pages)?.label, language)
            ?? nonEmpty(pageLabel({ name: item.name, label: '' }))
            ?? item.name;
        }
        case 'report': {
          const reports = readItemsByName('report', [item.name], () => metadata.reports);
          return metadataText(findByName(reports, item.name)?.label, language)
            ?? nonEmpty(reportLabel({ name: item.name, label: '' }))
            ?? item.name;
        }
        case 'package':
          return nonEmpty(packages?.find((p) => p.id === item.name)?.name) ?? item.name;
        default:
          return item.label;
      }
    },
    [targetLabel, metadata, readItemsByName, bundledReads, objectPluralLabel, pageLabel, reportLabel, language, packages],
  );
}
