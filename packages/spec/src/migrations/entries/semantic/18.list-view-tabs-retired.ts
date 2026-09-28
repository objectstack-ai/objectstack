// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20301 (ADR-0049 enforce-or-remove; triage verdict RETIRE under the
// maintainer's #18900 criterion) — the D3 entry of the `view-list-tabs-removed`
// family (ruling B on #17152: one D3 entry per retirement family, even when D2
// is lossless). Registered keys: `ui/ListView:tabs` and `ui/ObjectListView:tabs`.
// The strip changes no screen — nothing ever drew the tabs — which is exactly
// why it cannot be the end of the migration: what the author wanted was named
// presets, and those are a `listViews` entry each.
export const entry: SemanticMigration = {
  id: 'list-view-tabs-retired',
  surface: 'view.list.tabs / view.listViews.*.tabs — the list view\'s own tab definitions',
  replacement: 'One named list view per tab, under the object\'s `listViews` — the saved-view '
    + 'switcher above the object\'s records renders every entry as a tab. The tab\'s `name` '
    + 'becomes the entry\'s key, its `label` the entry\'s `label`, and its `filter` rules join the '
    + 'view\'s own `filter` on that entry, beside the `columns` the tab should show. A tab whose '
    + '`view` already named a list view needs nothing more.',
  reason: 'The D2 conversion `view-list-tabs-removed` deletes `tabs` from every list payload in '
    + '`stack.views[]`, in all three persisted spellings, and the delete is lossless in pixels: no '
    + 'renderer ever mounted a tab bar for the key, so a view that declared tabs has always drawn '
    + 'without them, and it still does. The judgment the conversion cannot make is the author\'s '
    + 'intent: each tab was a named preset the author wanted end users to switch to, and the '
    + 'platform delivers that as a named list view, not as a sub-key of one. Which tabs deserve an '
    + 'entry, what each should filter and show, and whether the switcher already lists an '
    + 'equivalent, are the author\'s decisions. The tab keys with no list-view counterpart — '
    + '`icon`, `order`, `pinned`, `isDefault`, `visible` — never had an effect either. One '
    + 'boundary is the author\'s by construction: tabs declared under `objects[].listViews` are '
    + 'reached by no conversion, so such an object is refused at its own door until edited by hand.',
  acceptanceCriteria: 'No list view in `stack.views[]` or in any object `listViews` map declares '
    + '`tabs`; the parse refuses the key by name at every list-view door. For each view that did: '
    + 'every tab the author still wants is a `listViews` entry with its own `label`, `filter` and '
    + '`columns`, and it appears as a tab in the switcher above the object\'s records and shows '
    + 'the rows its filter selects; a tab nobody wants is simply gone. No page-level '
    + '`userFilters` preset bar changes — that `tabs` is a different key, and it stays.',
};
