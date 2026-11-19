// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one spelling of the wrapper an L2 action body runs in.
 *
 * The runtime does not run an action's `body.source` as a script of its own: it
 * pastes the source into the body of an async arrow and calls that arrow with
 * the action's params and its context
 * (`packages/runtime/src/sandbox/quickjs-runner.ts`). So the source's
 * statements share a scope with two bindings the author never wrote, and a
 * source that is valid on its own can fail to compile there: declaring `input`
 * or `ctx` again with `const` / `let` / `class` is a redeclaration of a
 * parameter, a SyntaxError raised before any statement runs.
 *
 * The runtime builds its wrapper from {@link actionBodyFunctionExpression}, and
 * the author-time rule (`validate-action-body-compiles.ts`) compiles the source
 * inside that same expression, so the check and the run cannot disagree about
 * the wrapper. ⛔ Never spell the wrapper a second time anywhere: a copy is a
 * second shape the next edit can move one side of.
 *
 * Hook and job bodies run in a different wrapper, `(async (ctx) => { … })`, and
 * are not described here.
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
