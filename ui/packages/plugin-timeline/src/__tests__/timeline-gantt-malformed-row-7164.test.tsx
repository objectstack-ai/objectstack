/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7164 — a gantt whose ROWS are malformed refuses to draw, naming the
 * row and the fault, instead of crashing the render (maintainer ruling
 * 2026-09-02, A+: refuse through a new key, and tighten the zod mirror).
 *
 * ## The defect, measured on `a67abdc88` before any change
 *
 * `findUnusableGanttDate` read the row walk DEFENSIVELY (`?.`, `|| []`) and
 * `calculateDateRange` read the same walk BARE one line later. Every input in
 * the gap crashed, and all of it is ordinary JSON that the declared zod mirror
 * (`items: z.array(z.any())`) accepted. Driven in render through the real
 * `TimelineRenderer`, site attributed by the stack frame:
 *
 *     items: [null]                             THREW  renderer.tsx:287:10  (row.items)
 *     items: [{ items: 5 }]                     THREW  renderer.tsx:287:23  ((row.items || []).flatMap)
 *     items: [{ items: {} }]                    THREW  renderer.tsx:287:23
 *     items: [{ items: true }]                  THREW  renderer.tsx:287:23
 *     items: [{ items: {length:1, 0:{dates}} }] THREW  renderer.tsx:287:23
 *     items: {}                                 THREW  renderer.tsx:286:26  (items.flatMap)
 *     items: 'x'                                THREW  renderer.tsx:286:26
 *     items: 5                                  THREW  renderer.tsx:286:26
 *     items: [{ items: 'x' }]                   NAMED  items[0].items[0].startDate is undefined
 *     CONTROL an ordinary row                   DREW   bars=1 axisCells=3
 *     CONTROL items: []                         DREW   bars=0 axisCells=1
 *     CONTROL items: [{ label: 'R' }]           DREW   bars=0 axisCells=1
 *     CONTROL items: [{ items: null }]          DREW   bars=0 axisCells=1
 *     CONTROL items: [0]  /  [[]]               DREW   bars=0 axisCells=1
 *
 * (That last line is SUPERSEDED — see "The non-object ROW" below. The table
 * is the reading on `a67abdc88` and is kept as it was measured.)
 *
 * ## Why the repair is ONE reader, not a guard in each
 *
 * The card measured, by ablation, that a tolerant `calculateDateRange` closes
 * none of the eight — it MOVES them into the render loop (`items.map`,
 * `row.label`, `(row.items || []).map`), the relocation this path had already
 * performed four times. So the raw shape is now read exactly once, in
 * `classifyGanttRows`, and `findUnusableGanttDate`, `calculateDateRange` and the
 * render loop all consume its verdict. Each pin below therefore reads the SAME
 * refusal whichever reader used to crash, and the ablation legs recorded on
 * the PR show that removing any one of the three refusals turns exactly its
 * rows red here.
 *
 * ## Two kinds of defined outcome, and the third that is gone
 *
 *   - REFUSED — through `timeline.gantt.unusableRange.malformedRow`, a key of
 *     its own, naming the authored path and the value. Never through
 *     `malformedDate`: "items[0] is null, which is not a valid date" names the
 *     wrong fault for a row that is not a row.
 *   - DRAWN — the CONTROL shapes, with the SAME bar and axis-cell counts as
 *     before the change. The accept set is the ruling's and no wider.
 *   - THREW is what this card removes.
 *
 * ## The non-object ROW — a control SUPERSEDED by objectui#7364
 *
 * The A+ ruling of objectui#7164 required `items: [0]` and `items: [[]]` to
 * keep DRAWING, and this file pinned them as CONTROLS. They drew an empty,
 * unlabelled row while `validate` (the zod mirror, `TimelineSchema.items`)
 * refused both at authoring time. The objectui#7364 ruling — comment
 * 5809218505, letter A, maintainer 「同意」 — DELIBERATELY SUPERSEDES that
 * clause: `classifyGanttRows` refuses every row that is not an object (a
 * number, a string, a boolean, an array), through the same `malformedRow` key,
 * so the renderer agrees with `validate`. Those two pins are therefore
 * REWRITTEN to expect the refusal, not deleted, and joined by `['x']` and
 * `[true]`, the other two shapes the card names. The well-formed object row
 * stays a control that still DRAWS.
 *
 * ## Assertions count BAR ELEMENTS, never styles
 *
 * #6759's rule, inherited through every gantt pin since: a bar whose geometry
 * is `NaN` carries no `style` attribute, so a style-phrased assertion reads the
 * same for "gone" and "broken". Refusals are positive about the diagnostic.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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

/** The one refusal surface of the gantt branch — #6759's element, reused. */
const TESTID = 'timeline-unusable-date-range';
const KEY = 'timeline.gantt.unusableRange.malformedRow';

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

const gantt = (schema: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  render(<TimelineRenderer schema={{ type: 'timeline', variant: 'gantt', ...schema, ...extra } as any} />);

const GOOD_ITEM = { title: 'T', startDate: '2024-01-01', endDate: '2024-03-01' };
const goodRow = () => ({ label: 'R', items: [{ ...GOOD_ITEM }] });

/**
 * The sentence the refusal renders, resolved the way the provider-less test
 * host resolves it — through the package's own default table, whose entry is
 * the byte-identical twin of `en.ts`'s (pinned in `../useTimelineTranslation`).
 */
const ROW_CLAUSE = 'which is not a row shape';
const DATE_CLAUSE = 'which is not a valid date';

describe('the card’s THREW rows now REFUSE, each naming its path and value (objectui#7164)', () => {
  /**
   * The eight rows of the measurement table, in the card's order, with the
   * path and the spelling each refusal must carry. `value` is spelled by
   * `spellGanttDateValue`, so a plain object is `an object` and a string is
   * quoted — the speller's own conventions, not restated here.
   */
  const refused: [string, Record<string, unknown>, string, string][] = [
    ['items: [null] — a null ROW', { items: [null] }, 'items[0]', 'null'],
    ["items: [{ items: 5 }] — a row's items is a number", { items: [{ label: 'R', items: 5 }] }, 'items[0].items', '5'],
    ["items: [{ items: {} }] — a row's items is a plain object", { items: [{ label: 'R', items: {} }] }, 'items[0].items', 'an object'],
    ["items: [{ items: true }] — a row's items is true", { items: [{ label: 'R', items: true }] }, 'items[0].items', 'true'],
    [
      "items: [{ items: { length: 1, 0: … } }] — a row's items is ARRAY-LIKE, which the old walk judged usable",
      { items: [{ label: 'R', items: { length: 1, 0: { ...GOOD_ITEM } } }] },
      'items[0].items',
      'an object',
    ],
    ['items: {} — items itself a plain object', { items: {} }, 'items', 'an object'],
    ["items: 'x' — items itself a string", { items: 'x' }, 'items', '"x"'],
    ['items: 5 — items itself a number', { items: 5 }, 'items', '5'],
  ];

  for (const [label, schema, path, value] of refused) {
    it(`${label} -> REFUSED at ${path}`, () => {
      // The whole defect in one line: on `a67abdc88` this render THREW.
      expect(() => gantt(schema)).not.toThrow();

      const { container } = gantt(schema);
      const text = diagnosticOf(container);
      expect(text, 'no diagnostic rendered').not.toBeNull();
      expect(text).toContain(`${path} is ${value}`);
      expect(text).toContain(ROW_CLAUSE);
      // Never the date copy — it names the wrong fault for a row (the card).
      expect(text).not.toContain(DATE_CLAUSE);
      expect(barCountOf(container)).toBe(0);
      expect(axisOf(container)).toEqual([]);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
  }

  it('the FIRST malformed row wins, and it wins over a malformed DATE elsewhere in the document', () => {
    // Rows are judged as rows before their dates are judged as dates: a good
    // row, then a null row, then a row with an unparseable date. The refusal
    // names `items[1]`, not `items[2].items[0].startDate`.
    const { container } = gantt({
      items: [goodRow(), null, { label: 'R', items: [{ title: 'T', startDate: 'never', endDate: 'ever' }] }],
    });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[1] is null');
    expect(text).not.toContain('startDate');
  });

  it('a malformed row DEEPER in the list is named by its own index, beside good rows', () => {
    const { container } = gantt({ items: [goodRow(), goodRow(), { label: 'R', items: 'x'.length }] });
    expect(diagnosticOf(container)).toContain('items[2].items is 1');
  });
});

describe('the NAMED row takes the row door, and the CONTROL rows still DRAW with the same counts', () => {
  it("items: [{ items: 'x' }] — the card's NAMED row is now REFUSED through malformedRow, naming the true fault", () => {
    // On `a67abdc88` this row did not crash: a string is index-readable, so
    // the old walk reached `'x'[0]?.startDate`, read `undefined`, and named
    // `items[0].items[0].startDate is undefined, which is not a valid date` —
    // an asymmetry the card itself recorded as "not designed". The ruling's
    // door is "a row whose `items` is a TRUTHY NON-ARRAY", and a string is
    // one, so it now takes the row refusal and names the fault a reader can
    // act on: `items[0].items` is a string, not a list of bars. This is the
    // one row of the table whose OUTCOME changed rather than its crash.
    const { container } = gantt({ items: [{ label: 'R', items: 'x' }] });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items is "x"');
    expect(text).toContain(ROW_CLAUSE);
    expect(text).not.toContain(DATE_CLAUSE);
    expect(barCountOf(container)).toBe(0);
  });

  const controls: [string, Record<string, unknown>, number, number][] = [
    ['an ordinary row', { items: [goodRow()] }, 1, 3],
    ['items: []', { items: [] }, 0, 1],
    ["items: [{ label: 'R' }] — a row with no items key", { items: [{ label: 'R' }] }, 0, 1],
    ['items: [{ items: null }] — a row whose items is null (the empty row)', { items: [{ label: 'R', items: null }] }, 0, 1],
    // `items: [0]` and `items: [[]]` stood here as controls until
    // objectui#7364 (ruling 5809218505, A) superseded them — they are pinned
    // as REFUSALS in the block below, with the reason in the header.
  ];

  for (const [label, schema, bars, axisCells] of controls) {
    it(`CONTROL ${label} -> DREW bars=${bars} axisCells=${axisCells}`, () => {
      const { container } = gantt(schema);
      expect(diagnosticOf(container), `${label} was refused`).toBeNull();
      expect(barCountOf(container)).toBe(bars);
      expect(axisOf(container).length).toBe(axisCells);
    });
  }

  it('the ordinary row draws the SAME axis it drew before the change', () => {
    const { container } = gantt({ items: [goodRow()] });
    expect(axisOf(container)).toEqual(['Jan 2024', 'Feb 2024', 'Mar 2024']);
  });
});

describe('a row that is NOT AN OBJECT is refused — objectui#7364 supersedes the #7164 control', () => {
  /**
   * Ruling 5809218505 (letter A): the renderer refuses what `validate` already
   * refuses. The first two rows are the #7164 controls REWRITTEN — before
   * objectui#7364 each drew `bars=0 axisCells=1` with no label and no word to
   * the author; the other two are the card's remaining shapes. `value` is the
   * speller's own spelling (`spellGanttDateValue`): an array is `an array`, a
   * string is quoted.
   */
  const refused: [string, Record<string, unknown>, string][] = [
    ['items: [0] — a row that is the number 0 (a #7164 control, superseded)', { items: [0] }, '0'],
    ['items: [[]] — a row that is an empty array (a #7164 control, superseded)', { items: [[]] }, 'an array'],
    ["items: ['x'] — a row that is a string", { items: ['x'] }, '"x"'],
    ['items: [true] — a row that is a boolean', { items: [true] }, 'true'],
  ];

  for (const [label, schema, value] of refused) {
    it(`${label} -> REFUSED at items[0]`, () => {
      const { container } = gantt(schema);
      const text = diagnosticOf(container);
      expect(text, 'no diagnostic rendered — the row drew').not.toBeNull();
      expect(text).toContain(`items[0] is ${value}, ${ROW_CLAUSE}`);
      expect(text).not.toContain(DATE_CLAUSE);
      expect(barCountOf(container)).toBe(0);
      expect(axisOf(container)).toEqual([]);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
  }

  it('a non-object row BESIDE well-formed rows is named by its own index, and wins over a later bad date', () => {
    const { container } = gantt({
      items: [goodRow(), 0, { label: 'R', items: [{ title: 'T', startDate: 'never', endDate: 'ever' }] }],
    });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain(`items[1] is 0, ${ROW_CLAUSE}`);
    expect(text).not.toContain('startDate');
  });

  it('CONTROL — a well-formed object row still DRAWS, and so does the empty-row family', () => {
    const drawn: [string, Record<string, unknown>, number][] = [
      ['an ordinary row', { items: [goodRow()] }, 1],
      ['two ordinary rows', { items: [goodRow(), goodRow()] }, 2],
      ["a row with no items key", { items: [{ label: 'R' }] }, 0],
      ['a row whose items is null', { items: [{ label: 'R', items: null }] }, 0],
    ];
    for (const [label, schema, bars] of drawn) {
      const { container } = gantt(schema);
      expect(diagnosticOf(container), `${label} was refused`).toBeNull();
      expect(barCountOf(container), label).toBe(bars);
      expect(axisOf(container).length, `${label} drew no axis`).toBeGreaterThan(0);
    }
  });
});

describe('the three readers consume one verdict — the contract the render loop keeps', () => {
  it('onItemClick still receives the AUTHORED row object, not a normalized copy', () => {
    // The render loop reads `label` and `items` off the verdict, but the row
    // handed back to the host is the author's own object — same identity.
    const row = goodRow();
    const onItemClick = vi.fn();
    const { container } = gantt({ items: [row] }, { onItemClick });
    const bar = container.querySelector('.absolute.h-8.rounded-md') as HTMLElement;
    bar.click();
    expect(onItemClick).toHaveBeenCalledTimes(1);
    const [item, passedRow, rowIndex, itemIndex] = onItemClick.mock.calls[0];
    expect(passedRow).toBe(row);
    expect(item).toBe(row.items[0]);
    expect(rowIndex).toBe(0);
    expect(itemIndex).toBe(0);
  });

  it('a malformed date is still refused through malformedDate when the rows themselves are well-formed', () => {
    // The date door is untouched (objectui#6759 / #6781): only the ORDER
    // changed, and this is the case the order does not affect.
    const { container } = gantt({ items: [{ label: 'R', items: [{ title: 'T', startDate: 'never', endDate: '2024-03-01' }] }] });
    const text = diagnosticOf(container) ?? '';
    expect(text).toContain('items[0].items[0].startDate is "never"');
    expect(text).toContain(DATE_CLAUSE);
    expect(text).not.toContain(ROW_CLAUSE);
  });
});

describe('the key — one, beside malformedDate, with the same two holes', () => {
  it('the package default carries the key with {{path}} and {{value}}, and says "row", not "date"', () => {
    const copy = TIMELINE_DEFAULT_TRANSLATIONS[KEY];
    expect(copy).toBeDefined();
    expect(copy).toContain('{{path}}');
    expect(copy).toContain('{{value}}');
    expect(copy).toContain(ROW_CLAUSE);
    expect(copy).not.toContain(DATE_CLAUSE);
  });

  it('the copy reads grammatically at all three paths the walk can name', () => {
    // One key serves three levels because the fixed text states the whole
    // expected structure and the path says which level failed. Rendered, not
    // inferred: the three refusals from the table, each read back.
    const heads = [
      [{ items: {} }, 'items is an object, which is not a row shape'],
      [{ items: [null] }, 'items[0] is null, which is not a row shape'],
      [{ items: [{ items: 5 }] }, 'items[0].items is 5, which is not a row shape'],
    ] as const;
    for (const [schema, head] of heads) {
      const { container } = gantt(schema as Record<string, unknown>);
      expect(diagnosticOf(container)).toContain(head);
    }
  });
});
