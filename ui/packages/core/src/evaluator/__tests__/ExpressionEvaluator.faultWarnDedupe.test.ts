/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6444 — the built-in fault warnings of `evaluate` are rate limited to
 * ONE line per authored source, like both sibling reporters already are.
 *
 * ## The defect, measured on the built evaluator at `830ed5803`
 *
 * `evaluateCondition('${nosuchroot.x > 1}')` three times in a row produced
 * **3** console lines, where the `{ dialect: 'cel' }` envelope produced **1**
 * for the same three calls. `evaluate` is the hottest of the three paths —
 * `SchemaRenderer` calls it for every `properties.*` value, every `props.*`
 * value and `content`, for every node, on every render — so ONE broken `${…}`
 * prop in a 200-row list was 200 console lines per render, and 200 more on the
 * next one.
 *
 * ## What these cells have to measure, and why one direction is not enough
 *
 * "Two faults from the same source log once" passes just as well if the dedupe
 * silenced everything; "two faults from different sources log twice" passes
 * just as well if it deduped nothing. Only the pair measures the GRANULARITY,
 * so both are pinned below — plus the cell that discriminates the granularity
 * actually chosen: the same source across MANY DIFFERENT SCOPES is still one
 * line. That third cell is the card's open point (source text alone vs source +
 * scope) settled as a measurement: the 200-row flood is one authored source
 * against 200 distinct scopes, so a scope-sensitive key emits all 200 lines
 * again and fixes nothing.
 *
 * Every cell also asserts that the evaluation REALLY happened and returned its
 * documented fail-soft value — a "only one warn" pin passes vacuously if the
 * evaluator stopped being called or stopped faulting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type EvaluatorModule = typeof import('../ExpressionEvaluator.js');

/**
 * The dedupe under test is MODULE state, and module state outlives a test case:
 * without this reset the second cell to fault on a given source reads the first
 * cell's entry, sees silence, and passes having checked nothing. `vi.resetModules()`
 * + a fresh dynamic import gives every cell its own `Set` — and the last cell in
 * this file proves that this reset genuinely resets, rather than assuming it.
 * (Cells also use distinct source texts, so the discipline does not rest on the
 * hook alone.)
 */
let mod: EvaluatorModule;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  mod = await import('../ExpressionEvaluator.js');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SCOPE = { record: { id: 1, status: 'open' }, data: { total: 99 } };
const make = (scope: Record<string, unknown> = SCOPE) => new mod.ExpressionEvaluator(scope);
const lines = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

describe('#6444 — one authoring mistake, one loud line', () => {
  it('SAME source, three evaluations: ONE line — and all three evaluations really ran and really faulted', () => {
    const src = '${nosuchroot.dedupe_same > 1}';
    const e = make();

    const verdicts = [e.evaluateCondition(src), e.evaluateCondition(src), e.evaluateCondition(src)];

    // The fault happened every time: the documented fail-OPEN verdict, three times.
    expect(verdicts).toEqual([true, true, true]);
    // And the evaluator is still doing its job in the same run — so the single
    // line is a rate limit, not a stopped evaluator.
    expect(e.evaluate('Total: ${data.total}')).toBe('Total: 99');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toBe('Failed to evaluate expression: ${nosuchroot.dedupe_same > 1}');
  });

  it('DIFFERENT sources: each still gets its own line — the dedupe is not blanket silence', () => {
    const e = make();

    expect(e.evaluateCondition('${nosuchroot.distinct_a > 1}')).toBe(true);
    expect(e.evaluateCondition('${nosuchroot.distinct_b > 1}')).toBe(true);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(lines()).toEqual([
      'Failed to evaluate expression: ${nosuchroot.distinct_a > 1}',
      'Failed to evaluate expression: ${nosuchroot.distinct_b > 1}',
    ]);
  });

  it('THE OPEN POINT: one source across 200 DIFFERENT scopes is ONE line — the 200-row list from the card', () => {
    // This is the cell that separates the two candidate keyings. Keyed on the
    // source TEXT (what shipped) this is 1; keyed on source + scope it is 200,
    // which is the defect verbatim.
    const src = 'Row ${record.id}: ${nosuchroot.row_total}';
    const rendered: string[] = [];
    for (let row = 0; row < 200; row++) {
      rendered.push(make({ record: { id: row }, data: { total: 99 } }).evaluate(src) as string);
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(lines()[0]).toBe('Expression evaluation failed for: nosuchroot.row_total');

    // 200 real evaluations against 200 real scopes: the healthy half of the
    // template interpolates each row's OWN id, and the faulting half returns
    // its source verbatim (the documented fail-soft value for a template part).
    expect(rendered).toHaveLength(200);
    expect(rendered[0]).toBe('Row 0: ${nosuchroot.row_total}');
    expect(rendered[199]).toBe('Row 199: ${nosuchroot.row_total}');
    expect(new Set(rendered).size).toBe(200);
  });

  it('the two fault SITES report independently and keep their own message text', () => {
    // `evaluate` has two built-in fault paths: one PART of a multi-part
    // template failing, and the WHOLE expression failing. They are different
    // faults, so the dedupe key is tagged with the site and neither can
    // silence the other. Message texts are unchanged from before #6444.
    const e = make();

    expect(e.evaluate('a ${nosuchroot.site_part} b')).toBe('a ${nosuchroot.site_part} b');
    expect(e.evaluate('${nosuchroot.site_whole}')).toBe('${nosuchroot.site_whole}');

    expect(lines()).toEqual([
      'Expression evaluation failed for: nosuchroot.site_part',
      'Failed to evaluate expression: ${nosuchroot.site_whole}',
    ]);
  });

  it('a HEALTHY expression never warns — the silence that makes one line mean something', () => {
    const e = make();
    expect(e.evaluate('Total: ${data.total}')).toBe('Total: 99');
    expect(e.evaluate('${record.status}')).toBe('open');
    expect(e.evaluateCondition("${record.status == 'open'}")).toBe(true);
    expect(e.evaluateCondition("${record.status == 'closed'}")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('#6444 — the rate limit governs the built-in line ONLY', () => {
  it('`onFault` still fires on EVERY fault for the same source — the passback contract is unmoved', () => {
    // `fieldRules.ts` documents this for the canonical engine ("independent of
    // … the one-time-warning dedupe: it fires on every fault, so a caller doing
    // its own warn-once bookkeeping keeps control of it"). A caller that reports
    // per node must not have its faults swallowed by THIS module's bookkeeping.
    const src = '${nosuchroot.passback > 1}';
    const reasons: string[] = [];
    const e = make();

    for (let i = 0; i < 3; i++) {
      expect(e.evaluateCondition(src, { onFault: (r) => reasons.push(r) })).toBe(true);
    }

    expect(reasons).toHaveLength(3);
    expect(reasons.every((r) => r.includes('nosuchroot'))).toBe(true);
    // Supplying `onFault` still suppresses the built-in line entirely (#6038).
    expect(warn).not.toHaveBeenCalled();
  });

  it('`throwOnError` still throws on EVERY evaluation — the fail-closed signal is not rate limited', () => {
    const src = '${nosuchroot.failclosed > 1}';
    const e = make();

    expect(() => e.evaluateCondition(src, { throwOnError: true })).toThrow();
    expect(() => e.evaluateCondition(src, { throwOnError: true })).toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('#6444 — the module reset this file depends on', () => {
  it('the dedupe survives new evaluator INSTANCES, and `vi.resetModules()` genuinely clears it', async () => {
    // Both halves matter. The first is why the fix works at all: a 200-row list
    // builds a fresh evaluator per row, so a per-instance Set would dedupe
    // nothing. The second is why every other cell in this file is a real
    // measurement rather than a reading of the previous cell's leftover entry.
    const src = '${nosuchroot.reset_probe > 1}';
    const first = await import('../ExpressionEvaluator.js');

    expect(new first.ExpressionEvaluator(SCOPE).evaluateCondition(src)).toBe(true);
    expect(new first.ExpressionEvaluator(SCOPE).evaluateCondition(src)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1); // distinct instances, one line

    vi.resetModules();
    const second = await import('../ExpressionEvaluator.js');
    expect(second.ExpressionEvaluator).not.toBe(first.ExpressionEvaluator); // really a new module

    expect(new second.ExpressionEvaluator(SCOPE).evaluateCondition(src)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2); // fresh Set → the SAME source warns again
  });
});
