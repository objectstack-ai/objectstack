// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { buildEnv, celEngine } from './cel-engine';
import { buildScope } from './stdlib';
import type { EvalContext, EvalResult } from './types';

/**
 * #24536 — a cached program is never run twice at once.
 *
 * cel-js keeps a comprehension's iteration context (`args.iterCtx`) and
 * `cel.bind`'s binding context (`bindCtx`) ON THE AST, and every run
 * re-parents that overlay to its own scope. With one cached program per
 * source, an evaluation re-entered from inside its own comprehension or bind
 * (here: a scope getter that evaluates the SAME source for another subject)
 * would re-parent the outer run's overlay, and the outer run would read the
 * inner run's `current_user`. Each case below answers for the OUTER subject,
 * exactly as a fresh parse does.
 */

const ALICE = { id: 'usr_alice', positions: [] };
const BOB = { id: 'usr_bob', positions: [] };

function evaluate(source: string, ctx: EvalContext): EvalResult<unknown> {
  return celEngine.evaluate({ dialect: 'cel', source }, ctx);
}

/** What a fresh parse on a fresh environment answers, with the same scope. */
function freshAnswer(source: string, ctx: EvalContext): unknown {
  return buildEnv(() => new Date(0)).evaluate(source, buildScope(ctx));
}

/**
 * A value whose `probe` getter first evaluates `source` for BOB, on a record
 * that does not nest again, and then reads true.
 */
function probing(source: string, bobRecord: Record<string, unknown>): Record<string, unknown> {
  return Object.defineProperty({}, 'probe', {
    enumerable: true,
    get: () => {
      evaluate(source, { user: BOB, record: bobRecord });
      return true;
    },
  });
}

describe('#24536 — the same source re-entered from inside its own run', () => {
  it('inside exists(…): the outer step still reads the outer subject', () => {
    const source = "record.items.exists(i, i.probe && current_user.id == 'usr_alice')";
    const bobRecord = { items: [{ probe: true }] };
    const ctx = (): EvalContext => ({ user: ALICE, record: { items: [probing(source, bobRecord)] } });
    expect(freshAnswer(source, ctx())).toBe(true);
    // Warm the cache first, so the nested run meets a cached program.
    expect(evaluate(source, { user: ALICE, record: bobRecord })).toEqual({ ok: true, value: true });
    for (let i = 0; i < 3; i++) expect(evaluate(source, ctx())).toEqual({ ok: true, value: true });
  });

  it('inside map(…): every element is computed for the outer subject', () => {
    const source = 'record.items.map(i, i.probe ? current_user.id : "")';
    const bobRecord = { items: [{ probe: true }] };
    const ctx = (): EvalContext => ({ user: ALICE, record: { items: [probing(source, bobRecord), probing(source, bobRecord)] } });
    expect(freshAnswer(source, ctx())).toEqual(['usr_alice', 'usr_alice']);
    evaluate(source, { user: ALICE, record: bobRecord });
    expect(evaluate(source, ctx())).toEqual({ ok: true, value: ['usr_alice', 'usr_alice'] });
  });

  it('inside cel.bind(…): the bound expression still reads the outer subject', () => {
    const source = "cel.bind(p, record.box.probe, p && current_user.id == 'usr_alice')";
    const bobRecord = { box: { probe: true } };
    const ctx = (): EvalContext => ({ user: ALICE, record: { box: probing(source, bobRecord) } });
    expect(freshAnswer(source, ctx())).toBe(true);
    expect(evaluate(source, { user: ALICE, record: bobRecord })).toEqual({ ok: true, value: true });
    for (let i = 0; i < 3; i++) expect(evaluate(source, ctx())).toEqual({ ok: true, value: true });
  });

  it('the inner run answers for its own subject too (BOB is not ALICE)', () => {
    const source = "record.items.exists(i, i.probe && current_user.id == 'usr_alice')";
    expect(evaluate(source, { user: BOB, record: { items: [{ probe: true }] } })).toEqual({ ok: true, value: false });
  });
});
