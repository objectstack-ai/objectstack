// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-kanban` page block's `conditionalFormatting` was
// `z.unknown()`, held while objectui's kanban authored a second rule dialect
// the list view's member refuses. objectstack-ai/objectui#11522 retired that
// dialect from objectui's authoring faces, so the row now takes the list view's
// own member, by reference, as `object-grid` does. D3 only: page-component
// `properties` is not parsed on the metadata save or load path, so a stored page
// is never refused; and the authored census found no working rule to respell —
// the refused values are objectui's own refusal probes and one no-predicate
// fixture in this package, respelled in the same change.
export const entry: SemanticMigration = {
  id: 'ui-object-kanban-conditional-formatting-typed',
  surface: 'page `object-kanban` components — `properties.conditionalFormatting` (which used to accept any '
    + 'value)',
  replacement: 'the list view\'s own rules, `[{ condition, style }]`: a non-blank CEL `condition` over the '
    + 'card\'s `record.*` and a CSS `style` map of string values. Rewrite a native rule `{ field, operator, '
    + 'value, backgroundColor }` as `{ condition: "record.FIELD == VALUE", style: { backgroundColor } }`, an '
    + '`expression` as `condition`, and move a colour written beside `condition` into `style`.',
  reason: 'The board reads `conditionalFormatting` as an ordered list of `{ condition, style }` rules, through '
    + 'the evaluator the grid\'s rows use, and paints a card with the `style` of the first rule whose condition '
    + 'holds; objectui declares exactly the list view\'s rule as the member\'s only dialect. The page-component '
    + 'row declared it `z.unknown()`, so `42`, a bare string or a rule with no `style` passed the '
    + 'component-props gate and the board painted no card for it. The row now takes the list view\'s own '
    + 'member, by reference, as `object-grid` does, so one rule is judged the same way on every door. It is '
    + 'read where every page component\'s props are: the component-props gate reports a refused value as an '
    + 'advisory `component-props-invalid` / `component-props-unknown-key` finding on `objectstack validate`, '
    + '`objectstack build` and `objectstack lint`, and a stored page still saves and loads, because a page '
    + 'component\'s `properties` is not parsed on the metadata save or load path. No conversion is '
    + 'registered: nothing on the load path refuses the shape, and the authored census found no working rule '
    + 'to respell. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-kanban` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under '
    + '`properties.conditionalFormatting`. Each board that sets rules paints the card each rule names with '
    + 'its `style`.',
};
