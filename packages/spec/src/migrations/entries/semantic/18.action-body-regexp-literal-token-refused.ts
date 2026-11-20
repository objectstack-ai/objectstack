// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35040 — `action-body-does-not-compile` (@objectstack/lint) reported every
// regular-expression failure the host engine raised at warning, so a literal
// that never closes on its line, or whose flags are not a flag set, was
// accepted at write and failed every run. Only a failure in the literal's
// PATTERN stays a warning (that is where the host's V8 and the runtime's
// QuickJS measurably differ); the token errors are refused at error. It
// narrows what the authoring doors accept; no key is removed, so there is no
// tombstone. Measured first-party exposure at this change: zero. Not
// converted: whether a `/` meant a literal or a division is a judgement.
export const entry: SemanticMigration = {
  id: 'action-body-regexp-literal-token-refused',
  surface:
    'actions[].body.source, and objects[].actions[].body.source, of an action of type script whose body.language is '
    + 'js, on an action or object saved or published through the metadata doors (PUT /api/v1/meta/action/NAME, '
    + 'PUT /api/v1/meta/object/NAME with inline actions, POST /api/v1/packages/PKG/publish-drafts and the per-item '
    + 'publish) or loaded by os validate / os build / os lint: a regular-expression literal that never closes on its '
    + 'line (return /abc; or /[/), or whose flags are not a flag set (/a/gg, /a/zz, /a/uv)',
  replacement:
    'Close the literal with /, write a / inside it as a backslash followed by /, or, when the / is a division, give it '
    + 'a left-hand operand; write the flags as letters from dgimsuvy, each at most once, never u with v. Refused at '
    + 'error as `action-body-does-not-compile` (422 INVALID_METADATA at the doors). A literal whose pattern the host '
    + 'engine refuses (a duplicate named capture group, a modifier group) is still reported at warning.',
  reason:
    'The rule compiles the body with the host JavaScript engine and reported every failure whose sentence opens '
    + '"Invalid regular expression" at warning, because the host\'s V8 and the runtime\'s QuickJS differ on some '
    + 'patterns. That sentence also opens V8\'s two token errors, an unterminated literal ("missing /") and an invalid '
    + 'flag set ("Invalid regular expression flags"), and QuickJS refuses both ("unexpected end of regexp", '
    + '"unexpected line terminator in regexp", "invalid regular expression flags"); over 55 single characters and '
    + 'every ordered pair of the eight flags the two engines agreed on all 119 flag sets. So such a body was accepted '
    + 'at every authoring door and then every run of the action failed with the coded 500 that names the action and '
    + 'the compile error. Such a body never ran, so no run of it ever succeeded and no stored row changes shape. No '
    + 'first-party stack (example apps, skills, docs samples) carries one. There is no mechanical rewrite: whether '
    + 'the / opened a literal or meant a division is a choice about what the body computes.',
  acceptanceCriteria:
    'Load every action (`os validate` or `os build`): no `action-body-does-not-compile` finding at error at '
    + 'actions[N].body.source or objects[N].actions[N].body.source. PUT /api/v1/meta/action/NAME with each such body '
    + 'corrected answers 200, and running the action on POST /api/v1/actions/OBJECT/ACTION/ID answers the body\'s '
    + 'result instead of 500.',
};
