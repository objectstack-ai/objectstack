// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the second batch of author-time flow rules (#35143)
// that refuse, at publish and in `os validate` / `build`, a flow the schema still
// accepts but the engine never starts, starts on the wrong rows, or fails on
// every write. Notice only: no key is removed and no D2 conversion exists,
// because each fix is a choice only the author can make (which object a
// trigger watches, which option a condition means).
export const entry: SemanticMigration = {
  id: 'publish-refuses-flows-that-save-and-do-not-run',
  surface:
    'Seven author-time flow errors, run by the runtime publish gate and by `os validate` / `lint` / `compile` / `build`: '
    + 'a record-triggered flow with no `objectName` (`flow-trigger-object-missing`); a start condition, an edge '
    + 'condition or a `decision` branch that compares a select field with one of its option labels, or a '
    + '`get_record` / `update_record` / `delete_record` or `timeRelative` `filter` operand that is one, where the row '
    + 'holds the option value (`flow-condition-option-label`); '
    + 'a `timeRelative` block under a record `triggerType`, which wins (`flow-time-relative-shadowed`); `filter` or '
    + '`maxRecords` beside `timeRelative` instead of inside it (`flow-time-relative-key-misplaced`); a `timeRelative.dateField` '
    + 'that is not a `date` / `datetime` field of the object (`flow-time-relative-date-field-invalid`); a create / update '
    + 'node that writes a select field a literal no option carries (`flow-node-write-unknown-option`); a create / update '
    + 'node that writes a date field the text of a date helper call such as `today()` (`flow-node-write-date-helper-text`)',
  replacement:
    'Set the trigger\'s `objectName`; compare the option value, not its label; drop the record `triggerType` or the '
    + '`timeRelative` block, whichever the flow does not mean; move `filter` / `maxRecords` inside `timeRelative`; point '
    + '`dateField` at a `date` or `datetime` field; write an option value the field lists; write a date as a CEL value '
    + 'envelope (`{ dialect: \'cel\', source: \'isoDate(today())\' }`) instead of the helper call as text',
  reason:
    'Each flow parses and publishes, then misbehaves on every run: a record trigger with no object fires on writes to '
    + 'every object; a label comparison is never true, because the row stores the value; a record trigger shadows the '
    + 'time-relative schedule, so the sweep never runs; a misplaced `filter` / `maxRecords` is ignored, so the sweep reads '
    + 'every row; a sweep over a field that is not a date matches no record; a write of an unknown option is refused '
    + '`invalid_option` and a write of helper text is refused `invalid_date`, so the node fails on every run. Stored '
    + 'flows are not rewritten or refused at boot. The next publish of a flow that carries one of the seven errors is '
    + 'refused with the fix named. Three warnings join them (`flow-schedule-timezone-missing`, `flow-subflow-unknown`, '
    + '`flow-create-update-pair`), which refuse nothing and make `os validate --strict` exit 1 as any warning does.',
  acceptanceCriteria:
    'os validate reports none of the seven errors; a publish of every flow the package carries succeeds.',
};
