import { describe, expect, it } from 'vitest';

import { ExpressionEngine, getEngine, hasDialect } from './registry';
import type { Expression } from '@objectstack/spec';

describe('ExpressionEngine registry', () => {
  it('routes cel dialect to celEngine', () => {
    const expr: Expression = { dialect: 'cel', source: '1 + 1' };
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r).toEqual({ ok: true, value: 2 });
  });

  it("returns dialect error for the retired 'js' expression dialect (#3278)", () => {
    // `js` is no longer a valid ExpressionDialect — cast past the narrowed type
    // to exercise the runtime path a stale persisted artifact would hit.
    const expr = { dialect: 'js', source: 'foo' } as unknown as Expression;
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('dialect');
  });

  it('routes cron dialect to cronEngine (validates schedule)', () => {
    const expr: Expression = { dialect: 'cron', source: '* * * * *' };
    const r = ExpressionEngine.evaluate(expr, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('* * * * *');
  });

  it('cron rejects malformed source', () => {
    const r = ExpressionEngine.evaluate({ dialect: 'cron', source: 'not a cron' }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('parse');
  });

  it('routes template dialect to templateEngine', () => {
    const r = ExpressionEngine.evaluate(
      { dialect: 'template', source: 'Hello {{record.name}}' },
      { record: { name: 'World' } },
    );
    expect(r).toEqual({ ok: true, value: 'Hello World' });
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
    expect(getEngine('js')).toBeUndefined(); // retired (#3278)
    expect(getEngine('nonexistent')).toBeUndefined();
  });

  it('hasDialect reports only registered real engines', () => {
    expect(hasDialect('cel')).toBe(true);
    expect(hasDialect('cron')).toBe(true);
    expect(hasDialect('template')).toBe(true);
    // Retired (#3278) — this assertion is what makes the gate able to go red;
    // before the fix `hasDialect('js')` returned a false-positive `true`.
    expect(hasDialect('js')).toBe(false);
    expect(hasDialect('nonexistent')).toBe(false);
  });
});
