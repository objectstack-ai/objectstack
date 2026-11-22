// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The shared CEL validator refuses `==` / `!=` between a list-valued field and
// a non-null scalar literal (`list-equality`, #36167). A structured TODO, not a
// D2 conversion: `record.labels == 'frontend'` answers `false` on every row, so
// the condition the author meant — membership, or a whole-list match — is not
// recorded, and the platform does not guess.
export const entry: SemanticMigration = {
  id: 'cel-list-equality-refused',
  surface:
    'Any CEL predicate or formula the shared validator types against an object (a validation rule, a field rule, a '
    + 'formula, an action\'s visible / disabled, a hook or flow condition): `==` or `!=` '
    + 'between a read of a list-valued field (`multiselect`, `checkboxes`, `tags`, or a `select` / `radio` / '
    + '`lookup` / `user` / `file` / `image` field declared `multiple: true`) on `record` / `previous` — or, at a '
    + 'flow condition, its bare name, which the run binds to the trigger record\'s field — and a non-null '
    + 'string, number or boolean literal, in either operand order. Not the shape: a name a comprehension macro '
    + 'binds (`record.items.exists(labels, labels == \'a\')`, where `labels` is one item), nor a bare name a '
    + 'declared flow variable holds',
  replacement:
    'Test membership with `in`, null-guarded because `\'a\' in null` faults: `record.labels != null && '
    + '\'frontend\' in record.labels` for `==`, and `record.labels == null || !(\'frontend\' in record.labels)` for '
    + '`!=`. Compare the list with `null` to test whether it is set, and with a list literal for a whole-list match. '
    + '`os validate`, `os build`, the MCP `validate_expression` tool and the Studio object editor\'s draft check '
    + 'refuse the shape as `list-equality`, an error; the flow registration pass logs it.',
  reason:
    'CEL compares the whole list with the scalar, so `[\'frontend\', \'qa\'] == \'frontend\'` is `false`, and so '
    + 'is `null == \'frontend\'`: the expression answers `false` (`true` for `!=`) on every row whatever the list '
    + 'holds, with no fault and no log line. A condition written that way never fires (or always does), and the '
    + 'validator accepted it. Only a read that is the list field is refused: a name a comprehension macro binds '
    + 'holds one item, and its comparison answers per row, so it is not. Which test the author meant is not '
    + 'recorded, so no mechanical rewrite is lossless. '
    + 'Measured at the change: no producer of the shape in this repository\'s examples, its QA fixtures or HotCRM. '
    + 'ADR-0032 / ADR-0087.',
  acceptanceCriteria:
    'Load every module (`os validate` or `os build`): no `list-equality` finding. Every comparison of a list-valued '
    + 'field is a membership test, a null test or a whole-list match, and the condition answers per row. A stored row '
    + 'carrying the shape still loads and is served; its next save through a door that runs the publish lint is '
    + 'refused until it is corrected.',
};
