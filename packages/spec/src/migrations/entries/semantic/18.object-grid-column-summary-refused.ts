// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the authoring rule `list-view-summary-field-type-refused`
// (`@objectstack/lint`) on its `object-grid` carrier. No D2 conversion: which
// field or which summary the author meant is a judgement about the grid, and no
// rewrite keeps a figure the aggregate door refuses to compute.
export const entry: SemanticMigration = {
  id: 'object-grid-column-summary-refused',
  surface:
    'ui.ObjectGridProps.columns[].summary on an `object-grid` page component (the list view\'s own column entry, '
    + 'ListViewSchema.shape.columns), on a page saved live or published through the metadata doors '
    + '(PUT /api/v1/meta/page/NAME live save, the per-item publish, POST /api/v1/packages/PKG/publish-drafts, '
    + 'and the restore doors POST /api/v1/meta/page/NAME/rollback, POST /api/v1/packages/PKG/commits/COMMIT/revert '
    + 'and POST /api/v1/packages/PKG/rollback; Studio, REST and MCP authors), and on a page os validate / os build / '
    + 'os lint / os verify judge: a column summary whose function the engine\'s aggregate door refuses over the '
    + 'aggregated field\'s declaration — `sum` / `avg` over a non-numeric field (and `sum` over a percent), '
    + '`min` / `max` over a text, option, reference, formula or JSON-stored field, `count_unique` over a JSON-stored '
    + 'field or a field declared `multiple: true`. The aggregated field is `summary.field`, else the column\'s own `field`',
  replacement:
    'Aggregate a field of a type the summary accepts (the object form `summary: { type, field }` aggregates another '
    + 'field of the bound object), or write a summary the field accepts — `count` and the four filled / empty '
    + 'summaries take any field. The refusal\'s fix line names where to point the summary and the summaries the '
    + 'field\'s declaration accepts; a formula field is stored as a field of its return type and aggregated as that',
  reason:
    'An object-grid page component\'s `columns` declares the list view\'s column union, so a `summary` on it parsed '
    + 'whatever the field\'s type, and the page saved (200), published and built. A paged, ungrouped grid that owns '
    + 'its fetch asks the footer\'s whole-set aggregate query of its column summaries, and the aggregate door '
    + 'answers a refused pair 400 INVALID_FIELD; one refused node fails the whole query, so every summary column of '
    + 'that grid then shows the page\'s figure, labelled as the page\'s. A grid whose rows fit one page, or are handed '
    + 'in, sums them in the browser, where such a pair can still draw a figure that lasts only while the set fits '
    + 'the page. The authoring rule list-view-summary-field-type-refused (severity error), which already refused '
    + 'the same entry on a list view, now refuses it on the grid in os validate, os build, os lint and os verify, '
    + 'and a live save, a publish and a restore of the page answer 422 INVALID_METADATA with the rule in issues[], '
    + 'at the component\'s `properties.columns[J].summary`. The grid is bound by its `dataSource.object`, else '
    + '`properties.objectName`; an object the stack does not define, a field that does not resolve, a dotted path '
    + 'and a field with no declared type are not judged. A draft save (mode=draft) runs no rule and still stores; '
    + 'the draft is judged at its publish. Rows stored before this release: a page row holding such a summary stays '
    + 'stored and readable, the boot does not judge it, and the page still renders, its footer showing the page\'s '
    + 'figure as before. A live re-save of that row is refused until the summary is fixed, because the gate charges '
    + 'a write with the written page\'s own findings whatever the stored row held; a draft stored earlier blocks its '
    + 'package\'s publish until fixed; a history version holding it can no longer be restored (the same 422); '
    + 'deleting the page, or saving it as a draft, still works. OS_ALLOW_UNLINTED_METADATA_WRITES=1 turns the save, '
    + 'publish and restore refusal into a logged warning for a migration window. There is no mechanical rewrite: '
    + 'which field or which summary the author meant is a judgement about the grid.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files and confirm no '
    + 'list-view-summary-field-type-refused finding at a page\'s `properties.columns[J].summary`. For stored pages, '
    + 'PUT /api/v1/meta/page/NAME with each object-grid column summary over a field its type accepts (a number for '
    + '`sum` / `avg`, a number, date or boolean for `min` / `max`, a scalar for `count_unique`) answers 200, '
    + 'POST /api/v1/packages/PKG/publish-drafts publishes the package that holds it, and the grid\'s footer, once '
    + 'the matched set outgrows one page, reads as the whole set\'s figure rather than the page\'s.',
};
