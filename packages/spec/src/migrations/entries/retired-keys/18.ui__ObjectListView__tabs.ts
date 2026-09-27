// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20301 (ADR-0049 enforce-or-remove; triage verdict RETIRE under the
// maintainer's #18900 criterion). `ObjectListView.tabs` declared tab definitions for
// a multi-tab view interface, and no renderer ever drew them: the one
// component that reads a `ViewTab[]` (objectui's `TabBar`) has no production
// mount, and the tab strip above an object's records is the saved-view
// switcher (`ViewTabBar`), which renders one tab per `listViews` entry and
// reads no `tabs` key. Tombstoned with `retiredKey()` beside the `pageName`
// tombstone already on this shape; `ViewTabSchema` stays, reused by the
// page-only `userFilters.tabs` preset bar. D2: `view-list-tabs-removed`.
export const entry = 'ui/ObjectListView:tabs';
