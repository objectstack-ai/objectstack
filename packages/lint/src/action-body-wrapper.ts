// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one spelling of each wrapper an L2 body runs in.
 *
 * The runtime does not run a body's `source` as a script of its own: it pastes
 * the source into the body of an async arrow and calls that arrow
 * (`packages/runtime/src/sandbox/quickjs-runner.ts`). So the source's
 * statements share a scope with bindings the author never wrote, and a source
 * that is valid on its own can fail to compile there: declaring a parameter
 * again with `const` / `let` / `class` is a redeclaration, a SyntaxError raised
 * before any statement runs.
 *
 * There are two wrappers. An action body takes the action's params and its
 * context, `(async (input, ctx) => { … })`; a hook body and a job body take the
 * context alone, `(async (ctx) => { … })` (a job has no input to hand in, and
 * `JobSchema.body` documents `ctx` as its whole surface).
 *
 * The runtime builds each wrapper from {@link actionBodyFunctionExpression} and
 * {@link hookBodyFunctionExpression}, and the author-time rules
 * (`validate-action-body-compiles.ts`, `validate-hook-body-compiles.ts`)
 * compile the source inside those same expressions, so the check and the run
 * cannot disagree about a wrapper. ⛔ Never spell a wrapper a second time
 * anywhere: a copy is a second shape the next edit can move one side of.
 *
 * No imports: the runtime reaches this module through `@objectstack/lint/runtime`.
 */

/** The parameters an action body's wrapper binds, in call order: the params bag, then the context. */
export const ACTION_BODY_PARAMETERS = ['input', 'ctx'] as const;

/**
 * The function expression an action body runs as: `(async (input, ctx) => { SOURCE })`.
 *
 * The source is placed after the opening brace on the expression's FIRST line,
 * so line N of the source is line N of the expression; a compile error's line
 * number therefore reads directly as a line of `body.source`.
 */
export function actionBodyFunctionExpression(source: string): string {
  return `(async (${ACTION_BODY_PARAMETERS.join(', ')}) => { ${source} })`;
}

/** The parameter a hook or job body's wrapper binds: the context. */
export const HOOK_BODY_PARAMETERS = ['ctx'] as const;

/**
 * The function expression a hook body and a job body run as: `(async (ctx) => { SOURCE })`.
 *
 * The same one-line placement as {@link actionBodyFunctionExpression}: line N of
 * the source is line N of the expression.
 */
export function hookBodyFunctionExpression(source: string): string {
  return `(async (${HOOK_BODY_PARAMETERS.join(', ')}) => { ${source} })`;
}
