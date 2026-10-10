// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #22502 — the binding half of the rule the text-slot judge reads
// (`flow-text-slot-unbound-dollar-root-refused`): the dollar names are the flow
// engine's, so a node's outputVariable and a try_catch errorVariable refuse one
// (the engine's own $error excepted, as errorVariable's default). It narrows a
// flow's accept set; no key is removed, so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row. Semantic-only — no D2 conversion: the bare name may
// already be bound in the flow, and the reads of the old name sit in every
// dialect a flow string speaks.
//
// No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-binding-variable-dollar-name-refused',
  surface:
    'flows[].nodes[].config.outputVariable of a get_record, create_record, map, script or subflow node, and '
    + 'flows[].nodes[].config.errorVariable of a try_catch node — a variable name that starts with a dollar sign '
    + 'such as $caught, other than the default $error on errorVariable. Reachable wherever a flow is authored or '
    + 'stored: defineStack flows sources, defineFlow, an exported stack passed to objectstack validate or '
    + 'objectstack compile, a flow saved from the Studio flow designer, and a flow row already in sys_metadata',
  replacement:
    'the same name without the dollar sign, read as a hole over that name: errorVariable: \'caught\' read as '
    + '{{ caught.message }}, outputVariable: \'lead\' read as {{ lead.name }}. A try_catch may instead drop '
    + 'errorVariable and read the engine\'s default, {{ $error.message }}. Rename every read of the old name '
    + 'with it — a text-slot hole, a CEL expression, a single-brace token in a value position',
  reason:
    'The dollar-named variables are the flow engine\'s own: it binds $record, $runId, $flowName, $flowLabel and '
    + '$error, a flat-graph loop binds $loopItems and $loopIndex, and a resume signal may not write any dollar '
    + 'name. A flow text slot refuses a hole whose root is a dollar name the engine does not bind, so a flow '
    + 'that bound $caught as its errorVariable could not read {{ $caught.message }}: the refusal told the '
    + 'author to drop the dollar sign, while the binding key itself took any string. One contract had two '
    + 'answers to whether an author may own a dollar name. The binding keys now give the text slots\' answer: '
    + 'each key states the rule as a JSON Schema pattern, so the published schema refuses what the parse '
    + 'refuses, and the node contract, registerFlow, objectstack validate and the run itself refuse such a '
    + 'name at the key, naming the same name without the dollar sign. A binding over an engine name '
    + '(outputVariable: \'$record\') would also have overwritten the engine\'s value for the rest of the run. '
    + 'No D2 conversion exists: the bare name may already be bound in the flow, and the reads of the old '
    + 'name sit in every dialect a flow string speaks, so the rename is the author\'s. Where such a node '
    + 'already sits the whole flow is refused: registered from the metadata registry or sys_metadata at boot '
    + 'it is skipped with a warn naming it, its trigger not armed, while the flows beside it register; a '
    + 'stack source throws StackSchemaInvalidError for the whole stack. ADR-0087, ADR-0031.',
  acceptanceCriteria:
    'Run objectstack validate over every stack authored in config files, and boot every deployed stack. '
    + 'Each refusal names the node and the key — nodes.N.config.outputVariable or nodes.N.config.errorVariable, '
    + 'or the region path nodes.N.config.try.nodes.M.config.outputVariable — and the name to write. Rename the '
    + 'binding and every read of it, then (1) objectstack validate is clean, (2) each flow registers at boot '
    + 'with no failed to register flow warn for it, and (3) the flow paths that read the variable — a '
    + 'notification, a screen, a later node — carry its value, with no blank fragment.',
};
