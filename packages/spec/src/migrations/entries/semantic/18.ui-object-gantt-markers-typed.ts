// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-gantt` page block's `markers` was `z.array(z.unknown())`:
// its element contract lived only in objectui, so a marker with no `date`, a
// numeric `date` or a misspelled member passed the component-props gate, and
// the chart drew no line, or drew it unlabelled and in the default colour. The
// spec now declares objectui's own authoring declaration of a marker,
// `{ date, label?, color? }` with `date` a string, and the row takes it. D3
// only: page-component `properties` is not parsed on the metadata save or load
// path, so a stored page is never refused; a misspelled member has no rewrite
// that says which of the three the author meant; and the authored census found
// no authored value to respell — the one refused value is objectui's own
// compile-time refusal probe.
export const entry: SemanticMigration = {
  id: 'ui-object-gantt-markers-typed',
  surface: 'page `object-gantt` components — `properties.markers` (whose entries used to accept any value)',
  replacement: 'a list of `{ date, label?, color? }`: `date` an ISO date or date-time string (required), `label` '
    + 'the text drawn against the line, `color` any CSS colour. Write a marker `title`, `text` or `name` as '
    + '`label`, and a `colour` as `color`; give every marker a string `date`.',
  reason: 'The gantt reads each marker with one shape — `date` places the line, and a date that does not '
    + 'parse or falls outside the drawn range draws none; `label` is drawn against it; `color` paints it, the '
    + 'theme\'s primary colour when absent — and the page-component row declared the entries `z.unknown()`, '
    + 'because that contract was objectui\'s alone. So a marker with no `date`, a numeric `date` or a '
    + 'misspelled member passed the component-props gate, and the chart drew no line, or drew it with no label '
    + 'and in the default colour. The spec now declares objectui\'s own authoring declaration of a marker, '
    + '`{ date, label?, color? }` with `date` a string (authored metadata is JSON, which cannot carry a '
    + '`Date`), closed as every element shape on that map is. It is read where every page component\'s props '
    + 'are: the component-props gate reports a refused value as an advisory `component-props-invalid` / '
    + '`component-props-unknown-key` finding on `objectstack validate`, `objectstack build` and `objectstack '
    + 'lint`, and a stored page still saves and loads, because a page component\'s `properties` is not parsed '
    + 'on the metadata save or load path. No conversion is registered: nothing on the load path refuses the '
    + 'shape, and a misspelled member has no rewrite that says which member the author meant — which is the '
    + 'judgment this entry leaves to the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-gantt` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.markers`. Each '
    + 'gantt that sets markers draws one line per marker whose date falls in the drawn range, with the label '
    + 'and colour written.',
};
