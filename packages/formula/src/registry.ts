/**
 * Dialect-pluggable Expression engine registry.
 *
 * Replaces the per-call-site `compileFormula` / `evaluateFormula` direct
 * imports of the deleted custom engine. Call sites now ask the registry to
 * dispatch by `expression.dialect`.
 *
 * Three real engines are registered at module load: `cel`, `cron`, `template`.
 * An unregistered dialect yields an explicit `dialect`-kind error from
 * `evaluate` / `compile` (never a silent `undefined` — the old engine's
 * anti-pattern). There is deliberately no `js` expression engine: procedural JS
 * is the L2 `ScriptBody { language: 'js' }` surface, not an expression dialect
 * (retired in #3278; see ADR-0058 addendum).
 */

import type { Expression } from '@objectstack/spec';

import { celEngine } from './cel-engine';
import { cronEngine } from './cron-engine';
import { templateEngine } from './template-engine';
import type { DialectEngine, EvalContext, EvalResult } from './types';

const registry = new Map<string, DialectEngine>();

/** Register or replace a dialect engine. */
export function register(engine: DialectEngine): void {
  registry.set(engine.dialect, engine);
}

/** Look up a dialect engine without dispatching. */
export function getEngine(dialect: string): DialectEngine | undefined {
  return registry.get(dialect);
}

/** Whether a real engine is registered for this dialect. */
export function hasDialect(dialect: string): boolean {
  return registry.has(dialect);
}

// Real engines. Every registered dialect is a real engine — there are no stubs;
// an unregistered dialect surfaces a `dialect`-kind error at the call site.
register(celEngine);
register(cronEngine);
register(templateEngine);

/**
 * The unified evaluation entry point. Replaces the old direct calls to
 * `evaluateFormula` from the deleted custom engine.
 */
export const ExpressionEngine = {
  register,
  getEngine,
  hasDialect,

  /**
   * Compile-only — parse + type-check, returning the engine-native AST. Used
   * by `objectstack compile` to normalize source into AST in artifacts.
   */
  compile(expr: Expression): EvalResult<unknown> {
    const engine = registry.get(expr.dialect);
    if (!engine) {
      return {
        ok: false,
        error: { kind: 'dialect', message: `No engine registered for dialect '${expr.dialect}'` },
      };
    }
    if (typeof expr.source !== 'string') {
      return {
        ok: false,
        error: { kind: 'parse', message: 'Expression.source required for compile()' },
      };
    }
    return engine.compile(expr.source);
  },

  /**
   * Evaluate an expression in the given context. Never throws — branch on
   * `result.ok`. Errors carry a `kind` for caller-side classification.
   */
  evaluate<T = unknown>(expr: Expression, ctx: EvalContext): EvalResult<T> {
    const engine = registry.get(expr.dialect);
    if (!engine) {
      return {
        ok: false,
        error: { kind: 'dialect', message: `No engine registered for dialect '${expr.dialect}'` },
      };
    }
    return engine.evaluate<T>(expr, ctx);
  },
};
