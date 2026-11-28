// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Where an item of a list comes from, in the words the App Studio list uses
 * (objectstack#37918, the maintainer's decision 7 on epic objectstack#37424):
 * 系统自带 / 已修改 / 新建 — system-shipped, modified, new.
 *
 * Read from two facts the list already has, and only those:
 *
 *  - the row's customization mark (`customizationMarks.ts`), from the base's
 *    served customization read: a served override is "customized", any other
 *    item of the base's `.custom` pair is "added" (ADR-0146 D3);
 *  - the row's provenance (`classifyProvenance` in `ResourceListPage`): a row
 *    authored at runtime, or in a customization package, is `runtime`.
 *
 * A served override is served under the BASE's id, so its provenance reads
 * `artifact`; the mark is what says it was modified. That is why the Studio
 * list's source filter cannot read the provenance alone: its two narrowings
 * — "modified and new", "system-shipped" — are {@link studioListSource}'s two
 * values, written to the list's address as the existing `source` values
 * (`metadataListState.ts`, unchanged), and the detail's ‹ › order reads the
 * same function (`useListOrderedNames.ts`), so the two cannot disagree.
 */

import type { CustomizationMarkKind } from '../studio-design/customizationMarks.js';

/** What the Studio list's Source column says of a row. */
export type StudioSourceKind = 'system' | 'modified' | 'new';

/** The kind of a row: its mark first, then its provenance. */
export function studioSourceKind(
  provenance: 'artifact' | 'runtime',
  mark: CustomizationMarkKind | null,
): StudioSourceKind {
  if (mark === 'customized') return 'modified';
  if (mark === 'added') return 'new';
  return provenance === 'runtime' ? 'new' : 'system';
}

/**
 * The row's value for the list state's source filter in the Studio list:
 * `artifact` is "system-shipped", `runtime` is "modified and new".
 */
export function studioListSource(kind: StudioSourceKind): 'artifact' | 'runtime' {
  return kind === 'system' ? 'artifact' : 'runtime';
}

/** The i18n key each kind's badge is drawn with. */
export const STUDIO_SOURCE_KEY: Readonly<Record<StudioSourceKind, string>> = Object.freeze({
  system: 'engine.list.source.system',
  modified: 'engine.list.source.modified',
  new: 'engine.list.source.new',
});
