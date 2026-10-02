// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21229 — an `object-grid` page block's `exportOptions` was `z.unknown()`, so a
// bare format array (the list view's legacy spelling, which the list view lifts
// to `{ formats }`) was accepted on the grid, whose renderer reads
// `exportOptions.formats` and lifts nothing. The row now takes the list view's
// five-member export options OBJECT by identity, not the list view's union. D3
// only: page-component `properties` is not parsed on the metadata save or load
// path, so a stored page is never refused and there is no load-path refusal for
// a conversion to pre-empt; the bare array never worked here, and lifting it
// would change the export menu a deployed grid shows today; the authored census
// found nothing to respell.
export const entry: SemanticMigration = {
  id: 'ui-object-grid-export-options-closed',
  surface: 'page `object-grid` components — `properties.exportOptions` (which used to accept any value)',
  replacement: 'the export options object a list view\'s `exportOptions` declares: `{ formats?, '
    + 'maxRecords?, includeHeaders?, fileNamePrefix?, streaming? }`, with `formats` drawn from '
    + '`csv`, `xlsx` and `json`, `maxRecords` a non-negative integer, and `includeHeaders` / '
    + '`streaming` booleans. Where a bare format array was written, write `{ formats: [...] }` to '
    + 'offer the formats you listed — the grid will now offer exactly those — or `{}` to keep the '
    + 'csv/json default the grid has been offering. Delete `pdf` from `formats`, and any key the '
    + 'object does not declare; delete an `exportOptions: null` (it never enabled the menu).',
  reason: 'The grid reads one export options block — `exportOptions.formats`, `.maxRecords`, '
    + '`.includeHeaders`, `.fileNamePrefix` and `.streaming` — the block a list view declares, '
    + 'but the page-component row declared the key `z.unknown()`, so any value passed the '
    + 'component-props gate. The trap was the list view\'s legacy spelling: a bare format array is '
    + 'legal on a list view, which lifts it to `{ formats }` at parse, and was accepted on the grid, '
    + 'which lifts nothing — the export menu appeared, offering the csv/json default, and the '
    + 'author\'s list was dropped without a report. The row now takes the list view\'s export '
    + 'options object itself rather than its union, so a legacy spelling does not spread to a '
    + 'surface that never read it: a bare array is refused with the object form named, a format '
    + 'outside the enum is refused at its index (`pdf` with its retirement text), and a key the '
    + 'object does not declare is named. It is read where every page component\'s props are: the '
    + 'component-props gate reports these as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and '
    + '`objectstack lint`, and a stored page still saves and loads, because a page component\'s '
    + '`properties` is not parsed on the metadata save or load path. No conversion is registered: '
    + 'nothing on the load path refuses the shape; a bare array has no rewrite that both keeps '
    + 'what the grid shows today and honours what the author wrote, which is the judgment this '
    + 'entry leaves to the upgrader; and the authored census found nothing to respell. Population '
    + 'measured at the change, on origin/main f148852752: zero `object-grid` blocks authoring '
    + '`exportOptions` in the examples, the package fixtures, the documentation and the published '
    + 'skills, against ten authored `object-grid` blocks through the same matcher (nine in '
    + 'TypeScript, one in a YAML documentation example) and four list-view `exportOptions` '
    + 'authorings as the key\'s control. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-grid` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding on a '
    + '`properties.exportOptions` path. Every `exportOptions` on an `object-grid` is an object '
    + 'carrying only the five declared keys, with every `formats` entry `csv`, `xlsx` or `json`, '
    + 'and the grid\'s export menu offers the declared formats the active export path delivers '
    + '(`xlsx` on the server stream only).',
};
