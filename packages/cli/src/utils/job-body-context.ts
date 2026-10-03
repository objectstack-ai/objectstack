// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The check a JOB's function must pass before `lowerCallables` mints a job
 * `body` from it — on top of everything `extractHookBody` already refuses.
 *
 * ## Why a job needs a check a hook does not
 *
 * A lowered body runs as `(async (ctx) => { <source> })(ctx)` inside the
 * QuickJS sandbox (`runtime/src/sandbox/quickjs-runner.ts`), and
 * `extractHookBody` peels the function's parameter list away to produce
 * `<source>`. For a hook that is faithful by design: the in-process hook
 * context and the sandbox `ctx` are the same shape (`ctx.input`, `ctx.api`),
 * and the members that differ are refused one by one (`.sudo(`, `.create(`).
 *
 * A job's function is written against a DIFFERENT context. `AppPlugin` calls
 * it with `JobHandlerContext` (`@objectstack/runtime`): `{ jobId, data,
 * bundle, ql, logger }`, and the documented form destructures it —
 * `async function sweep({ jobId, ql, logger })`. Peeled, that becomes a body
 * reading `ql`, `logger` and `jobId` with nothing binding them: the
 * free-identifier gate passes (they WERE parameters), the build exits 0, and
 * the body throws `ReferenceError` on its first run. Worse, `body` wins over
 * `handler` once the runtime binds job bodies, so the build would have replaced
 * a working handler with a broken body. A sandbox job body reaches data only
 * through `ctx.api` under its declared capabilities and logs through `ctx.log`;
 * there is no engine handle and no bundle in there (`JobSchema.body`).
 *
 * So a job's function becomes a body only when it is written against the
 * sandbox `ctx`: at most one parameter, a plain identifier named `ctx`, and no
 * read of a member that exists only on the in-process context. Anything else
 * is refused with a `forbidden-token` refusal — structural, like `fetch(`: the
 * function is not a body as written, and its `handler` keeps running it.
 *
 * ## What it does not see
 *
 * Over-refusing is the safe direction (the handler keeps working; only
 * `--strict-body` turns a refusal into a failure), under-refusing is not. The
 * three read shapes below are the ones a job function plausibly writes:
 * `ctx.ql`, `ctx['ql']` and `const { ql } = ctx`. An alias (`const c = ctx;
 * c.ql`) is not followed. `ctx.jobId` and `ctx.data` are NOT refused: what a
 * job body's `ctx` carries beyond the shared sandbox surface is the runtime
 * binder's to declare, and refusing them here would decide it.
 */

import { ts } from 'ts-morph';
import { parseFunction } from './detect-free-identifiers.js';
import { HookBodyExtractionError } from './extract-hook-body.js';

/**
 * Members of the in-process `JobHandlerContext` that a sandboxed body's `ctx`
 * does not have, and will not: `ql` is an unscoped engine handle (a body
 * reaches data only through `ctx.api` under declared capabilities), `logger`
 * is the host logger (a body logs through `ctx.log`), `bundle` is host memory.
 */
export const HOST_ONLY_JOB_CONTEXT_MEMBERS: ReadonlySet<string> = new Set(['ql', 'logger', 'bundle']);

const KEEPS_HANDLER = 'This job keeps running through its `handler` (no behavior change).';

/**
 * Throw a {@link HookBodyExtractionError} unless a body lowered from `fn` would
 * see the context `fn` reads. Call it AFTER `extractHookBody` succeeded.
 */
export function assertJobBodyContext(fn: (...a: unknown[]) => unknown, originLabel: string): void {
  const head = `[hook-body-extract] ${originLabel}: `;
  const parsed = parseFunction(String(fn));
  if (!parsed) {
    throw new HookBodyExtractionError(
      'unparseable',
      originLabel,
      `${head}could not parse the handler's parameter list, so the build cannot tell whether a body ` +
        `lowered from it would see the context it reads. ${KEEPS_HANDLER}`,
    );
  }

  const params = parsed.parameters;
  if (params.length === 0) return;

  const refuse = (why: string): never => {
    throw new HookBodyExtractionError('forbidden-token', originLabel, `${head}${why} ${KEEPS_HANDLER}`);
  };

  if (params.length > 1) {
    refuse(
      `the handler takes ${params.length} parameters. A job is called with one argument, its context, ` +
        'and a lowered body binds only `ctx`, so every other parameter would be unbound in the sandbox.',
    );
  }

  const param = params[0];
  if (!ts.isIdentifier(param.name) || param.dotDotDotToken) {
    refuse(
      'the handler destructures its argument. A lowered body runs as `(async (ctx) => { … })`: the build ' +
        'peels the parameter list away, so the destructured names would be unbound in the sandbox. Take ' +
        'the context as one parameter named `ctx` and read `ctx.api` / `ctx.log` from it.',
    );
  }

  const name = (param.name as ts.Identifier).text;
  if (name !== 'ctx') {
    refuse(
      `the handler names its argument \`${name}\`. A lowered body runs as \`(async (ctx) => { … })\`, ` +
        `so every reference to \`${name}\` would be unbound in the sandbox. Name the parameter \`ctx\`.`,
    );
  }

  const reads = hostMemberReads(parsed, name);
  if (reads.length > 0) {
    refuse(
      `the handler reads ${reads.map((m) => `\`ctx.${m}\``).join(', ')}, which exist${reads.length === 1 ? 's' : ''} ` +
        'only on the in-process job context. A job body runs in the sandbox: it reaches data through ' +
        '`ctx.api.object(…)` under its declared capabilities and logs through `ctx.log`, and has no engine ' +
        'handle and no bundle. Rewrite those reads against `ctx.api` / `ctx.log` to make it a body.',
    );
  }
}

/** Sorted, de-duplicated host-only members read off the parameter `param`. */
function hostMemberReads(fn: ts.FunctionLikeDeclarationBase, param: string): string[] {
  const hits = new Set<string>();
  const isParam = (node: ts.Node): boolean => ts.isIdentifier(node) && node.text === param;

  const walk = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isParam(node.expression)) {
      if (HOST_ONLY_JOB_CONTEXT_MEMBERS.has(node.name.text)) hits.add(node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      isParam(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      if (HOST_ONLY_JOB_CONTEXT_MEMBERS.has(node.argumentExpression.text)) hits.add(node.argumentExpression.text);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isParam(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && HOST_ONLY_JOB_CONTEXT_MEMBERS.has(key.text)) hits.add(key.text);
      }
    }
    ts.forEachChild(node, walk);
  };

  if (fn.body) walk(fn.body);
  return [...hits].sort();
}
