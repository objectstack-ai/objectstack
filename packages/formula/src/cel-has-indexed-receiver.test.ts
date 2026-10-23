// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { celEngine, firstUndeclaredReference, inferCelType, rewriteIndexedHas } from './cel-engine';
import { validateExpression } from './validate';

/**
 * #25267 — `has()` over a selection whose receiver is not a plain name.
 *
 * The CEL spec defines `has(e.f)` for any expression `e`; cel-js 8.0.0's macro
 * refused every receiver chain not rooted in an identifier with `has() invalid
 * argument`. Measured on `origin/main` 17f3c65a1d before the change:
 * `has(data.environments[0].storage.usedMb)` answered `ok: false` from
 * `evaluate`, `compile` and `validateExpression` alike, while a page's
 * `visibleWhen` (parse-only gate) published it and the console failed open.
 *
 * The engine now lowers that call to the spec's equivalent `e.?f.hasValue()`
 * ({@link rewriteIndexedHas}); these pins hold every door to one answer.
 */

const ENVIRONMENTS = { environments: [{ storage: { usedMb: 5 } }, { storage: {} }] };

function evaluate(source: string, extra: Record<string, unknown>) {
  return celEngine.evaluate({ dialect: 'cel', source }, { extra });
}

describe('has() over an indexed receiver evaluates as a presence test (#25267)', () => {
  it('the filed reading: present answers true, absent answers false', () => {
    expect(evaluate('has(data.environments[0].storage.usedMb)', { data: ENVIRONMENTS }))
      .toEqual({ ok: true, value: true });
    expect(evaluate('has(data.environments[1].storage.usedMb)', { data: ENVIRONMENTS }))
      .toEqual({ ok: true, value: false });
  });

  it('agrees with the `in` form the filing worked around with', () => {
    for (const at of [0, 1]) {
      const viaHas = evaluate(`has(data.environments[${at}].storage.usedMb)`, { data: ENVIRONMENTS });
      const viaIn = evaluate(`'usedMb' in data.environments[${at}].storage`, { data: ENVIRONMENTS });
      expect(viaHas).toEqual(viaIn);
    }
  });

  it('answers exactly what the identifier-rooted form answers, over every value kind', () => {
    // `has(v.…)` is cel-js's own macro (identifier root, untouched); `has(w[0].…)`
    // is the lowered form over the same value. Faults compare by kind and the
    // macro's first line, since the lowered source is echoed in the excerpt.
    const kinds: Record<string, unknown> = {
      'map with the key': { f: { g: 1 } },
      'map with the key null': { f: null },
      'map with the key false': { f: false },
      'map without the key': { h: 1 },
      'empty map': {},
      null: null,
      list: [1],
      int: 5,
      string: 's',
      bool: true,
    };
    const shape = (r: ReturnType<typeof evaluate>) =>
      r.ok ? { ok: true, value: r.value } : { ok: false, kind: r.error.kind, first: r.error.message.split('\n')[0] };
    for (const [kind, v] of Object.entries(kinds)) {
      for (const path of ['f', 'f.g']) {
        const native = shape(evaluate(`has(v.${path})`, { v, w: [v] }));
        const lowered = shape(evaluate(`has(w[0].${path})`, { v, w: [v] }));
        expect({ kind, path, ...lowered }).toEqual({ kind, path, ...native });
      }
    }
  });

  it('a receiver that is a call result is a receiver too', () => {
    expect(evaluate("has(dyn(m).a)", { m: { a: 1 } })).toEqual({ ok: true, value: true });
    expect(evaluate("has(dyn(m).b)", { m: { a: 1 } })).toEqual({ ok: true, value: false });
  });
});

describe('every door gives the same verdict (#25267)', () => {
  const lowered = 'has(record.items[0].name)';

  it('compile and validateExpression accept what evaluate runs', () => {
    expect(celEngine.compile(lowered).ok).toBe(true);
    expect(validateExpression('predicate', { dialect: 'cel', source: lowered }).ok).toBe(true);
    expect(celEngine.evaluate({ dialect: 'cel', source: lowered }, { record: { items: [{ name: 'x' }] } }))
      .toEqual({ ok: true, value: true });
  });

  it('the checker-backed helpers judge the lowered form', () => {
    expect(inferCelType(lowered)).toBe('bool');
    // The `has()` fault no longer takes the checker's one error slot, so a bare
    // reference behind it is reported instead of masked.
    expect(firstUndeclaredReference(`${lowered} && status == 'x'`)).toBe('status');
  });

  it('controls: an argument the spec refuses is still refused at every door', () => {
    for (const source of ['has(status)', 'has(record.items[0])']) {
      const compiled = celEngine.compile(source);
      expect(compiled.ok).toBe(false);
      expect(compiled.ok ? '' : compiled.error.message).toContain('has() invalid argument');
      expect(validateExpression('predicate', { dialect: 'cel', source }).ok).toBe(false);
      const ran = celEngine.evaluate({ dialect: 'cel', source }, { record: { items: [{ name: 'x' }] } });
      expect(ran.ok).toBe(false);
    }
  });
});

describe('rewriteIndexedHas (#25267)', () => {
  it('lowers only a `has()` whose selection is rooted in something other than a name', () => {
    expect(rewriteIndexedHas('has(a[0].b.c)')).toBe('a[0].b.?c.hasValue()');
    expect(rewriteIndexedHas('has(a[0].b) && has(c.d)')).toBe('a[0].?b.hasValue() && has(c.d)');
    for (const untouched of ['has(record.a.b)', 'has(status)', 'has(a[0])', "x.has('y')", 'record.has_items']) {
      expect(rewriteIndexedHas(untouched)).toBe(untouched);
    }
  });

  it('is idempotent, and lowers a `has()` nested in a lowered receiver', () => {
    const once = rewriteIndexedHas('has(a[has(b[0].c) ? 0 : 1].d)');
    expect(once).not.toContain('has(');
    expect(rewriteIndexedHas(once)).toBe(once);
  });
});
