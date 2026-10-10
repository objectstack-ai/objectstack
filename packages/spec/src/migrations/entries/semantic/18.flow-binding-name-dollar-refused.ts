// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22572 — the family close-out of flow-binding-variable-dollar-name-refused:
// every remaining position where a flow binds a variable by name refuses a
// dollar name, by the same rule — a loop or map iteratorVariable and
// indexVariable, an object-form screen's idVariable, a screen field's name, a
// declared flow variable's name, and an assignment node's targets in each shape
// its executor reads. It narrows a flow's accept set; no key is removed, so
// there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. Semantic-only — no D2
// conversion: the bare name may already be bound in the flow, and the reads of
// the old name sit in every dialect a flow string speaks.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-binding-name-dollar-refused',
  surface:
    'flows[].nodes[].config.iteratorVariable and config.indexVariable of a loop or map node, '
    + 'flows[].nodes[].config.idVariable and config.fields[].name of a screen node, flows[].variables[].name, '
    + 'and an assignment node\'s targets — a key of config.assignments, a top-level key of a config with no '
    + 'assignments map, or the variable of a legacy assignments array item — when the name starts with a dollar '
    + 'sign, such as $row. Reachable wherever a flow is authored or stored: defineStack flows sources, '
    + 'defineFlow, an exported stack passed to objectstack validate or objectstack compile, a flow saved from the '
    + 'Studio flow designer, and a flow row already in sys_metadata',
  replacement:
    'the same name without the dollar sign, read as a hole over that name: iteratorVariable: \'row\' read as '
    + '{{ row.name }}, idVariable: \'account_id\' read as {{ account_id }}, a declared variable or an assignment '
    + 'target named total read as {{ total }}. Rename every read of the old name with it — a text-slot hole, a '
    + 'CEL expression, a single-brace token in a value position',
  reason:
    'The dollar-named variables are the flow engine\'s own: it binds $record, $runId, $flowName, $flowLabel and '
    + '$error, a flat-graph loop binds $loopItems and $loopIndex, and a resume signal may not write any dollar '
    + 'name. A flow text slot refuses a hole whose root is a dollar name the engine does not bind and tells the '
    + 'author to drop the dollar sign, and since protocol 18 an outputVariable and an errorVariable refuse one '
    + '(flow-binding-variable-dollar-name-refused). Every other binding still took any string, so one contract '
    + 'still had two answers. Measured on the run, the old answer was worse than unreadable: a loop or map '
    + 'iteratorVariable of $record left the trigger record holding the last item for the rest of the run, an '
    + 'indexVariable of $runId left the run id holding an index, an assignment to $record overwrote it, a '
    + 'declared variable named $record was overwritten by the engine at run start, and a screen whose '
    + 'idVariable or field name was a dollar name could never be submitted — the resume that carried the value '
    + 'was refused as a write to an engine variable. Each binding now gives the text slots\' answer: each key '
    + 'states the rule as a JSON Schema pattern (propertyNames for the assignments map), so the published schema '
    + 'refuses what the parse refuses, and the flow parse, registerFlow and objectstack validate refuse such a '
    + 'name where it was written, naming the same name without the dollar sign — as does the run itself for a '
    + 'loop, map or screen node, whose executor parses its contract. '
    + 'No D2 conversion exists: the bare name may already be bound in the flow, and the reads of the old name sit '
    + 'in every dialect a flow string speaks, so the rename is the author\'s. Where such a binding already sits '
    + 'the whole flow is refused: registered from the metadata registry or sys_metadata at boot it is skipped '
    + 'with a warn naming it, its trigger not armed, while the flows beside it register; a stack source throws '
    + 'StackSchemaInvalidError for the whole stack. ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run objectstack validate over every stack authored in config files, and boot every deployed stack. '
    + 'Each refusal names the node and the position — nodes.N.config.iteratorVariable, '
    + 'nodes.N.config.fields.M.name, nodes.N.config.assignments.NAME, variables.N.name, or the same under a '
    + 'region path such as nodes.N.config.body.nodes.M.config — and the name to write. Rename the binding and '
    + 'every read of it, then (1) objectstack validate is clean, (2) each flow registers at boot with no failed '
    + 'to register flow warn for it, and (3) the flow paths that read the variable — a notification, a screen, '
    + 'a later node — carry its value, with no blank fragment, and a screen that binds one submits.',
};
