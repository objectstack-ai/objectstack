// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An L2 hook body and an L2 job body must COMPILE in the wrapper the runtime
 * runs them in.
 *
 * ## The failure this refuses
 *
 * The runtime runs a hook's or a job's `body.source` as the body of
 * {@link hookBodyFunctionExpression} — `(async (ctx) => { SOURCE })` — never as
 * a script of its own (`packages/runtime/src/sandbox/quickjs-runner.ts`; a job
 * takes the hook's wrapper because it has no input to hand in). A source that
 * is valid on its own can fail to compile there: `const ctx = …` or `let ctx`
 * declares the wrapper's parameter a second time, a SyntaxError raised before
 * any statement runs, and so is `let x = 1; let x = 2;` or any grammar error.
 * Before this rule such a body passed `os validate`, `os build`, `os verify`
 * and the publish door, and then every run of the hook or job failed, for as
 * long as the metadata was deployed.
 *
 * The parse check on the same body (`hook-body-source-unparseable`) cannot see
 * most of it: it parses the source with the TypeScript parser inside a
 * synthesised `async function __body(ctx)`, and a parser reports no early
 * error (a redeclaration is one) at all.
 *
 * ## How it judges
 *
 * Exactly the way `action-body-does-not-compile` judges an action body
 * (`validate-action-body-compiles.ts`, whose module note measures the two
 * engines against each other): the expression the runtime builds, from the same
 * function, is compiled with the host engine as a script and never run, and the
 * failure is read through the one {@link judgeBodyCompile}. So the severity
 * split is the action rule's: a regular-expression PATTERN the host refuses is a
 * `warning` (QuickJS's pattern dialect measurably differs from V8's there), and
 * every other compile failure is an `error`.
 *
 * ## Two rule ids, one wrapper
 *
 * A hook finding is `hook-body-does-not-compile` and a job finding is
 * `job-body-does-not-compile`: the id names the body kind, as the action rule's
 * does, so `os explain` and a `suppressWarnings` entry address one kind. The
 * walk is one: `hooks[*].body` and `jobs[*].body`, `language: 'js'` only (an L1
 * expression body is not run in this wrapper).
 */

import { HOOK_BODY_PARAMETERS, hookBodyFunctionExpression } from './action-body-wrapper.js';
import { bodyCompileHint, bodyCompileMessage, judgeBodyCompile } from './validate-action-body-compiles.js';
import { hookBodyFindingLocation } from './validate-hook-body-writes.js';
import { recordsOf } from './object-graph.js';

/** Rule id for a hook body. */
export const HOOK_BODY_DOES_NOT_COMPILE = 'hook-body-does-not-compile';

/** Rule id for a job body. */
export const JOB_BODY_DOES_NOT_COMPILE = 'job-body-does-not-compile';

export interface HookBodyCompileFinding {
  /** `error`, except a regular-expression PATTERN the host refuses (`warning`). */
  severity: 'error' | 'warning';
  rule: string;
  /** e.g. `hook "stamp_owner" › body`, `job "nightly_close" › body`. */
  where: string;
  /** e.g. `hooks[0].body.source`, `hooks[0].handler` (lowered), `jobs[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The L2 source of a hook or job body, or `undefined` when there is nothing to compile. */
function scriptSource(body: unknown): string | undefined {
  if (!isRec(body) || body.language !== 'js') return undefined;
  return typeof body.source === 'string' && body.source.trim() !== '' ? body.source : undefined;
}

const OTHER_FIX =
  'Fix body.source so it compiles as the statements of an async function whose parameter is `ctx`';

/**
 * Every L2 hook body and job body that does not compile in the runtime's
 * `(ctx)` wrapper. Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or
 * post-parse stacks. `ctx.loweredHookRefs` locates a hook whose body the build
 * lowered from an inline `handler` at `hooks[i].handler`, the key the author
 * wrote ({@link hookBodyFindingLocation}).
 */
export function validateHookAndJobBodyCompiles(
  stack: AnyRec,
  ctx?: { loweredHookRefs?: ReadonlySet<string> },
): HookBodyCompileFinding[] {
  const findings: HookBodyCompileFinding[] = [];
  if (!isRec(stack)) return findings;

  recordsOf(stack.hooks).forEach((hook, index) => {
    const source = scriptSource(hook.body);
    if (source === undefined) return;
    const verdict = judgeBodyCompile(hookBodyFunctionExpression(source), HOOK_BODY_PARAMETERS);
    if (!verdict) return;
    const name = typeof hook.name === 'string' && hook.name ? hook.name : `#${index}`;
    const loc = hookBodyFindingLocation(hook, index, ctx);
    findings.push({
      severity: verdict.severity,
      rule: HOOK_BODY_DOES_NOT_COMPILE,
      where: `hook "${name}" › body`,
      path: loc.path,
      message: bodyCompileMessage(verdict, hookBodyFunctionExpression('…'), 'this hook') + loc.messageSuffix,
      hint: bodyCompileHint(verdict, {
        redeclared: (parameter) =>
          `\`${parameter}\` is already the parameter of the wrapper: use it as it is (the hook's record is ` +
          `\`ctx.input\`), or give the local another name, e.g. \`const input = ctx.input || {}\``,
        other: OTHER_FIX,
      }),
    });
  });

  recordsOf(stack.jobs).forEach((job, index) => {
    const source = scriptSource(job.body);
    if (source === undefined) return;
    const verdict = judgeBodyCompile(hookBodyFunctionExpression(source), HOOK_BODY_PARAMETERS);
    if (!verdict) return;
    const name = typeof job.name === 'string' && job.name ? job.name : `#${index}`;
    findings.push({
      severity: verdict.severity,
      rule: JOB_BODY_DOES_NOT_COMPILE,
      where: `job "${name}" › body`,
      path: `jobs[${index}].body.source`,
      message: bodyCompileMessage(verdict, hookBodyFunctionExpression('…'), 'this job'),
      hint: bodyCompileHint(verdict, {
        redeclared: (parameter) =>
          `\`${parameter}\` is already the parameter of the wrapper: use it as it is (a job reaches data ` +
          `through \`ctx.api\`), or give the local another name, e.g. \`const api = ctx.api\``,
        other: OTHER_FIX,
      }),
    });
  });

  return findings;
}
