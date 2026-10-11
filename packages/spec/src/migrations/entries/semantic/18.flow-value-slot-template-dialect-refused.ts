// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The template dialect leaves the flow value slots: one dialect for a computed
// value, CEL. Semantic-only — every token spelling authored in flows was
// measured lossy under conversion, so no D2 conversion rewrites any of them.
// The run-user paths are refused too: the flow CEL scope binds current_user,
// the run's user or null. So are the date macros, with their CEL string form
// (isoDate / isoDatetime): no single-brace spelling is kept. The surface widens
// to the maps a node hands to a callee (subflow and map input, script inputs),
// where a guarded form's null is supplied and wins over a child's default.
export const entry: SemanticMigration = {
  id: 'flow-value-slot-template-dialect-refused',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'flows[].nodes[].config of an assignment node (the assignments map, the legacy assignments array and the '
    + 'legacy bare config), of create_record and update_record nodes (the fields map), and of the nodes that hand '
    + 'a map to a callee: a subflow node and a map node (the input map, evaluated per item on a map node) and a '
    + 'script node (the inputs map) — a string value, or a '
    + 'string anywhere inside an array or object value, carrying a single-brace template token, the run-user '
    + 'paths beginning $User. and the date macros NOW() and TODAY() with an optional day offset included',
  replacement:
    'a CEL value envelope, { dialect: "cel", source: "…" }, evaluated to the value: a path is the same path '
    + '(record.owner; a numeric segment becomes an index, items[0]; a variable whose name starts with $ is read '
    + 'through vars, vars["$error"].message), arithmetic is the same arithmetic with every integer divisor written '
    + 'as a double (round(x * 100) / 100.0), and text with holes is one concatenation (\'Hello \' + o.name). The '
    + 'run user\'s id, $User.Id, is current_user.id — current_user is the run\'s user, or null when the run has '
    + 'none — and in a flow that can run without a user it is current_user != null ? current_user.id : null, which '
    + 'writes null where the template wrote nothing, so on update_record it clears a stored value the template '
    + 'left alone. Every other run-user path ($User.Email, $User.Name, …) never resolved in any shipped run: '
    + 'current_user carries only what the run holds (id, positions, organizationId, isPlatformAdmin), and an email '
    + 'or a name is read from the user record by current_user.id (a get_record node on sys_user). A date macro is '
    + 'its CEL string form on the UTC calendar: TODAY() is isoDate(today()), TODAY() + N and TODAY() - N are '
    + 'isoDate(daysFromNow(N)) and isoDate(daysAgo(N)), NOW() is isoDatetime(now()), and NOW() plus or minus N is '
    + 'isoDatetime(addDays(now(), N)) with N signed, which keeps the time of day where daysFromNow lands on '
    + 'midnight; a variable offset is isoDate(addDays(today(), days)). Where an envelope is literal data — a string '
    + 'inside an object or list value, or either legacy assignment shape — an envelope written in its place is '
    + 'stored as the object it spells, so the whole value is one envelope building a CEL map or list literal, and '
    + 'a legacy assignment moves into the assignments map. A string with no token is the literal text it spells, '
    + 'and braces meant literally are a CEL string literal. In a subflow or map input, the value is handed to the '
    + 'child flow\'s input variable of that name: a guarded form\'s null is a supplied value that wins over the '
    + 'child variable\'s defaultValue, so to keep the default for an absent value write the default in the guard\'s '
    + 'null branch (has(vars.x) ? vars.x : \'the default\'), and leave the key out only where the value is never '
    + 'meant to be supplied; a script function is handed null where the template handed undefined',
  reason:
    'The interpolator and the CEL engine answer differently for every token spelling authored in flows, so no '
    + 'conversion is lossless (ADR-0087 D2) and none is applied. A path, an absent variable, key or list index '
    + 'wrote nothing under the template and fails the run under CEL; text with a null hole rendered nothing and '
    + 'CEL refuses + null; CEL divides two integers as integers, so round(x * 100) / 100 truncates 123.46 to 123. '
    + 'Where a value may be absent, which of nothing, null or a default the field should take is the author\'s '
    + 'decision — the template decided it silently. The run user\'s id was the run\'s userId under the template, '
    + 'and nothing in a run with no user (a schedule, a record change made by a system write); the flow CEL scope '
    + 'binds current_user to the run\'s user and to null in such a run, never a pseudo-user, so current_user.id '
    + 'fails there and its guarded form writes null. The other run-user paths read a user object no run carries, '
    + 'so they wrote nothing in every run. The date macros wrote the ISO text of the UTC day or instant, which '
    + 'isoDate and isoDatetime write byte for byte for a whole number of days, but the template read an offset it '
    + 'could not use as 0 — a variable it did not find, a value that is not a number, text that is neither — '
    + 'where CEL fails the run, and it truncated a fractional offset after adding it to the day of the month, where '
    + 'addDays truncates the offset itself and daysFromNow and daysAgo refuse a fraction at build. Where the map '
    + 'is handed to a callee, a whole token that resolved to nothing handed the callee nothing, and the child flow '
    + 'then seeded the input variable from its defaultValue; under CEL that value either fails the run or, guarded, '
    + 'is null, which the child takes as supplied, so the default no longer applies unless the guard writes it. A '
    + 'flow carrying '
    + 'a refused value is refused at registration, by objectstack validate and by the executor; a stored flow '
    + 'carrying one is skipped at boot with a warn naming it.',
  acceptanceCriteria:
    'Run objectstack validate: it reports each refused value as expression-invalid at the node and the value\'s '
    + 'path, with the CEL spelling of its tokens. Rewrite each as that envelope; where a variable or key may be '
    + 'absent, guard it a step at a time from vars, which holds only the variables the run has bound '
    + '(has(vars.x) ? vars.x : null, has(vars.source) && has(vars.source.id) ? vars.source.id : null; a guard on '
    + 'the last key alone, has(source.id), fails the run when source itself was never bound) or route around the '
    + 'node. For the run user, find which flows can run without one (a schedule, a record change '
    + 'a system write can make): there, guard current_user.id, or skip the node with a start condition or a '
    + 'decision on current_user != null where an update_record must leave the stored value alone. For a date '
    + 'macro with a variable offset, check the variable is always set to a number where the flow runs; write a '
    + 'fractional offset as the whole number of days meant. Re-run the flow paths that write those fields and '
    + 'compare the stored values with the ones the template wrote.',
};
