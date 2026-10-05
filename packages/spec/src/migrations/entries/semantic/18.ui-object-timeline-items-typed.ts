// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-timeline` page block's `items` was `z.array(z.unknown())`:
// each entry is objectui's authored timeline element (`TimelineFeedItem` /
// `TimelineGanttItem`, ruled on objectui#6356), which the spec did not declare,
// and the arm an entry must be is chosen by the row's `variant`. The maintainer
// ruled on #21704 (fork 4, letter B): both arms closed, a feed entry's `content`
// opaque, a row refinement pairing each entry with the arm `variant` selects,
// and a gantt bar's dates a string or a number. D3 only: page-component
// `properties` is not parsed on the metadata save or load path, so a stored page
// is never refused; and the authored census found no drawn entry to respell —
// the refused values are objectui's probes of its render-time gantt date
// diagnostic.
export const entry: SemanticMigration = {
  id: 'ui-object-timeline-items-typed',
  surface: 'page `object-timeline` components — `properties.items` (whose entries used to accept any value)',
  replacement: 'the entry kind the block\'s `variant` selects: on `vertical` (the default) or `horizontal`, a feed '
    + 'entry `{ time?, title, description?, variant?, icon?, content?, className? }`; on `gantt`, a gantt row '
    + '`{ label, items? }` whose bars are `{ title?, startDate?, endDate?, variant? }`, each date a string or epoch '
    + 'milliseconds. Write a feed entry\'s `date` as `time` and its `color` as `variant` (`default`, `success`, '
    + '`warning`, `danger`, `info`); move a gantt row to `variant: \'gantt\'`, or a feed entry off it.',
  reason: 'The timeline rail draws `items` as authored, ahead of every record source, and each branch of its '
    + 'renderer reads only its own kind of entry: the feed branches read `time`, `title`, `description`, `variant`, '
    + '`icon`, `content` and `className`; the gantt branch reads a row\'s `label` and its bars\' `title`, '
    + '`startDate`, `endDate` and `variant`. The page-component row declared each entry `z.unknown()`, so a '
    + 'misspelled key, a feed entry with no `title`, or a gantt row on a feed timeline passed the component-props '
    + 'gate, and the rail drew an empty, unlabelled entry. The row now takes objectui\'s two ruled kinds, closed, '
    + 'and pairs each entry with the kind its `variant` selects; a feed entry\'s `content` (child components) is '
    + 'held unjudged until a writer appears. It is read where every page component\'s props are: the '
    + 'component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and `objectstack lint`, '
    + 'and a stored page still saves and loads, because a page component\'s `properties` is not parsed on the '
    + 'metadata save or load path. No conversion is registered: nothing on the load path refuses the shape, and '
    + 'the authored census found no drawn entry to respell. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-timeline` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.items`. Each timeline '
    + 'with authored entries draws every entry with its title (or row label), date and colour.',
};
