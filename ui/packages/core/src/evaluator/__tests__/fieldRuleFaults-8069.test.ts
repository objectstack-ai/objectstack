/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8069 — the core half of ADR-0137 D2 and D4.
 *
 * ## D2: the fault REPORT a submit path reads
 *
 * `resolveFieldRuleState` used to return three verdicts and nothing else, so a
 * submit path that wanted to refuse a broken rule had only one way to learn
 * about it: evaluate the predicate a second time, with its own copy of the
 * record assembly. It now returns `faults` beside the verdicts, filled from the
 * very evaluation that drew them. The verdicts themselves do not move — a
 * faulting `visibleWhen` still SHOWS the field (ADR-0137 D3).
 *
 * ## A stored BLANK field rule is a fault (D2), a blank GATE is not (D4)
 *
 * ADR-0137 makes a declared-but-blank field rule a third state: "A blank
 * predicate takes this path too, wherever one is already stored" (D2). So it
 * enters the report under its rule, with the `[blank]` reason, and a submit
 * path refuses it. The authoring half (D1) is `@object-ui/types`' form wire,
 * which refuses a blank triad key at parse, so no author reaches this state by
 * writing it; its pin is `base-schema-predicate-envelope-7530.test.ts`. A blank
 * GATE never reaches this function — the silencer cases below are its control.
 *
 * ## D4: the two blank-GATE silencers, diagnosed with no verdict moved
 *
 *   1. `ExpressionEvaluator.evaluateCelCondition` answered `true` for a blank
 *      CEL source before any evaluator could say so.
 *   2. `hasDeclaredPredicate` folded blank predicate text to "no gate".
 *
 * Both verdicts are objectui#3850 / #3960's and stay; both now report through
 * `evalFieldPredicate`'s one `[blank]` channel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The one-time warning dedupe is MODULE state, and this project runs with
 * `isolate: false`: without a reset, a blank spelling another file already
 * warned about reads as silence here and a case passes having checked nothing.
 * `vi.resetModules()` + fresh imports give every case its own dedupe `Set` —
 * the shape `ExpressionEvaluator.faultWarnDedupe.test.ts` uses and proves.
 */
let resolveFieldRuleState: typeof import('../fieldRules.js').resolveFieldRuleState;
let hasDeclaredPredicate: typeof import('../declaredPredicate.js').hasDeclaredPredicate;
let ExpressionEvaluator: typeof import('../ExpressionEvaluator.js').ExpressionEvaluator;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  ({ resolveFieldRuleState } = await import('../fieldRules.js'));
  ({ hasDeclaredPredicate } = await import('../declaredPredicate.js'));
  ({ ExpressionEvaluator } = await import('../ExpressionEvaluator.js'));
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const warnings = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

/** Unique per case: the one-time warning dedupes on predicate text. */
const unbound = (tag: string) => `record.no_such_column_${tag}_8069 == 1`;

describe('resolveFieldRuleState — the fault report (objectui#8069, ADR-0137 D2)', () => {
  it('reports a faulted visibleWhen with the reason the warning prints, and still SHOWS the field', () => {
    const st = resolveFieldRuleState({ visibleWhen: unbound('vis') }, {}, {}, undefined, undefined, "field 'a'");
    expect(st.visible).toBe(true);
    expect(st.faults.visibleWhen).toMatch(/no_such_column_vis_8069/);
    expect(st.faults.readonlyWhen).toBeUndefined();
    expect(st.faults.requiredWhen).toBeUndefined();
    // The same reason the one-time warning carries, from the same evaluation.
    const line = warnings().find((w) => w.includes("visibleWhen of field 'a'"));
    expect(line).toBeDefined();
    expect(line).toContain(st.faults.visibleWhen!);
  });

  it('reports each rule under its own key — readonlyWhen and requiredWhen too', () => {
    const st = resolveFieldRuleState(
      { readonlyWhen: unbound('ro'), requiredWhen: unbound('req') },
      {},
      {},
    );
    expect(st.readonly).toBe(false);
    expect(st.required).toBe(false);
    expect(st.faults.readonlyWhen).toMatch(/no_such_column_ro_8069/);
    expect(st.faults.requiredWhen).toMatch(/no_such_column_req_8069/);
    expect(st.faults.visibleWhen).toBeUndefined();
  });

  it('a visibleWhen reading previous with no previous bound is a fault — the create-form residual', () => {
    // ADR-0137 D2 as ruled for objectui#8069: nothing anywhere can evaluate
    // `previous` on an INSERT, so this is the accepted residual the submit
    // paths refuse.
    const st = resolveFieldRuleState({ visibleWhen: "previous.status_8069 == 'approved'" }, {}, {});
    expect(st.visible).toBe(true);
    expect(st.faults.visibleWhen).toMatch(/previous/);
  });

  it('control — the same previous-reading visibleWhen is NOT a fault once previous is bound (an edit)', () => {
    const st = resolveFieldRuleState(
      { visibleWhen: "previous.status_8069 == 'approved'" },
      {},
      {},
      { status_8069: 'approved' },
    );
    expect(st.visible).toBe(true);
    expect(st.faults).toEqual({});
  });

  it('control — healthy predicates, TRUE and FALSE alike, report nothing', () => {
    const rules = {
      visibleWhen: "record.stage_8069 == 'open'",
      readonlyWhen: "record.stage_8069 == 'closed'",
      requiredWhen: "record.stage_8069 == 'open'",
    };
    expect(resolveFieldRuleState(rules, { stage_8069: 'open' }, {}).faults).toEqual({});
    const hidden = resolveFieldRuleState(rules, { stage_8069: 'closed' }, {});
    expect(hidden.visible).toBe(false);
    expect(hidden.faults).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it('control — no rules at all report nothing', () => {
    expect(resolveFieldRuleState({}, {}, {}).faults).toEqual({});
  });

  it('a rule the verdict did not need never runs, so it cannot fault', () => {
    const st = resolveFieldRuleState(
      { readonlyWhen: unbound('ro_static'), requiredWhen: unbound('req_owned') },
      {},
      { readonly: true, serverOwnedValue: true },
    );
    expect(st.readonly).toBe(true);
    expect(st.required).toBe(false);
    expect(st.faults).toEqual({});
  });
});

describe('a stored BLANK field rule is reported as a fault — ADR-0137 D2 (objectui#8069)', () => {
  it.each([
    ['empty string', ''],
    ['whitespace string', '   '],
    ['blank envelope', { dialect: 'cel', source: '  ' }],
  ] as const)('%s visibleWhen: still SHOWN (D3), [blank] warned, and in the report as [blank]', (_label, pred) => {
    const st = resolveFieldRuleState(
      { visibleWhen: pred as never },
      {},
      {},
      undefined,
      undefined,
      `field 'blank_${_label.replace(/\W/g, '_')}_8069'`,
    );
    expect(st.visible).toBe(true);
    expect(st.faults.visibleWhen).toMatch(/^\[blank\]/);
    expect(warnings().some((w) => w.includes('[blank]'))).toBe(true);
  });

  it('a blank requiredWhen / readonlyWhen is reported too — which rules a path refuses on is the path\u2019s ruling', () => {
    const st = resolveFieldRuleState({ readonlyWhen: '', requiredWhen: { source: ' ' } }, {}, {});
    expect(st.readonly).toBe(false);
    expect(st.required).toBe(false);
    expect(st.faults.readonlyWhen).toMatch(/^\[blank\]/);
    expect(st.faults.requiredWhen).toMatch(/^\[blank\]/);
  });

  it('control — an ABSENT rule is not a fault: no key, no report', () => {
    const st = resolveFieldRuleState({ visibleWhen: undefined }, {}, {});
    expect(st.faults).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('ADR-0137 D4 — silencer 1: evaluateCelCondition on a blank CEL gate', () => {
  const blank = { dialect: 'cel', source: '   ' };

  it('answers true, as before, and says so once', () => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition(blank)).toBe(true);
    expect(ev.evaluateCondition(blank)).toBe(true);
    const lines = warnings().filter((w) => w.includes('[blank]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a CEL gate predicate, read as no gate');
  });

  it('hands the [blank] reason to onFault instead of warning, when the caller supplies one', () => {
    const reasons: string[] = [];
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition({ dialect: 'cel', source: '' }, { onFault: (r) => reasons.push(r) })).toBe(true);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('[blank]');
    expect(warn).not.toHaveBeenCalled();
  });

  it('throwOnError does NOT throw on a blank — nothing was authored that could fault', () => {
    const ev = new ExpressionEvaluator({ record: {} });
    expect(ev.evaluateCondition({ dialect: 'cel', source: '\t' }, { throwOnError: true })).toBe(true);
  });

  it('control — a healthy CEL gate is silent and a broken one still throws under throwOnError', () => {
    const ev = new ExpressionEvaluator({ record: { stage_8069: 'open' } });
    expect(ev.evaluateCondition({ dialect: 'cel', source: "record.stage_8069 == 'open'" })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(() =>
      ev.evaluateCondition({ dialect: 'cel', source: unbound('gate_throw') }, { throwOnError: true }),
    ).toThrow(/CEL predicate failed to evaluate/);
  });
});

describe('ADR-0137 D4 — silencer 2: hasDeclaredPredicate folding a blank gate', () => {
  it.each([
    ['whitespace string', ' \n '],
    ['whitespace envelope', { dialect: 'cel', source: '  \t' }],
    ['dialect-less blank envelope', { source: '     ' }],
  ] as const)('%s: still "not declared", now diagnosed', (_label, value) => {
    expect(hasDeclaredPredicate(value)).toBe(false);
    const lines = warnings().filter((w) => w.includes('[blank]'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('a declared gate, read as no gate');
  });

  it("'' and the empty envelope are one blank spelling: not declared, and ONE line between them", () => {
    // The locator is fixed at this key-neutral layer, so the dedupe is per
    // blank spelling across the app — the limit `reportBlankGate` documents.
    expect(hasDeclaredPredicate('')).toBe(false);
    expect(hasDeclaredPredicate({ dialect: 'cel', source: '' })).toBe(false);
    expect(hasDeclaredPredicate('')).toBe(false);
    expect(warnings().filter((w) => w.includes('[blank]'))).toHaveLength(1);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
  ] as const)('control — %s is not blank TEXT: not declared, and silent', (_label, value) => {
    expect(hasDeclaredPredicate(value)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  // objectui#11358 — these two were "not declared, and silent" controls. They
  // are DECLARED now (a gate with no evaluable `source`, which faults), and
  // still silent HERE: the report belongs to the evaluation that every
  // declared gate goes on to, not to this definition — see
  // `declaredPredicate.test.ts`'s objectui#11358 block.
  it.each([
    ['a number', 0],
    ['an object without source', {}],
  ] as const)('control — %s is not blank TEXT: declared (objectui#11358), and silent here', (_label, value) => {
    expect(hasDeclaredPredicate(value)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('control — a declared gate is declared and silent', () => {
    expect(hasDeclaredPredicate("record.stage == 'open'")).toBe(true);
    expect(hasDeclaredPredicate(false)).toBe(true);
    expect(hasDeclaredPredicate({ dialect: 'cel', source: 'true' })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
