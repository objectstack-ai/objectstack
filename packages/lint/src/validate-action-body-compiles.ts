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
 * regular-expression literal, in one direction, and only for two constructs:
 * Node 22's V8 (12.4) refuses duplicate named capture groups in different
 * alternatives (`/(?<a>x)|(?<a>y)/`) and modifier groups (`/(?i:a)/`), both of
 * which QuickJS (quickjs-emscripten 0.32.0) accepts and runs. V8 reports a
 * pattern failure as `Invalid regular expression: /PATTERN/FLAGS: REASON`, and
 * the two constructs answer the REASONs in {@link REGEXP_DIALECT_GAP_REASONS}
 * (`Duplicate capture group name`, `Invalid group`). Those two reasons are the
 * one `warning` arm: that is where a host refusal measurably does not predict a
 * runtime refusal, and an `error` there would refuse a body that runs.
 *
 * Every other pattern REASON is an `error`, because QuickJS refuses the pattern
 * too. Measured over the same wrapper text on both engines (V8 12.4 · QuickJS
 * quickjs-emscripten 0.32.0): `Unterminated group` (`/(/`, `/(?:/`), `Nothing
 * to repeat` (`a**`), `Range out of order in character class` (`/[b-a]/`),
 * `Invalid named capture referenced` (`/\k<x>/u`), `Invalid property name`
 * (`/\p{Nope}/u`), `Incomplete quantifier` (`/a{/u`), `Unmatched ')'`,
 * `numbers out of order in {} quantifier`, `Invalid Unicode escape`, `Invalid
 * capture group name`, `Invalid character class`, `Invalid escape` and
 * `Invalid quantifier` — QuickJS refused every one. The allow-list is the
 * narrow side on purpose: a reason it does not name is judged an `error`, so a
 * later V8 that accepts more only removes findings, and a NEW reason a later V8
 * invents for a construct QuickJS accepts has to be measured and added here.
 *
 * What the allow-list costs, measured too: V8 names only the FIRST failure of
 * a pattern, and the two allow-listed reasons are wider than the two
 * constructs. `/(?<a>x)(?<a>y)/` (one alternative), `(?ii:a)`, `(?x)`, an
 * unterminated `(?i:` and a modifier group followed by `/[b-a]/` all answer an
 * allow-listed reason and are refused by QuickJS, so they stay `warning`
 * findings — a refusal missed, never a body that runs refused. Judging those
 * would mean parsing the pattern a second time here, a second regular-expression
 * grammar this rule would own; the warning names the risk instead.
 *
 * The literal's own TOKEN is not a dialect question. A literal that never closes
 * on its line (`return /abc;` — V8 `Invalid regular expression: missing /`) and
 * a flag set that is not one (`/a/gg`, `/a/zz`, `/a/uv` — V8 `Invalid regular
 * expression flags`) are refused by QuickJS as well (`unexpected end of regexp`,
 * `unexpected line terminator in regexp`, `invalid regular expression flags`),
 * and over 55 single characters and every ordered pair of the eight flags the
 * two engines agreed on all 119 flag sets. So both are an `error`. The
 * disagreement in the other direction (syntax the host accepts and QuickJS does
 * not, such as newer grammar) is a missed finding, never a false one; at run
 * time the body then answers a coded `500` naming itself and the compile error
 * (`quickjs-runner.ts`). A host that is not V8 (the `Function` fallback in a
 * page) words its sentences differently: none of them is read as a pattern
 * reason, so every failure there is an `error`.
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
   * `error`, except a regular-expression pattern the host refuses for one of the two measured dialect-gap reasons
   * (`warning`; see the module note). Every other pattern failure, a literal that never closes and a flag set that is
   * not one are an `error`.
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
 * literal: `Invalid regular expression: /PATTERN/FLAGS: REASON`. The literal's
 * token errors open with the same three words and are not this shape
 * (`Invalid regular expression: missing /`, `Invalid regular expression
 * flags`). The REASON is the text after the sentence's last `: `: V8's reasons
 * carry no colon, and the pattern sits before it.
 */
const REGEXP_PATTERN_FAILURE = /^SyntaxError: Invalid regular expression: \//;

/**
 * The V8 pattern REASONs the two measured dialect gaps answer — the one
 * `warning` arm. `Duplicate capture group name` is a duplicate named capture
 * group (`/(?<a>x)|(?<a>y)/`), `Invalid group` a modifier group (`/(?i:a)/`):
 * Node 22's V8 refuses both and QuickJS runs both. Every other reason is an
 * `error`. Widen only on a measurement against the runtime's QuickJS (the
 * module note's table), never on a reason that merely reads like a dialect.
 */
const REGEXP_DIALECT_GAP_REASONS: readonly string[] = Object.freeze([
  'Duplicate capture group name',
  'Invalid group',
]);

/** The REASON of a V8 pattern failure, or `undefined` when `error` is not one. */
function regexpPatternReason(error: string): string | undefined {
  if (!REGEXP_PATTERN_FAILURE.test(error)) return undefined;
  return error.slice(error.lastIndexOf(': ') + 2);
}

/**
 * V8's two reasons for a Unicode property escape (`\p{…}` / `\P{…}`) whose
 * name it does not know, outside and inside a character class. V8 resolves the
 * name against its own list and the host's Unicode tables, so on these reasons
 * the judgement is per property name ({@link REGEXP_PROPERTY_NAMES_ONLY_QUICKJS_KNOWS}).
 */
const REGEXP_PROPERTY_REASONS: readonly string[] = Object.freeze([
  'Invalid property name',
  'Invalid property name in character class',
]);

/**
 * The property-escape bodies Node 22's V8 refuses and the runtime's QuickJS
 * compiles — the property-name half of the `warning` arm. Measured, not
 * picked: every name in quickjs-emscripten 0.32.0's own property, script and
 * general-category tables (2,909 identifiers read out of its release-sync wasm,
 * so every name QuickJS accepts is among them), in seven forms (bare, `gc=`,
 * `General_Category=`, `sc=`, `Script=`, `scx=`, `Script_Extensions=`), under
 * `u` and `v`, outside and inside a class — 81,452 literals compiled in the
 * action wrapper on both engines (Node 22.23.5, V8 12.4, ICU 78.3, Unicode
 * 17.0). These twelve spellings are every disagreement; none ran the other way.
 * Measured on a host with Unicode 17.0 tables: {@link HOST_UNICODE_MEASURED}.
 */
const REGEXP_PROPERTY_NAMES_ONLY_QUICKJS_KNOWS: ReadonlySet<string> = new Set([
  'IDS_Unary_Operator',
  'IDSU',
  'Modifier_Combining_Mark',
  'MCM',
  'sc=Katakana_Or_Hiragana',
  'sc=Hrkt',
  'Script=Katakana_Or_Hiragana',
  'Script=Hrkt',
  'scx=Katakana_Or_Hiragana',
  'scx=Hrkt',
  'Script_Extensions=Katakana_Or_Hiragana',
  'Script_Extensions=Hrkt',
]);

/**
 * The Unicode version of the tables the property-name list was measured
 * against. A host whose tables are older (an early Node 22 ships Unicode 15.1)
 * can refuse a script or property Unicode added later that QuickJS knows, and
 * that half was not measured, so there a refused property name is judged a
 * `warning`: a refusal missed, never a body that runs refused. A host that
 * names no Unicode version (a page) is judged the same way.
 */
const HOST_UNICODE_MEASURED = 17.0;

function hostUnicodeAtLeastMeasured(): boolean {
  const v = (globalThis as { process?: { versions?: { unicode?: unknown } } }).process?.versions?.unicode;
  return typeof v === 'string' && Number.parseFloat(v) >= HOST_UNICODE_MEASURED;
}

/** Every `\p{BODY}` / `\P{BODY}` in a pattern, an escaped backslash before it excluded. */
const PROPERTY_ESCAPE = /(?<!\\)(?:\\\\)*\\[pP]\{([^}]*)\}/g;

/**
 * On a property-name reason: is every property escape the host refuses one
 * only QuickJS knows? The pattern and flags are read back from V8's sentence
 * (`/PATTERN/FLAGS: REASON`), and each escape is compiled alone with the
 * literal's `u` or `v`, so the name V8 refused is the one judged. A host older
 * than the measured tables, or an escape this read cannot find, is not judged:
 * that is the `warning` arm too.
 */
function onlyQuickJsKnowsTheRefusedProperty(error: string, reason: string): boolean {
  if (!hostUnicodeAtLeastMeasured()) return true;
  const literal = error.slice('SyntaxError: Invalid regular expression: '.length, error.length - reason.length - 2);
  const close = literal.lastIndexOf('/');
  const pattern = literal.slice(1, close);
  const flag = literal.slice(close + 1).includes('v') ? 'v' : 'u';
  const refused = [...pattern.matchAll(PROPERTY_ESCAPE)].map((m) => m[1]).filter((body) => {
    try {
      new RegExp(`\\p{${body}}`, flag);
      return false;
    } catch {
      return true;
    }
  });
  return refused.every((body) => REGEXP_PROPERTY_NAMES_ONLY_QUICKJS_KNOWS.has(body));
}

/** Is this V8 pattern failure one of the measured dialect gaps — the `warning` arm? */
function isRegexpDialectGap(error: string, reason: string): boolean {
  if (REGEXP_DIALECT_GAP_REASONS.includes(reason)) return true;
  return REGEXP_PROPERTY_REASONS.includes(reason) && onlyQuickJsKnowsTheRefusedProperty(error, reason);
}

/** V8's sentence for a regular-expression literal that never closes on its line. */
const REGEXP_UNTERMINATED = /^SyntaxError: Invalid regular expression: missing \//;

/** V8's sentence for a regular-expression literal whose flags are not a flag set. */
const REGEXP_FLAGS = /^SyntaxError: Invalid regular expression flags/;

/** A redeclaration the host names (`Identifier 'input' has already been declared`), and the name. */
const REDECLARED = /^SyntaxError: Identifier '([^']+)' has already been declared/;

/** How a compile failure is classified; every body kind's rule reads the same classes. */
export type BodyCompileShape =
  /**
   * A regular-expression PATTERN the host refuses for a measured dialect-gap reason
   * ({@link REGEXP_DIALECT_GAP_REASONS}) — the one `warning` arm.
   */
  | 'regexp-dialect-gap'
  /** A regular-expression PATTERN the host refuses for any other reason; the runtime's engine refuses it too. */
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
  /** `warning` on `regexp-dialect-gap` only; every other failure is an `error`. */
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
  const reason = regexpPatternReason(failure.error);
  const shape: BodyCompileShape = parameter !== undefined
    ? 'redeclared-parameter'
    : reason !== undefined
      ? isRegexpDialectGap(failure.error, reason) ? 'regexp-dialect-gap' : 'regexp-pattern'
      : REGEXP_UNTERMINATED.test(failure.error)
        ? 'regexp-unterminated'
        : REGEXP_FLAGS.test(failure.error)
          ? 'regexp-flags'
          : 'other';

  return {
    severity: shape === 'regexp-dialect-gap' ? 'warning' : 'error',
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
  return verdict.shape === 'regexp-dialect-gap'
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
    case 'regexp-dialect-gap':
      return 'Rewrite the regular expression in a form both engines accept (a group name used once, no `(?i:…)` ' +
        'modifier group), or build it with new RegExp(…) at run time';
    case 'regexp-pattern':
      return 'Fix the regular expression\'s pattern: the runtime\'s engine refuses it too. Close every `(` with `)`, ' +
        'give `*` / `+` / `?` / `{n}` something to repeat (or write it as `\\*`), write a class range low to high ' +
        '(`[a-z]`), name only a group the pattern declares in `\\k<…>`, and under `u` use a Unicode property that exists';
    case 'regexp-unterminated':
      return 'A `/` opens a regular-expression literal that never closes on its line: close it with `/`, write a ' +
        '`/` inside it as `\\/`, keep the literal on one line (a `\\n` written with one backslash in a quoted or ' +
        'JSON-carried body.source arrives as a line break, which ends it: write `\\\\n`), or, if the `/` is a ' +
        'division, give it a left-hand operand';
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
