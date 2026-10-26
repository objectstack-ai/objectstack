/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7027 — the gantt date TYPE GATE is made total, and the totality is
 * EXERCISED rather than asserted.
 *
 * ## Why this file exists at all, and why it is the deliverable
 *
 * Four cards have now made a totality claim about this one code path, and each
 * of the first three was falsified by the next one's MEASUREMENT:
 *
 *   1. #6759 declared `spellGanttDateValue` "total by construction".
 *   2. #6905 (#6781's type rule) made that property load-bearing by ordering
 *      the type gate BEFORE `new Date`.
 *   3. #6907 (PR #7026) measured that the speller was NOT total — `String`
 *      ran author `toString`, and three inputs crashed the render on `main`.
 *      The gate had not removed the crash class; it moved it downstream.
 *   4. This card: the GATE has a gap of the same kind, one function upstream.
 *      `value instanceof Date` answers "does this inherit from
 *      `Date.prototype`", not "is this a Date", and the two differ.
 *
 * A fifth prose assertion would continue the sequence. What ends it is a
 * PINNED ADVERSARIAL INPUT SET — every way the language lets an object lie
 * about being a Date, each one asserted to reach a DEFINED outcome. That is
 * what #7026 gave the speller and what the gate did not have.
 *
 *   5. objectui#7036: the gate's repair held, and the SPELLER still was not
 *      total — `Array.isArray` throws on a revoked `Proxy`. That card did not
 *      repair it; it ruled the exclusion STATED AND EXERCISED, which is what
 *      `pin 4` at the foot of this file is. It also measured that the card's
 *      own headline was wrong: `Array.isArray` is not the last non-total
 *      operation on the PATH, only inside that function (objectui#7153).
 *
 *   6. objectui#7153: the UPSTREAM reads. That card said five sites; driven in
 *      render there are six in `findUnusableGanttDate` and three more in
 *      `calculateDateRange`, and a tenth is NOT MEASURED. It took the same
 *      stated-and-exercised branch for the six (`pin 5`) after re-testing the
 *      `catch` argument rather than inheriting it — measured, a `catch`
 *      upstream reads the PATH half and still substitutes the VALUE half, and
 *      buys 3 of 9. And it falsified the class claim as well as the count: the
 *      three in `calculateDateRange` are plain JSON, not exotica, so they were
 *      pinned as a DEFECT (`pin 6`, objectui#7164) and not as an exclusion.
 *
 *   7. objectui#7164 (maintainer ruling 2026-09-02, A+): the defect is
 *      REPAIRED — `classifyGanttRows` reads the raw shape once and refuses a
 *      malformed row through its own key, and the three readers consume its
 *      verdict. `pin 6` below now pins the REFUSAL, and two rows of `pin 5`
 *      moved with the reads they exercise: a revoked proxy handed as `items`
 *      or as a row's `items` now dies at `Array.isArray` in that function
 *      (`IsArray`, the class pin 4 already states) rather than at U1 / U4.
 *
 * ⚠️ So this file's input set is not a claim of totality either. It is the
 * boundary that has actually been exercised, and the seventh card will be the
 * one that says where it ends. Every entry above was written as the settled
 * answer; five of the six were moved by the next card's measurement.
 *
 * ## What "a defined outcome" means here — two kinds, and never a third
 *
 * ⚠️ Not every row below is a refusal, and forcing them all to be one would
 * change the accept set, which is #6781's ruling and is untouched by this card.
 * Every input reaches exactly one of:
 *
 *   - ACCEPTED  — it is a real Date, so the chart draws (rows 5 and 6 below).
 *   - NAMED     — it is refused through #6759/#6770/#6781's single existing
 *                 diagnostic, with the authored path and a spelling.
 *
 * and never the third, which is what this card removes:
 *
 *   - THREW     — an uncaught TypeError mid-render, i.e. a blank screen where
 *                 a named diagnostic belongs.
 *
 * ## The base readings — measured on 7fc5c3c12, node probe + this suite
 *
 *     Object.create(Date.prototype)              -> THREW TypeError: Method
 *         Date.prototype.toString called on incompatible receiver
 *         [object Object]                        (in `isUnusable`, and again
 *                                                 in `spellGanttDateValue`)
 *     new Proxy(Object.create(Date.prototype),
 *               { get() { throw } })             -> THREW  (the get trap, via
 *                                                 ToPrimitive in `new Date`)
 *     new Proxy({}, { getPrototypeOf() { throw } })
 *                                                -> THREW  (`instanceof`
 *                                                 itself is not total)
 *     class X extends Date { getTime() { throw } }
 *                                                -> accepted, chart drew (the
 *                                                 CONTROL that rejects one of
 *                                                 the two suggested repairs)
 *     { get [Symbol.toStringTag]() { throw } }   -> named "an object" (the
 *                                                 CONTROL that rejects the
 *                                                 other suggested repair)
 *     new Proxy({}, { get() { throw } })         -> named "an object"
 *     new Date('2024-01-01')                     -> accepted, chart drew
 *     new Date(NaN)                              -> named "Invalid Date"
 *
 * The three THREW rows are the defect. The two CONTROL rows are the reason the
 * repair is neither of the two the card suggested — see pin 2.
 *
 * ## Assertions count BAR ELEMENTS, never styles
 *
 * #6759's rule, inherited through #6770 and #6781: a bar whose geometry is
 * `NaN` carries NO `style` attribute at all, so an assertion phrased over
 * styles reads identically for "the bar is gone" and "the bar is there and
 * broken". Refusal assertions are positive about the diagnostic and count
 * elements; styles are read only where an UNCHANGED geometry is the point.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TimelineRenderer } from '../renderer';

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useDataScope: () => undefined,
    useNavigationOverlay: () => ({
      isOverlay: false,
      handleClick: vi.fn(),
      selectedRecord: null,
      isOpen: false,
      close: vi.fn(),
      setIsOpen: vi.fn(),
      mode: 'overlay',
      view: undefined,
    }),
    useObjectLabel: () => ({
      fieldOptionLabel: (_o: string, _f: string, _v: string, fb: string) => fb,
      translateOptions: (_o: string, _f: string, opts: unknown[]) => opts,
      fieldLabel: (_o: string, _f: string, fb: string) => fb,
    }),
  };
});

const TESTID = 'timeline-unusable-date-range';
const PATH = 'items[0].items[0].endDate';

/** The axis header cells the gantt branch emits, in order. */
const axisOf = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.border-r.text-xs.font-medium.text-center')).map(
    (n) => n.textContent ?? '',
  );

/** How many bar ELEMENTS exist — not their geometry. See the header. */
const barCountOf = (container: HTMLElement): number =>
  container.querySelectorAll('.absolute.h-8.rounded-md').length;

/** The diagnostic's text, or `null` when the gantt rendered instead. */
const diagnosticOf = (container: HTMLElement): string | null => {
  const el = container.querySelector(`[data-testid="${TESTID}"]`);
  return el ? el.textContent ?? '' : null;
};

const gantt = (schema: Record<string, unknown>) =>
  render(<TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as any} />);

/** One row carrying one item, so a case only has to say what is wrong with it. */
const rowWith = (item: Record<string, unknown>) => [{ label: 'R', items: [{ title: 'T', ...item }] }];

/**
 * The adversarial constructors, as FACTORIES.
 *
 * Each is built fresh per case on purpose: several of these are single-use
 * (a revoked proxy, a getter that throws) and a shared instance would let one
 * case's first touch decide another case's reading.
 */

/** Inherits `Date.prototype`, owns no `[[DateValue]]` slot. The filed defect. */
const slotlessImpostor = () => Object.create(Date.prototype) as unknown;

/** The same impostor, behind a proxy that also refuses every property read. */
const hostileSlotlessImpostor = () =>
  new Proxy(Object.create(Date.prototype), {
    get() {
      throw new Error('get trap: no property of this value may be read');
    },
  }) as unknown;

/** Breaks `instanceof` ITSELF — `instanceof` walks `[[GetPrototypeOf]]`. */
const prototypeHostileProxy = () =>
  new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('getPrototypeOf trap: this value has no readable prototype');
      },
    },
  ) as unknown;

/** Refuses every property read, but is honest about its prototype. */
const readHostileProxy = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error('get trap: no property of this value may be read');
      },
    },
  ) as unknown;

/** A REAL Date (it owns its slot) whose `getTime` is hijacked to throw. */
class HijackedGetTime extends Date {
  override getTime(): number {
    throw new Error('getTime hijacked by the authored document');
  }
}

/**
 * A REVOKED proxy — the one input `spellGanttDateValue` is documented NOT to
 * survive (objectui#7036). `Proxy.revocable` is the only way to spell it, and
 * nothing in any package `src/` calls it: this is a test-only value.
 */
const revokedProxy = (target: object = {}) => {
  const { proxy, revoke } = Proxy.revocable(target, {});
  revoke();
  return proxy as unknown;
};

/** An object whose `Symbol.toStringTag` is a throwing getter. */
const throwingToStringTag = () =>
  ({
    get [Symbol.toStringTag](): string {
      throw new Error('Symbol.toStringTag getter throws');
    },
  }) as unknown;

describe('pin 1 — a Date IMPOSTOR is NAMED, never thrown (objectui#7027)', () => {
  /**
   * The defect, in its three measured spellings. Every one of these passed
   * `value instanceof Date` (or crashed inside it) on 7fc5c3c12 and took the
   * render down with an uncaught `TypeError`.
   *
   * The assertion is deliberately about the DIAGNOSTIC and not about the
   * absence of a throw: `render` propagates a render-time error, so a
   * regression here fails loudly on the first line rather than on a
   * `not.toThrow` that would also pass for a silently-drawn wrong chart.
   */
  const impostors: [string, () => unknown][] = [
    [
      'Object.create(Date.prototype) — inherits the prototype, owns no [[DateValue]] slot',
      slotlessImpostor,
    ],
    [
      'the same impostor behind a Proxy that throws on every get',
      hostileSlotlessImpostor,
    ],
    [
      'a Proxy whose getPrototypeOf trap throws — `instanceof` is not total either',
      prototypeHostileProxy,
    ],
  ];

  for (const [label, make] of impostors) {
    it(`names ${label}`, () => {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: make() }) });

      const el = screen.getByTestId(TESTID);
      // The same channel #6759/#6770/#6781 use. No second diagnostic, no new
      // i18n key — an impostor is refused as the non-date it is.
      expect(el.getAttribute('role')).toBe('alert');
      const text = el.textContent ?? '';
      expect(text, 'the diagnostic did not name the authored path').toContain(PATH);
      // Named by TYPE, never rendered: producing text from an impostor is the
      // one operation that hands control back to the authored document.
      expect(text, 'the impostor was rendered instead of named').toContain('is an object');
      // No chart was drawn from a value that is not a date.
      expect(axisOf(container), 'a chart was drawn from a Date impostor').toEqual([]);
      expect(barCountOf(container)).toBe(0);
      expect(screen.queryByText('T')).toBeNull();
    });
  }

  it('a Proxy that throws on every get is named, not thrown', () => {
    // Refused on the base too (its prototype is `Object.prototype`), so this
    // row is a REGRESSION pin rather than a repair: the gate's new brand test
    // must not start reading properties off the value.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: readHostileProxy() }),
    });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain(PATH);
    expect(text).toContain('is an object');
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 2 — the two SUGGESTED repairs, each with the input that refutes it (objectui#7027)', () => {
  /**
   * The card offered two brand tests and triage flagged both as "not free".
   * These two rows are why neither was taken, and they are the rows that go
   * red if a later reader "simplifies" the gate into one of them.
   */

  it('a Date subclass whose `getTime` throws is ACCEPTED — refutes `Number.isFinite(value.getTime())`', () => {
    // It is a REAL Date: `super()` gave it a `[[DateValue]]` slot, so it is
    // inside #6781's accept set and the chart must draw. A gate written as
    // `Number.isFinite(value.getTime())` would call the AUTHOR's `getTime` and
    // die here — trading the impostor crash for a subclass crash.
    //
    // `new Date(x)` never runs ToPrimitive on a value that owns the slot, so
    // the hijack is unreachable from the guard as written.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new HijackedGetTime('2024-03-01') }),
    });

    expect(diagnosticOf(container), 'a real Date subclass was refused').toBeNull();
    expect(barCountOf(container), 'the chart did not draw for a real Date').toBe(1);
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
  });

  it('an object with a throwing `Symbol.toStringTag` getter is NAMED — refutes `Object.prototype.toString.call`', () => {
    // `Object.prototype.toString` always performs `Get(O, @@toStringTag)`
    // (ES2015 step 16) even when the builtin tag is already decided, so the
    // brand test runs this getter and throws. Measured — the same fact #6907
    // recorded when it refused that spelling inside `spellGanttDateValue`.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: throwingToStringTag() }),
    });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain(PATH);
    expect(text).toContain('is an object');
    expect(barCountOf(container)).toBe(0);
  });
});

describe('pin 3 — the ACCEPT SET is unchanged: #6781’s ruling does not move (objectui#7027)', () => {
  /**
   * This card repairs a CRASH; it adjudicates nothing. Every value an author
   * can write must land exactly where #6781 put it. These are the controls.
   */

  it('a real, valid `Date` still draws its chart', () => {
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new Date('2024-03-01') }),
    });

    expect(diagnosticOf(container), 'a real Date was refused').toBeNull();
    expect(barCountOf(container)).toBe(1);
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
  });

  it('`new Date(NaN)` is still refused by the PARSE check, and still spelled `Invalid Date`', () => {
    // The load-bearing half of "do not change the accept set": an invalid Date
    // owns its slot, so it must pass the TYPE gate and be refused one step
    // later. A brand test that refused it would move the diagnostic's spelling
    // from `Invalid Date` to `an object` — a visible change to an author.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new Date(Number.NaN) }),
    });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain(PATH);
    expect(text, 'the invalid Date lost its `Invalid Date` spelling').toContain('Invalid Date');
    expect(barCountOf(container)).toBe(0);
  });

  it('the three accepted spellings and the three refused ones are all where #6781 left them', () => {
    // A compact re-assertion across the accept-set boundary, so this file fails
    // if the brand test is ever widened or narrowed past the crash class.
    const accepted: [string, unknown][] = [
      ['a date string', '2024-03-01'],
      ['a finite number (epoch ms)', 1709251200000],
      ['a real Date', new Date('2024-03-01')],
    ];
    for (const [label, value] of accepted) {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: value }) });
      expect(diagnosticOf(container), `${label} was refused`).toBeNull();
      expect(barCountOf(container), `${label} drew no bar`).toBe(1);
    }

    const refused: [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['a boolean', false],
    ];
    for (const [label, value] of refused) {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate: value }) });
      expect(diagnosticOf(container) ?? '', `${label} was accepted`).toContain(PATH);
      expect(barCountOf(container), `${label} drew a bar`).toBe(0);
    }
  });
});

/**
 * The message `Array.isArray` throws on a revoked `Proxy` — the language's, so
 * it is matched, not paraphrased. Module-scoped because two pins read it: pin 4
 * (the speller's site) and, since objectui#7164, pin 5 (the row walk's).
 */
const REVOKED_ISARRAY = /Cannot perform 'IsArray' on a proxy that has been revoked/;

describe('pin 4 — the ONE documented EXCLUSION, exercised not asserted (objectui#7036)', () => {
  /**
   * `spellGanttDateValue`'s `Array.isArray` is not total: `IsArray` recurses
   * into `[[ProxyTarget]]` and a REVOKED proxy has none, so it throws while
   * naming the value. objectui#7036 adjudicated this as STATED-AND-EXERCISED
   * rather than repaired, on three grounds recorded in that function's
   * docblock: it is unreachable from an authored document (JSON cannot spell
   * a proxy), a `catch` here would SUBSTITUTE `an object` for a failure
   * rather than read anything the way `isDate`'s catch does, and it would not
   * make the PATH total anyway — five reads that FETCH the date throw first
   * (objectui#7153).
   *
   * ## Why a THROW is pinned here, and why not with a bare `toThrow()`
   *
   * This file exists because four prose totality claims on this path were
   * each falsified by the next card's measurement. A docblock sentence saying
   * "except a revoked proxy" would be a fifth claim of the same species. The
   * rows below make the exclusion a MEASUREMENT instead, and they assert the
   * throw's own MESSAGE: a bare `toThrow()` passes for any error from any
   * line, so it would stay green if the crash moved to `instanceof`, to
   * `Object.prototype.toString`, or upstream into the row walk — which is
   * precisely what has happened on this path four times. The message names
   * both the operation (`IsArray`) and the cause (`revoked`), so the pin
   * fails if the site moves and fails if the exclusion is ever repaired,
   * either of which must come with a docblock edit.
   */


  // Every target shape: the throw is about revocation, not about the target.
  const targets: [string, () => object][] = [
    ['{}', () => ({})],
    ['[]', () => []],
    ['a function', () => function noop() {}],
    ['a real Date', () => new Date('2024-03-01')],
  ];

  for (const [label, makeTarget] of targets) {
    it(`a revoked Proxy over ${label} throws at \`Array.isArray\`, by design`, () => {
      expect(() =>
        gantt({ items: rowWith({ startDate: '2024-01-01', endDate: revokedProxy(makeTarget()) }) }),
      ).toThrow(REVOKED_ISARRAY);
    });
  }

  it('a revoked Proxy pinned as `minDate` reaches the same site', () => {
    // The pinned limb takes the same speller, so the exclusion is not
    // confined to a row item. `value &&` is ToBoolean and does not throw.
    expect(() =>
      gantt({
        items: rowWith({ startDate: '2024-01-01', endDate: '2024-03-01' }),
        minDate: revokedProxy(),
      }),
    ).toThrow(REVOKED_ISARRAY);
  });

  it('CONTROL — a LIVE Proxy is still NAMED `an object`, so the rows above are about REVOCATION', () => {
    // Without this the four rows above would also pass if the whole gantt
    // branch had broken. `typeof` does not separate a revoked proxy out
    // either: it answers `'object'` for one, exactly as it does here.
    const { container } = gantt({
      items: rowWith({ startDate: '2024-01-01', endDate: new Proxy({}, {}) }),
    });

    const text = diagnosticOf(container) ?? '';
    expect(text).toContain(PATH);
    expect(text).toContain('is an object');
    expect(barCountOf(container)).toBe(0);
  });
});

/**
 * A proxy that refuses ONE named operation and is honest about the rest, so
 * the thrown message identifies WHICH read died. `Reflect.get` for everything
 * else keeps the value ordinary right up to the site under test.
 */
const trapOn = (target: object, key: string, message: string) =>
  new Proxy(target, {
    get(t, p, r) {
      if (p === key) throw new Error(message);
      return Reflect.get(t, p, r);
    },
  }) as any;

/** One ordinary gantt row, as the hostile rows' non-hostile twin. */
const GOOD_ITEM = { title: 'T', startDate: '2024-01-01', endDate: '2024-03-01' };
const goodRow = () => ({ label: 'R', items: [{ ...GOOD_ITEM }] });

const REVOKED_GET = /Cannot perform 'get' on a proxy that has been revoked/;

describe('pin 5 — the SIX non-total reads UPSTREAM of the speller (objectui#7153)', () => {
  /**
   * objectui#7036 documented `spellGanttDateValue`'s `Array.isArray` as the
   * one exclusion on the gantt date path and pointed at this card for the
   * reads that run BEFORE the speller is entered. objectui#7153's card named
   * five of them; driven in render on 51449a043 there are SIX in
   * `findUnusableGanttDate` alone, and three more in `calculateDateRange`
   * (pin 6 below, a different reachability class entirely — and REPAIRED by
   * objectui#7164, which also moved U1–U3 into `classifyGanttRows`; the trap
   * messages below are unchanged because the trap writes them, so these rows
   * hold across that move, and the two revoked-proxy rows that changed site
   * say so).
   *
   * ## Why these are PINNED AS THROWS rather than repaired
   *
   * Same three grounds objectui#7036 recorded for its own site, and the middle
   * one was RE-TESTED here rather than inherited, because upstream is not the
   * same shape as the speller:
   *
   * 1. Unreachable from an authored document — JSON spells neither a getter
   *    nor a proxy. Re-swept on 51449a043 with a comment-stripped instrument:
   *    `Proxy.revocable`, `new Proxy`, the bare word `Proxy` and
   *    `Object.setPrototypeOf` are each 0 across every package `src/` outside
   *    tests, beside live controls of `Object.assign` 19 and `JSON.parse` 105
   *    on that same instrument; the SAME query widened to the whole repo returns 1, 21
   *    and 105 (tests only), which is what makes the narrow zeros readings.
   * 2. A `catch` upstream reads HALF of what it would need, which is more than
   *    the speller's `catch` reads and still not enough. Measured by ablation:
   *    a `try` around U6 reporting the path from the loop counters came back
   *    NAMED `items[0].items[0].endDate` — exact, because the path is built
   *    from indices and never touches the value, unlike at the speller where
   *    the `catch` holds only the value it cannot read. But the VALUE half is
   *    still substitution (the diagnostic read `is "UNREADABLE"`), so a real
   *    repair needs a value-less diagnostic and therefore a new i18n key
   *    across ten locale packs.
   * 3. It would buy 3 of 9. That same ablation converted U5, U6 and the
   *    throwing-getter item and left U1 through U4 throwing upstream of it and
   *    `calculateDateRange`'s three throwing downstream — the "1 of 6" trade
   *    objectui#7036's triage refused, at a different site.
   *
   * ## The assertions name the MESSAGE, and the messages name the SITE
   *
   * A bare `toThrow()` passes for any error from any line, so it would stay
   * green through exactly the relocation this path has performed four times.
   * Four of the six rows drive a proxy that refuses ONE named operation, so
   * the message identifies the read that died. A row goes red both if its site
   * is repaired and if the crash moves — either of which must come with a
   * docblock edit.
   */

  const sites: [string, () => Record<string, unknown>, RegExp][] = [
    [
      'U1 `items.length` — the row loop condition',
      () => ({ items: trapOn([goodRow()], 'length', 'U1: items.length trap') }),
      /U1: items\.length trap/,
    ],
    [
      'U2 `items[rowIndex]` — the row index get',
      () => ({ items: trapOn([goodRow()], '0', 'U2: items[0] trap') }),
      /U2: items\[0\] trap/,
    ],
    [
      'U3 `items[rowIndex]?.items` — reading `items` off the row',
      () => ({ items: [trapOn(goodRow(), 'items', 'U3: row.items getter trap')] }),
      /U3: row\.items getter trap/,
    ],
    [
      'U4 `rowItems.length` — the item loop condition',
      () => ({ items: [{ label: 'R', items: trapOn([{ ...GOOD_ITEM }], 'length', 'U4: rowItems.length trap') }] }),
      /U4: rowItems\.length trap/,
    ],
    [
      'U5 `rowItems[itemIndex]` — the item index get',
      () => ({ items: [{ label: 'R', items: trapOn([{ ...GOOD_ITEM }], '0', 'U5: rowItems[0] trap') }] }),
      /U5: rowItems\[0\] trap/,
    ],
    [
      'U6 `rowItems[itemIndex]?.[key]` — the date read itself',
      () => ({ items: [{ label: 'R', items: [trapOn({ ...GOOD_ITEM }, 'endDate', 'U6: endDate getter trap')] }] }),
      /U6: endDate getter trap/,
    ],
  ];

  for (const [label, make, message] of sites) {
    it(`${label} is NOT total — it throws, by design`, () => {
      expect(() => gantt(make())).toThrow(message);
    });
  }

  /**
   * The revoked `Proxy` reaches four of those six sites depending on WHERE it
   * is pinned, and all four share one message because the language writes it.
   * They are separate rows so that repairing one site turns exactly one red.
   */
  const revokedPositions: [string, () => Record<string, unknown>, RegExp][] = [
    // objectui#7164: `classifyGanttRows` asks `Array.isArray(items)` before
    // U1 can read `items.length`, and `Array.isArray(row.items)` before U4 can
    // read its `length`. A revoked proxy dies at the FIRST operation that
    // touches it, so these two now throw `IsArray` (pin 4's class) instead of
    // `get`. Same reachability argument, same exclusion; the site moved.
    ['as `items` itself (dies at `Array.isArray` in `classifyGanttRows`, upstream of U1)', () => ({ items: revokedProxy([]) }), REVOKED_ISARRAY],
    // objectui#7364: `classifyGanttRows` now asks `Array.isArray(row)` (a row
    // must be an object, not an array) before U3 reads `row.items`, so a
    // revoked proxy as a ROW dies at `IsArray` too. Same exclusion; the site
    // moved one operation up, inside the same function.
    ['as a ROW (dies at `Array.isArray` in `classifyGanttRows`, upstream of U3)', () => ({ items: [revokedProxy()] }), REVOKED_ISARRAY],
    ["as a row's `items` (dies at `Array.isArray` in `classifyGanttRows`, upstream of U4)", () => ({ items: [{ label: 'R', items: revokedProxy([]) }] }), REVOKED_ISARRAY],
    ['as an ITEM (dies at U6)', () => ({ items: [{ label: 'R', items: [revokedProxy()] }] }), REVOKED_GET],
  ];

  for (const [label, make, message] of revokedPositions) {
    it(`a revoked Proxy ${label}`, () => {
      expect(() => gantt(make())).toThrow(message);
    });
  }

  it('CONTROL — a LIVE Proxy at every one of those positions still DRAWS', () => {
    // Without this the ten rows above would also pass if the gantt branch had
    // simply broken. These are the same positions, proxied and not hostile, so
    // the rows above are about REVOCATION and THROWING TRAPS and nothing else.
    const live: [string, Record<string, unknown>][] = [
      ['items', { items: new Proxy([goodRow()], {}) }],
      ['a row', { items: [new Proxy(goodRow(), {})] }],
      ["a row's items", { items: [{ label: 'R', items: new Proxy([{ ...GOOD_ITEM }], {}) }] }],
      ['an item', { items: [{ label: 'R', items: [new Proxy({ ...GOOD_ITEM }, {})] }] }],
    ];
    for (const [where, schema] of live) {
      const { container } = gantt(schema);
      expect(diagnosticOf(container), `a live Proxy at ${where} was refused`).toBeNull();
      expect(barCountOf(container), `a live Proxy at ${where} drew no bar`).toBe(1);
      expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    }
  });
});

describe('pin 6 — `calculateDateRange`’s three reads: the DEFECT, now REPAIRED (objectui#7164)', () => {
  /**
   * These rows were pinned as THROWS with a note saying they were EXPECTED to go
   * red when objectui#7164 landed, so that the repair could not land quietly.
   * It landed (maintainer ruling 2026-09-02, A+), they went red, and this is
   * the rewrite that note demanded.
   *
   * ## What they pin now
   *
   * The same nine inputs — still ordinary JSON — each REFUSED through
   * `timeline.gantt.unusableRange.malformedRow`, naming the authored path and
   * the value, and never through `malformedDate`. The full table, the
   * before/after readings, the controls and the key are in
   * `./timeline-gantt-malformed-row-7164.test.tsx`; this block keeps the rows
   * HERE so that this file's boundary stays exercised in one place, and so a
   * future relocation of the refusal (a guard that moves instead of closes —
   * the failure this path performed four times) reddens both files.
   *
   * ## Why it is still a different class from pin 5
   *
   * Nothing about reachability changed. `findUnusableGanttDate` read the walk
   * with `?.` and `|| []` and SKIPPED a row it could not index, while
   * `calculateDateRange` re-walked the same rows BARE; everything in the gap
   * crashed, and all of it was spellable in JSON and green through the
   * declared zod mirror. "JSON cannot spell this", the argument that excuses
   * pin 4 and pin 5, was false here — which is why these were a defect and
   * those are an exclusion. The repair reads the raw shape ONCE
   * (`classifyGanttRows`) and hands every reader the same verdict; the mirror
   * now refuses a non-object element and a non-array `row.items` at authoring
   * time as well (`@object-ui/types`, `timeline-items-row-shape-7164.test.ts`).
   */

  const ROW_CLAUSE = 'which is not a row shape';

  const refused: [string, Record<string, unknown>, string][] = [
    ['a `null` ROW', { items: [null] }, 'items[0] is null'],
    ['a `null` row BESIDE a good one', { items: [goodRow(), null] }, 'items[1] is null'],
    ["a row whose `items` is a number", { items: [{ label: 'R', items: 5 }] }, 'items[0].items is 5'],
    ["a row whose `items` is a plain object", { items: [{ label: 'R', items: {} }] }, 'items[0].items is an object'],
    ["a row whose `items` is `true`", { items: [{ label: 'R', items: true }] }, 'items[0].items is true'],
    [
      "a row whose `items` is ARRAY-LIKE — the old walk judged it USABLE, then died",
      { items: [{ label: 'R', items: { length: 1, 0: { ...GOOD_ITEM } } }] },
      'items[0].items is an object',
    ],
    ['`items` itself a plain object', { items: {} }, 'items is an object'],
    ['`items` itself a string', { items: 'x' }, 'items is "x"'],
    ['`items` itself a number', { items: 5 }, 'items is 5'],
  ];

  for (const [label, schema, head] of refused) {
    it(`REPAIRED — ${label} is REFUSED, naming the row`, () => {
      expect(() => gantt(schema)).not.toThrow();
      const { container } = gantt(schema);
      const text = diagnosticOf(container) ?? '';
      expect(text).toContain(head);
      expect(text).toContain(ROW_CLAUSE);
      expect(text).not.toContain('which is not a valid date');
      expect(barCountOf(container)).toBe(0);
    });
  }

  it('CONTROL — the row shapes NEXT TO the repaired class all still DRAW', () => {
    // The live controls that make the nine rows above readings rather than a
    // broken harness, and that fence the accept set: every one of these drew
    // before the repair and draws after it. The ruling refused the three lines
    // above and nothing wider.
    //
    // A non-null primitive row (`0`) and an array row (`[]`) stood here as
    // controls, drawing an unlabelled empty row, until objectui#7364 (ruling
    // 5809218505, letter A) DELIBERATELY SUPERSEDED that clause of the #7164
    // ruling: the renderer now refuses them as `validate` already did. They
    // are asserted as REFUSALS just below, not dropped.
    const drawn: [string, Record<string, unknown>][] = [
      ['an ordinary row', { items: [goodRow()] }],
      ['an empty items list', { items: [] }],
      ['a row with no `items` key', { items: [{ label: 'R' }] }],
      ['a row whose `items` is null', { items: [{ label: 'R', items: null }] }],
      ['a row whose `items` is an empty array', { items: [{ label: 'R', items: [] }] }],
    ];
    for (const [label, schema] of drawn) {
      const { container } = gantt(schema);
      expect(diagnosticOf(container), `${label} was refused`).toBeNull();
      expect(axisOf(container).length, `${label} drew no axis`).toBeGreaterThan(0);
    }

    // objectui#7364 — the two former controls, now REFUSED through the row door.
    for (const [row, spelled] of [[0, '0'], [[], 'an array']] as const) {
      const { container } = gantt({ items: [row] });
      expect(diagnosticOf(container) ?? '').toContain(`items[0] is ${spelled}, ${ROW_CLAUSE}`);
      expect(barCountOf(container)).toBe(0);
    }

    // The string that did NOT crash before — index-readable, so the old walk
    // named `items[0].items[0].startDate is undefined` through the DATE copy
    // by accident. A string is a truthy non-array, which is the ruling's row
    // door, so it now takes the ROW refusal and names the fault a reader can
    // act on. Recorded here because it is the one table row whose outcome
    // changed rather than its crash.
    const { container } = gantt({ items: [{ label: 'R', items: 'x' }] });
    expect(diagnosticOf(container) ?? '').toContain('items[0].items is "x"');
    expect(diagnosticOf(container) ?? '').toContain(ROW_CLAUSE);
    expect(barCountOf(container)).toBe(0);
  });
});
