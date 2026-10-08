// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The template dialect leaves the flow value slots: one dialect for a computed
// value, CEL. Semantic-only — every token spelling authored in flows was
// measured lossy under conversion, so no D2 conversion rewrites any of them,
// and the date macros and run-user paths CEL cannot write yet are kept.
export const entry: SemanticMigration = {
  id: 'flow-value-slot-template-dialect-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config of an assignment node (the assignments map, the legacy assignments array and the '
    + 'legacy bare config) and of create_record and update_record nodes (the fields map) — a string value, or a '
    + 'string anywhere inside an array or object value, carrying a single-brace template token',
  replacement:
    'a CEL value envelope, { dialect: "cel", source: "…" }, evaluated to the value: a path is the same path '
    + '(record.owner; a numeric segment becomes an index, list[0]; a variable whose name starts with $ is read '
    + 'through vars, vars["$error"].message), arithmetic is the same arithmetic with every integer divisor written '
    + 'as a double (round(x * 100) / 100.0), and text with holes is one concatenation (\'Hello \' + o.name). A '
    + 'string with no token is the literal text it spells, and braces meant literally are a CEL string literal',
  reason:
    'The interpolator and the CEL engine answer differently for every token spelling authored in flows, so no '
    + 'conversion is lossless (ADR-0087 D2) and none is applied. A path, an absent variable, key or list index '
    + 'wrote nothing under the template and fails the run under CEL; text with a null hole rendered nothing and '
    + 'CEL refuses + null; CEL divides two integers as integers, so round(x * 100) / 100 truncates 123.46 to 123. '
    + 'Where a value may be absent, which of nothing, null or a default the field should take is the author\'s '
    + 'decision — the template decided it silently. Two spellings are kept with their old meaning, because CEL '
    + 'cannot write them yet: the date macros NOW() and TODAY() with a day offset (CEL yields a Timestamp, not the '
    + 'ISO text, and has no string form for one) and the run-user paths beginning $User. (the flow CEL scope binds '
    + 'no user). A flow carrying a refused value is refused at registration, by objectstack validate and by the '
    + 'executor; a stored flow carrying one is skipped at boot with a warn naming it.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused value as expression-invalid at the node and the value\'s '
    + 'path, with the CEL spelling of its tokens. Rewrite each as that envelope; where a variable or key may be '
    + 'absent, guard it (has(record.owner) ? record.owner : null, has(vars.x) ? vars.x : null for a variable) or '
    + 'route around the node. Re-run the flow paths that write those fields and compare the stored values with '
    + 'the ones the template wrote.',
};
