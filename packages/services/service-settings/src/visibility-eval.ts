// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Evaluator for the restricted visibility expressions used by settings
 * manifests, e.g. `"${data.provider === 'cloudflare'}"` or
 * `"${data.embedder_provider && data.embedder_provider !== 'none'}"`.
 *
 * The server needs these at save time so `setMany` can enforce `required`
 * only on fields that are actually visible for the current provider —
 * a half-filled Cloudflare form must be rejected, while OpenAI fields
 * stay irrelevant. The console UI evaluates the same strings client-side;
 * this is deliberately NOT a general JS evaluator, just the tiny grammar
 * the manifests use:
 *
 *   orExpr   := andExpr ('||' andExpr)*
 *   andExpr  := unary ('&&' unary)*
 *   unary    := '!' unary | comparison
 *   compare  := primary (('===' | '!==' | '==' | '!=' |
 *                         '>=' | '<=' | '>' | '<') primary)?
 *   primary  := '(' orExpr ')' | string | number | true | false | null | data.<ident>
 *
 * ## The relational operators are here because a manifest already used one
 *
 * `>` / `>=` / `<` / `<=` were added in #7169, not speculatively: the auth
 * manifest ships `visible: '${data.lockout_threshold > 0}'`, the console's
 * client-side evaluator (a `new Function(...)` over the same string) rendered
 * it correctly, and THIS grammar refused it — so the save path threw and, under
 * the lenient contract this header used to state, skipped the whole
 * `lockout_duration_minutes` specifier. Measured on `origin/main`: that key
 * declares `min: 1, max: 1440` and accepted `-5` and `99999`, while its
 * `visible`-free sibling `rate_limit_max` was refused correctly. The two
 * evaluators disagreeing about what parses IS the bug class this file sits in,
 * so the server grammar catches up to the operator the manifests demonstrably
 * reach for, with JS relational semantics — the console's — deliberately.
 *
 * ## Callers must fail CLOSED (#7169, maintainer ruling 2026-08-10)
 *
 * Anything outside the grammar throws `VisibilityParseError`. This header used
 * to tell callers to treat that as "cannot determine visibility" and skip
 * validation for the field, lenient. That is exactly backwards for a save-time
 * gate: `visible` does not gate one check, it gates EVERY check on the
 * specifier (`required`, `options`, `pattern`, `valueDomain`, the value
 * window), so a predicate this evaluator cannot parse silently switches all of
 * them off. A caller enforcing declared constraints MUST refuse the write and
 * report the parse failure — see `validatePatch` in `settings-service.ts`.
 */

export class VisibilityParseError extends Error {
  constructor(
    /** The unwrapped predicate source that failed to parse. */
    readonly source: string,
    /** Why it failed, without the surrounding sentence — for embedding in a caller's own message. */
    readonly detail: string,
  ) {
    super(`Cannot parse visibility expression "${source}": ${detail}`);
    this.name = 'VisibilityParseError';
  }
}

type Token =
  | {
      kind: 'punct';
      value: '(' | ')' | '!' | '&&' | '||' | '===' | '!==' | '==' | '!=' | '>=' | '<=' | '>' | '<';
    }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'keyword'; value: boolean | null }
  | { kind: 'ref'; value: string };

/**
 * The comparison operators, longest-first so `>=` is never tokenized as `>`
 * followed by a stray `=`. `!` is matched separately (after this list) for the
 * same reason: `!==` and `!=` must win over the unary `!`.
 */
const COMPARISON_OPERATORS = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'] as const;
type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/**
 * Unwrap the manifest forms a `visible` field can take: a bare string,
 * a `${…}` template string, or a `{ dialect, source }` envelope.
 */
export function visibilitySource(visible: unknown): string | undefined {
  let src: string | undefined;
  if (typeof visible === 'string') src = visible;
  else if (visible && typeof visible === 'object' && typeof (visible as { source?: unknown }).source === 'string') {
    src = (visible as { source: string }).source;
  }
  if (src === undefined) return undefined;
  const trimmed = src.trim();
  if (trimmed.startsWith('${') && trimmed.endsWith('}')) return trimmed.slice(2, -1).trim();
  return trimmed;
}

/** `data.*` keys referenced by a visibility expression (regex-level scan). */
export function referencedKeys(visible: unknown): string[] {
  const src = visibilitySource(visible);
  if (!src) return [];
  return [...src.matchAll(/data\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { tokens.push({ kind: 'punct', value: ch }); i++; continue; }
    let matchedOp = false;
    for (const op of [...COMPARISON_OPERATORS, '&&', '||'] as const) {
      if (expr.startsWith(op, i)) {
        tokens.push({ kind: 'punct', value: op });
        i += op.length;
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;
    if (ch === '!') { tokens.push({ kind: 'punct', value: '!' }); i++; continue; }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < expr.length && expr[j] !== quote) {
        if (expr[j] === '\\' && j + 1 < expr.length) { out += expr[j + 1]; j += 2; }
        else { out += expr[j]; j++; }
      }
      if (j >= expr.length) throw new VisibilityParseError(expr, 'unterminated string');
      tokens.push({ kind: 'string', value: out });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(expr.slice(i))!;
      tokens.push({ kind: 'number', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(expr.slice(i))!;
      const word = m[0];
      if (word === 'true') tokens.push({ kind: 'keyword', value: true });
      else if (word === 'false') tokens.push({ kind: 'keyword', value: false });
      else if (word === 'null') tokens.push({ kind: 'keyword', value: null });
      else if (word.startsWith('data.')) {
        const key = word.slice('data.'.length);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new VisibilityParseError(expr, `unsupported reference "${word}"`);
        tokens.push({ kind: 'ref', value: key });
      } else throw new VisibilityParseError(expr, `unsupported identifier "${word}"`);
      i += word.length;
      continue;
    }
    throw new VisibilityParseError(expr, `unexpected character "${ch}"`);
  }
  return tokens;
}

/**
 * Evaluate a visibility expression against the merged form data.
 * Throws {@link VisibilityParseError} for anything outside the grammar.
 */
export function evaluateVisibility(visible: unknown, data: Record<string, unknown>): boolean {
  const src = visibilitySource(visible);
  if (!src) return true;
  const tokens = tokenize(src);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const eat = (value: string): boolean => {
    const t = tokens[pos];
    if (t?.kind === 'punct' && t.value === value) { pos++; return true; }
    return false;
  };

  function primary(): unknown {
    const t = peek();
    if (!t) throw new VisibilityParseError(src!, 'unexpected end of expression');
    if (t.kind === 'punct' && t.value === '(') {
      pos++;
      const v = orExpr();
      if (!eat(')')) throw new VisibilityParseError(src!, 'missing closing parenthesis');
      return v;
    }
    if (t.kind === 'string' || t.kind === 'number' || t.kind === 'keyword') { pos++; return t.value; }
    if (t.kind === 'ref') { pos++; return data[t.value]; }
    throw new VisibilityParseError(src!, `unexpected token`);
  }

  function comparison(): unknown {
    const left = primary();
    const t = peek();
    if (t?.kind === 'punct' && (COMPARISON_OPERATORS as readonly string[]).includes(t.value)) {
      const op = t.value as ComparisonOperator;
      pos++;
      const right = primary();
      switch (op) {
        // Loose == / != are treated as strict — manifest values are
        // primitives written by hand; the distinction never matters here.
        case '===':
        case '==':
          return left === right;
        case '!==':
        case '!=':
          return left !== right;
        // Relational comparison uses JS semantics on the raw operands, on
        // purpose (#7169): the console evaluates the SAME manifest string
        // through `new Function`, and a server evaluator that disagreed with it
        // about `data.lockout_threshold > 0` would be the very producer/consumer
        // split this file's caller now refuses. `undefined > 0` is `false`
        // there and `false` here.
        case '>':
          return (left as number) > (right as number);
        case '>=':
          return (left as number) >= (right as number);
        case '<':
          return (left as number) < (right as number);
        case '<=':
          return (left as number) <= (right as number);
      }
    }
    return left;
  }

  function unary(): unknown {
    if (eat('!')) return !unary();
    return comparison();
  }

  function andExpr(): unknown {
    let v = unary();
    while (eat('&&')) {
      const r = unary();
      v = v && r;
    }
    return v;
  }

  function orExpr(): unknown {
    let v = andExpr();
    while (eat('||')) {
      const r = andExpr();
      v = v || r;
    }
    return v;
  }

  const result = orExpr();
  if (pos !== tokens.length) throw new VisibilityParseError(src, 'trailing tokens');
  return Boolean(result);
}
