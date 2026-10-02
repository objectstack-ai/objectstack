// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9359] The cases of the driver-fault redaction's load-time template guard.
//
// [#21385] Moved here, verbatim, with the module they test: the redaction moved
// from `@objectstack/objectql` to this package so `driver-sql`'s own log lines
// call the same cut as the engine. The guard and the template table it checks
// stay package-internal (not on `@objectstack/types`' entry), which is why
// their cases live beside them instead of in the engine suite that still pins
// the cut's behaviour (`packages/objectql/src/driver-fault-redaction.test.ts`).

import { describe, it, expect } from 'vitest';
import { VALUE_BEARING_TEMPLATES, assertHeadBearingTemplatesAreEndAnchored } from './driver-fault-redaction.js';

describe('#9359 — the head invariant is a GUARD, not a note', () => {
  // ⭐ Why this block exists at all. The invariant "only an end-of-message
  // template may declare a head" is the WHOLE of the argument that #9275's
  // head-anchored cut over-redacts rather than leaks. Until this card it was
  // held by prose plus the behavioural case above, which forges the heads the
  // table declares TODAY — nothing stopped a future author adding a
  // head-bearing row with a right anchor, which is the single shape that turns
  // the amendment into a leak surface.
  //
  // ⛔ The cautionary precedent is in this file's own history: the head note
  // once claimed leak-freedom also rested on taking the LAST matching head, and
  // that claim was FALSE — ablating to first-match left all 50 cases green. A
  // documented property about this very mechanism read as true for weeks and
  // fell only to an ablation. So these cases do not assert that the guard is
  // present; they assert that it FIRES, on each shape it claims to reject.

  /** A right-anchored `whole` — the shape that must never carry a `head`. */
  const RIGHT_ANCHORED = /(incorrect \w+ value:\s+)'[\s\S]*'(\s+for column\s+'[^']*')/gi;
  /** A well-formed end-of-message `whole`, for the cases isolating one fault. */
  const END_ANCHORED = /(truncated incorrect \w+ value:\s+)'[\s\S]*$()/gi;
  const SOME_HEAD = /truncated incorrect \w+ value:\s+'/gi;

  it('does NOT fire on the shipped table — it must not be a false alarm on `main`', () => {
    // The zero. Its positive control is every case below: the same function,
    // called the same way, throws on a row the shipped table does not contain.
    // The module-load call is the same assertion, so importing this file at all
    // has already exercised it — this case only says so out loud.
    expect(() => assertHeadBearingTemplatesAreEndAnchored(VALUE_BEARING_TEMPLATES)).not.toThrow();
  });

  it('the shipped table really does contain head-bearing rows — the guard has something to check', () => {
    // ⛔ Anti-vacuity of the case above: a guard that loops over zero
    // head-bearing rows also "does not throw". Two rows carry a `head` today
    // (mysql/1292, pg/22P02) and the rest take a `tail`.
    const headBearing = VALUE_BEARING_TEMPLATES.filter((t) => t.head !== undefined);
    expect(headBearing.map((t) => t.id)).toEqual([
      'mysql/1292 ER_TRUNCATED_WRONG_VALUE',
      'pg/22P02 invalid_text_representation',
    ]);
  });

  it('FIRES on a head-bearing row whose `whole` is right-anchored — the leak shape itself', () => {
    // This is the one way #9275's amendment can leak: the head-anchored cut
    // lands inside the statement, and a right anchor keeps everything after it.
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/right-anchored-with-head', whole: RIGHT_ANCHORED, head: SOME_HEAD },
    ])).toThrow(/does not end with/);
  });

  it('FIRES on an end-anchored `whole` that carries the `m` flag — `$` would mean end of LINE', () => {
    // Spelled end-anchored, not end-anchored. Under `m` a multi-line dump stops
    // at the first newline and the remainder — statement — survives.
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/multiline-flag', whole: /(truncated incorrect \w+ value:\s+)'[\s\S]*$()/gim, head: SOME_HEAD },
    ])).toThrow(/end of LINE/);
  });

  it('FIRES when the capture groups do not number exactly two', () => {
    // `redactDiagnosticValues` reads `whole[1]` and `whole[2]` by index, so a
    // third group silently reassigns what is kept after the value.
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/three-groups', whole: /(a)(b)'[\s\S]*$()/gi, head: SOME_HEAD },
    ])).toThrow(/capture group/);
  });

  it('names the offending row, so the throw is actionable rather than a riddle', () => {
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/right-anchored-with-head', whole: RIGHT_ANCHORED, head: SOME_HEAD },
    ])).toThrow(/test\/right-anchored-with-head/);
  });

  it('leaves ANCHORED rows alone — a right-anchored `whole` with no head is exactly correct', () => {
    // ⛔ The control that stops this guard from being "throw on anything that
    // is not end-anchored". Three of the five shipped families are right-
    // anchored on purpose; the invariant is about rows that declare a HEAD.
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/right-anchored-no-head', whole: RIGHT_ANCHORED, tail: /'(\s+for column\s+'[^']*')/gi },
    ])).not.toThrow();
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/end-anchored-with-head', whole: END_ANCHORED, head: SOME_HEAD },
    ])).not.toThrow();
  });

  it('checks EVERY row, not just the first — a bad row cannot hide behind a good one', () => {
    expect(() => assertHeadBearingTemplatesAreEndAnchored([
      { id: 'test/end-anchored-with-head', whole: END_ANCHORED, head: SOME_HEAD },
      { id: 'test/right-anchored-with-head', whole: RIGHT_ANCHORED, head: SOME_HEAD },
    ])).toThrow(/test\/right-anchored-with-head/);
  });
});
