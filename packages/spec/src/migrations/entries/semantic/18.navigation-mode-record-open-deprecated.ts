// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// `navigation.mode` no longer picks how an object's list opens a record
// (objectstack#35854, maintainer ruling 2026-11-20, verbatim 「废弃」, card
// comment 7039654214). Page blocks that carry `navigation` still honour it. The
// console's one rule replaces it: the record's name opens the full page, and
// the name cell's hover icon opens the side panel over the list. The key stays
// in the shape and every authored value still parses — a deprecation, not a
// retirement — so there is no tombstone, no RETIRED_KEYS_BY_MAJOR row and no D2
// conversion: stripping `page` or `drawer` mechanically would change nothing
// on an object's list but would change what a page block's rows open, and
// stripping `none` would make a read-only list start opening records. The one value that keeps a meaning is `none` (rows open
// nothing); the entry points its author at `preventNavigation: true`.
export const entry: SemanticMigration = {
  id: 'navigation-mode-record-open-deprecated',
  surface: 'ui.NavigationConfig.mode — `navigation.mode` on a list view or an object\'s listViews '
    + '(an object\'s list). Not on a page block that carries `navigation` (a list block, the '
    + 'timeline, an embedded view): there every value is still honoured',
  replacement: 'on an object\'s list, nothing: delete `navigation.mode: \'drawer\' | \'page\' | '
    + '\'new_window\'`. An object\'s list in the console opens a record one way for every reader — the '
    + 'record\'s name opens the full page, and the icon shown beside the name while the row is hovered '
    + 'opens the side panel over the list. A list that declared `new_window` and wants to keep opening '
    + 'records in a new tab writes `navigation: { openNewTab: true }`. A list whose rows must open '
    + 'nothing keeps `navigation.mode: \'none\'` or, better, writes `navigation: { preventNavigation: true }`. '
    + 'On a page block keep the key: it still picks the drawer, the page or a new tab',
  reason:
    'A RULED behaviour change with no shape change: the maintainer deprecated `navigation.mode` '
    + 'as the switch that picks how an object\'s list opens a record, together with the reader\'s own '
    + '「Open records: drawer / full page」 setting and the drawer\'s full-width state. Every value '
    + 'still parses, so nothing fails to load, but on an object\'s list `drawer`, `page` and '
    + '`new_window` no longer change what a click does: a list view that declares one behaves exactly '
    + 'as a list view that declares nothing. `none` keeps its meaning — the rows open nothing — '
    + 'because a read-only list that started opening records would be a regression nobody chose. '
    + '`openNewTab: true` stays live: the record\'s name then opens the full page in a new tab. A '
    + '⌘/Ctrl or middle click on the name still opens the page in a new tab. A page block that '
    + 'carries `navigation` (a list block, the timeline, an embedded view) reads the same key through '
    + 'its own renderer and still honours every value, so the key is not deprecated there. Not '
    + 'mechanically convertible: the same `NavigationConfigSchema` serves both surfaces, deleting the '
    + 'value from a page block would change what its rows open, a list that declared `new_window` may '
    + 'want `openNewTab: true` instead, and `none` must not be deleted at all.',
  acceptanceCriteria:
    'A list view declaring `navigation: { mode: \'page\' }`, `{ mode: \'drawer\' }` or '
    + '`{ mode: \'new_window\' }` loads, and in the console its record name opens the full page '
    + 'while the hover icon beside the name opens the side panel, the same as a list view with no '
    + '`navigation` block. A list view declaring `navigation: { openNewTab: true }` opens the page in '
    + 'a new tab from the name. A list view declaring `navigation: { mode: \'none\' }` or '
    + '`navigation: { preventNavigation: true }` opens no record on any click on a desktop. A page '
    + 'block declaring `navigation: { mode: \'page\' }` still opens the record page. No list view or '
    + 'object `listViews` entry still declares `drawer`, `page` or `new_window`.',
};
