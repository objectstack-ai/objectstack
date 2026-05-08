/**
 * Dialect-pluggable Expression engine registry.
 *
 * Replaces the per-call-site `compileFormula` / `evaluateFormula` direct
 * imports of the deleted custom engine. Call sites now ask the registry to
 * dispatch by `expression.dialect`.
 *
 * Stub dialects (`js`, `cron`) are registered at module load with explicit
 * `dialect`-error responses so call sites get a clear message instead of
 * silent `undefined` (the old engine's anti-pattern).
 */

import type { Expression } from '@objectstack/spec';

import { celEngine } from './cel-engine';
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

/** Whether a dialect has a real (non-stub) implementation registered. */
export function hasDialect(dialect: string): boolean {
  return registry.has(dialect) && !registry.get(dialect)!.dialect.startsWith('stub:');
}

function makeStub(dialect: string, reason: string): DialectEngine {
  return {
    dialect,
    compile: () => ({ ok: false, error: { kind: 'dialect', message: reason } }),
    evaluate: () => ({ ok: false, error: { kind: 'dialect', message: reason } }),
  };
}

// Real engines.
register(celEngine);

// Stubs — phased in by later milestones (M9.5+ for `js`, M9.6 for `cron`).
register(makeStub('js', "dialect 'js' not registered. Install @objectstack/plugin-js-vm"));
register(makeStub('cron', "dialect 'cron' not registered. Install @objectstack/plugin-cron"));

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
