// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35694 — `action-body-does-not-compile`, `hook-body-does-not-compile` and
// `job-body-does-not-compile` (@objectstack/lint) reported every failure the
// host engine raised against a regular-expression PATTERN at warning, so a
// pattern the runtime's QuickJS refuses as well (an unterminated group, nothing
// to repeat, a class range out of order, …) was accepted at write and failed
// every run. Only the measured dialect gaps stay a warning (a duplicate named
// capture group, a modifier group, and twelve spellings of three Unicode
// property names: Node 22's V8 refuses them, QuickJS runs them); every other
// pattern failure is refused at error. It narrows what
// the authoring doors accept; no key is removed, so there is no tombstone.
// Measured first-party exposure at this change: zero. Not converted: which
// pattern the author meant is a judgement.
export const entry: SemanticMigration = {
  id: 'body-regexp-pattern-refused',
  surface:
    'actions[].body.source and objects[].actions[].body.source of an action of type script, and hooks[].body.source '
    + 'and jobs[].body.source, whose body.language is js, on an action, object or hook saved or published through the '
    + 'metadata doors (PUT /api/v1/meta/action/NAME, PUT /api/v1/meta/object/NAME with inline actions, '
    + 'PUT /api/v1/meta/hook/NAME, POST /api/v1/packages/PKG/publish-drafts and the per-item publish) or loaded by '
    + 'os validate / os build / os lint: a regular-expression literal whose pattern the host engine refuses and the '
    + 'runtime\'s QuickJS refuses too, such as an unterminated group ((), nothing to repeat (a**), a class range out of '
    + 'order ([b-a]), and under the u flag a back-reference to a group the pattern does not name, a Unicode property '
    + 'name neither engine knows (\\p{Nope}) or an incomplete quantifier. A Unicode property name is judged by the '
    + 'host\'s Unicode tables, against a list measured on Unicode 17.0 tables',
  replacement:
    'Fix the pattern: close every group, give each quantifier something to repeat or escape it, write a class range '
    + 'low to high, reference only a group the pattern names, and use a Unicode property that exists. Refused at '
    + 'error as `action-body-does-not-compile`, `hook-body-does-not-compile` or `job-body-does-not-compile` (422 '
    + 'INVALID_METADATA at the doors). A pattern the host refuses as a duplicate named capture group, a modifier group '
    + 'or one of the Unicode property names only QuickJS knows (IDS_Unary_Operator or IDSU, Modifier_Combining_Mark or '
    + 'MCM, and the script Katakana_Or_Hiragana or Hrkt under sc=, Script=, scx= or Script_Extensions=) is still '
    + 'reported at warning, and so is every property name the host refuses when its Unicode tables are older than '
    + '17.0. A property name only the runtime knows can also be built with new RegExp at run time.',
  reason:
    'The rule compiles the body with the host JavaScript engine and reported every failure V8 words as "Invalid '
    + 'regular expression: /PATTERN/FLAGS: REASON" at warning, because the host\'s V8 and the runtime\'s QuickJS '
    + 'differ on some patterns. Measured over the same wrapper text (Node 22.23.5, V8 12.4, Unicode 17.0 tables, '
    + 'against quickjs-emscripten 0.32.0), they differ on two constructs, which V8 reports as "Duplicate capture group '
    + 'name" and "Invalid group", and on twelve spellings of three Unicode property names, which V8 reports as '
    + '"Invalid property name" (or "... in character class") and QuickJS compiles: every name in QuickJS\'s own '
    + 'property, script and general-category tables was compiled in seven key forms, under u and v, bare and in a '
    + 'class, 81,452 literals, and those twelve were every disagreement. Every other reason probed (Unterminated '
    + 'group, Nothing to repeat, Range out of order in character class, Invalid named capture referenced, Invalid '
    + 'property name for a name off that list, Incomplete quantifier, Unmatched \')\', numbers out of order in {} '
    + 'quantifier, Invalid Unicode escape, Invalid capture group name, Invalid character class, Invalid escape, '
    + 'Invalid quantifier) QuickJS refuses too. So such a body was accepted at every authoring door '
    + 'and then every run failed. Such a body never ran, so no run of it ever succeeded and no stored row changes '
    + 'shape. No first-party stack (example apps, skills, docs samples) carries one. There is no mechanical rewrite: '
    + 'which pattern the author meant is a choice about what the body matches.',
  acceptanceCriteria:
    'Load every action, hook and job (`os validate` or `os build`): no `action-body-does-not-compile`, '
    + '`hook-body-does-not-compile` or `job-body-does-not-compile` finding at error at actions[N].body.source, '
    + 'objects[N].actions[N].body.source, hooks[N].body.source, hooks[N].handler or jobs[N].body.source. '
    + 'PUT /api/v1/meta/action/NAME or PUT /api/v1/meta/hook/NAME with each such body corrected answers 200, and '
    + 'running it answers the body\'s result instead of the compile failure.',
};
