// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A flow text slot refuses a double-brace hole whose root is a dollar-named
// variable the flow engine does not bind. The 17.x node contracts typed these
// slots as plain strings, so such a hole was accepted there; under the 18 text
// slots, before this refusal, it rendered nothing. Semantic-only — nothing maps
// the hole to a value the run has, so no D2 conversion exists.
export const entry: SemanticMigration = {
  id: 'flow-text-slot-unbound-dollar-root-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config of a notify node (title, message), a screen node (title, description) and an end node '
    + '(message) — a string, or the source of a template envelope, carrying a double-brace hole whose root is a '
    + 'dollar-named variable the flow engine does not bind, such as {{ $User.Id }}',
  replacement:
    'a variable the run has, written as a hole. The run user is computed first, with an assignment node whose '
    + 'value slot still reads the run-user path (assignments: { by: \'{$User.Id}\' }), then written as {{ by }}. '
    + 'A variable the flow binds itself (a declared variable, an assignment target, an outputVariable, a try_catch '
    + 'errorVariable) is named without the dollar sign and written as {{ caught.message }}. The engine\'s own '
    + 'variables stay holes: {{ $error.message }}, {{ $record.name }}, {{ $runId }}, {{ $flowName }}, '
    + '{{ $flowLabel }}, and a flat-graph loop\'s {{ $loopItems }} / {{ $loopIndex }}',
  reason:
    'The dollar-named variables are the flow engine\'s own: it binds $record, $runId, $flowName, $flowLabel and '
    + '$error, and a flat-graph loop binds $loopItems and $loopIndex. A hole over any other dollar name answers '
    + 'to no variable — {{ $User.Id }} looks like the run user and is not one, since the run user has no hole '
    + 'spelling. In 17.x the slot was a plain string read by the single-brace interpolator, which substituted the '
    + 'inner token and left a literal brace on each side; the 18 text slots render holes through the template '
    + 'engine, where such a hole renders nothing and the run reports success. It is now refused by the node '
    + 'contract, at registration and by objectstack validate, with the remedy its single-brace spelling gets; a '
    + 'stored flow carrying one is skipped at boot with a warn naming it. No D2 conversion exists: what the author '
    + 'meant the hole to read is not in the flow, and the template engine binds no new variable to answer it.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused text slot as expression-invalid at the node and the '
    + 'slot\'s key, naming the hole and its remedy. For a run-user hole, add the assignment the remedy names and '
    + 'write its variable as the hole; for a variable the flow binds under a dollar name, drop the dollar sign at '
    + 'the binding and in the hole. Re-run the flow paths that send those notifications or show those screens and '
    + 'confirm the text carries the value, with no stray brace and no missing fragment.',
};
