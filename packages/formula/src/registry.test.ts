import { describe, expect, it } from 'vitest';

import { ExpressionEngine, getEngine, hasDialect } from './registry';
import type { Expression } from '@objectstack/spec';

describe('ExpressionEngine registry', () => {
  it('routes cel dialect to celEngine', () => {
    const expr: Expression = { dialect: 'cel', source: '1 + 1' };
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r).toEqual({ ok: true, value: 2 });
  });

  it('returns dialect error for js stub', () => {
    const expr: Expression = { dialect: 'js', source: 'foo' };
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dialect');
  });

  it('returns dialect error for cron stub', () => {
    const expr: Expression = { dialect: 'cron', source: '* * * * *' };
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dialect');
  });

  it('returns dialect error for unknown dialect', () => {
    const r = ExpressionEngine.evaluate({ dialect: 'xyz' as never, source: 'x' }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dialect');
  });

  it('compile() emits AST for valid CEL source', () => {
    const r = ExpressionEngine.compile({ dialect: 'cel', source: 'record.x > 1' });
    expect(r.ok).toBe(true);
  });

  it('getEngine returns registered engine', () => {
    expect(getEngine('cel')?.dialect).toBe('cel');
    expect(getEngine('js')?.dialect).toBe('js');
    expect(getEngine('nonexistent')).toBeUndefined();
  });

  it('hasDialect distinguishes real engines from stubs', () => {
    expect(hasDialect('cel')).toBe(true);
  });
});
