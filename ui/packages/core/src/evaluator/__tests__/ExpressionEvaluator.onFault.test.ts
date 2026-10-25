/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6038 — `EvaluationOptions.onFault`: observe a predicate fault
 * WITHOUT a second evaluation and WITHOUT moving a verdict.
 *
 * ## The problem this seam exists to solve
 *
 * Before it, the only fault-detection channel a fail-soft caller had was
 * `throwOnError`, and on the CEL branch `evaluateCelCondition` implements that
 * by evaluating TWICE. So a caller that wanted to *report* a broken predicate
 * while keeping the historical fail-open answer had to double the engine calls
 * for every predicate of every node of every render — which is precisely why
 * `SchemaRenderer`'s node gate bought its diagnostic with a `__DEV__` gate and
 * shipped production silent. The maintainer's 2026-08-25 ruling (option B)
 * retired that silence and kept the negligible-cost requirement, so the fault
 * has to become observable at the SAME number of engine calls.
 *
 * ## What was actually silent — measured, per dialect
 *
 * Against `origin/main`, on the built evaluator, a faulting predicate with no
 * options produced: bare string -> NOTHING; `{ dialect: 'cel' }` -> one generic
 * line, deduped; `${…}` template -> one generic line PER EVALUATION. The first
 * group of cases below pins all three converging on the passback, which is what
 * lets one caller print one line for a fault in any dialect.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExpressionEvaluator } from '../ExpressionEvaluator.js';

const SCOPE = { record: { status: 'open' }, data: { total: 99 }, page: {} };
const evaluator = () => new ExpressionEvaluator(SCOPE);

/** Faulting predicates, one per dialect. */
const FAULT_BARE = 'nosuchroot.x > 1';
const FAULT_TEMPLATE = '${nosuchroot.x > 1}';
const FAULT_CEL = { dialect: 'cel', source: 'record.bad(' };

describe('#6038 — onFault fires on every dialect that can fault', () => {
  it('BARE STRING: the dialect that reported nothing at all now hands back a reason', () => {
    // objectstack#11254 measured a real gate breaking on exactly this dialect
    // and produced no console line anywhere.
    const reasons: string[] = [];
    const verdict = evaluator().evaluateCondition(FAULT_BARE, { onFault: (r) => reasons.push(r) });
    expect(verdict).toBe(true); // fail-open, unchanged
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('nosuchroot');
  });

  it('CEL ENVELOPE: forwarded to `evalFieldPredicate`\'s existing passback, and its generic line is suppressed', () => {
    // One fault, one report. Without `warn: false` the canonical engine would
    // print its own line beside the caller's, so a production console would
    // show two lines for one broken predicate.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reasons: string[] = [];
      const verdict = evaluator().evaluateCondition(FAULT_CEL, { onFault: (r) => reasons.push(r) });
      expect(verdict).toBe(true);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]).toContain('parse');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('${…} TEMPLATE: the generic per-evaluation line is replaced by one passback per evaluation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reasons: string[] = [];
      const verdict = evaluator().evaluateCondition(FAULT_TEMPLATE, { onFault: (r) => reasons.push(r) });
      expect(verdict).toBe(true);
      expect(reasons).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a HEALTHY predicate never calls it — on either verdict', () => {
    // The silence that makes the signal mean something. A `false` verdict is an
    // answer, not a fault, and a passback that fired on it would report every
    // hiding gate in the repository.
    const reasons: string[] = [];
    const e = evaluator();
    expect(e.evaluateCondition("record.status == 'open'", { onFault: (r) => reasons.push(r) })).toBe(true);
    expect(e.evaluateCondition("record.status == 'closed'", { onFault: (r) => reasons.push(r) })).toBe(false);
    expect(e.evaluateCondition({ dialect: 'cel', source: "record.status == 'closed'" }, { onFault: (r) => reasons.push(r) })).toBe(false);
    expect(reasons).toHaveLength(0);
  });
});

describe('#6038 — the seam moves no verdict and adds no evaluation', () => {
  it('every predicate shape reaches the identical verdict with and without onFault', () => {
    // The card is observability-only. This is that constraint as a measurement
    // rather than a claim: same inputs, both call shapes, byte-identical answers.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cases: Array<[unknown, string]> = [
        [FAULT_BARE, 'bare fault'],
        [FAULT_CEL, 'cel fault'],
        [FAULT_TEMPLATE, 'template fault'],
        ["record.status == 'open'", 'bare true'],
        ["record.status == 'closed'", 'bare false'],
        [{ dialect: 'cel', source: "record.status == 'open'" }, 'cel true'],
        [{ dialect: 'cel', source: "record.status == 'closed'" }, 'cel false'],
        ['${record.status == "open"}', 'template true'],
        ['${record.status == "closed"}', 'template false'],
        [true, 'literal true'],
        [false, 'literal false'],
        [undefined, 'absent'],
        ['', 'empty'],
        ['   ', 'whitespace'],
      ];
      for (const [pred, label] of cases) {
        const without = evaluator().evaluateCondition(pred as never);
        const with_ = evaluator().evaluateCondition(pred as never, { onFault: () => {} });
        expect(`${label}: ${String(with_)}`).toBe(`${label}: ${String(without)}`);
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('the CEL branch still makes ONE engine call — the `throwOnError` probe is not smuggled in', () => {
    // The whole point of the passback. `throwOnError` detects a CEL fault by
    // evaluating twice (once with each fallback); if `onFault` had been built on
    // top of it, production would pay double for every predicate of every node.
    // A throwing getter on the record counts the reads the engine performs.
    let reads = 0;
    const probed = new ExpressionEvaluator({
      record: {
        get status() {
          reads += 1;
          return 'open';
        },
      },
    });
    reads = 0;
    probed.evaluateCondition({ dialect: 'cel', source: "record.status == 'open'" }, { onFault: () => {} });
    const withPassback = reads;

    reads = 0;
    probed.evaluateCondition({ dialect: 'cel', source: "record.status == 'open'" }, { throwOnError: true });
    const withProbe = reads;

    // The passback path reads the record the same number of times a plain
    // fail-soft call does; the `throwOnError` probe reads it strictly more.
    reads = 0;
    probed.evaluateCondition({ dialect: 'cel', source: "record.status == 'open'" });
    const plain = reads;

    expect(withPassback).toBe(plain);
    expect(withProbe).toBeGreaterThan(plain);
  });

  it('without onFault, the loud dialect still prints its own generic line', () => {
    // The compatibility half: every caller that does not opt in must still see
    // its line. A bare-string fault stays silent (it always was), and the
    // `${…}` dialect keeps its own generic text.
    //
    // objectui#6444 rate limited that built-in line to ONE per authored source,
    // module-wide, so this cell faults on a source no other cell in this file
    // uses. Reusing `FAULT_TEMPLATE` here would read the dedupe entry the
    // verdict-parity cell above already made and see silence — a green run
    // that measured nothing. The rate limit itself is pinned in
    // `ExpressionEvaluator.faultWarnDedupe.test.ts`.
    const OWN_TEMPLATE = '${nosuchroot.compat_6038 > 1}';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(evaluator().evaluateCondition(FAULT_BARE)).toBe(true);
      expect(warn).not.toHaveBeenCalled();

      expect(evaluator().evaluateCondition(OWN_TEMPLATE)).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('Failed to evaluate expression');
    } finally {
      warn.mockRestore();
    }
  });

  it('`throwOnError` still wins where both are set — the fail-closed contract is unmoved', () => {
    // Documented precedence. A caller that asked for a throw gets a throw; the
    // passback is the fail-SOFT observation channel, not a second one.
    expect(() =>
      evaluator().evaluateCondition(FAULT_BARE, { throwOnError: true, onFault: () => {} }),
    ).toThrow();
  });
});
