// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #34987 — an L2 hook body and an L2 job body (`body.language: 'js'`) must
// compile as the body of the wrapper the runtime runs both in, an async arrow
// function whose one parameter is `ctx`: one that does not is refused at error
// as `hook-body-does-not-compile` / `job-body-does-not-compile`
// (@objectstack/lint), the check `action-body-does-not-compile` already makes
// for an action body, with the same severity split. It narrows what the
// authoring doors accept; no key is removed, so there is no tombstone.
// Measured first-party exposure at this change: zero — no example app, skill or
// docs sample carries a hook or job body that fails to compile there (one docs
// sample elides its body with an ellipsis; it is prose, not metadata). Not
// converted: which name the author meant for the local is a judgement.
export const entry: SemanticMigration = {
  id: 'hook-job-body-does-not-compile-refused',
  surface:
    'hooks[].body.source and jobs[].body.source whose body.language is js, on a hook saved or published through '
    + 'the metadata doors (PUT /api/v1/meta/hook/NAME, POST /api/v1/packages/PKG/publish-drafts and the per-item '
    + 'publish) or a hook or job loaded by os validate / os build / os lint, a hook body lowered from an inline '
    + 'handler included: a source that does not compile as the statements of the async arrow function the runtime '
    + 'wraps it in, whose one parameter is ctx. The common cases declare ctx a second time (const ctx = …, let ctx), '
    + 'declare one name twice with let or const, or carry a grammar error',
  replacement:
    'Write the body as the statements of an async function whose parameter is ctx (the context): use ctx as it is, '
    + 'or give the local another name (const input = ctx.input || {} in a hook, const api = ctx.api in a job), and '
    + 'declare each name once. Fix any other compile error the finding names at the line of body.source it names. '
    + 'Refused at error as `hook-body-does-not-compile` or `job-body-does-not-compile` (422 INVALID_METADATA at the '
    + 'hook door). A regular expression whose pattern the host engine refuses is reported at warning, never '
    + 'refused; a literal that never closes or whose flags are not a flag set is refused.',
  reason:
    'The runtime never runs a hook or job body.source as a script of its own: it compiles it inside an async arrow '
    + 'function with the one parameter ctx, and a source that redeclares it, or otherwise fails to compile there, '
    + 'raises a SyntaxError before its first statement. Every authoring door accepted such a body (the hook parse '
    + 'check reads the source with a parser, which reports no redeclaration or other early error, and a job body '
    + 'had no check at all), so it deployed clean and then every run of the hook or job failed for as long as it '
    + 'stayed deployed. The rule compiles the source inside the expression the runtime builds, from the same '
    + 'function, with the host JavaScript engine and without running it, and reads the failure exactly as the '
    + 'action rule does. No door publishes a job at run time, so a job body is refused by the three CLI commands. '
    + 'Such a body never ran, so no run of it ever succeeded and no stored row changes shape. No first-party stack '
    + '(example apps, skills, docs samples) carries such a body today. There is no mechanical rewrite: renaming a '
    + 'local is a choice about which name the rest of the body reads.',
  acceptanceCriteria:
    'Load every hook and job (`os validate` or `os build`): no `hook-body-does-not-compile` finding at error at '
    + 'hooks[N].body.source or hooks[N].handler, and no `job-body-does-not-compile` finding at error at '
    + 'jobs[N].body.source. PUT /api/v1/meta/hook/NAME with each such hook body corrected answers 200, and the '
    + 'hook runs on its next event instead of failing it.',
};
