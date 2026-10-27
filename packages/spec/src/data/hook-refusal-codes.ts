// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hook's declared refusal catalogue (#26170, maintainer ruling 6431311681,
 * letter A): the vocabulary, the save-time reading of a body's literal throws,
 * and the sentences both halves speak.
 *
 * A hook that declares `refusals: { <CODE>: { message, status? } }` refuses by
 * code only. Its body throws an error carrying a declared `code`; the runtime
 * answers with the declared message, translated through
 * `hooks.<hook>.refusals.<CODE>.message` in the caller's locale, and the
 * declared status. A code the catalogue does not declare is refused loudly:
 *
 *  - at save time, where the body names the code literally in a `throw`
 *    ({@link hookRefusalCodesThrownIn}) — `HookSchema` refuses the hook at
 *    every door that parses one;
 *  - otherwise at run time, where the sandboxed body runner answers the throw
 *    as a fault naming the hook and the code
 *    (`packages/runtime/src/sandbox/hook-refusal-catalogue.ts`).
 *
 * It imports nothing, on purpose: `data/hook.zod.ts` reads it and so does the
 * runtime, and a leaf keeps the schema's import graph unchanged (the
 * `identity/identity-assignment-body-writes.ts` precedent).
 */

/**
 * The spelling of a declared refusal code: SCREAMING_SNAKE, the one wire
 * vocabulary of an error code (ADR-0112). The code a body throws is the
 * `code` the caller's envelope carries, so it is spelled as every other code a
 * client branches on.
 */
export const HOOK_REFUSAL_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

/** A string literal in any of the three quote forms, holding a refusal code. */
const CODE_LITERAL = String.raw`(?<quote>['"\x60])(?<code>[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)\k<quote>`;

/** `code: 'X'` — the property in an object literal a `throw` builds. */
const CODE_PROPERTY = new RegExp(String.raw`(?<![\w$.])code\s*:\s*` + CODE_LITERAL, 'g');

/** `e.code = 'X'` — the code assigned onto a name the body later throws. */
const CODE_ASSIGNMENT = new RegExp(
  String.raw`(?<![\w$.])(?<binding>[A-Za-z_$][\w$]*)\s*\.\s*code\s*=(?!=)\s*` + CODE_LITERAL,
  'g',
);

/**
 * The text of each `throw` statement in `source`: from the keyword to the end
 * of its expression — a `;` or a line break outside every bracket and string,
 * or the close of the block that holds it.
 *
 * Read, never parsed or run, so a body that does not parse still answers; the
 * scan skips over strings, template literals and comments so a `;` or a
 * bracket inside one does not end or extend the expression.
 */
function throwStatements(source: string): string[] {
  const found: string[] = [];
  const keyword = /(?<![\w$.])throw\b/g;
  for (const match of source.matchAll(keyword)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 0;
    let end = source.length;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i = skipString(source, i);
        continue;
      }
      if (ch === '/' && source[i + 1] === '/') {
        const nl = source.indexOf('\n', i);
        i = nl === -1 ? source.length : nl - 1;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        i = close === -1 ? source.length : close + 1;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      } else if (depth === 0 && (ch === ';' || ch === '\n') && source.slice(start, i).trim().length > 0) {
        end = i;
        break;
      }
    }
    found.push(source.slice(start, end));
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
  for (const statement of throwStatements(source)) {
    for (const m of statement.matchAll(CODE_PROPERTY)) codes.add(m.groups!.code);
    const binding = thrownBinding(statement);
    if (binding) thrownNames.add(binding);
  }
  for (const m of source.matchAll(CODE_ASSIGNMENT)) {
    if (thrownNames.has(m.groups!.binding)) codes.add(m.groups!.code);
  }
  return [...codes];
}

/** The declared codes, as the sentence lists them. */
function declaredList(declared: readonly string[]): string {
  return declared.length > 0 ? declared.map((c) => `'${c}'`).join(', ') : 'none';
}

/**
 * The save-time refusal for a code a body throws literally and the hook's
 * catalogue does not declare.
 */
export function undeclaredHookRefusalCodeAtSave(code: string, declared: readonly string[]): string {
  return (
    `\`body.source\` throws code '${code}', and this hook's \`refusals\` declares no such code `
    + `(declared: ${declaredList(declared)}). A hook that declares \`refusals\` refuses by code only, so the `
    + `throw is refused when the body runs. Declare it under \`refusals.${code}\` with the message the user `
    + 'reads, or throw one of the declared codes.'
  );
}

/**
 * The run-time refusal for a body throw the catalogue cannot answer: a code it
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
