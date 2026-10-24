/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6907 — HOW a refused gantt date is spelled, as a rule.
 *
 * ## The rule this file pins
 *
 *     Spell the value when the LANGUAGE owns its spelling.
 *     Name its TYPE when producing text would run AUTHOR code.
 *
 * `renderer.tsx`'s `spellGanttDateValue` carries the rule and its ground; this
 * file pins the readings. Which values are REFUSED is #6781's ruling and is
 * untouched — pin 5 is that control.
 *
 * ## What was wrong, measured on this card's base b458300ca
 *
 * `String(value)` was the fallback for everything that is not a string,
 * `undefined`, `null` or a symbol. #6905 routed the whole non-date type space
 * through it and it failed three different ways:
 *
 *     endDate: []                 -> "endDate is , which is not a valid date"
 *     endDate: ['2024-01-01']     -> "endDate is 2024-01-01, ..."
 *     endDate: [0]                -> "endDate is 0, ..."
 *     endDate: 0n                 -> "endDate is 0, ..."
 *     endDate: {toString: () => '2024-01-01'}
 *                                 -> "endDate is 2024-01-01, ..."
 *     endDate: new Map()          -> "endDate is [object Map], ..."
 *     endDate: {toString() { throw }}      -> THREW, uncaught, mid-render
 *     endDate: {get [Symbol.toStringTag]() { throw }}
 *                                          -> THREW, uncaught, mid-render
 *     endDate: Object.create(null)         -> THREW TypeError: Cannot convert
 *                                             object to primitive value
 *
 * It VANISHES (row 1), it LIES (rows 2-5 name a text that IS a valid date, or
 * a number that IS an accepted one), and it THROWS (the last three are live
 * crashes on `main`). The third is why this is not a cosmetic card: #6759
 * declared the helper "total by construction" and #6905 made that property
 * load-bearing, but the type gate only stopped `new Date` from throwing —
 * `String(value)` handed control to author code one line later, so the crash
 * class moved into the speller rather than going away.
 *
 * ## The obvious repair is REFUTED, and pin 4 keeps it refuted
 *
 * `JSON.stringify(0n)` throws. Spelling the value with it would put the crash
 * class straight back. Pin 4 asserts the totality property directly, over the
 * inputs that would break `JSON.stringify` as well as the ones that broke
 * `String`.
 *
 * ## Assertions read the WHOLE clause, not a bare substring
 *
 * `toContain('0')` is true of almost every diagnostic this component emits, and
 * the faults above are faults of the SENTENCE. So each spelling is asserted as
 * `` `${path} is ${spelling}, which is not a valid date` `` — the exact clause
 * an author reads — and the misleading readings are asserted GONE by name.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectTimeline } from '../ObjectTimeline';
import { TimelineRenderer } from '../renderer';
import { TIMELINE_DEFAULT_TRANSLATIONS } from '../useTimelineTranslation';

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

/** The diagnostic's text, or `null` when the gantt rendered instead. */
const diagnosticOf = (container: HTMLElement): string | null => {
  const el = container.querySelector(`[data-testid="${TESTID}"]`);
  return el ? el.textContent ?? '' : null;
};

/** How many bar ELEMENTS exist — #6759's rule, never their geometry. */
const barCountOf = (container: HTMLElement): number =>
  container.querySelectorAll('.absolute.h-8.rounded-md').length;

/** The axis header cells the gantt branch emits, in order. */
const axisOf = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('.border-r.text-xs.font-medium.text-center')).map(
    (n) => n.textContent ?? '',
  );

const gantt = (schema: Record<string, unknown>) =>
  render(<TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema } as any} />);

/** One row carrying one item, so a case only has to say what is wrong with it. */
const rowWith = (item: Record<string, unknown>) => [{ label: 'R', items: [{ title: 'T', ...item }] }];

/** The clause an author actually reads, for an `endDate` at fault. */
const clauseFor = (spelling: string) => `${PATH} is ${spelling}, which is not a valid date`;

/** Render one bad `endDate` and hand back the diagnostic text. */
const spellingOf = (endDate: unknown): string => {
  const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate }) });
  return diagnosticOf(container) ?? '';
};

describe('pin 1 — the BLANK spelling is gone (live on main before this card)', () => {
  it('an array `endDate` no longer vanishes from its own sentence', () => {
    // Base: "items[0].items[0].endDate is , which is not a valid date".
    const text = spellingOf([]);

    expect(text, 'the empty array is still spelled as nothing').toContain(clauseFor('an array'));
    expect(text, 'the blank reading survived').not.toContain(`${PATH} is ,`);
  });

  it('the value half is never empty for ANY refused non-primitive', () => {
    for (const value of [[], {}, new Map(), new Set(), Object.create(null), () => 1]) {
      const text = spellingOf(value);
      expect(text, `a blank value half for ${String(Object.prototype.hasOwnProperty)}`).not.toContain(
        `${PATH} is ,`,
      );
      expect(text).toContain(PATH);
    }
  });
});

describe('pin 2 — the MISLEADING spellings are gone (the card’s own table)', () => {
  const misleading: [string, unknown, string, string][] = [
    // label,            authored value,   was spelled,    is now spelled
    ["['2024-01-01']", ['2024-01-01'], '2024-01-01', 'an array'],
    ['[0]', [0], '0', 'an array'],
    ['0n', 0n, '0', '0n'],
    ['{}', {}, '[object Object]', 'an object'],
    ["{toString: () => '2024-01-01'}", { toString: () => '2024-01-01' }, '2024-01-01', 'an object'],
  ];

  for (const [label, value, was, now] of misleading) {
    it(`${label} is spelled \`${now}\`, not \`${was}\``, () => {
      const text = spellingOf(value);

      expect(text, `${label} did not get its new spelling`).toContain(clauseFor(now));
      expect(text, `${label} still reads as \`${was}\``).not.toContain(clauseFor(was));
    });
  }

  it('`0n` is told apart from the ACCEPTED `0` — the worst row of the table', () => {
    // `0` alone is a kept gantt date (#6781), so spelling `0n` as `0` told the
    // author their valid value was invalid. The `n` is the whole repair.
    const text = spellingOf(0n);
    expect(text).toContain(clauseFor('0n'));
    expect(text, 'the bigint is still spelled as the accepted number').not.toContain(clauseFor('0'));
  });

  it('a Map is not spelled `[object Object]`-style, and a function is not dumped as source', () => {
    expect(spellingOf(new Map())).toContain(clauseFor('an object'));
    expect(spellingOf(new Map()), 'the internal tag leaked').not.toContain('[object Map]');

    const fnText = spellingOf(function myFn() {
      return 1;
    });
    expect(fnText).toContain(clauseFor('a function'));
    expect(fnText, 'the function body was dumped into the alert').not.toContain('return 1');
  });
});

describe('pin 3 — the PINNED spellings do not move (#6759, #6770, #6781)', () => {
  const pinned: [string, unknown, string][] = [
    ['#6759 — an unparseable string stays quoted', 'not-a-date', '"not-a-date"'],
    ['#6759 — an EMPTY string stays visible rather than vanishing', '', '""'],
    ['#6759 — a space-padded string stays visible', '   ', '"   "'],
    ['#6759 — an ABSENT date stays `undefined`', undefined, 'undefined'],
    ['#6770 — a `null` row date stays `null`', null, 'null'],
    ['#6781 — a symbol stays spelled as itself', Symbol('oops'), 'Symbol(oops)'],
  ];

  for (const [label, value, spelling] of pinned) {
    it(label, () => {
      expect(spellingOf(value), `the pinned spelling ${spelling} moved`).toContain(
        clauseFor(spelling),
      );
    });
  }

  it('an invalid `Date` OBJECT still reads `Invalid Date`', () => {
    expect(spellingOf(new Date(Number.NaN))).toContain(clauseFor('Invalid Date'));
  });

  it('a boolean and a non-finite number still read as their own source syntax', () => {
    expect(spellingOf(false)).toContain(clauseFor('false'));
    expect(spellingOf(true)).toContain(clauseFor('true'));
    expect(spellingOf(Number.NaN)).toContain(clauseFor('NaN'));
    expect(spellingOf(Number.POSITIVE_INFINITY)).toContain(clauseFor('Infinity'));
  });

  it('`undefined` is still told apart from `null` (#6770’s asymmetry)', () => {
    expect(spellingOf(undefined)).not.toContain('null');
    expect(spellingOf(null)).not.toContain('undefined');
  });
});

describe('pin 4 — TOTAL BY CONSTRUCTION: nothing here makes the helper throw', () => {
  /**
   * The first three rows CRASHED the render on the base — `String(value)` runs
   * author-supplied `toString` / `Symbol.toStringTag`. The rest are the inputs
   * that would break `JSON.stringify`, which is why that repair is refuted.
   */
  const cyclic: Record<string, unknown> = { a: 1 };
  cyclic.self = cyclic;

  const cyclicArray: unknown[] = [1];
  cyclicArray.push(cyclicArray);

  const hostile: [string, unknown][] = [
    ['an object whose `toString` THROWS (base: crashed)', { toString() { throw new Error('boom'); } }],
    [
      'an object whose `Symbol.toStringTag` getter THROWS (base: crashed)',
      { get [Symbol.toStringTag]() { throw new Error('boom'); } },
    ],
    ['`Object.create(null)` — no prototype at all (base: crashed)', Object.create(null)],
    ['a CYCLIC object (JSON.stringify throws)', cyclic],
    ['a CYCLIC array (JSON.stringify throws)', cyclicArray],
    ['a bigint (JSON.stringify throws)', 0n],
    ['an object with an `undefined` member (JSON.stringify DROPS it)', { endDate: undefined }],
    ['an object whose `valueOf` THROWS', { valueOf() { throw new Error('boom'); } }],
    ['an object whose `Symbol.toPrimitive` THROWS', { [Symbol.toPrimitive]() { throw new Error('boom'); } }],
    ['a getter that THROWS on every property', new Proxy({}, { get() { throw new Error('boom'); } })],
    ['a `Date` subclass whose `toString` is hijacked to throw', new (class extends Date {
      toString(): string { throw new Error('boom'); }
    })(Number.NaN)],
    ['a symbol', Symbol('oops')],
    ['a function', function myFn() { return 1; }],
    ['a Map', new Map()],
    ['a Set', new Set([1])],
    ['a RegExp', /^2024/],
    ['a class constructor', class Foo {}],
    ['an array of hostile members', [{ toString() { throw new Error('boom'); } }]],
  ];

  for (const [label, value] of hostile) {
    it(`does not throw on ${label}`, () => {
      let text = '';
      expect(() => {
        text = spellingOf(value);
      }, 'the diagnostic helper crashed while reporting an author error').not.toThrow();

      // Not merely "did not throw" — it must still have NAMED the fault.
      expect(text, 'no diagnostic was rendered at all').toContain(PATH);
      expect(text, 'the value half is blank').not.toContain(`${PATH} is ,`);
      expect(text).toContain('which is not a valid date');
    });
  }

  it('every hostile input is spelled by TYPE — no author text reaches the sentence', () => {
    for (const [, value] of hostile) {
      const text = spellingOf(value);
      expect(text, 'an author-controlled string leaked into the diagnostic').not.toContain('boom');
    }
  });
});

describe('pin 5 — the ACCEPT SET is untouched (#6781’s ruling)', () => {
  it('`0` is still an accepted epoch date and still draws its chart', () => {
    const { container } = gantt({
      items: rowWith({ startDate: 0, endDate: '2024-01-01' }),
    });
    expect(diagnosticOf(container), '`0` was refused — #6781’s ruling was moved').toBeNull();
    expect(barCountOf(container)).toBe(1);
  });

  it('a string, a finite timestamp and a `Date` instance all still render', () => {
    for (const endDate of [
      '2024-03-01',
      new Date('2024-03-01T00:00:00Z').getTime(),
      new Date('2024-03-01T00:00:00Z'),
    ]) {
      const { container } = gantt({ items: rowWith({ startDate: '2024-01-01', endDate }) });
      expect(diagnosticOf(container), `${String(endDate)} was refused`).toBeNull();
      expect(barCountOf(container)).toBe(1);
    }
  });

  it('a valid gantt draws the same axis and the same bar geometry as before this card', () => {
    const { container } = gantt({
      items: [
        {
          label: 'Backend',
          items: [{ title: 'API Design', startDate: '2024-01-01', endDate: '2024-03-01' }],
        },
      ],
    });
    expect(diagnosticOf(container)).toBeNull();
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
    expect(barCountOf(container)).toBe(1);
  });

  it("#6750's EMPTY gantt still gets its sentinel rather than a refusal", () => {
    const { container } = gantt({ items: [{ label: 'R', items: [] }] });
    expect(diagnosticOf(container)).toBeNull();
  });

  it('exactly ONE diagnostic is rendered, at the FIRST fault', () => {
    const { container } = gantt({
      items: rowWith({ startDate: [], endDate: {} }),
    });
    expect(container.querySelectorAll(`[data-testid="${TESTID}"]`).length).toBe(1);
    expect(diagnosticOf(container) ?? '').toContain(
      'items[0].items[0].startDate is an array, which is not a valid date',
    );
  });

  it('`ObjectTimeline` reaches the same spelling on an authored gantt', () => {
    const { container } = render(
      <ObjectTimeline
        schema={
          {
            type: 'timeline',
            variant: 'gantt',
            items: rowWith({ startDate: '2024-01-01', endDate: ['2024-01-01'] }),
          } as any
        }
      />,
    );
    expect(diagnosticOf(container) ?? '').toContain(clauseFor('an array'));
  });
});

describe('pin 6 — the SHARED inverted-range diagnostic does not move', () => {
  const invertedWith = (minDate: unknown, maxDate: unknown) => {
    const { container } = gantt({
      items: [
        {
          label: 'R',
          items: [{ title: 'T', startDate: '2024-01-01', endDate: '2024-03-01' }],
        },
      ],
      minDate,
      maxDate,
    });
    return diagnosticOf(container) ?? '';
  };

  it('pinned STRING ends read exactly as they did before this card', () => {
    // Base b458300ca: minDate "2030-01-01" is after maxDate "2026-03-15".
    expect(invertedWith('2030-01-01', '2026-03-15')).toContain(
      'minDate "2030-01-01" is after maxDate "2026-03-15"',
    );
  });

  it('pinned `Date` ends read exactly as they did before this card', () => {
    // The Date branch swapped `String(value)` for `Date.prototype.toString.call`
    // precisely so this reading stays byte-identical. Compared against the
    // builtin rather than a frozen literal, so the pin is timezone-independent.
    const min = new Date('2030-01-01T00:00:00Z');
    const max = new Date('2026-03-15T00:00:00Z');
    expect(invertedWith(min, max)).toContain(
      `minDate ${min.toString()} is after maxDate ${max.toString()}`,
    );
  });

  it('a numeric pinned end still reads as its own source syntax', () => {
    const min = new Date('2030-01-01T00:00:00Z').getTime();
    expect(invertedWith(min, '2026-03-15')).toContain(`minDate ${min} is after maxDate`);
  });

  it('one pinned end is enough to invert the range, unchanged', () => {
    expect(invertedWith('2030-01-01', undefined)).toContain(
      'minDate "2030-01-01" is after maxDate "2024-03-01"',
    );
  });

  it('a DEGENERATE range is still not inverted (#6750’s boundary)', () => {
    const { container } = gantt({
      items: [
        {
          label: 'R',
          items: [{ title: 'T', startDate: '2024-05-01', endDate: '2024-05-01' }],
        },
      ],
    });
    expect(diagnosticOf(container)).toBeNull();
  });

  it('the type-naming branches are UNREACHABLE from the inverted site', () => {
    // Both ends passed `findUnusableGanttDate` to get here, so each is a
    // string, a finite number or a `Date`. Asserted rather than asserted-about:
    // an `an object` in this sentence would mean the guard let one through.
    for (const [min, max] of [
      ['2030-01-01', '2026-03-15'],
      [new Date('2030-01-01T00:00:00Z'), new Date('2026-03-15T00:00:00Z')],
    ] as [unknown, unknown][]) {
      const text = invertedWith(min, max);
      expect(text).not.toContain('an object');
      expect(text).not.toContain('an array');
      expect(text).not.toContain('a function');
    }
  });
});

describe('pin 7 — NO new i18n key: the sentence is unchanged', () => {
  it('the spelling reads grammatically in the EXISTING message', () => {
    // "…endDate is an array, which is not a valid date." The article is carried
    // by the spelling, so the `{{value}}` hole and the sentence around it are
    // untouched and the ten locale packs are not opened.
    const text = spellingOf(['2024-01-01']);
    expect(text).toContain('Unusable gantt date range — ');
    expect(text).toContain(clauseFor('an array'));
    expect(text).toContain('Every gantt date has to parse');
  });

  it('both #6759 keys still carry their holes, intact — neither was renamed by this card', () => {
    // #6759's pin 8, re-asserted here because a spelling that needed a new
    // sentence would have had to open `packages/i18n`'s ten locale packs. It
    // did not: the article rides in the `{{value}}` hole. (objectui#7164 later
    // DID open them, for a different fault — a malformed ROW — with a third
    // key beside these two; that is its own decision and its own pin, and it
    // leaves both of these untouched.)
    const malformed = TIMELINE_DEFAULT_TRANSLATIONS['timeline.gantt.unusableRange.malformedDate'];
    expect(malformed).toContain('{{path}}');
    expect(malformed).toContain('{{value}}');
    expect(malformed).toContain('which is not a valid date');

    const inverted = TIMELINE_DEFAULT_TRANSLATIONS['timeline.gantt.unusableRange.inverted'];
    expect(inverted).toContain('{{minDate}}');
    expect(inverted).toContain('{{maxDate}}');
  });
});
