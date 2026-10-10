// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A flow CEL expression's record root is the record the run was handed, or
// unbound. The flow engine used to bind record to the run's own variables
// whenever the run held no record, so record.assignee silently read a flow
// variable named assignee. That spelling now fails the run with an unknown-
// variable fault on record. Semantic-only: whether a run holds a record depends
// on the entrances that start the flow (a trigger, an action, a parent flow, a
// map item), which are not visible from the flow alone, so no D2 conversion can
// rewrite the source mechanically.
export const entry: SemanticMigration = {
  id: 'flow-cel-record-variables-alias-retired',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config.condition, flows[].edges[].condition, a decision node\'s conditions[].expression, a '
    + 'screen node\'s fields[].visibleWhen, and the CEL value envelopes of an assignment node\'s assignments and of '
    + 'a create_record or update_record node\'s fields — a CEL source reading record.X, or record bare, on a run '
    + 'that holds no record, where X names a flow variable',
  replacement:
    'the variable by its name, or through the vars namespace: record.assignee becomes assignee, or vars.assignee. '
    + 'A record.X read on a run that was handed a record is unchanged, and reads that record\'s field X',
  reason:
    'Flow CEL binds record to the record the run was handed: a record-change trigger\'s row, a time-relative '
    + 'sweep\'s row, the inbound hook\'s request body, a flow action\'s record (the loaded row, or an empty record '
    + 'carrying at most the id it was given), a subflow or map parent\'s record, or a map item that carries an id. '
    + 'A flow can also bind a variable named record itself. A run with none of these, one started through the REST '
    + 'trigger route, a declared endpoint or a cron schedule, or a child of such a run, used to see record bound to '
    + 'its own variables map, so record.X answered a flow variable named X instead of failing: a second spelling of '
    + 'every variable, which hid the author\'s mistake. Such a run now fails the expression with an unknown-variable '
    + 'fault on record, carrying the source, as every other unbound root does. No D2 conversion exists: whether a '
    + 'run holds a record depends on the entrances that start the flow, which the flow alone does not show, so '
    + 'only the author can tell a variable read from a record field read. Measured at the change: 0 flows in this '
    + 'repository\'s example apps, platform objects and dogfood suites, and 0 in objectstack-ai/hotcrm, read record '
    + 'with no record entrance.',
  acceptanceCriteria:
    'For each flow whose CEL reads record, list the entrances that start it. Where any of them hands no record, '
    + 'replace each record.X that names a flow variable with the variable\'s name or vars.X. Re-run each flow path '
    + 'started with no record and confirm every expression evaluates instead of failing with an unknown-variable '
    + 'fault on record; re-run a path started with a record and confirm record.X still reads that record\'s field.',
};
