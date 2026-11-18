// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34884 — an L2 action body (`type: 'script'`, `body.language: 'js'`) must
// compile as the body of the wrapper the runtime runs it in, an async arrow
// function whose parameters are `input` and `ctx`: one that does not is refused
// at error as `action-body-does-not-compile` (@objectstack/lint). It narrows
// what the authoring doors accept; no key is removed, so there is no tombstone.
// Measured first-party exposure at this change: zero — no example app, skill or
// docs sample carries an action body that fails to compile there. Not
// converted: which name the author meant for the local is a judgement.
export const entry: SemanticMigration = {
  id: 'action-body-does-not-compile-refused',
  surface:
    'actions[].body.source, and objects[].actions[].body.source, of an action of type script whose body.language is '
    + 'js, on an action or object saved or published through the metadata doors (PUT /api/v1/meta/action/NAME, '
    + 'PUT /api/v1/meta/object/NAME with inline actions, POST /api/v1/packages/PKG/publish-drafts and the per-item '
    + 'publish) or loaded by os validate / os build / os lint: a source that does not compile as the statements of '
    + 'the async arrow function the runtime wraps it in, whose parameters are input and ctx. The common case declares '
    + 'a parameter a second time, as in const input = ctx.input || {} or let ctx = …',
  replacement:
    'Write the body as the statements of an async function whose parameters are input (the action\'s params) and ctx '
    + '(the context): read the params as input, or give the local another name (const params = ctx.input || {}); '
    + 'var input = … also compiles. Fix any other compile error the finding names at the line of body.source it '
    + 'names. Refused at error as `action-body-does-not-compile` (422 INVALID_METADATA at the doors). A regular '
    + 'expression literal the host engine refuses is reported at warning, never refused.',
  reason:
    'The runtime never runs body.source as a script of its own: it compiles it inside an async arrow function with '
    + 'the parameters input and ctx, and a source that redeclares one of them, or otherwise fails to compile there, '
    + 'raises a SyntaxError before its first statement. Every authoring door accepted such a body (the parse check '
    + 'reads the source inside a different wrapper, and a parser reports no redeclaration), so it deployed clean '
    + 'and then EVERY run of the action failed, answering an opaque 500 INTERNAL_ERROR on the /actions door and on '
    + 'MCP run_action for as long as it stayed deployed. The rule compiles the source inside the expression the '
    + 'runtime builds, from the same function, with the host JavaScript engine and without running it. The host '
    + 'engine and the runtime\'s QuickJS agreed on every early error probed except regular-expression literals, '
    + 'hence the warning there. Such a body never ran, so no run of it ever succeeded and no stored row changes '
    + 'shape. Hook and job bodies, which run in a different wrapper, are not judged. No first-party stack (example '
    + 'apps, skills, docs samples) carries such a body today. There is no mechanical rewrite: renaming a local is '
    + 'a choice about which name the rest of the body reads.',
  acceptanceCriteria:
    'Load every action (`os validate` or `os build`): no `action-body-does-not-compile` finding at error at '
    + 'actions[N].body.source or objects[N].actions[N].body.source. PUT /api/v1/meta/action/NAME with each such body '
    + 'corrected answers 200, and running the action on POST /api/v1/actions/OBJECT/ACTION/ID answers the body\'s '
    + 'result instead of 500 INTERNAL_ERROR.',
};
