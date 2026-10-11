// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A flow CEL expression is refused when it reads a root the flow does not bind.
// Formulas, row-level security and the client bind the run's user as user,
// ctx.user and os.user as well as current_user; flow CEL binds current_user only,
// so an alias there failed every run that reached it while objectstack validate
// passed it. Semantic-only — none of these roots ever evaluated in a flow, so no
// D2 conversion has behaviour to carry over.
export const entry: SemanticMigration = {
  id: 'flow-cel-unbound-root-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config.condition, flows[].edges[].condition, a decision node\'s conditions[].expression, a '
    + 'screen node\'s fields[].visibleWhen, and the CEL value envelopes of an assignment node\'s assignments and of '
    + 'a create_record or update_record node\'s fields — a CEL source whose root identifier the flow does not bind, '
    + 'such as user.id, ctx.user.id or os.user.id',
  replacement:
    'current_user for the run\'s user: user.id, ctx.user.id and os.user.id become current_user.id, and a flow that '
    + 'can run without a user guards it as current_user != null ? current_user.id : null. Any other root becomes a '
    + 'name the flow binds — a declared variable, an outputVariable, an iterator, index or error variable, an '
    + 'assignment target, a node id or a screen field — or a field of the trigger record, read bare or as '
    + 'record.FIELD',
  reason:
    'A flow CEL expression evaluates in one scope per run: the flow\'s variables spread to top level, the trigger '
    + 'record\'s fields flattened beside them, record bound to the record the run was handed (where an entrance the '
    + 'stack declares hands the flow one, or the flow binds a variable named record), and previous, vars and '
    + 'current_user bound by the engine. A '
    + 'root outside that scope fails the expression with an unknown-variable fault on every run that reaches it, '
    + 'and the build door, which judged a flow expression\'s syntax only, passed it. The run-user spellings are '
    + 'the reachable case: formulas, row-level security and the client bind the run\'s user under user, ctx.user '
    + 'and os.user as well, and flow CEL does not, because a top-level user would collide with a variable or a '
    + 'lookup field of that name. objectstack validate now refuses such a root, naming current_user for the user '
    + 'spellings and the in-scope names for any other. A flow whose run can bind a name the reader cannot see is not '
    + 'judged: one with a script or connector_action node, a wait, subflow or map node a resume can fold a bag into, '
    + 'a screen with no field list, or a plugin node type; and one an entrance the stack declares hands a record '
    + 'whose keys are not in hand: a record trigger or time-relative sweep on an object the stack does not declare, '
    + 'an api trigger (the inbound hook hands the request body in as the record), a flow action on an undeclared '
    + 'object, a map node whose itemObject is undeclared or absent, or a subflow or map parent that is itself such a '
    + 'flow. The runtime publish gate does not give this verdict yet: it judges a flow write without the stack\'s '
    + 'actions and other flows, so it cannot see those entrances. No D2 conversion exists: none of these roots ever '
    + 'evaluated in a flow, so there is no behaviour to carry over, and a run without a user needs a guard only the '
    + 'author can choose.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused root as expression-invalid at the flow, the node or edge and '
    + 'the slot, naming the root and its remedy. Replace each run-user spelling with current_user, guarded where the '
    + 'flow can run without a user, and bind or correct every other root. Re-run the flow paths that evaluate those '
    + 'expressions and confirm each one evaluates instead of failing with an unknown-variable fault.',
};
