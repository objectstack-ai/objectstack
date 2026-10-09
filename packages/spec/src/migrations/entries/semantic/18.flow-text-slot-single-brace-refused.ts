// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The flow text slots read ADR-0032 §3's double-brace template holes, rendered
// by the formula template engine; the single brace is deleted from them.
// Semantic-only — the two renderers answer differently for some value of every
// token spelling, so no D2 conversion rewrites any of them, and no spelling is
// kept.
export const entry: SemanticMigration = {
  id: 'flow-text-slot-single-brace-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config of a notify node (title, message), a screen node (title, description) and an end node '
    + '(message) — a string, or the source of a template envelope, carrying a single-brace template token',
  replacement:
    'a double-brace template hole, rendered by the formula template engine over the flow\'s variables: a variable '
    + 'path with an optional formatter, {{ record.name }}, {{ $error.message }}, {{ rows.0.subject }}, '
    + '{{ record.amount | currency }}. A token no hole can spell is computed into a variable first, with an '
    + 'assignment node — arithmetic and functions as a CEL value envelope, the date macros and the run-user paths '
    + 'as the value-slot spelling that still reads them — and written as {{ variable }}',
  reason:
    'ADR-0032 Decision 3 fixes one template delimiter, double braces, and deletes the single brace: it collides '
    + 'with CEL map literals, and an author who meets both dialects in one flow mixes them. The 17.x interpolator '
    + 'and the template engine render the same text for a path holding a string, a number, a boolean, null, an '
    + 'absent key or variable, an ISO date string, an object or an array, but not for every value — a Date '
    + 'rendered JSON-quoted under the interpolator and as its ISO text under the engine, and a screen title, '
    + 'screen description or end message that was one token holding an object, an array or a Date rendered '
    + 'String(value) — so no conversion is lossless (ADR-0087 D2) and none is applied. Arithmetic, function '
    + 'calls, the date macros and the run-user paths have no hole spelling: a hole is a path with a formatter, '
    + 'never logic. A flow carrying a single-brace token in a text slot is refused at registration, by '
    + 'objectstack validate and by the node contract; a stored flow carrying one is skipped at boot with a warn '
    + 'naming it.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused text slot as expression-invalid at the node and the '
    + 'slot\'s key, with the double-brace spelling of every path token. Rewrite each slot as that spelling; for '
    + 'a token no hole can spell, add the assignment the refusal names and write its variable as a hole. Re-run '
    + 'the flow paths that send those notifications or show those screens and compare the text with the text '
    + 'the 17.x renderer produced — in particular any slot that renders a date value or a whole object.',
};
