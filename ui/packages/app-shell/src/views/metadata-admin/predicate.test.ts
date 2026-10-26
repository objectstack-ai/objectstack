// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6936 — an unresolvable predicate path must fail OPEN, loudly.
 *
 * `predicate.ts` promised fail-open in its header and delivered it only for
 * *thrown* errors. A path whose root identifier did not exist in the scope
 * resolved to `undefined`, and then `['text'].includes(undefined)` /
 * `undefined === 'text'` judged the predicate false — the field disappeared with
 * no diagnostic. Maintainer ruling (option C, 2026-08-09): unresolvable path →
 * `true`, plus a dev-mode warning naming the path and the predicate.
 *
 * The tests below pin the SEMANTIC BOUNDARY as much as the new verdict, because
 * the boundary is the part that is easy to get wrong in either direction:
 *
 *   unresolvable ROOT identifier   → fail-open `true` + one warning
 *   root resolves, value is absent → ordinary comparison (usually `false`), silent
 *
 * Widening the first case to "any undefined value" would show every
 * type-conditional sub-field at once on a fresh draft; narrowing it away again
 * restores the silent-hide bug. Both directions are asserted here.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { objectForm } from '@objectstack/spec/data';
import { evaluatePredicate, resetPredicateWarnings } from './predicate';

/**
 * The `unit` vitest project runs with `isolate: false`, so this module-global
 * warn-once memo outlives a single test file. Reset before every test or the
 * second assertion on a given (path, predicate) pair sees no warning.
 */
// `MockInstance<typeof console.warn>`, not `ReturnType<typeof vi.spyOn>`: the
// latter is the un-instantiated `MockInstance<Procedure | Constructable>`, whose
// `mock.calls` carries no argument types, so `warnings()` below took an implicit
// `any` (objectui#4040).
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  resetPredicateWarnings();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

const scope = (data: Record<string, unknown>) => ({ data });

/** All console.warn text emitted so far, joined — order-independent matching. */
const warnings = () => warn.mock.calls.map((c) => c.join(' ')).join('\n');

/* ── 1. unresolvable root identifier → true, and it says so ──────────────── */

describe('unresolvable path → fail-open true + dev warning (objectstack#6936)', () => {
  it('a bare `type in [...]` against a `{ data }` scope shows the field instead of hiding it', () => {
    const row = { type: 'currency' };
    expect(evaluatePredicate("type in ['number','currency','percent']", scope(row))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    // The warning has to name BOTH the unresolved path and the predicate that
    // carried it — a warning that says only "something did not resolve" sends
    // nobody anywhere.
    expect(warnings()).toContain('`type`');
    expect(warnings()).toContain("type in ['number','currency','percent']");
  });

  it('bare `type == literal` too', () => {
    expect(evaluatePredicate("type == 'formula'", scope({ type: 'text' }))).toBe(true);
    expect(warnings()).toContain("type == 'formula'");
  });

  it('a bare truthy check on an unresolvable name', () => {
    expect(evaluatePredicate('createOpportunity', scope({ type: 'text' }))).toBe(true);
    expect(warnings()).toContain('`createOpportunity`');
  });

  it('NEGATION does not invert the fail-open — `!unresolvable` is still true', () => {
    // The reason resolution failure is thrown rather than returned as a
    // sentinel. A sentinel would make the inner path "true-ish" and `!` would
    // negate it straight back to false — fail-CLOSED, i.e. the bug, reached by
    // a different route.
    expect(evaluatePredicate('!type', scope({ type: 'text' }))).toBe(true);
    expect(warnings()).toContain('`type`');
  });

  it('a wrong scope root (`record`, `page`) fails open and names the whole path', () => {
    expect(evaluatePredicate("record.status == 'open'", scope({ status: 'closed' }))).toBe(true);
    expect(warnings()).toContain('`record.status`');
    expect(evaluatePredicate("page.selectedId != ''", scope({}))).toBe(true);
    expect(warnings()).toContain('`page.selectedId`');
  });

  it('an inherited name is unresolvable, not a resolvable Object member', () => {
    // `hasOwn`, not `in`: `'constructor' in ctx` is true, and resolving it would
    // compare a function against a string — false, silently, forever.
    expect(evaluatePredicate("constructor == 'x'", scope({}))).toBe(true);
    expect(warnings()).toContain('`constructor`');
  });

  it('warns ONCE per (path, predicate) pair, not once per evaluation', () => {
    for (let i = 0; i < 5; i++) evaluatePredicate("type == 'formula'", scope({ type: 'text' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('but a DIFFERENT predicate on the same path gets its own warning', () => {
    // Keying the memo on the path alone would report the first of the 16 skewed
    // `objectForm` predicates and stay silent about the other fifteen.
    evaluatePredicate("type == 'formula'", scope({ type: 'text' }));
    evaluatePredicate("type == 'code'", scope({ type: 'text' }));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warnings()).toContain("type == 'formula'");
    expect(warnings()).toContain("type == 'code'");
  });

  it('reads the object predicate form as well as the string form', () => {
    expect(evaluatePredicate({ dialect: 'cel', source: "type == 'formula'" }, scope({}))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/* ── 2. resolved and genuinely false → false, silently ───────────────────── */

describe('a resolved path that is genuinely unequal still hides the field', () => {
  it.each([
    ["data.type == 'currency'", { type: 'text' }],
    ["data.type in ['number','currency']", { type: 'text' }],
    ["data.type != 'text'", { type: 'text' }],
    ['!data.flag', { flag: true }],
    ["data.config.kind == 'json'", { config: { kind: 'yaml' } }],
  ])('%s over %j → false', (expr, row) => {
    expect(evaluatePredicate(expr, scope(row as Record<string, unknown>))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a true predicate is still true (and silent)', () => {
    expect(evaluatePredicate("data.type in ['number','currency']", scope({ type: 'currency' }))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

/* ── 3. resolved-to-undefined / null is a VALUE fact, unchanged ──────────── */

describe('an absent draft value is not an unresolvable path (boundary pin)', () => {
  // Each case: the root `data` resolves, the draft simply carries nothing at
  // that key. Behaviour must be exactly what it was before objectstack#6936 —
  // ordinary comparison, no warning. A fresh row must not light up with every
  // type-conditional sub-field at once.
  it.each([
    ["data.type == 'text'", {}, false],
    ["data.type in ['text','textarea']", {}, false],
    ['data.type', {}, false],
    ['data.type', { type: null }, false],
    ['!data.type', {}, true],
    ["data.type != 'text'", {}, true],
    // CEL-style loose nullish equality, live before this change and after it.
    ['data.type == null', {}, true],
    ['data.type == null', { type: null }, true],
    ['data.type != null', {}, false],
    // Nullish part-way down the path: still a value fact, one level deeper.
    ["data.config.kind == 'json'", {}, false],
    ["data.config.kind == 'json'", { config: null }, false],
    ['data.config.kind == null', {}, true],
  ])('%s over %j → %s, silently', (expr, row, expected) => {
    expect(evaluatePredicate(expr as string, scope(row as Record<string, unknown>))).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  it('`data` itself resolves — a scope-shaped predicate is not "unresolvable"', () => {
    expect(evaluatePredicate('data', scope({ type: 'text' }))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});

/* ── 4. the pre-existing parse-error fail-open, unchanged ────────────────── */

describe('the documented parse-error fail-open is untouched (regression pin)', () => {
  it('a throwing property access still fails open — and stays silent', () => {
    // The catch-all branch this file has always had. It must keep failing open,
    // and it must NOT borrow the unresolved-path warning: the path resolved
    // fine, reading it blew up, which is a different fact.
    const row = {};
    Object.defineProperty(row, 'type', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    expect(evaluatePredicate("data.type == 'text'", scope(row))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([null, undefined, ''])('an absent predicate (%j) is "always visible"', (expr) => {
    expect(evaluatePredicate(expr as never, scope({}))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an empty object-form source is "always visible"', () => {
    expect(evaluatePredicate({ dialect: 'cel', source: '' }, scope({}))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('unparseable garbage fails open, and now names what it could not resolve', () => {
    // Before objectstack#6936 this fell through to a bare truthy check on the
    // whole string, resolved to `undefined`, and hid the field silently. It is
    // an unresolvable reference by any reading, so it warns.
    expect(evaluatePredicate('this is not CEL (((', scope({}))).toBe(true);
    expect(warnings()).toContain('this is not CEL (((');
  });
});

/* ── 5. CEL-style absorption: a short-circuited branch is never reached ──── */

describe('short-circuit absorption (CEL order)', () => {
  it('`false && unresolvable` is false — the bad half is absorbed, no warning', () => {
    // Matches CEL, where a false conjunct absorbs an erroring branch. The
    // verdict is decided by a path that DID resolve, so fail-open never applies
    // and there is nothing to report.
    expect(evaluatePredicate("data.type == 'currency' && type == 'formula'", scope({ type: 'text' }))).toBe(
      false,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('`true || unresolvable` is true, also silently', () => {
    expect(evaluatePredicate("data.type == 'text' || type == 'formula'", scope({ type: 'text' }))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('but a reachable unresolvable half decides the predicate, and warns', () => {
    expect(evaluatePredicate("data.type == 'text' && type == 'formula'", scope({ type: 'text' }))).toBe(true);
    expect(warnings()).toContain('`type`');
  });
});

/* ── 6. the version-skew specimen, from the bundled spec itself ──────────── */

/**
 * The reproduction from the issue: `@objectstack/spec` ≤ 17.0.0-rc.5 ships the
 * `objectForm` sub-field predicates spelled BARE (`type in [...]`), which this
 * engine evaluates against `{ data: draftRow }`. A frontend carrying the
 * objectstack#6331 reader fix in front of such a backend resolved `type` to
 * nothing and hid all 16 type-conditional sub-fields, for every row type.
 *
 * Read from the installed spec rather than hand-transcribed — the same choice
 * `SchemaForm.visibleWhen.test.tsx` made, for the same reason: a hand-written
 * fixture proves the fixture, not the metadata this engine actually renders.
 *
 * When the workspace bumps to a spec with objectstack#6254 landed, the bare
 * subset legitimately becomes empty. That must not turn this suite into a green
 * run over nothing (the #5046 trap), so the total-predicate guard below is
 * asserted unconditionally, and the literal skew table in the next block —
 * which is version-independent — carries the semantics on its own.
 */
describe('bundled spec `objectForm`: bare predicates no longer hide their fields', () => {
  type Node = Record<string, unknown>;
  const collect = (node: unknown, out: Array<{ field: string; source: string }>): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) collect(n, out);
      return;
    }
    const n = node as Node;
    const pred = n.visibleWhen;
    if (pred) {
      const source = typeof pred === 'string' ? pred : (pred as { source?: string }).source;
      if (source) out.push({ field: String(n.field ?? '(section)'), source });
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') collect(v, out);
  };

  const predicates: Array<{ field: string; source: string }> = [];
  collect(objectForm, predicates);
  const bare = predicates.filter((p) => !/^\s*data\b/.test(p.source));

  it('the spec ships type-conditional predicates on objectForm at all', () => {
    // Non-vacuity guard: objectstack#6254 changes the SPELLING of these
    // predicates, never their presence, so this holds on both sides of the bump.
    expect(predicates.length).toBeGreaterThan(0);
  });

  it('every bare-root predicate the installed spec ships evaluates true for any row', () => {
    for (const { field, source } of bare) {
      for (const rowType of ['text', 'currency', 'lookup', 'formula', 'code', 'summary', 'autonumber']) {
        expect(
          evaluatePredicate(source, scope({ name: 'f', type: rowType })),
          `${field}: ${source} (row type ${rowType})`,
        ).toBe(true);
      }
    }
  });

  it('and every one of them is reported once per predicate', () => {
    for (const { source } of bare) evaluatePredicate(source, scope({ type: 'text' }));
    // Distinct predicate sources → distinct warnings; duplicate sources
    // (maxLength/minLength share one) collapse, which is the intended memo.
    const distinct = new Set(bare.map((p) => p.source));
    expect(warn).toHaveBeenCalledTimes(distinct.size);
  });

  it('`data.`-spelled predicates keep discriminating by row type (post-#6254 shape)', () => {
    // The other half of the skew window: once the backend is upgraded, the same
    // sub-fields must go back to being row-type-conditional rather than always
    // visible. Fail-open applies to unresolvable paths only.
    const currency = scope({ name: 'amount', type: 'currency' });
    const text = scope({ name: 'title', type: 'text' });
    expect(evaluatePredicate("data.type in ['number','currency','percent']", currency)).toBe(true);
    expect(evaluatePredicate("data.type in ['text','textarea','email']", currency)).toBe(false);
    expect(evaluatePredicate("data.type in ['text','textarea','email']", text)).toBe(true);
    expect(evaluatePredicate("data.type in ['number','currency','percent']", text)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The literal skew table — the 16 `objectForm` sub-field predicates as spec
 * 17.0.0-rc.5 spells them, with the Studio sub-field each one gates. Kept as a
 * literal so the specimen survives a spec bump: it is the shape the issue
 * measured (16 sub-fields, zero shown, zero diagnostics), not whatever the
 * installed package happens to carry today.
 */
const SKEWED_OBJECT_FORM_PREDICATES: Array<[field: string, source: string]> = [
  ['maxLength', "type in ['text','textarea','email','url','phone','password','markdown','html','richtext']"],
  ['minLength', "type in ['text','textarea','email','url','phone','password','markdown','html','richtext']"],
  ['min', "type in ['number','currency','percent','rating','slider','progress']"],
  ['max', "type in ['number','currency','percent','rating','slider','progress']"],
  ['precision', "type in ['number','currency','percent']"],
  ['scale', "type in ['number','currency','percent']"],
  ['options', "type in ['select','multiselect','radio','checkboxes']"],
  ['reference', "type in ['lookup','master_detail','tree']"],
  ['lookupFilters', "type in ['lookup','master_detail']"],
  ['deleteBehavior', "type in ['lookup','master_detail']"],
  ['multiple', "type in ['lookup']"],
  ['expression', "type == 'formula'"],
  ['returnType', "type == 'formula'"],
  ['summaryOperations', "type == 'summary'"],
  ['autonumberFormat', "type == 'autonumber'"],
  ['language', "type == 'code'"],
];

describe('the 16 vanished Studio sub-fields (objectstack#6936 reading)', () => {
  it('is the specimen the issue measured — 16 predicates', () => {
    expect(SKEWED_OBJECT_FORM_PREDICATES).toHaveLength(16);
  });

  it.each(SKEWED_OBJECT_FORM_PREDICATES)('%s is shown again, not silently dropped (%s)', (_field, source) => {
    // Before this change every one of these returned false for every row type:
    // `['text',…].includes(undefined)` / `undefined === 'formula'`.
    expect(evaluatePredicate(source, scope({ name: 'amount', type: 'currency' }))).toBe(true);
    expect(evaluatePredicate(source, scope({ name: 'title', type: 'text' }))).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});

/* ── 7. a path on the RIGHT of ==/!= is a string literal — say so (#4049) ── */

/**
 * objectui#4049. `parseLiteral`'s tail `return s` hands back any input it does
 * not recognise as a literal, verbatim. The LEFT side of `==` / `!=` resolves
 * paths; the RIGHT side does not — so `data.a == data.b` compares the value of
 * `data.a` against the seven-character string "data.b" and is FALSE however
 * equal the two sides are, with nothing in the console. objectstack#6936's
 * warning cannot see this: it hangs on `resolveValue`, which the right side
 * never enters (measured — 0 warnings for the whole truth table below).
 *
 * Maintainer/PM ruling on this card: option B ONLY — a dev-mode diagnostic at
 * that tail, ZERO semantic change. The verdicts are therefore pinned IDENTICAL
 * before and after (§7.3); the console merely stops being silent.
 */
describe('a path-shaped right-hand side is diagnosed, not resolved (objectui#4049)', () => {
  /* 7.1 — it fires, and it names both halves */

  it('`data.a == data.b` warns, naming the right-hand text and the predicate', () => {
    expect(evaluatePredicate('data.a == data.b', scope({ a: 'x', b: 'x' }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // Both halves or the warning sends nobody anywhere — same bar as #6936.
    expect(warnings()).toContain('`data.b`');
    expect(warnings()).toContain('data.a == data.b');
  });

  it('`!=` routes through the same tail', () => {
    expect(evaluatePredicate('data.a != data.b', scope({ a: 'x', b: 'x' }))).toBe(true);
    expect(warnings()).toContain('`data.b`');
  });

  it('an UNQUOTED bare identifier fires — the A-direction regression shape', () => {
    // `data.type == text` "works" today by accident: the row happens to hold the
    // string "text". Option A (resolving the right side) would have flipped it
    // to fail-open true. It stays exactly as it was — and stops being silent, so
    // the accident is discoverable instead of load-bearing.
    expect(evaluatePredicate('data.type == text', scope({ type: 'text' }))).toBe(true);
    expect(warnings()).toContain('`text`');
  });

  it('warns ONCE per (right-hand text, predicate) pair', () => {
    for (let i = 0; i < 5; i++) evaluatePredicate('data.a == data.b', scope({ a: 'x', b: 'x' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('but a different predicate carrying the same text gets its own warning', () => {
    evaluatePredicate('data.a == data.b', scope({ a: 'x', b: 'x' }));
    evaluatePredicate('data.c == data.b', scope({ b: 'x', c: 'x' }));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the diagnostic is dev-mode only', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(evaluatePredicate('data.a == data.b', scope({ a: 'x', b: 'x' }))).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  /* 7.2 — controls: real literals stay silent */

  it.each([
    ["a quoted string", "data.type == 'text'", { type: 'text' }],
    ['a double-quoted string', 'data.type == "text"', { type: 'text' }],
    ['a number', 'data.n == 42', { n: 42 }],
    ['a negative number', 'data.n == -1', { n: -1 }],
    ['a decimal', 'data.n == 1.5', { n: 1.5 }],
    ['true', 'data.flag == true', { flag: true }],
    ['false', 'data.flag == false', { flag: false }],
    ['null', 'data.v == null', { v: null }],
    ['an array', "data.type in ['text','number']", { type: 'text' }],
    ['a quoted string that CONTAINS dots', "data.v == 'a.b.c'", { v: 'a.b.c' }],
  ])('%s on the right side fires nothing', (_label, expr, row) => {
    evaluatePredicate(expr as string, scope(row as Record<string, unknown>));
    expect(warn).not.toHaveBeenCalled();
  });

  it('a dotted NON-identifier is not called a path (grammar boundary)', () => {
    // `1.2.3` reaches the same tail (via resolveValue's literal shortcut for
    // digit-leading operands) and is likewise compared as text — but it is a
    // malformed NUMBER, not a path. Reporting it as one would be a false claim,
    // so the grammar is the dot-separated identifier chain the left side
    // accepts, not "contains a dot".
    expect(evaluatePredicate('data.v == 1.2.3', scope({ v: '1.2.3' }))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  /* 7.3 — the zero-semantics proof: verdicts identical to pre-change */

  it.each([
    ['data.a == data.b', { a: 'x', b: 'x' }, false], // equal values, still FALSE
    ['data.a != data.b', { a: 'x', b: 'x' }, true], // equal values, still TRUE
    ['data.a == data.b', { a: 'x', b: 'y' }, false], // right for the wrong reason
    ["data.a == 'x'", { a: 'x', b: 'y' }, true], // literal control
    ['data.type == text', { type: 'text' }, true], // unquoted, unchanged
    ['data.a == data.b', { a: 'data.b' }, true], // the literal-text comparison itself
  ])('%s over %j is still %s — the diagnostic changes no verdict', (expr, row, expected) => {
    expect(evaluatePredicate(expr as string, scope(row as Record<string, unknown>))).toBe(expected);
  });
});

/* ── 8. a non-literal element inside `in [...]` is diagnosed (objectui#4266) ── */

/**
 * objectui#4266. `parseLiteral`'s array branch JSON-parses the bracketed text
 * after normalising quotes; an element that is not a JSON literal (a path, a
 * bare identifier, a trailing comma) makes that `JSON.parse` throw, and the
 * `catch` returned `[]` with nothing in the console — `in` reads FALSE FOR
 * EVERY ROW, and because the parse is whole-set, one bad element discards the
 * good literals sitting next to it too.
 *
 * Ruling on this card: **diagnose only, zero semantic change** — the same
 * posture #4049 took for the right-hand-literal tail. The `catch` still
 * returns `[]`; the verdicts are pinned IDENTICAL before and after (§8.3);
 * all that changes is that the console stops being silent.
 */
describe('a non-literal element inside `in [...]` is diagnosed, not resolved (objectui#4266)', () => {
  /* 8.1 — it fires, and it names the predicate and the culprit element */

  it('`data.type in [data.a]` warns, naming the predicate and the unparseable element', () => {
    expect(evaluatePredicate('data.type in [data.a]', scope({ type: 'text', a: 'text' }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain('data.type in [data.a]');
    expect(warnings()).toContain('`data.a`');
  });

  it('a bare (unresolvable-shaped) identifier element is named too', () => {
    expect(evaluatePredicate("data.type in ['text', foo]", scope({ type: 'text' }))).toBe(false);
    expect(warnings()).toContain('`foo`');
  });

  it('a trailing comma with otherwise-literal elements still warns, falling back to the whole set', () => {
    // No single element is at fault here — every element parses fine on its
    // own, so `findUnparseableSetElement` finds none, and the warning names
    // the whole broken set instead of guessing at (and misnaming) a culprit.
    expect(evaluatePredicate("data.type in ['a','b',]", scope({ type: 'a' }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain("data.type in ['a','b',]");
    expect(warnings()).not.toContain('containing `');
  });

  /* 8.2 — one bad element still discards the good literals beside it, and the
     warning names the ONE that actually broke the parse, not the whole set
     blindly */

  it('one non-literal element collapses the WHOLE set, including the good literals next to it', () => {
    // Both sides hold 'text' — a working `in` would be true. It is false,
    // matching the pre-fix whole-set collapse; only the console changes.
    expect(evaluatePredicate("data.type in ['text', data.a]", scope({ type: 'text', a: 'text' }))).toBe(
      false,
    );
    expect(warnings()).toContain('`data.a`');
    // The warning names the culprit, not the innocent literal beside it.
    expect(warnings()).not.toContain("containing `'text'`");
  });

  /* 8.3 — the zero-semantics proof: verdicts identical to pre-change */

  it.each([
    ['data.type in [data.a]', { type: 'text', a: 'text' }, false], // would be true if paths resolved
    ["data.type in ['text', data.a]", { type: 'text', a: 'text' }, false], // good literal discarded too
    ["data.type in [data.a,]", { type: 'text', a: 'text' }, false],
  ])('%s over %j is still %s — the diagnostic changes no verdict', (expr, row, expected) => {
    expect(evaluatePredicate(expr, scope(row as Record<string, unknown>))).toBe(expected);
  });

  /* 8.4 — controls: literal-only `in` sets are completely unaffected */

  it.each([
    ["data.type in ['text','textarea']", { type: 'text' }, true],
    ["data.type in ['number','currency']", { type: 'text' }, false],
    ["data.type in ['a', 'b', 'c']", {}, false],
  ])('%s over %j → %s, silently (literal path unperturbed)', (expr, row, expected) => {
    expect(evaluatePredicate(expr, scope(row as Record<string, unknown>))).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  /* 8.5 — warn-once discipline, same bar as #6936 and #4049 */

  it('warns ONCE per (predicate, set) pair, not once per evaluation', () => {
    for (let i = 0; i < 5; i++) evaluatePredicate('data.type in [data.a]', scope({ type: 'text', a: 'x' }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('but a different predicate carrying the same broken set gets its own warning', () => {
    evaluatePredicate('data.type in [data.a]', scope({ type: 'text', a: 'x' }));
    evaluatePredicate('data.kind in [data.a]', scope({ kind: 'text', a: 'x' }));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  /* 8.6 — dev-mode only */

  it('the diagnostic is dev-mode only', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(evaluatePredicate('data.type in [data.a]', scope({ type: 'text', a: 'text' }))).toBe(false);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

/* ── 9. `in` with a PATH on the right is diagnosed, not resolved (objectui#6617) ── */

/**
 * objectui#6617. The `in` branch matches `/^(.+?)\s+in\s+(\[.*\])$/` — the right
 * side must be a BRACKETED literal set — so a membership test whose right side is
 * a PATH never reaches it. It carries no `==`/`!=` either, so it falls to the
 * bare-truthy tail and the WHOLE text is evaluated as one operand:
 *
 *   `'admin' in current_user.positions`  → quote-leading, so `parseLiteral`'s tail
 *      hands it back verbatim as a non-empty string ⇒ TRUE for every user.
 *   `data.roles in current_user.positions` → path-shaped, so `resolveValue` walks
 *      off the draft at `roles in current_user` ⇒ FALSE for every row.
 *
 * Both were SILENT: objectstack#6936's warning hangs on `resolveValue`'s path
 * branch, which quote-leading text never enters, and objectui#4049's
 * `PATH_SHAPED_LITERAL` only matches text starting with an identifier character.
 *
 * Ruling on this card: **diagnose only, zero semantic change** — the same posture
 * #4049 and #4266 took. Nothing new is resolved; the verdicts are pinned IDENTICAL
 * before and after (§9.3), measured on `origin/main` @ 9101be57 before the change
 * and asserted here after it.
 *
 * ⚠️ §9.2 is the load-bearing half. A naive `expr.includes(' in ')` would report a
 * bare quoted literal containing the word (`'plug in adapter'` — correct code, a
 * truthy string) as broken, which is a worse defect than the bug: a false
 * statement about the author's code. Both directions are pinned.
 */
describe('`in` with a path on the right is diagnosed, not resolved (objectui#6617)', () => {
  /** The scope this surface publishes once a host `ExpressionProvider` is present. */
  const userScope = (data: Record<string, unknown>, current_user: Record<string, unknown>) => ({
    data,
    current_user,
  });

  /**
   * WHICH diagnostic fired, identified by a phrase unique to each message.
   *
   * ⚠️ Deliberately not the bare card number: #6617's own text CITES
   * objectui#4049 as the rule that paths resolve only on the left of an
   * operator, so `toContain('objectui#4049')` is true of #6617's message too and
   * a mutual-exclusivity assertion written that way passes for the wrong reason
   * in one direction and fails spuriously in the other.
   */
  const SIG = {
    unresolvedPath6936: "is not a name in this form's evaluation scope",
    pathShapedLiteral4049: 'which looks like a path but is being used as the literal string',
    unparseableInSet4266: 'the WHOLE set was treated as EMPTY',
    inWithoutLiteralSet6617: 'spells a membership test',
  } as const;

  /* 9.1 — it fires, and it names both halves plus the supported subset */

  it("ADR-0068's headline spelling warns, naming the membership text and the predicate", () => {
    expect(
      evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: ['admin'] })),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    // Both halves or the warning sends nobody anywhere — same bar as #6936/#4049.
    expect(warnings()).toContain("'admin' in current_user.positions");
    expect(warnings()).toContain('[metadata-admin] visibility predicate');
  });

  it('the message names the supported subset', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    expect(warnings()).toContain("`path in ['a','b']`");
  });

  it('the message says plainly that this form CANNOT be written here — it does not imply a fix', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    // The author's next question is "then how do I write it?"; the honest answer
    // on this surface is "you cannot", and the message has to say so rather than
    // leave them hunting for punctuation that would work.
    expect(warnings()).toContain('CANNOT be written here today');
    expect(warnings()).toContain('not with different punctuation, not with a different spelling, not at all');
  });

  it('the message names the fail-OPEN direction for the quote-leading shape', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    expect(warnings()).toContain('TRUE for EVERY user');
    expect(warnings()).toContain('open to everyone');
  });

  it('the path-shaped left side (the FALSE-for-every-row shape) warns too', () => {
    expect(
      evaluatePredicate(
        'data.roles in current_user.positions',
        userScope({ roles: ['admin'] }, { positions: ['admin'] }),
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain('data.roles in current_user.positions');
  });

  it('fires identically whether or not `current_user` is bound — the gap is grammatical', () => {
    // The text begins with a quote, so `resolveValue`'s literal shortcut hands it
    // to `parseLiteral` and the root is never resolved at all. Binding cannot
    // change the verdict, and it does not change the diagnostic either.
    expect(evaluatePredicate("'admin' in current_user.positions", scope({}))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain("'admin' in current_user.positions");
  });

  it('`data.*` on the right is the same gap as `current_user.*`', () => {
    expect(evaluatePredicate("'x' in data.tags", scope({ tags: ['zzz'] }))).toBe(true);
    expect(warnings()).toContain("'x' in data.tags");
  });

  it('fires on a sub-expression inside `||`, naming the sub-expression and the whole predicate', () => {
    expect(
      evaluatePredicate(
        "'admin' in current_user.positions || data.kind == 'x'",
        userScope({ kind: 'z' }, { positions: [] }),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain("'admin' in current_user.positions");
    expect(warnings()).toContain("'admin' in current_user.positions || data.kind == 'x'");
  });

  it('an extra space around `in` is still detected (the walk matches the token, not the gap)', () => {
    expect(evaluatePredicate("'admin'  in  current_user.positions", userScope({}, { positions: [] }))).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  /* 9.2 — THE TRAP, both directions: the quote-aware scan must not accuse
     correct code. A naive `.includes(' in ')` fails every case below. */

  it.each([
    ['a bare single-quoted literal containing the word', "'plug in adapter'", {}],
    ['the same, double-quoted', '"plug in adapter"', {}],
    ['a literal whose text is only the word', "' in '", {}],
    ['a quoted literal on the RIGHT of `==`', "data.label == 'plug in adapter'", { label: 'plug in adapter' }],
    ['a quoted literal inside an `in` SET', "data.label in ['plug in adapter','x']", { label: 'x' }],
    ['a quoted literal carrying an apostrophe-free inner quote', '"it in that"', {}],
  ])('%s does NOT warn — correct code is never accused', (_label, expr, row) => {
    evaluatePredicate(expr as string, scope(row as Record<string, unknown>));
    expect(warn).not.toHaveBeenCalled();
  });

  it('the negation of a quoted literal containing the word is silent too', () => {
    expect(evaluatePredicate("!'plug in adapter'", scope({}))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a quoted literal containing the word stays TRUTHY — the verdict is untouched by the scan', () => {
    expect(evaluatePredicate("'plug in adapter'", scope({}))).toBe(true);
  });

  it.each([
    ["data.kind in ['a','b']", { kind: 'a' }, true],
    ["data.kind in ['a','b']", { kind: 'z' }, false],
    ["data.type in ['text','textarea']", { type: 'text' }, true],
  ])('control: the supported literal-set form %s stays silent and discriminating', (expr, row, expected) => {
    expect(evaluatePredicate(expr as string, scope(row as Record<string, unknown>))).toBe(expected);
    expect(warn).not.toHaveBeenCalled();
  });

  /* 9.3 — the zero-semantics proof: verdicts identical to pre-change.
     Every row below was MEASURED on origin/main @ 9101be57 before the change and
     produced exactly these verdicts; they are re-asserted here after it. */

  it.each([
    ["'admin' in current_user.positions", { data: {}, current_user: { positions: ['admin'] } }, true],
    ["'admin' in current_user.positions", { data: {}, current_user: { positions: ['viewer'] } }, true],
    ["'admin' in current_user.positions", { data: {}, current_user: { positions: [] } }, true],
    ["'admin' in current_user.positions", { data: {} }, true],
    ["'x' in data.tags", { data: { tags: ['x'] } }, true],
    ["'x' in data.tags", { data: { tags: ['zzz'] } }, true],
    ['data.roles in current_user.positions', { data: { roles: ['admin'] }, current_user: { positions: ['admin'] } }, false],
    ['type in current_user.positions', { data: {}, current_user: { positions: ['admin'] } }, true],
    ["'plug in adapter'", { data: {} }, true],
    ['"plug in adapter"', { data: {} }, true],
    ["data.label == 'plug in adapter'", { data: { label: 'plug in adapter' } }, true],
    ["'admin' in current_user.positions || data.kind == 'x'", { data: { kind: 'z' }, current_user: { positions: [] } }, true],
    ["data.flag && 'admin' in current_user.positions", { data: { flag: true }, current_user: { positions: [] } }, true],
    ["data.flag && 'admin' in current_user.positions", { data: { flag: false }, current_user: { positions: [] } }, false],
    ["'admin'  in  current_user.positions", { data: {}, current_user: { positions: [] } }, true],
    ["('admin' in current_user.positions)", { data: {}, current_user: { positions: [] } }, true],
    ["data.kind in ['a','b']", { data: { kind: 'a' } }, true],
    ["data.kind in ['a','b']", { data: { kind: 'z' } }, false],
    ["data.type in ['text', data.a]", { data: { type: 'text', a: 'text' } }, false],
    ['data.a == data.b', { data: { a: 'x', b: 'x' } }, false],
  ])('%s over %j is still %s — the diagnostic changes no verdict', (expr, ctx, expected) => {
    expect(evaluatePredicate(expr as string, ctx as never)).toBe(expected);
  });

  /* 9.4 — warn-once discipline, keyed exactly like the three Sets above */

  it('warns ONCE per (membership sub-expression, predicate) pair, not once per evaluation', () => {
    for (let i = 0; i < 5; i++) {
      evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    }
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('but a different predicate carrying the same membership text gets its own warning', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    evaluatePredicate(
      "'admin' in current_user.positions || data.kind == 'x'",
      userScope({ kind: 'z' }, { positions: [] }),
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('`resetPredicateWarnings` clears this memo along with the other three', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    expect(warn).toHaveBeenCalledTimes(1);
    resetPredicateWarnings();
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  /* 9.5 — dev-mode only */

  it('the diagnostic is dev-mode only', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(
        evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] })),
      ).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  /* 9.6 — no overlap with #4266, and neither can mask the other.
     They are mutually exclusive BY CONSTRUCTION: #4266 fires from
     `parseLiteral`'s array branch, reachable only for text that already matched
     an operator branch (`in`'s right side, or `==`'s); this one fires at the
     bare-truthy tail, reachable only when EVERY operator branch declined. */

  it('a #4266 predicate fires #4266 only — no brackets means no overlap', () => {
    expect(evaluatePredicate('data.type in [data.a]', scope({ type: 'text', a: 'text' }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain(SIG.unparseableInSet4266);
    expect(warnings()).not.toContain(SIG.inWithoutLiteralSet6617);
  });

  it('a #4049 predicate fires #4049 only', () => {
    expect(evaluatePredicate('data.a == data.b', scope({ a: 'x', b: 'x' }))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain(SIG.pathShapedLiteral4049);
    expect(warnings()).not.toContain(SIG.inWithoutLiteralSet6617);
  });

  it('a #6617 predicate fires #6617 only', () => {
    evaluatePredicate("'admin' in current_user.positions", userScope({}, { positions: [] }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain(SIG.inWithoutLiteralSet6617);
    expect(warnings()).not.toContain(SIG.unparseableInSet4266);
    expect(warnings()).not.toContain(SIG.pathShapedLiteral4049);
  });

  it('one predicate carrying BOTH gaps reports BOTH — neither masks the other', () => {
    expect(
      evaluatePredicate(
        "data.type in ['text', data.a] || 'admin' in current_user.positions",
        userScope({ type: 'text', a: 'text' }, { positions: [] }),
      ),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warnings()).toContain(SIG.unparseableInSet4266);
    expect(warnings()).toContain(SIG.inWithoutLiteralSet6617);
  });

  it('an unbound root reports BOTH this gap and objectstack#6936 — both statements are true', () => {
    // `type in current_user.positions` is path-shaped, so `resolveValue` throws
    // on the unbound root `type in current_user`. The membership diagnostic is
    // raised BEFORE that throw, so the author learns the shape is unsupported as
    // well as that the name is unknown. Verdict unchanged: fail-open true.
    expect(
      evaluatePredicate('type in current_user.positions', userScope({}, { positions: ['admin'] })),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warnings()).toContain(SIG.inWithoutLiteralSet6617);
    expect(warnings()).toContain(SIG.unresolvedPath6936);
  });

  /* 9.7 — the spellings the reused walk cannot see fail to SILENCE, which is the
     pre-existing behaviour, never to a false claim about the author's code */

  it('a parenthesised membership sits at depth > 0 and is not detected — silent, as before', () => {
    // The evaluator does not support parentheses at all: the whole text is a
    // path-shaped operand with an unbound root, so #6936 fires and the verdict
    // is fail-open true. Widening the walk to reach it would mean teaching the
    // detection about syntax the evaluator itself rejects.
    expect(
      evaluatePredicate("('admin' in current_user.positions)", userScope({}, { positions: [] })),
    ).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toContain(SIG.unresolvedPath6936);
    expect(warnings()).not.toContain(SIG.inWithoutLiteralSet6617);
  });

  it('a tab-separated `in` is not detected — a miss is silence, not a false claim', () => {
    expect(evaluatePredicate("'admin'\tin\tcurrent_user.positions", userScope({}, { positions: [] }))).toBe(
      true,
    );
    expect(warnings()).not.toContain(SIG.inWithoutLiteralSet6617);
  });
});
