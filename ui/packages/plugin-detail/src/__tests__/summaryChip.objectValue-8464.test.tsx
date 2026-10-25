/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What the `summaryFields` chip beside the record H1 draws for an OBJECT value
 * (objectui#8464).
 *
 * ## The defect, reproduced before it was fixed
 *
 * The chip's display was `String(val)` with four families special-cased, so an
 * object-valued summary field printed the literal `[object Object]` next to the
 * page title — and, because the chip's accessible name is built from the SAME
 * string, in its accessible name too. Measured on `ed971e8fc`, before the fix,
 * with `summaryFields: ['owner_ref','billing_address','office_location']`:
 *
 *   chip text `[object Object]`  aria-label `owner_ref: [object Object]`
 *   chip text `[object Object]`  aria-label `billing_address: [object Object]`
 *   chip text `[object Object]`  aria-label `office_location: [object Object]`
 *
 * Reachable both ways the card names: `schema.summaryFields` is author-declared
 * and never filtered by type, and the auto-detection can hand the status slot to
 * a field whose stored value is not a scalar.
 *
 * ## Which question this chip asks — MEASURED, not argued
 *
 * objectui#8395 established on this exact page that "render what the user sees"
 * and "render the underlying value" give different answers per field type, and
 * that the intuitive choice was wrong for 9 of 17 types. That table is about a
 * CLIPBOARD payload. This chip is a display surface, and its own existing
 * behaviour answers which side it is on — re-derived against this tree:
 *
 * | field    | stored                       | chip prints            |
 * |----------|------------------------------|------------------------|
 * | currency | `1234.5`                     | `$1,235`               |
 * | date     | `'2026-03-04'`               | `Mar 4, 2026`          |
 * | datetime | `'2024-07-04T07:00:00.000Z'` | `Jul 4, 2024, 7:00 AM` |
 * | select   | `'won'`                      | `Closed Won`           |
 *
 * Every one is the SEEN face, never the stored one. So the display authority for
 * a kind the chip does not format is that kind's own cell renderer — option A,
 * the way `HeaderHighlight` reads it one band below. The four rows above are
 * pinned in `THE FOUR FORMATTED FAMILIES` and are RED for routing every value
 * through the cell renderer regardless of kind.
 *
 * ## …and where a pill cannot host one
 *
 * A Badge is a much smaller surface than a cell. 15 of the 53 registered types
 * draw a nested pill, an avatar composite, a bare `<img>` with no text, or a
 * "No value" face for a value `hasCellValue` just called FILLED. The full table
 * and its instrument are `summaryChip.badgeFitCensus-8464.test.tsx`; the set is
 * `../summaryChipRenderers`. Those kinds take `coerceToSafeValue`, this repo's
 * single answer to the same question — ⛔ never a stringifier written for this
 * chip (objectui#8395's option C, "answer-shopping").
 *
 * ## Deliberately NOT moved
 *
 * ⭐ The chip's EMPTINESS classification. objectui#8394 / PR #8457 converged it
 * onto `hasCellValue` as "the non-regressive convergence — it moves
 * whitespace-only strings and nothing else". This card is a DISPLAY decision;
 * `THE EMPTINESS CLASSIFICATION` below re-pins all four of its answers through
 * the chip, so a display change that quietly re-classified a value is red here.
 *
 * ## Instruments
 *
 * ⚠️ **Four expected NAMES here moved in objectui#8729, and the reason is
 *   worth keeping.** That card made this chip resolve the field's label through
 *   `fieldLabel` — the call `HeaderHighlight` and `DetailSection` already make —
 *   instead of printing the raw stored column. So a fixture whose authored
 *   label differs from its stored name now announces the label:
 *   `status: Negotiation` → `Status: Negotiation`, `owner:` → `Owner:`,
 *   `stage:` → `Stage:`, `ratio:` → `Ratio:`. ⭐ THIS CARD'S SUBJECT DID NOT
 *   MOVE: the VALUE half of every one of those strings is byte-identical, and
 *   the whole `RENDERER_BACKED` table below is untouched down to the byte
 *   because it declares `label: field` — the two spellings coincide there, so
 *   the naming change is invisible to it, which is itself the measurement that
 *   the change is confined to the name.
 *
 * - Chips are navigated by `[data-summary-chip="<field>"]`, added by this change
 *   so a renderer-backed chip (which carries no `aria-label` — see below) has the
 *   same handle as a string one. ⚠️ NOT by `queryByText`, which throws on
 *   MULTIPLE matches as well as none, and every summary value also renders in the
 *   body grid.
 * - ⚠️ Nested pills are counted by CLASS TOKEN over `chip.querySelectorAll('*')`,
 *   never by `querySelector`. `.rounded-full` matches TWO nodes per avatar (Radix
 *   `Avatar.Root` AND `AvatarFallback`); a `querySelector` navigation cannot see
 *   that, counting can, and `USER` below asserts the exact count.
 * - A renderer-backed chip carries no `aria-label`: `aria-label` OVERRIDES
 *   content, so it would hide the very value the branch exists to show. Its
 *   accessible name is composed from content instead — an `sr-only` field-name
 *   prefix plus the renderer's text — which is why `textContent` reads
 *   `field: value` for those chips and bare `value` for string ones.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import * as React from 'react';
import { DetailView } from '../DetailView';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; under happy-dom that is a real request.
 * Served from a double so no case here depends on the network
 * (`DetailView.test.tsx`'s pattern).
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const renderPage = (schema: Partial<DetailViewSchema>) =>
  render(
    <DetailView
      schema={{ type: 'record:details', objectName: 'account', ...schema } as DetailViewSchema}
    />,
  );

const chipFor = (c: HTMLElement, field: string) =>
  c.querySelector<HTMLElement>(`[data-summary-chip="${field}"]`);

/** The chip, with a message naming the field when it is missing. */
const requireChip = (c: HTMLElement, field: string): HTMLElement => {
  const chip = chipFor(c, field);
  expect(chip, `a summary chip for "${field}" is beside the H1`).not.toBeNull();
  return chip!;
};

const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Descendants of the chip carrying the `rounded-full` class token. */
const nestedPills = (chip: HTMLElement) =>
  Array.from(chip.querySelectorAll('*')).filter((e) =>
    (e.getAttribute('class') || '').split(/\s+/).includes('rounded-full'),
  );

describe('objectui#8464 — an object-valued summary chip beside the H1', () => {
  /**
   * The object-valued kinds whose renderer was MEASURED to fit the pill.
   * ⚠️ `file` was a fourth row here until objectui#9161; it is now its own case
   * below, on the REFUSED side, for the reason stated there.
   * `expected` is the whole chip: the `sr-only` field-name prefix that carries
   * the accessible name plus the value the renderer drew. Asserting the exact
   * string pins BOTH halves the defect broke.
   */
  const RENDERER_BACKED = [
    {
      field: 'owner_ref',
      type: 'lookup',
      value: { id: 'acct-1', name: 'Ada Lovelace' },
      expected: 'owner_ref: Ada Lovelace',
    },
    {
      field: 'billing_address',
      type: 'address',
      // `postalCode` is the spec spelling (objectstack#5143); `formatAddress`
      // reads it, so the expected line below is a real format and not a
      // re-derivation of the input.
      value: {
        street: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62704',
        country: 'USA',
      },
      expected: 'billing_address: 1 Main St, Springfield, IL 62704, USA',
    },
    {
      field: 'office_location',
      type: 'location',
      // MORE precision than the cell prints (it rounds to 4 decimals), so the
      // expectation cannot be satisfied by echoing the input back.
      value: { latitude: 30.2741567, longitude: 120.1551234 },
      expected: 'office_location: 30.2742, 120.1551',
    },
    {
      field: 'payload',
      type: 'json',
      value: { a: 1, b: ['x', 'y'] },
      expected: 'payload: {"a":1,"b":["x","y"]}',
    },
  ];

  it.each(RENDERER_BACKED)(
    'FITTING KIND — $type draws its own cell face in the chip, never `[object Object]`',
    ({ field, type, value, expected }) => {
      const { container } = renderPage({
        summaryFields: [field, 'stage'] as any,
        fields: [
          { name: field, label: field, type },
          { name: 'stage', label: 'Stage', type: 'text' },
        ] as any,
        data: { id: 'A1', name: 'Acme Corporation', [field]: value, stage: 'Won' },
      });

      // CONTROL — the page drew its H1, so an absent chip below is a decision
      // about this value and not about the header failing to render.
      expect(container.querySelector('h1'), 'CONTROL: the record H1 rendered').not.toBeNull();
      // CONTROL — the sibling scalar chip is there, so the chip row itself works.
      expect(
        textOf(requireChip(container, 'stage')),
        'CONTROL: the sibling scalar chip still reads its value',
      ).toBe('Won');

      // The artefact's ABSENCE first, so an unfixed tree fails on a different
      // sentence from a harness that lost its navigation target.
      const chip = requireChip(container, field);
      expect(
        textOf(chip),
        `the "${field}" chip must not carry the String() placeholder`,
      ).not.toContain('[object Object]');
      expect(
        textOf(chip),
        `the "${field}" chip draws what its own cell draws, and names the field for AT`,
      ).toBe(expected);

      // A renderer-backed chip must not smuggle the placeholder back through the
      // accessible name, which is exactly where the defect's second half lived.
      expect(
        chip.getAttribute('aria-label'),
        'a renderer-backed chip sets no aria-label — it would override the value it exists to show',
      ).toBeNull();
      expect(
        chip.querySelector('.sr-only')?.textContent,
        'the field name reaches AT through the visually-hidden prefix instead',
      ).toBe(`${field}: `);

      // The pill hosts text, not a control, an image or a second pill.
      expect(chip.querySelectorAll('a[href],button,[role="button"],input').length,
        `the "${field}" chip draws no interactive control inside the page title row`).toBe(0);
      expect(chip.querySelectorAll('img').length, `the "${field}" chip draws no image`).toBe(0);
      expect(nestedPills(chip).length, `the "${field}" chip is not a pill inside a pill`).toBe(0);
      expect(
        chip.querySelectorAll('[data-slot="empty-value"]').length,
        `the "${field}" chip never says "No value" for a value the band above called filled`,
      ).toBe(0);
    },
  );

  it('AUTO-DETECTION — the status slot handed an object value reads a name, not the placeholder', () => {
    // The card's SECOND route in: no `summaryFields` at all, so
    // `autoSummaryFields` picks the field — and it filters by name and
    // emptiness, never by type.
    const { container } = renderPage({
      fields: [{ name: 'status', label: 'Status', type: 'lookup' }] as any,
      data: { id: 'A2', name: 'Acme', status: { id: 's-1', name: 'Negotiation' } },
    });

    expect(container.querySelector('h1'), 'CONTROL: the record H1 rendered').not.toBeNull();
    const chip = requireChip(container, 'status');
    expect(textOf(chip), 'the auto-detected chip must not carry the placeholder').not.toContain(
      '[object Object]',
    );
    expect(textOf(chip), 'the auto-detected chip reads the record name').toBe(
      'Status: Negotiation',
    );
  });

  /**
   * The kinds MEASURED not to fit a pill. They keep the string path — so they
   * keep their `aria-label` — and its text is `coerceToSafeValue`'s, which
   * objectui#8596 ruled `user` and the option families onto for an object value.
   */
  it('USER — an expanded user object reads its name; the avatar does not enter the pill', () => {
    const { container } = renderPage({
      summaryFields: ['owner'] as any,
      fields: [{ name: 'owner', label: 'Owner', type: 'user' }] as any,
      data: { id: 'A3', name: 'Acme', owner: { id: 'u-1', name: 'Ada Lovelace' } },
    });

    const chip = requireChip(container, 'owner');
    // ⚠️ The instrument pin. `UserCellRenderer` draws a Radix Avatar, whose
    // Root AND Fallback both carry `rounded-full` — TWO nodes, which a
    // `querySelector` navigation cannot see and this count can. Both the avatar
    // and the initials it glues onto the name (`ACAcme Corp` in the census) are
    // why `user` is refused the renderer here.
    expect(nestedPills(chip).length, 'no avatar (two rounded-full nodes) inside the chip').toBe(0);
    expect(chip.querySelectorAll('img').length, 'no avatar image inside the chip').toBe(0);
    expect(textOf(chip), 'the chip reads the coerced name').toBe('Ada Lovelace');
    expect(
      chip.getAttribute('aria-label'),
      'a string-path chip keeps the accessible name it always had, now true',
    ).toBe('Owner: Ada Lovelace');
  });

  it('OPTION FAMILY — a select field holding an object reads the coerced text, not a pill in a pill', () => {
    const { container } = renderPage({
      summaryFields: ['stage'] as any,
      fields: [
        { name: 'stage', label: 'Stage', type: 'select', options: [{ value: 'won', label: 'Closed Won' }] },
      ] as any,
      data: { id: 'A4', name: 'Acme', stage: { id: 'st-9', name: 'Negotiation' } },
    });

    const chip = requireChip(container, 'stage');
    expect(nestedPills(chip).length, 'the option renderer is not nested inside the chip').toBe(0);
    expect(textOf(chip), 'the chip reads the coerced text').toBe('Negotiation');
    expect(chip.getAttribute('aria-label'), 'and its accessible name says the same').toBe(
      'Stage: Negotiation',
    );
  });

  it('FILE — a file value reads its coerced name; the download link does not enter the pill', () => {
    // ⚠️ MOVED here from `RENDERER_BACKED` by objectui#9161, and the move is the
    // finding. That card gave `FileCellRenderer` a view/download `<a href>` per
    // file — its whole subject: a read-only `file` field named its attachments
    // and offered no way to open one, while the record read, the signing
    // endpoint and the signed URL all answered 200. This chip's own rule is
    // unchanged and is what moves `file` across it: "the pill hosts text, not a
    // control", beside the page H1.
    //
    // ⭐ The VALUE half of the old expectation is asserted unchanged below:
    // `coerceToSafeValue` reads the same `name` the cell renderer reads, so the
    // reader sees the same word they saw before. What this case adds is the
    // absence of the control — the fact the move is about. The file itself
    // stays reachable one band down, in the field's own cell.
    const { container } = renderPage({
      summaryFields: ['contract'] as any,
      fields: [{ name: 'contract', label: 'contract', type: 'file' }] as any,
      data: {
        id: 'A5',
        name: 'Acme',
        contract: { name: 'contract.pdf', url: 'https://cdn.example.com/contract.pdf' },
      },
    });

    const chip = requireChip(container, 'contract');
    expect(textOf(chip), 'the chip must not carry the String() placeholder').not.toContain(
      '[object Object]',
    );
    expect(textOf(chip), 'the chip reads the coerced file name').toBe('contract.pdf');
    expect(
      chip.querySelectorAll('a[href],button,[role="button"],input').length,
      'no view/download control inside the page title row',
    ).toBe(0);
    expect(
      chip.getAttribute('aria-label'),
      'a string-path chip keeps the accessible name it always had',
    ).toBe('contract: contract.pdf');
  });

  it('UNNAMEABLE OBJECT — an object with no name reads the page\'s own word for it', () => {
    // `coerceToSafeValue`'s answer for an object carrying no name/label/id is
    // `[Object]` — the SAME text objectui#8596 pinned for eleven families. It is
    // deliberately not blank and deliberately not `[object Object]`.
    const { container } = renderPage({
      summaryFields: ['meta'] as any,
      fields: [{ name: 'meta', label: 'Meta', type: 'avatar' }] as any,
      data: { id: 'A5', name: 'Acme', meta: { url: 'https://cdn.example.com/a.png' } },
    });

    const chip = requireChip(container, 'meta');
    expect(textOf(chip), 'not the String() placeholder').not.toContain('[object Object]');
    expect(textOf(chip), "the package's one coercion answers it").toBe('[Object]');
  });

  /**
   * ⭐ THE NON-REGRESSION the card names. objectui#8394 / PR #8457 converged this
   * chip's emptiness guard onto `hasCellValue` — "it moves whitespace-only
   * strings and nothing else". A display change may not move any of its four
   * answers, so all four are re-pinned here through the chip.
   */
  describe('THE EMPTINESS CLASSIFICATION — unmoved by this display change', () => {
    const cases = [
      { what: 'an object is FILLED, and now says so', data: { o: { id: 'x', name: 'Nm' } }, chip: true },
      { what: 'a whitespace-only string is EMPTY', data: { o: '   ' }, chip: false },
      { what: '`0` is FILLED', data: { o: 0 }, chip: true },
      { what: 'an empty array is EMPTY (objectui#8474)', data: { o: [] }, chip: false },
      { what: 'an empty object is FILLED — `hasCellValue` says so', data: { o: {} }, chip: true },
    ];

    it.each(cases)('$what', ({ data, chip }) => {
      const { container } = renderPage({
        summaryFields: ['o', 'keep'] as any,
        fields: [
          { name: 'o', label: 'O', type: 'lookup' },
          { name: 'keep', label: 'Keep', type: 'text' },
        ] as any,
        data: { id: 'A6', name: 'Acme', keep: 'sibling', ...data },
      });

      // CONTROL — the sibling chip drew, so an absent chip is a classification
      // and not a header that failed to render.
      expect(
        textOf(requireChip(container, 'keep')),
        'CONTROL: the sibling chip rendered',
      ).toBe('sibling');

      if (chip) {
        expect(chipFor(container, 'o'), 'this value is FILLED and must keep its chip').not.toBeNull();
      } else {
        expect(chipFor(container, 'o'), 'this value is EMPTY and must render no chip at all').toBeNull();
      }
    });
  });

  /**
   * ⭐ THE FOUR FORMATTED FAMILIES. Each prints the SEEN face — which is the
   * measurement that says this chip asks the display question — and each is
   * BYTE-IDENTICAL to what it printed before this change. Red for "route every
   * value through the cell renderer regardless of kind".
   */
  describe('THE FOUR FORMATTED FAMILIES — byte-identical, and each is the seen face', () => {
    const FORMATTED = [
      { field: 'price', type: 'currency', extra: { currency: 'USD' }, stored: 1234.5, chip: '$1,235' },
      { field: 'due', type: 'date', extra: {}, stored: '2026-03-04', chip: 'Mar 4, 2026' },
      {
        field: 'closed_at',
        type: 'datetime',
        extra: {},
        stored: '2024-07-04T07:00:00.000Z',
        chip: 'Jul 4, 2024, 7:00 AM',
      },
      {
        field: 'stage',
        type: 'select',
        extra: { options: [{ value: 'won', label: 'Closed Won' }] },
        stored: 'won',
        chip: 'Closed Won',
      },
    ];

    it.each(FORMATTED)(
      '$type prints $chip for $stored — the seen face, not the stored value',
      ({ field, type, extra, stored, chip }) => {
        const { container } = renderPage({
          summaryFields: [field] as any,
          fields: [{ name: field, label: field, type, ...extra }] as any,
          data: { id: 'A7', name: 'Acme', [field]: stored },
        });

        const el = requireChip(container, field);
        expect(textOf(el), `${type} keeps its own summary format`).toBe(chip);
        expect(
          el.getAttribute('aria-label'),
          `${type} keeps the accessible name it always had`,
        ).toBe(`${field}: ${chip}`);
        expect(String(stored), 'CONTROL: the stored value and the chip face differ or agree by measurement').not.toBe(
          '[object Object]',
        );
        expect(nestedPills(el).length, `${type} draws no cell renderer's pill inside the chip`).toBe(0);
      },
    );

    /**
     * ⚠️ The expected text has now moved TWICE, and the pin is still doing its
     * job both times, because its subject is ROUTING — that a percent keeps the
     * chip's own text path and its own single bar instead of being handed to a
     * cell renderer — and the routing is unchanged by either card.
     *
     *  - objectui#8728: `0.123%` → `12.3%`. That card found the chip's two
     *    halves scaling the same stored number by two different rules, so the
     *    `0.123%` this line used to require was the text disagreeing with the
     *    bar drawn beside it. The agreement itself is pinned in
     *    `summaryChip.percentOneRule-8728.test.tsx`.
     *  - objectui#9167: `12.3%` → `12%`. The chip's text now goes through
     *    `formatPercent`, the list cell's own call, so it rounds to the field's
     *    declared precision (`0` here, undeclared) and renders the locale's own
     *    affix. ⭐ Note what did NOT move: the bar-span count below, which is
     *    the actual assertion of this case. The spelling is pinned across both
     *    surfaces in `summaryChip.percentConvention-9167.test.tsx`.
     */
    it('PERCENT — keeps its own text AND its single decorative bar', () => {
      const { container } = renderPage({
        summaryFields: ['ratio'] as any,
        fields: [{ name: 'ratio', label: 'Ratio', type: 'percent' }] as any,
        data: { id: 'A8', name: 'Acme', ratio: 0.123 },
      });

      const chip = requireChip(container, 'ratio');
      expect(textOf(chip), 'the percent chip keeps its own text').toBe('12%');
      // The chip's OWN bar is two `rounded-full` spans — track and fill. A cell
      // renderer routed in here would add its own, so the exact count is the pin.
      expect(nestedPills(chip).length, 'exactly the chip\'s own two-span bar, no renderer bar').toBe(2);
      expect(
        chip.getAttribute('aria-label'),
        'and the accessible name still comes from that same string',
      ).toBe('Ratio: 12%');
    });
  });

  /**
   * The string path for values it always handled. Byte-identical: the fix fires
   * on the DEFECT'S OWN SIGNATURE (`String(val)` produced the placeholder), so
   * nothing that already rendered can be touched by it.
   */
  it('SCALARS AND SCALAR ARRAYS — untouched', () => {
    const { container } = renderPage({
      summaryFields: ['name_txt', 'count', 'labels'] as any,
      fields: [
        { name: 'name_txt', label: 'Name', type: 'text' },
        { name: 'count', label: 'Count', type: 'number' },
        { name: 'labels', label: 'Labels', type: 'text' },
      ] as any,
      data: { id: 'A9', name: 'Acme', name_txt: 'Plain String Value', count: 16, labels: ['a', 'b'] },
    });

    expect(textOf(requireChip(container, 'name_txt')), 'a string is verbatim').toBe(
      'Plain String Value',
    );
    expect(textOf(requireChip(container, 'count')), 'a number is verbatim').toBe('16');
    // `String(['a','b'])` is `a,b` — it never produced the placeholder, so the
    // fix does not fire and this text may not move.
    expect(textOf(requireChip(container, 'labels')), 'an array of strings keeps String()\'s join').toBe(
      'a,b',
    );
  });

  it('THE PAGE — no band of the rendered record still says `[object Object]`', () => {
    const { container } = renderPage({
      summaryFields: ['owner_ref', 'billing_address', 'office_location'] as any,
      fields: [
        { name: 'owner_ref', label: 'Owner', type: 'lookup' },
        { name: 'billing_address', label: 'Billing Address', type: 'address' },
        { name: 'office_location', label: 'Office Location', type: 'location' },
      ] as any,
      data: {
        id: 'A10',
        name: 'Acme Corporation',
        owner_ref: { id: 'acct-1', name: 'Ada Lovelace' },
        billing_address: { street: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62704', country: 'USA' },
        office_location: { latitude: 30.2741567, longitude: 120.1551234 },
      },
    });

    // CONTROL — all three chips are present, so "no placeholder" is not the
    // trivially-true statement of a page that rendered no chips at all.
    expect(
      ['owner_ref', 'billing_address', 'office_location'].filter((f) => chipFor(container, f)),
      'CONTROL: all three summary chips rendered',
    ).toEqual(['owner_ref', 'billing_address', 'office_location']);

    expect(
      container.textContent ?? '',
      'the whole record page is free of the String() placeholder',
    ).not.toContain('[object Object]');
  });
});
