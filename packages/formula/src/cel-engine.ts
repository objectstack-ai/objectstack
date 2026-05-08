/**
 * CEL dialect engine — wraps `@marcbachmann/cel-js` with the ObjectStack
 * stdlib, bounded execution limits, and result coercion.
 *
 * Why a thin wrapper:
 *
 *  - cel-js returns `BigInt` for ints. The kernel and CRM expect plain
 *    numbers, so we coerce at the boundary.
 *  - cel-js parses dotted names as receiver-typed methods; we register
 *    `now()`, `today()`, `daysFromNow()` as bare functions and let `os.*`
 *    refer to context data only (see {@link buildScope}).
 *  - Bounds (`maxAstNodes`, `maxDepth`, …) are enforced spec-wide so
 *    third-party plugins can't ship runaway predicates.
 */

import { Environment } from '@marcbachmann/cel-js';
import type { Expression } from '@objectstack/spec';

import { buildScope, registerStdLib } from './stdlib';
import type { DialectEngine, EvalContext, EvalResult } from './types';

/**
 * Default execution bounds. Picked conservatively — every metadata-authored
 * expression we've seen is well under these. If you hit them, the expression
 * is too complex for ObjectStack and should be moved to a hook (`dialect: js`).
 */
export const DEFAULT_LIMITS = {
  maxAstNodes: 256,
  maxDepth: 32,
  maxListElements: 64,
  maxMapEntries: 64,
  maxCallArguments: 16,
} as const;

function buildEnv(now: () => Date): Environment {
  const env = new Environment({
    unlistedVariablesAreDyn: true,
    enableOptionalTypes: true,
    limits: DEFAULT_LIMITS,
  });
  return registerStdLib(env, now);
}

/** Coerce cel-js's BigInt-flavored return into spec-friendly JS values. */
function coerce(value: unknown): unknown {
  if (typeof value === 'bigint') {
    // BigInt → number when safe, else string to avoid silent truncation.
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(coerce);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = coerce(v);
    return out;
  }
  return value;
}

function classifyError(err: unknown): EvalResult<never> {
  const message = err instanceof Error ? err.message : String(err);
  let kind: 'parse' | 'type' | 'runtime' | 'bounds' = 'runtime';
  if (/Exceeded max/i.test(message)) kind = 'bounds';
  else if (/parse|unexpected|syntax/i.test(message)) kind = 'parse';
  else if (/type|unknown variable|undeclared/i.test(message)) kind = 'type';
  return { ok: false, error: { kind, message } };
}

export const celEngine: DialectEngine = {
  dialect: 'cel',

  compile(source: string): EvalResult<unknown> {
    try {
      // We use a wall-clock now() here purely for parse-time stdlib
      // type-checking; the function is never actually called.
      const env = buildEnv(() => new Date(0));
      const compiled = env.parse(source);
      // Surface check errors eagerly.
      const checkErrors = compiled.check?.();
      if (checkErrors && Array.isArray(checkErrors) && checkErrors.length > 0) {
        return {
          ok: false,
          error: { kind: 'type', message: checkErrors.join('; ') },
        };
      }
      return { ok: true, value: compiled.ast };
    } catch (err) {
      return classifyError(err);
    }
  },

  evaluate<T = unknown>(expr: Expression, ctx: EvalContext): EvalResult<T> {
    if (expr.dialect !== 'cel') {
      return {
        ok: false,
        error: { kind: 'dialect', message: `celEngine cannot evaluate dialect '${expr.dialect}'` },
      };
    }
    const source = expr.source;
    if (typeof source !== 'string' || source.length === 0) {
      // AST-only inputs: cel-js does not currently expose a public API to
      // re-execute a parsed AST without re-serializing. We persist `source`
      // as the canonical form during M9.1 and revisit AST-only execution in
      // M9.7 when we cut the spec persistence over.
      return {
        ok: false,
        error: { kind: 'parse', message: 'AST-only evaluation not yet supported; persist `source`' },
      };
    }

    const now = () => ctx.now ?? new Date();
    try {
      const env = buildEnv(now);
      const scope = buildScope(ctx);
      const raw = env.evaluate(source, scope);
      return { ok: true, value: coerce(raw) as T };
    } catch (err) {
      return classifyError(err);
    }
  },
};
