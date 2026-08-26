// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-form-field-length-malformed-refused',
  surface: 'form-view field row `maxLength` / `minLength` declarations '
    + '(`FormFieldSchema`, the rows inside `FormView.sections[].fields[]`) — '
    + '`0`, negative or non-integer values',
  replacement: 'a positive-integer bound (>= 1), or no declaration at all ("no minimum" is '
    + 'expressed by OMITTING `minLength`, never by `minLength: 0`). The row-level key is a '
    + 'per-form override that can only NARROW what the referenced object field already '
    + 'declares (the object field surface tightened first: #11566/#11949) — so a malformed '
    + 'row value is deleted, and a bound that was actually wanted is re-declared as a '
    + 'positive integer, or dropped in favour of the object field\'s own authoritative '
    + 'declaration',
  reason:
    '#12174: the form-field row carried the pre-#11566 shape — bare `z.number()` — after '
    + 'the object-field surface converged (`maxLength` #11566, `minLength` #11949, both '
    + '`z.number().int().min(1)`). The row keys are LIVE, measured in objectui: the spec '
    + 'bridge (`packages/react/src/spec-bridge/bridges/form-view.ts` mapField, '
    + 'objectui#5898) and plugin-form (`sectionFields.ts` normalizeSectionField) both copy '
    + 'them onto the runtime field, the console FormPage merges `override.maxLength ?? '
    + 'def.maxLength` onto the rendered input (objectui#5595), and the fields package '
    + 'builds react-hook-form validation rules from `minLength`/`maxLength` — so '
    + '`maxLength: 0` on a form row reached the DOM as an input that accepts nothing, and '
    + 'the public-form resolve route (`GET /forms/:slug`) serves the rows verbatim to '
    + 'anonymous renderers. The schema now refuses the malformed values at parse '
    + '(`z.number().int().min(1)`, ADR-0078 declared=enforced). Unlike the object-field '
    + 'twins there is NO type-conditional gate: a form row references its object field by '
    + 'name and usually omits `type`, so the referenced field\'s type is invisible at parse '
    + 'time — value shape is checkable on this surface, key placement is the object '
    + 'field\'s own schema\'s job.',
  acceptanceCriteria:
    'Every form-view field row declaring `maxLength` or `minLength` carries a positive '
    + 'integer. Well-formed rows (a positive-integer bound) parse byte-identically to '
    + 'before; rows declaring neither key are untouched, and absence stays absence — no '
    + 'default materializes. A stored form view carrying a malformed row value is refused '
    + 'on its next authoring-path save with a prescriptive per-key issue; the author '
    + 'deletes the key (the object field\'s own declaration keeps governing the write '
    + 'seam) or re-declares the intended positive integer.',
};
