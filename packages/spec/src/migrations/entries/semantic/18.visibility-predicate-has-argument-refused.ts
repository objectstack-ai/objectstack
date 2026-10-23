// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The page/view `visibleWhen` door refuses a `has()` argument that is not a
// field selection (ruling 6351260886 on #25281). A structured TODO, not a D2
// conversion: `has(status)` could mean `has(record.status)`,
// `'status' in record` or `record.status != null`, and `has(record.items[0])`
// could mean `size(record.items) > 0` or a test on the first item's field.
// Which one the author meant is not recorded, and the platform does not guess.
export const entry: SemanticMigration = {
  id: 'visibility-predicate-has-argument-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'visibleWhen on a page component and on a form view\'s sections and section fields — a has() call whose '
    + 'argument is not a field selection: a name alone, has(status), an index as the last step, '
    + 'has(record.items[0]), or any other argument that is not e.f',
  replacement:
    'Write the presence test the CEL definition admits, `has(e.f)` with `f` a field name after a dot, on the root '
    + 'the surface binds (`record` on a runtime view or page, `data` on a metadata-editing form): '
    + '`has(record.status)` or `\'status\' in record` for a field, and `size(record.items) > 0` to ask whether a '
    + 'list has a first element (`\'k\' in e` for a bracketed string key). `has()` over a selection whose receiver '
    + 'is indexed or called, such as `has(record.items[0].name)`, is accepted. `os validate`, `os build`, `os lint` '
    + 'and the page and view save doors (`422 INVALID_METADATA`) refuse the shape as '
    + '`visibility-predicate-has-argument`, an error.',
  reason:
    'The CEL definition gives `has()` one form, `has(e.f)`, where `f` is syntactically an identifier and only the '
    + 'select notation is supported. The engine refuses any other argument as `has() invalid argument` on every '
    + 'evaluation, whatever the record holds. The page and view `visibleWhen` door did not judge the argument, so '
    + 'such a predicate published clean, and the console, which renders a faulting predicate as visible, drew the '
    + 'guarded element for every user. The refusal is a fact about the source, decided before any type is known, '
    + 'which is why the door that refuses unknown functions can refuse it too without judging the types that flow '
    + 'through a predicate. No mechanical move is lossless: the test the author meant is not recorded. Measured at '
    + 'the change: no producer of either shape in this repository or in HotCRM; every other predicate surface '
    + 'already refused it through `validateExpression`. ADR-0137 / ADR-0087.',
  acceptanceCriteria:
    'Load every page and view module (`os validate` or `os build`): no `visibility-predicate-has-argument` '
    + 'finding. Every `has()` in a page component\'s or a form view\'s `visibleWhen` takes a field selection, and '
    + 'the element is drawn only when its predicate is true. A stored page or view row in the refused shape still '
    + 'loads and is served, and its next save is refused until it is corrected; `os migrate meta --stored` lists '
    + 'each such predicate under this entry\'s id. Done when no stored or authored `visibleWhen` carries the shape.',
};
