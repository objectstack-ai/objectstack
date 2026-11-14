// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's declared refusal catalogue (#26170, maintainer ruling 6431311681,
 * letter A): the vocabulary, the save-time reading of a body's literal throws,
 * and the sentences both halves speak.
 *
 * A hook that declares `refusals: { <CODE>: { message, status?, reasons?,
 * params? } }` refuses by code only. Its code — a sandboxed `js` body, or an
 * in-process `handler` the build lowers to one (#33214, ruling 6879477573
 * letter A) — throws an error carrying a declared `code`, and optionally a
 * declared `reason` and the `params` the sentence's holes name; the runtime
 * answers with the declared message, translated through
 * `hooks.<hook>.refusals.<CODE>.message` (or
 * `hooks.<hook>.refusals.<CODE>.reasons.<REASON>.message`) in the caller's
 * locale, and the declared status. A code, or a reason, the catalogue does not
 * declare is refused loudly:
 *
 *  - at save time, where the hook's source names it literally in a `throw`
 *    ({@link hookRefusalCodesThrownIn}, {@link hookRefusalReasonsThrownIn}) —
 *    `HookSchema` refuses the hook at every door that parses one;
 *  - otherwise at run time, where the runtime answers the throw as a fault
 *    naming the hook and the code
 *    (`packages/runtime/src/sandbox/hook-refusal-catalogue.ts`).
 *
 * It imports nothing, on purpose: `data/hook.zod.ts` reads it and so does the
 * runtime, and a leaf keeps the schema's import graph unchanged (the
 * `identity/identity-assignment-body-writes.ts` precedent).
 */

/**
 * The spelling of a declared refusal code: SCREAMING_SNAKE, the one wire
 * vocabulary of an error code (ADR-0112). The code a body throws reaches the
 * caller's envelope (as `declaredCode`, beside the status's registered `code`),
 * so it is spelled as every other code a client branches on.
 */
export const HOOK_REFUSAL_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** A string literal in any of the three quote forms, holding a refusal code. */
const CODE_LITERAL = String.raw`(?<quote>['"\x60])(?<code>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)\k<quote>`;

/**
 * The spelling of a declared refusal reason (#33214): snake_case, a machine
 * name like every other key an author declares under a code. A reason never
 * reaches the wire — the code does — so it is spelled as a data value, not as
 * an error code, and the literal reading can tell the two apart.
 */
export const HOOK_REFUSAL_REASON_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * The spelling of a declared refusal param (#33214): an identifier, the root a
 * `{{ name }}` hole in the entry's sentences names.
 */
export const HOOK_REFUSAL_PARAM_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A string literal in any of the three quote forms, holding a refusal reason. */
const REASON_LITERAL = String.raw`(?<rquote>['"\x60])(?<reason>[a-z][a-z0-9]*(?:_[a-z0-9]+)*)\k<rquote>`;

/** `reason: 'x'` — the property in an object literal a `throw` builds. */
const REASON_PROPERTY = new RegExp(String.raw`(?<![\w$.])reason\s*:\s*` + REASON_LITERAL, 'g');

/** `e.reason = 'x'` — the reason assigned onto a name the body later throws. */
const REASON_ASSIGNMENT = new RegExp(
  String.raw`(?<![\w$.])(?<binding>[A-Za-z_$][\w$]*)\s*\.\s*reason\s*=(?!=)\s*` + REASON_LITERAL,
  'g',
);

/** `code: 'X'` — the property in an object literal a `throw` builds. */
const CODE_PROPERTY = new RegExp(String.raw`(?<![\w$.])code\s*:\s*` + CODE_LITERAL, 'g');

/** `e.code = 'X'` — the code assigned onto a name the body later throws. */
const CODE_ASSIGNMENT = new RegExp(
  String.raw`(?<![\w$.])(?<binding>[A-Za-z_$][\w$]*)\s*\.\s*code\s*=(?!=)\s*` + CODE_LITERAL,
  'g',
);

/**
 * `source` with every comment blanked and every string literal's contents
 * blanked, keeping each offset where it was — except a string that holds
 * nothing but a refusal code or a refusal reason, which are the literals the
 * reading looks for.
 *
 * So a `throw`, a `code:` or a bracket written inside a comment or inside a
 * longer string is never read as code.
 */
function maskedSource(source: string): string {
  const out = source.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const close = skipString(source, i);
      const inner = source.slice(i + 1, close);
      if (!HOOK_REFUSAL_CODE_PATTERN.test(inner) && !HOOK_REFUSAL_REASON_PATTERN.test(inner)) blank(i + 1, close);
      i = close;
    } else if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end - 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end - 1;
    }
  }
  return out.join('');
}

/**
 * The text of each `throw` statement in a masked source ({@link maskedSource}):
 * from the keyword to the end of its expression — a `;` or a line break
 * outside every bracket, or the close of the block that holds it.
 *
 * Read, never parsed or run, so a body that does not parse still answers.
 */
function throwStatements(masked: string): string[] {
  const found: string[] = [];
  // Not after a quote: a kept reason literal may spell the word itself.
  const keyword = /(?<![\w$.'"\x60])throw\b/g;
  for (const match of masked.matchAll(keyword)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 0;
    let end = masked.length;
    for (let i = start; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i = skipString(masked, i);
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (depth === 0 && (ch === ';' || ch === '\n') && masked.slice(start, i).trim().length > 0) {
        end = i;
        break;
      }
    }
    found.push(masked.slice(start, end));
  }
  return found;
}

/** The index of the closing quote of the string opened at `open`. */
function skipString(source: string, open: number): number {
  const quote = source[open];
  for (let i = open + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
      continue;
    }
    if (source[i] === quote) return i;
  }
  return source.length;
}

/** The identifier a `throw` statement throws, when it throws a bare name. */
function thrownBinding(statement: string): string | undefined {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(statement);
  return m ? m[1] : undefined;
}

/**
 * The refusal codes a sandboxed body's source throws LITERALLY, in first-seen
 * order — the cases a save can decide:
 *
 *  - a `code: 'X'` property inside a `throw` statement:
 *    `throw Object.assign(new Error(), { code: 'X' })`, `throw { code: 'X' }`;
 *  - `e.code = 'X'` on a name some `throw` statement throws bare: `throw e`.
 *
 * A code that arrives any other way — a helper's parameter
 * (`refuse('…', code)`), a variable, a computed value — is left to the run-time
 * refusal, which judges the code the body actually threw. Only SCREAMING_SNAKE
 * literals are read ({@link HOOK_REFUSAL_CODE_PATTERN}), so a record field
 * named `code` written with a lower-case value is never mistaken for one.
 */
export function hookRefusalCodesThrownIn(source: string): string[] {
  const codes = new Set<string>();
  const thrownNames = new Set<string>();
  const masked = maskedSource(source);
  for (const statement of throwStatements(masked)) {
    for (const m of statement.matchAll(CODE_PROPERTY)) codes.add(m.groups!.code);
    const binding = thrownBinding(statement);
    if (binding) thrownNames.add(binding);
  }
  for (const m of masked.matchAll(CODE_ASSIGNMENT)) {
    if (thrownNames.has(m.groups!.binding)) codes.add(m.groups!.code);
  }
  return [...codes];
}

/**
 * The `(code, reason)` pairs a hook's source throws LITERALLY (#33214), in
 * first-seen order — the reason half of {@link hookRefusalCodesThrownIn}, read
 * the same two ways:
 *
 *  - a `reason: 'x'` property inside a `throw` statement that also names
 *    exactly one code literally: `throw { code: 'X', reason: 'x' }`;
 *  - `e.reason = 'x'` on a name some `throw` statement throws bare, paired
 *    with that name's literal `e.code = 'X'`.
 *
 * A reason with no literal code beside it, or one that arrives any other way,
 * is left to the run-time refusal.
 */
export function hookRefusalReasonsThrownIn(source: string): Array<{ code: string; reason: string }> {
  const pairs: Array<{ code: string; reason: string }> = [];
  const seen = new Set<string>();
  const add = (code: string, reason: string) => {
    const key = `${code}.${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ code, reason });
  };
  const thrownNames = new Set<string>();
  const masked = maskedSource(source);
  for (const statement of throwStatements(masked)) {
    const codes = new Set([...statement.matchAll(CODE_PROPERTY)].map((m) => m.groups!.code));
    if (codes.size === 1) {
      const [code] = codes;
      for (const m of statement.matchAll(REASON_PROPERTY)) add(code!, m.groups!.reason);
    }
    const binding = thrownBinding(statement);
    if (binding) thrownNames.add(binding);
  }
  const codeOf = new Map<string, string>();
  for (const m of masked.matchAll(CODE_ASSIGNMENT)) {
    if (thrownNames.has(m.groups!.binding)) codeOf.set(m.groups!.binding, m.groups!.code);
  }
  for (const m of masked.matchAll(REASON_ASSIGNMENT)) {
    const code = codeOf.get(m.groups!.binding);
    if (code !== undefined) add(code, m.groups!.reason);
  }
  return pairs;
}

/** The declared codes, as the sentence lists them. */
function declaredList(declared: readonly string[]): string {
  return declared.length > 0 ? declared.map((c) => `'${c}'`).join(', ') : 'none';
}

/**
 * The save-time refusal for a code a body throws literally and the hook's
 * catalogue does not declare.
 */
export function undeclaredHookRefusalCodeAtSave(
  code: string,
  declared: readonly string[],
  at: 'body.source' | 'handler' = 'body.source',
): string {
  return (
    `\`${at}\` throws code '${code}', and this hook's \`refusals\` declares no such code `
    + `(declared: ${declaredList(declared)}). A hook that declares \`refusals\` refuses by code only, so the `
    + `throw is refused when the hook runs. Declare it under \`refusals.${code}\` with the message the user `
    + 'reads, or throw one of the declared codes.'
  );
}

/**
 * A refusal message with no `{{ … }}` hole — the rule for an entry that
 * declares no `params`: nothing fills a hole there (the message is plain text,
 * translated whole), so a hole is refused at save. An entry that declares
 * `params` (#33214) is judged by the closed-scope template rule instead
 * (`HookSchema`), which allows a hole over a declared param only.
 */
export const HOOK_REFUSAL_MESSAGE_WITHOUT_HOLE = /^(?![\s\S]*\{\{[^{}]*\}\})[\s\S]*$/;

/** The save-time refusal for a `{{ … }}` hole in a refusal message whose entry declares no `params`. */
export const HOOK_REFUSAL_MESSAGE_HOLE_REFUSED =
  'A hook refusal `message` whose entry declares no `params` is plain text, and nothing fills a `{{ }}` hole: the '
  + 'caller would read the braces as written. Declare the name under the entry\'s `params` (`params: [\'state\']`) '
  + 'and throw it in the error\'s `params` (`{ code, params: { state } }`), or write the sentence without the hole.';

/** How a hook carrying `refusals` names the code that would answer it, for the sentence below. */
function refusalCarrier(language: string | undefined): string {
  return language !== undefined ? `a \`${language}\` body` : 'no `body` and no `handler`';
}

/**
 * The save-time refusal for a catalogue on a hook whose code cannot throw a
 * code: an `expression` body, or no body and no handler at all.
 */
export function hookRefusalsWithoutSandboxedBody(language: string | undefined): string {
  return (
    '`refusals` is answered for a sandboxed `body` (`language: \'js\'`) and for an in-process `handler` (which '
    + `\`os build\` lowers to a \`js\` body), and this hook has ${refusalCarrier(language)}: nothing it runs `
    + 'can throw a declared code, while `os i18n` still demanded its translations. Give the hook a `js` body or a '
    + '`handler` that throws the declared codes, or drop `refusals`.'
  );
}

/**
 * The run-time refusal for a throw the catalogue cannot answer: a code it
 * does not declare, or no code at all. Fault text, for the server log and the
 * author: it names the hook and the code and says how to fix it.
 */
export function undeclaredHookRefusalAtRun(
  hookName: string,
  code: string | undefined,
  declared: readonly string[],
): string {
  const thrown = code === undefined ? 'threw no `code`' : `threw code '${code}'`;
  return (
    `hook '${hookName}' ${thrown}, and its \`refusals\` declares no such code (declared: ${declaredList(declared)}). `
    + 'A hook that declares `refusals` refuses by code only: throw an error whose `code` is one of the declared '
    + 'codes, or declare this one with the message the user reads.'
  );
}

/** The declared reasons of one code, as the sentence lists them. */
function reasonList(declared: readonly string[]): string {
  return declared.length > 0 ? declared.map((r) => `'${r}'`).join(', ') : 'none';
}

/**
 * The save-time refusal for a reason a hook's source throws literally under a
 * declared code whose `reasons` does not declare it (#33214).
 */
export function undeclaredHookRefusalReasonAtSave(
  code: string,
  reason: string,
  declared: readonly string[],
  at: 'body.source' | 'handler',
): string {
  return (
    `\`${at}\` throws code '${code}' with reason '${reason}', and \`refusals.${code}.reasons\` declares no such `
    + `reason (declared: ${reasonList(declared)}). A reason picks one of the code's declared sentences, so the `
    + `throw is refused when the hook runs. Declare it under \`refusals.${code}.reasons.${reason}\` with the `
    + 'message the user reads, or throw one of the declared reasons.'
  );
}

/**
 * The run-time refusal for a declared code thrown with a reason the code's
 * `reasons` does not declare (#33214). Fault text, like
 * {@link undeclaredHookRefusalAtRun}.
 */
export function undeclaredHookRefusalReasonAtRun(
  hookName: string,
  code: string,
  reason: string,
  declared: readonly string[],
): string {
  return (
    `hook '${hookName}' threw code '${code}' with reason '${reason}', and \`refusals.${code}.reasons\` declares `
    + `no such reason (declared: ${reasonList(declared)}). A reason picks one of the code's declared sentences: `
    + 'throw one of the declared reasons, or declare this one with the message the user reads.'
  );
}
