// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31394] `dialectTextMatchSql` — the emitter contract the two faces rely on.
 *
 * The SQL each arm emits is pinned where it is executed and compared:
 * `driver-sql`'s text-match suites (every dialect, through knex) and
 * `service-analytics`' cross-run suites, which require the analytics compilers
 * to emit what the driver emits. What only this module can pin is the
 * PLUMBING both faces build on: the `'unknown'` dialect answers `null` before
 * either emitter is called, and the emitters are called left to right in the
 * order their references appear, so a positional binder stays aligned.
 */

import { describe, expect, it } from 'vitest';
import { dialectTextMatchSql, type TextMatchDialect, type TextMatchEmitters } from './text-match-sql.js';

/** Emitters that record every call, spelling each reference by its call order. */
function recorder(): { emit: TextMatchEmitters; calls: string[]; values: unknown[] } {
  const calls: string[] = [];
  const values: unknown[] = [];
  return {
    calls,
    values,
    emit: {
      column: () => {
        calls.push('column');
        return `C${calls.length}`;
      },
      value: (v) => {
        calls.push('value');
        values.push(v);
        return `V${calls.length}`;
      },
    },
  };
}

describe('[#31394] dialectTextMatchSql — the emitter contract', () => {
  it('answers null on `unknown`, and calls neither emitter', () => {
    const r = recorder();
    expect(dialectTextMatchSql({ dialect: 'unknown', shape: 'contains', value: 'a' }, r.emit)).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('calls the emitters in the order their references appear, on every arm', () => {
    const dialects: TextMatchDialect[] = ['sqlite', 'postgres', 'mysql', 'mssql', 'oracle'];
    for (const dialect of dialects) {
      for (const shape of ['contains', 'starts', 'ends'] as const) {
        for (const fold of [false, true]) {
          const r = recorder();
          const sql = dialectTextMatchSql({ dialect, shape, value: 'Ab', fold }, r.emit)!;
          // Every placeholder the SQL carries, in text order, is the call that
          // produced it — so a positional binder pushing in call order is aligned.
          const refs = [...sql.matchAll(/\b([CV])(\d+)\b/g)].map((m) => Number(m[2]));
          expect(refs, `${dialect} ${shape} fold=${fold}`).toEqual(refs.map((_, i) => i + 1));
          expect(refs.length, `${dialect} ${shape} fold=${fold}`).toBe(r.calls.length);
        }
      }
    }
  });

  it('binds the escape character on every LIKE arm, and SQL Server escapes `[` alone', () => {
    const likeArms: TextMatchDialect[] = ['postgres', 'mysql', 'mssql', 'oracle'];
    for (const dialect of likeArms) {
      const r = recorder();
      dialectTextMatchSql({ dialect, shape: 'contains', value: 'a[b%_\\' }, r.emit);
      expect(r.values, dialect).toEqual([
        dialect === 'mssql' ? '%a\\[b\\%\\_\\\\%' : '%a[b\\%\\_\\\\%',
        '\\',
      ]);
    }
  });
});
