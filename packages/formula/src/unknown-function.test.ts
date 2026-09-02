// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { buildEnv, celEngine } from './cel-engine';
import { callNameFromNoOverload, firstUnknownFunctionCall } from './unknown-function';
import { CEL_STDLIB_FUNCTIONS } from './validate';

/**
 * The function-existence oracle (#13594).
 *
 * The property under test is a BOUNDARY, not a feature: this oracle must answer
 * "the environment does not register this name" and must stay silent about every
 * other thing cel-js's `check()` has an opinion about. Both halves are pinned —
 * the refusals AND the silences — because a widening here reaches an
 * `error`-level publish gate (`@objectstack/lint`'s view/page visibility rule)
 * where a false positive is a build nobody can ship.
 *
 * The registration set is MEASURED off `buildEnv` here rather than read back out
 * of the module under test, for the reason `cel-stdlib-drift.test.ts` states
 * about itself: a control that asks the implementation for its own oracle cannot
 * catch the implementation getting the oracle wrong.
 */

/** The instant the pinned environment is built at — any fixed instant will do. */
const FIXED_NOW = () => new Date(0);

function registeredNames(): string[] {
  const env = buildEnv(FIXED_NOW, 'UTC') as unknown as {
    getDefinitions(): { functions: Array<{ name: string; receiverType: string | null }> };
  };
  return [...new Set(env.getDefinitions().functions.map((fn) => fn.name))].sort();
}

function bareCallableNames(): Set<string> {
  const env = buildEnv(FIXED_NOW, 'UTC') as unknown as {
    getDefinitions(): { functions: Array<{ name: string; receiverType: string | null }> };
  };
  return new Set(env.getDefinitions().functions.filter((fn) => !fn.receiverType).map((fn) => fn.name));
}

/**
 * The engine's own verdict, used ONLY as a control — never as the subject. Taken
 * from the real `celEngine` rather than a rebuilt lookalike, because a control
 * measuring a different environment controls nothing.
 */
function celCompile(source: string) {
  return celEngine.compile(source);
}

describe('firstUnknownFunctionCall — what it REFUSES (#13594)', () => {
  it('the global-call form names the function and quotes the engine verbatim', () => {
    const found = firstUnknownFunctionCall('totallyBogusFn(1,2)');
    expect(found?.name).toBe('totallyBogusFn');
    // The engine's own wording, not a paraphrase — the publish-time message and
    // the runtime fault have to read as one system (ruling refinement 2).
    expect(found?.detail).toContain("found no matching overload for 'totallyBogusFn(int, int)'");
  });

  it('the RECEIVER/member-call form is covered by the same verdict', () => {
    // The half a global-only repair would have left open. cel-js phrases it with
    // the receiver TYPE in front (`dyn.nosuchmethod(string)`); the method name is
    // what the author typed and what has to come back.
    const found = firstUnknownFunctionCall("record.x.nosuchmethod('a')");
    expect(found?.name).toBe('nosuchmethod');
    expect(found?.detail).toContain("found no matching overload for 'dyn.nosuchmethod(string)'");
  });

  it('the objectui#4421 predicate — the authored shape this ruling came from', () => {
    // `current_user` is a declared SCOPE_ROOT, so the unbound-root check cannot
    // structurally see this one: existence is the only check that can.
    expect(firstUnknownFunctionCall('current_user.can(object, verb)')?.name).toBe('can');
  });

  it('a typo one edit away from a real function is still just unknown — no suggestion field', () => {
    const found = firstUnknownFunctionCall('isBlnk(record.x)');
    expect(found?.name).toBe('isBlnk');
    // The result carries a name and the engine's line, and nothing else. Ruling
    // refinement 2: 「不给 `nearestName` 建议。」
    expect(Object.keys(found ?? {}).sort()).toEqual(['detail', 'name']);
  });

  it('an unknown call inside a larger predicate is still found', () => {
    expect(firstUnknownFunctionCall('record.amount > 100 && bogusFn2(record.x)')?.name).toBe('bogusFn2');
  });
});

describe('firstUnknownFunctionCall — what it deliberately STAYS SILENT about', () => {
  it.each([
    ["upper('a')", 'a registered function called correctly'],
    ['type(record.x) == string', 'the legitimate CEL the blind-spot pin protects'],
    ["record.tags.all(t, t != '')", 'a comprehension macro'],
    ['record.items.exists(i, i.qty > 0)', 'a macro with a receiver'],
    ['has(record.status)', 'the sparse-binding guard idiom'],
    ["record.name.split(',')", 'a receiver-only stdlib method used correctly'],
    ["record.created.getFullYear() > 2020", 'a receiver-only name absent from CEL_STDLIB_FUNCTIONS'],
    ['size(record.tags) > 0', 'a cel-js built-in'],
    ["status == 'active'", 'a bare identifier — a different gate’s verdict'],
    ['record.x.foo.bar', 'a dotted path that is not a call at all'],
  ])('%s → null (%s)', (source) => {
    expect(firstUnknownFunctionCall(source)).toBeNull();
  });

  it('a REGISTERED name called with the wrong arguments is not an existence fault', () => {
    // cel-js gives this the SAME message shape as an unknown call
    // (`found no matching overload for 'upper(int, int)'`), which is the entire
    // reason this oracle exists rather than a regex over `compile`'s message.
    // Ruling refinement 3: 「只拒未知函数裁定,⛔ 不搬运 `check()` 的其他抱怨。」
    expect(firstUnknownFunctionCall('upper(1, 2)')).toBeNull();
    // …and the control that the case is live: the message really is that shape.
    expect(callNameFromNoOverload("found no matching overload for 'upper(int, int)'")).toBe('upper');
  });

  it('a REGISTERED name called in the wrong POSITION is not an existence fault either', () => {
    // `split` is registered receiver-only. Bare `split(...)` faults — but the
    // name exists, so calling it "not registered" would be a false statement.
    // Call-form is a different question and is not this gate's to answer.
    expect(firstUnknownFunctionCall("split('a,b')")).toBeNull();
    expect(bareCallableNames().has('split')).toBe(false);
    expect(registeredNames()).toContain('split');
  });

  it.each([
    ["type == 'grid'", 'no such overload: type == string'],
    ["1 + 'a'", 'no such overload: int + string'],
  ])('a `type` fault phrased any other way is not read: %s', (source, expectedPhrasing) => {
    expect(firstUnknownFunctionCall(source)).toBeNull();
    // Control: the source really IS refused by the checker, so the null above is
    // this oracle standing down rather than the checker finding nothing.
    const compiled = celCompile(source);
    expect(compiled.ok).toBe(false);
    expect(compiled.ok ? '' : compiled.error.message).toContain(expectedPhrasing);
  });

  it.each([
    ['country === "USA"', 'a parse fault — the syntax rule owns it'],
    ['', 'an empty source'],
    ['   ', 'a whitespace-only source'],
  ])('%s → null (%s)', (source) => {
    expect(firstUnknownFunctionCall(source)).toBeNull();
  });

  it('an over-budget but valid source is a bounds fault, not an existence one', () => {
    const overBudget = Array.from({ length: 80 }, (_, i) => `record.f${i} == ${i}`).join(' && ');
    expect(firstUnknownFunctionCall(overBudget)).toBeNull();
    const compiled = celCompile(overBudget);
    expect(compiled.ok ? '' : compiled.error.kind).toBe('bounds');
  });
});

describe('the oracle is the ENVIRONMENT, never the advertised catalog (refinement 1)', () => {
  it('no registered name is ever reported unknown — the full-registration control', () => {
    // The measured hazard the ruling names: a gate keyed on CEL_STDLIB_FUNCTIONS
    // would refuse the 37 names the environment registers but does not
    // advertise. Every registered name is probed in BOTH call forms, and the
    // assertion is the narrow one — the oracle may say nothing, and may not say
    // "this name does not exist".
    const names = registeredNames();
    expect(names.length, 'the environment registered nothing — the seam is broken, not the oracle')
      .toBeGreaterThan(35);

    const misjudged: string[] = [];
    for (const name of names) {
      for (const source of [`${name}(record.x)`, `record.x.${name}(record.y)`]) {
        if (firstUnknownFunctionCall(source)?.name === name) misjudged.push(source);
      }
    }
    expect(misjudged, 'registered functions reported as unknown — these authored ' +
      'predicates would be refused at the publish gate').toEqual([]);
  });

  it('the registered-but-not-advertised gap is real and is entirely accepted', () => {
    // Derived from the two sets rather than transcribed, so the control tracks a
    // cel-js upgrade instead of pinning yesterday's census. If this ever emptied,
    // the test above would silently stop covering the hazard it exists for.
    const advertised = new Set(CEL_STDLIB_FUNCTIONS);
    const unadvertised = registeredNames().filter((name) => !advertised.has(name));
    expect(unadvertised.length,
      'no registered-but-unadvertised names left — the catalog-as-oracle hazard ' +
      'this control covers has gone, and so has the control').toBeGreaterThan(0);
    for (const name of unadvertised) {
      expect(firstUnknownFunctionCall(`${name}(record.x)`)?.name).not.toBe(name);
      expect(firstUnknownFunctionCall(`record.x.${name}(record.y)`)?.name).not.toBe(name);
    }
  });

  it('a name absent from BOTH sets is what actually gets refused', () => {
    // The negative control for the two above: the probe shape they use does
    // produce a refusal when the name really is unregistered, so their silence
    // is a verdict rather than a broken probe.
    expect(registeredNames()).not.toContain('definitelyNotRegistered');
    expect(firstUnknownFunctionCall('definitelyNotRegistered(record.x)')?.name)
      .toBe('definitelyNotRegistered');
    expect(firstUnknownFunctionCall('record.x.definitelyNotRegistered(record.y)')?.name)
      .toBe('definitelyNotRegistered');
  });
});

describe('callNameFromNoOverload — the shared extraction (#13594)', () => {
  it.each([
    ["found no matching overload for 'totallyBogusFn(int, int)'", 'totallyBogusFn'],
    ["found no matching overload for 'dyn.nosuchmethod(string)'", 'nosuchmethod'],
    ["found no matching overload for 'upper(int, int)'", 'upper'],
  ])('%s → %s', (message, expected) => {
    expect(callNameFromNoOverload(message)).toBe(expected);
  });

  it.each([
    'no such overload: type == string',
    'no such overload: int + string',
    'Unknown variable: status',
  ])('is undefined for a message that is not a call verdict: %s', (message) => {
    expect(callNameFromNoOverload(message)).toBeUndefined();
  });

  it('does not run past the call into the source excerpt cel-js appends', () => {
    // cel-js's `formatErrorWithHighlight` puts the author's own source on the
    // following lines, dots and all. The greedy receiver prefix must not reach it.
    const message =
      "found no matching overload for 'dyn.nosuchmethod(string)'\n" +
      "  record.a.b.c('x')\n" +
      '           ^';
    expect(callNameFromNoOverload(message)).toBe('nosuchmethod');
  });
});

