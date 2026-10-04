// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — `navigation` on the `object-map`, `object-gantt` and `object-tree`
// page blocks was `z.unknown()` although each renderer hands it to the shared
// navigation hook, which reads `.mode` and types its mode union as the list
// view's `NavigationConfigSchema`; any value passed and an off-shape one opened
// the record page in silence. The three rows now take that schema by reference,
// the carrier `object-grid`, `object-kanban`, `object-calendar` and
// `object-timeline` already take. D3 only: page-component `properties` is not
// parsed on the metadata save or load path, so a stored page is never refused;
// an off-shape value has no rewrite that says what the author meant; and the
// authored census found nothing in either repository's corpora to respell.
export const entry: SemanticMigration = {
  id: 'ui-object-map-gantt-tree-navigation-typed',
  surface: 'page `object-map`, `object-gantt` and `object-tree` components — `properties.navigation` '
    + '(which used to accept any value)',
  replacement: 'the list view\'s navigation block `{ mode?, size?, openNewTab?, preventNavigation? }`, '
    + '`mode` one of `page`, `drawer`, `modal`, `split`, `popover`, `new_window`, `none` — the block '
    + '`object-grid`, `object-kanban`, `object-calendar` and `object-timeline` already take. Rewrite a bare '
    + 'mode string such as `navigation: \'drawer\'` as `navigation: { mode: \'drawer\' }`.',
  reason: 'Each of the three renderers hands `navigation` to the shared navigation hook, which reads '
    + '`navigation.mode`, falls back to `page` when it finds none, and types its mode union as the list '
    + 'view\'s `NavigationConfigSchema`. The rows declared the member `z.unknown()`, so any value passed '
    + 'the component-props gate and an off-shape one was answered with a silent default: `navigation: 42` '
    + 'and a bare mode string such as `\'drawer\'` both opened the record page, whatever they named. The '
    + 'three rows now take the list view\'s schema by reference, so one value is judged the same way on '
    + 'every door that carries it. It is read where every page component\'s props are: the '
    + 'component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and '
    + '`objectstack lint`, and a stored page still saves and loads, because a page component\'s '
    + '`properties` is not parsed on the metadata save or load path. No conversion is registered: '
    + 'nothing on the load path refuses the shape, and an off-shape value has no rewrite that both keeps '
    + 'what the block shows today (the record page) and honours what the author wrote — which is the '
    + 'judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-map`, `object-gantt` and `object-tree` node validates: '
    + '`objectstack validate` reports no `component-props-invalid` / `component-props-unknown-key` '
    + 'finding under `properties.navigation`. Each block that set `navigation` opens the mode it names '
    + 'on a marker, task or row click.',
};
