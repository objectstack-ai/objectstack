/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11262 — ADR-0137 D4 on the two CORE paths that still answered a
 * blank gate in silence after objectui#8069: a gate predicate that is blank is
 * "diagnosed, never a silent `true`".
 *
 *   1. `ExpressionEvaluator.evaluateCondition`'s LEGACY path. objectui#8069
 *      diagnosed the `{ dialect: 'cel' }` route only; a bare string and an
 *      envelope without `dialect` took the legacy path, whose `if (!condition)`
 *      and whitespace-only `trim()` returned `true` before anything could say
 *      so. `SchemaRenderer`'s `visibleWhen` / `visible` / `visibleOn` /
 *      `visibility` legs hand it the raw authored value, so this is the path a
 *      page author reaches.
 *   2. `evalRowPredicate`'s bare-blank fallback (`listConditional.ts`). A blank
 *      ENVELOPE already reached `evalFieldPredicate`'s `[blank]` report; a
 *      blank STRING returned the caller's fallback one line earlier.
 *
 * ## What each row pins
 *
 * The VERDICT does not move (D3/D4: a blank gate is "no gate") and the silence
 * ends, so every row asserts both halves. The report is the one channel
 * objectui#8069 put on the `dialect: 'cel'` route — `evalFieldPredicate`'s
 * `[blank]` reason — which the rows read by its tag, never by its prose.
 *
 * The "one diagnosis point" rows are what distinguish ONE guard from a second
 * blank test with its own reporter: a blank spelled on the legacy path and the
 * same blank spelled on the CEL route land on the same dedupe key, so they
 * print one line between them. A second reporter prints two.
 *
 * ## Fresh module graph per case
 *
 * The one-time warning dedupe is MODULE state and the `unit` project runs with
 * `isolate: false`, so a blank spelling another file already warned about
 * would read as silence here. `vi.resetModules()` + fresh imports give every
 * case its own dedupe `Set` — the shape `fieldRuleFaults-8069.test.ts` uses.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let ExpressionEvaluator: typeof import('../ExpressionEvaluator.js').ExpressionEvaluator;
let evalRowPredicate: typeof import('../listConditional.js').evalRowPredicate;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  ({ ExpressionEvaluator } = await import('../ExpressionEvaluator.js'));
  ({ evalRowPredicate } = await import('../listConditional.js'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const warnings = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));
const blankLines = (): string[] => warnings().filter((w) => w.includes('[blank]'));

/** The three blank spellings the triage names, on every path. */
const BLANKS = [
  ['an empty string', ''],
  ['a whitespace string', ' \t '],
  ["{ source: '' }", { source: '' }],
] as const;

describe('path 1 — evaluateCondition’s legacy path diagnoses a blank gate (objectui#11262, ADR-0137 D4)', () => {
  it.each(BLANKS)('%s: still true ("no gate"), and now said once', (_label, gate) => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition(gate)).toBe(true);
    expect(ev.evaluateCondition(gate)).toBe(true);
    expect(blankLines()).toHaveLength(1);
  });

  it.each(BLANKS)('%s: the [blank] reason goes to onFault instead, when the caller supplies one', (_label, gate) => {
    const reasons: string[] = [];
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition(gate, { onFault: (r) => reasons.push(r) })).toBe(true);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^\[blank\]/);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(BLANKS)('%s: throwOnError does not throw on it — nothing was authored that could fault — and it is still said', (_label, gate) => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition(gate, { throwOnError: true })).toBe(true);
    expect(blankLines()).toHaveLength(1);
  });

  it('one diagnosis point: a blank on the legacy path and its dialect: cel twin print ONE line between them', () => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition('')).toBe(true);
    expect(blankLines()).toHaveLength(1);
    expect(ev.evaluateCondition({ dialect: 'cel', source: '' })).toBe(true);
    expect(ev.evaluateCondition({ source: '' })).toBe(true);
    expect(blankLines()).toHaveLength(1);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ] as const)('control — %s is no gate at all, not blank TEXT: true and silent', (_label, gate) => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition(gate as never)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('control — a written legacy gate answers its own verdict and is silent', () => {
    const ev = new ExpressionEvaluator({ data: { stage: 'open' } });
    expect(ev.evaluateCondition("${data.stage === 'open'}")).toBe(true);
    expect(ev.evaluateCondition("${data.stage === 'won'}")).toBe(false);
    expect(ev.evaluateCondition('1 > 2')).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('path 2 — evalRowPredicate diagnoses a bare blank instead of returning its fallback in silence (objectui#11262)', () => {
  const ROUTES = [
    ['the single-eval route', false],
    ['the labelled fail-closed route (warnOnError)', true],
  ] as const;

  describe.each(ROUTES)('%s', (_route, warnOnError) => {
    it.each(BLANKS)('%s: the caller’s fallback, both directions, and a [blank] report', (_label, pred) => {
      const opts = { warnOnError, label: 'row action "archive_11262"' };
      expect(evalRowPredicate(pred as never, { a: 1 }, { ...opts, fallback: true })).toBe(true);
      expect(evalRowPredicate(pred as never, { a: 1 }, { ...opts, fallback: false })).toBe(false);
      // One line for both calls: the dedupe keys on the text and the label,
      // never on the fallback.
      const lines = blankLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('archive_11262');
    });

    it('one diagnosis point: the bare blank takes its envelope twin’s route — one line between them', () => {
      const opts = { warnOnError, fallback: false, label: 'formatting rule 11262' };
      evalRowPredicate('', { a: 1 }, opts);
      expect(blankLines()).toHaveLength(1);
      evalRowPredicate({ source: '' } as never, { a: 1 }, opts);
      evalRowPredicate('', { a: 2 }, opts);
      expect(blankLines()).toHaveLength(1);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ] as const)('control — %s is no predicate: the fallback, silent', (_label, pred) => {
      expect(evalRowPredicate(pred, { a: 1 }, { warnOnError, fallback: true })).toBe(true);
      expect(evalRowPredicate(pred, { a: 1 }, { warnOnError, fallback: false })).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });

    it('control — a written predicate answers its own verdict and is silent', () => {
      expect(evalRowPredicate('record.a == 1', { a: 1 }, { warnOnError, fallback: false })).toBe(true);
      expect(evalRowPredicate('record.a == 1', { a: 2 }, { warnOnError, fallback: true })).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('rowless (a param dialog) takes the same guard — the fallback, and the report', () => {
    expect(evalRowPredicate('   ', null, { rowless: true, fallback: true, warnOnError: true, label: 'param "p_11262"' })).toBe(true);
    expect(blankLines()).toHaveLength(1);
  });
});
