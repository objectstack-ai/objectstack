// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An L2 action body must COMPILE in the wrapper the runtime runs it in.
 *
 * ## The failure this refuses
 *
 * The runtime runs `body.source` as the body of
 * {@link actionBodyFunctionExpression} — `(async (input, ctx) => { SOURCE })` —
 * never as a script of its own. A source that is valid on its own can fail to
 * compile there. The common case is the one an AI author writes because `input`
 * reads like a free variable: `const input = ctx.input || {}` declares a
 * parameter a second time, which is a SyntaxError raised before any statement
 * of the body runs. Before this rule such a body passed `os validate`,
 * `os build`, `os verify` and the publish door, and then EVERY run of the
 * action failed, on every door, for as long as the metadata was deployed.
 *
 * The existing parse check (`action-body-source-unparseable`) cannot see it: it
 * parses the source with the TypeScript parser inside a synthesised
 * `async function __body(ctx)`, a different binding list, and a parser reports
 * no redeclaration at all (that is an early error, not a grammar error).
 *
 * ## How it judges
 *
 * It compiles `actionBodyFunctionExpression(source)` — the function the runtime
 * builds, from the same function — with the host JavaScript engine, as a
 * SCRIPT, the way the runtime evaluates it. Compiling never runs anything: a
 * source that closes the wrapper early and writes statements after it compiles
 * here and nothing in it executes. `node:vm`'s `Script` is used where the host
 * has it (every Node the package supports from 22.3); otherwise the `Function`
 * constructor compiles the same text as a function body. A host that refuses
 * both (a page under a content security policy) gets no finding: the rule
 * cannot judge there, and says nothing rather than guess.
 *
 * ## The engines are not the same engine — what that costs, measured
 *
 * The runtime's engine is QuickJS; this rule's is the host's (V8 on Node). Both
 * implement the same early errors, and over a probe of 36 bodies the two agreed
 * on every redeclaration, every grammar error, every strict-mode error and every
 * misplaced `new.target` / `super`. They disagree inside the PATTERN of a
 * regular-expression literal: Node 22's V8 refuses duplicate named capture
 * groups (`/(?<a>x)|(?<a>y)/`) and modifier groups (`/(?i:a)/`), both of which
 * QuickJS accepts and runs. A failure V8 reports against a pattern — its
 * sentence names the literal, `Invalid regular expression: /PATTERN/FLAGS:
 * REASON` — is therefore a `warning`: that is where a host refusal measurably
 * does not predict a runtime refusal, and an `error` there would refuse a body
 * that runs.
 *
 * The literal's own TOKEN is not a dialect question. A literal that never closes
 * on its line (`return /abc;` — V8 `Invalid regular expression: missing /`) and
 * a flag set that is not one (`/a/gg`, `/a/zz`, `/a/uv` — V8 `Invalid regular
 * expression flags`) are refused by QuickJS as well (`unexpected end of regexp`,
 * `unexpected line terminator in regexp`, `invalid regular expression flags`),
 * and over 55 single characters and every ordered pair of the eight flags the
 * two engines agreed on all 119 flag sets. So only the pattern shape takes
 * the warning arm, and every other compile failure — these two included — is an
 * `error`. The disagreement in the other direction (syntax the host accepts and
 * QuickJS does not, such as newer grammar) is a missed finding, never a false
 * one; at run time the action then answers a coded `500` naming itself and the
 * compile error (`quickjs-runner.ts`).
 *
 * Hook and job bodies run in a different wrapper, `(async (ctx) => { … })`,
 * and are judged by `hook-body-does-not-compile` / `job-body-does-not-compile`
 * (`validate-hook-body-compiles.ts`), which read their compile failures through
 * the same {@link judgeBodyCompile}, so every body kind takes the same severity
 * split.
 */

import { ACTION_BODY_PARAMETERS, actionBodyFunctionExpression } from './action-body-wrapper.js';
import { collectActionBodies } from './validate-action-body-writes.js';

/** Rule id. */
export const ACTION_BODY_DOES_NOT_COMPILE = 'action-body-does-not-compile';

export interface ActionBodyCompileFinding {
  /**
   * `error`, except a regular-expression PATTERN the host refuses (`warning`; see the module note). A
   * literal that never closes, or whose flags are not a flag set, is an `error`.
   */
  severity: 'error' | 'warning';
  rule: string;
  /** e.g. `action "decide_approval_step" › body`. */
  where: string;
  /** e.g. `actions[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

/** What the host engine said about a text it would not compile. */
export interface HostCompileFailure {
  /** `SyntaxError: <the engine's sentence>`. */
  error: string;
  /** 1-based line of the compiled text the engine named, when it named one. */
  line?: number;
}

type VmModule = { Script: new (code: string, options?: { filename?: string }) => unknown };

const COMPILE_FILENAME = 'action-body';

function hostVm(): VmModule | undefined {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  if (typeof proc?.getBuiltinModule !== 'function') return undefined;
  try {
    const vm = proc.getBuiltinModule('node:vm') as Partial<VmModule> | undefined;
    return typeof vm?.Script === 'function' ? (vm as VmModule) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compile `text` with the host engine WITHOUT running it, and answer why it did
 * not compile, or `undefined` when it compiled (or when the host refuses to
 * compile anything at all, which is no verdict about `text`).
 */
export function hostCompileFailure(text: string): HostCompileFailure | undefined {
  try {
    const vm = hostVm();
    if (vm) new vm.Script(text, { filename: COMPILE_FILENAME });
    // Compiled, never called: the constructed function is discarded.
    else new Function(text);
    return undefined;
  } catch (e) {
    const err = e as { name?: unknown; message?: unknown; stack?: unknown };
    if (err?.name !== 'SyntaxError') return undefined;
    const lineMatch = new RegExp(`^${COMPILE_FILENAME}:(\\d+)`).exec(String(err.stack ?? ''));
    return {
      error: `SyntaxError: ${String(err.message ?? '')}`,
      ...(lineMatch ? { line: Number(lineMatch[1]) } : {}),
    };
  }
}

/**
 * V8's sentence for a regular-expression PATTERN it refuses, which names the
 * literal: `Invalid regular expression: /PATTERN/FLAGS: REASON`. The one
 * `warning` arm. The literal's token errors open with the same three words and
 * are not this shape (`Invalid regular expression: missing /`, `Invalid regular
 * expression flags`), so they stay `error`, and so does any other sentence.
 */
const REGEXP_PATTERN_FAILURE = /^SyntaxError: Invalid regular expression: \//;

/** V8's sentence for a regular-expression literal that never closes on its line. */
const REGEXP_UNTERMINATED = /^SyntaxError: Invalid regular expression: missing \//;

/** V8's sentence for a regular-expression literal whose flags are not a flag set. */
const REGEXP_FLAGS = /^SyntaxError: Invalid regular expression flags/;

/** A redeclaration the host names (`Identifier 'input' has already been declared`), and the name. */
const REDECLARED = /^SyntaxError: Identifier '([^']+)' has already been declared/;

/** How a compile failure is classified; every body kind's rule reads the same classes. */
export type BodyCompileShape =
  /** A regular-expression PATTERN the host refuses — the one `warning` arm. */
  | 'regexp-pattern'
  /** A regular-expression literal that never closes on its line. */
  | 'regexp-unterminated'
  /** A regular-expression literal whose flags are not a flag set. */
  | 'regexp-flags'
  /** A parameter of the wrapper declared again. */
  | 'redeclared-parameter'
  /** Any other compile failure. */
  | 'other';

/** What compiling one body inside its wrapper said, when it did not compile. */
export interface BodyCompileVerdict {
  /** `warning` for a regular-expression pattern only; every other failure is an `error`. */
  severity: 'error' | 'warning';
  shape: BodyCompileShape;
  /** The host's sentence, `SyntaxError: …`. */
  error: string;
  /** `, line N` when the host named a line (line N of the source), else empty. */
  at: string;
  /** The wrapper parameter declared again, on `redeclared-parameter`. */
  parameter?: string;
}

/**
 * Compile `expression` — a body's wrapper with the body inside it, from the one
 * function the runtime builds it with — and classify why it did not compile, or
 * answer `undefined` when it compiled (or when the host cannot judge).
 * `parameters` are the wrapper's own bindings, so a redeclared one is named.
 */
export function judgeBodyCompile(expression: string, parameters: readonly string[]): BodyCompileVerdict | undefined {
  const failure = hostCompileFailure(expression);
  if (!failure) return undefined;

  const at = failure.line !== undefined ? `, line ${failure.line}` : '';
  const redeclared = REDECLARED.exec(failure.error)?.[1];
  const parameter = redeclared !== undefined && parameters.includes(redeclared) ? redeclared : undefined;
  const shape: BodyCompileShape = parameter !== undefined
    ? 'redeclared-parameter'
    : REGEXP_PATTERN_FAILURE.test(failure.error)
      ? 'regexp-pattern'
      : REGEXP_UNTERMINATED.test(failure.error)
        ? 'regexp-unterminated'
        : REGEXP_FLAGS.test(failure.error)
          ? 'regexp-flags'
          : 'other';

  return {
    severity: shape === 'regexp-pattern' ? 'warning' : 'error',
    shape,
    error: failure.error,
    at,
    ...(parameter !== undefined ? { parameter } : {}),
  };
}

/**
 * The finding's message for a verdict: `wrapper` is the wrapper shown with an
 * ellipsis for the body, `subject` the body's owner as a noun (`this action`).
 */
export function bodyCompileMessage(verdict: BodyCompileVerdict, wrapper: string, subject: string): string {
  return verdict.shape === 'regexp-pattern'
    ? `body's regular expression is refused by this host's engine (${verdict.error}${verdict.at}); the runtime's ` +
      `engine may accept it, but if it does not, every run of ${subject} fails`
    : `body does not compile in the wrapper the runtime runs it in, ` +
      `${wrapper} (${verdict.error}${verdict.at}), so every run of ${subject} fails`;
}

/**
 * The finding's hint for a verdict. The two body-kind-specific answers are the
 * caller's — what to do about a redeclared parameter, and the generic fix — and
 * the regular-expression answers are the same for every kind.
 */
export function bodyCompileHint(
  verdict: BodyCompileVerdict,
  own: { redeclared: (parameter: string) => string; other: string },
): string {
  switch (verdict.shape) {
    case 'redeclared-parameter':
      return own.redeclared(verdict.parameter!);
    case 'regexp-pattern':
      return 'Rewrite the regular expression in a form both engines accept, or build it with new RegExp(…) at run time';
    case 'regexp-unterminated':
      return 'A `/` opens a regular-expression literal that never closes on its line: close it with `/`, write a ' +
        '`/` inside it as `\\/`, or, if the `/` is a division, give it a left-hand operand';
    case 'regexp-flags':
      return 'A regular-expression literal\'s flags are letters from `dgimsuvy`, each at most once, and never ' +
        '`u` with `v`';
    default:
      return own.other;
  }
}

/**
 * Every L2 action body that does not compile in the runtime's action wrapper.
 * Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or post-parse stacks.
 * Walks the bodies {@link collectActionBodies} walks — both registration
 * sites, `type: 'script'` only, a merged action once.
 */
export function validateActionBodyCompiles(stack: Record<string, unknown>): ActionBodyCompileFinding[] {
  const findings: ActionBodyCompileFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  for (const site of collectActionBodies(stack)) {
    const verdict = judgeBodyCompile(actionBodyFunctionExpression(site.source), ACTION_BODY_PARAMETERS);
    if (!verdict) continue;

    findings.push({
      severity: verdict.severity,
      rule: ACTION_BODY_DOES_NOT_COMPILE,
      where: `action "${site.name}" › body`,
      path: site.path,
      message: bodyCompileMessage(verdict, actionBodyFunctionExpression('…'), 'this action'),
      hint: bodyCompileHint(verdict, {
        redeclared: (parameter) =>
          `\`${parameter}\` is already a parameter of the wrapper: use it as it is (the action's params are ` +
          `\`input\`, the context is \`ctx\`), or give the local another name, e.g. ` +
          `\`const params = ctx.input || {}\``,
        other:
          `Fix body.source so it compiles as the statements of an async function whose parameters are ` +
          `${ACTION_BODY_PARAMETERS.map((p) => `\`${p}\``).join(' and ')}`,
      }),
    });
  }

  return findings;
}
