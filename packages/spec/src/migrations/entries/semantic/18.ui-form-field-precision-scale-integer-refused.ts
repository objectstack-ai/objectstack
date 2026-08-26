// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-form-field-precision-scale-integer-refused',
  surface: 'form-view field row `precision` / `scale` declarations '
    + '(`FormFieldSchema`, the rows inside `FormView.sections[].fields[]`) — '
    + 'non-integer or negative values (`scale: 2.5`, `precision: -1`)',
  replacement: 'a non-negative integer digit count, or no declaration at all. The row-level '
    + 'key is a per-form override of the referenced object field\'s own declaration (that '
    + 'surface tightened first: #8321) — a malformed row value is deleted, and a count '
    + 'that was actually wanted is re-declared as a non-negative integer (`scale: 2.5` was '
    + 'probably `2` or `3`)',
  reason:
    '#12174: the form-field row carried the pre-#8321 shape — bare `z.number()` — after '
    + 'the object-field surface converged on `z.number().int().min(0)` for both digit '
    + 'counts. The row keys are LIVE, measured in objectui: the spec bridge '
    + '(`form-view.ts` mapField, objectui#5898) and plugin-form (`sectionFields.ts`) copy '
    + 'them onto the runtime field, `ObjectForm` derives the number input\'s step from '
    + '`precision`, and the `NumberField` widget reads `scale` — so a malformed count '
    + 'flowed into rendering arithmetic (`Math.pow(10, -precision)`) with no defined '
    + 'meaning. The schema now refuses non-integer and negative values for both keys at '
    + 'parse time (ADR-0078 declared=enforced). Same no-type-gate rationale as the length '
    + 'pair entry (`ui-form-field-length-malformed-refused`): the row usually omits '
    + '`type`, so only value shape is checkable on this surface. '
    + '⚠️ `CurrencyConfigSchema.precision` and the gantt `scale` enum are different '
    + 'surfaces and are unchanged.',
  acceptanceCriteria:
    'Every form-view field row declaring `precision` or `scale` carries a non-negative '
    + 'integer. Well-formed rows (`0`, `2`, any non-negative integer) parse '
    + 'byte-identically to before; rows declaring neither key are untouched, and absence '
    + 'stays absence. A stored form view carrying a malformed row value is refused on its '
    + 'next authoring-path save with a prescriptive per-key issue; the author deletes the '
    + 'key or re-declares the integer they meant.',
};
