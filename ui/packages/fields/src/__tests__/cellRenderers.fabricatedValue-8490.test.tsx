/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8490 — an empty array is not a cell value, and eight renderers
 * FABRICATED one.
 *
 * objectui#8481 fixed the renderers whose output for `[]` was BLANK. This is
 * the other half of that census: the renderers whose output for `[]` was not
 * blank but WRONG — a value the record does not hold. Every row below was
 * re-measured by rendering on `e411c3e58` (after `639ca9dc0`, the #8481 fix,
 * which moved none of them):
 *
 * | field types                | renderer                  | rendered for `[]` before             | why                                       |
 * |----------------------------|---------------------------|--------------------------------------|-------------------------------------------|
 * | boolean, toggle            | `BooleanCellRenderer`     | a CHECKED, disabled checkbox         | guard was `value == null`; `[]` is truthy |
 * | number, slider, rating     | `NumberCellRenderer`      | the digit `0`                        | `coerceToSafeValue([])` is `''`; `Number('')` is `0` |
 * | currency                   | `CurrencyCellRenderer`    | the digit `0`                        | same                                      |
 * | percent, progress          | `PercentCellRenderer`     | a 0% progress bar, `aria-valuenow=0` | same                                      |
 * | email                      | `EmailCellRenderer`       | a live anchor, `href="mailto:"`      | guard was `!value`                        |
 * | url                        | `UrlCellRenderer`         | a live `_blank` anchor, `href=""`    | same                                      |
 * | phone                      | `PhoneCellRenderer`       | a live anchor, `href="tel:"`         | same                                      |
 * | color                      | `ColorSwatchCellRenderer` | a bordered swatch with no colour     | guard was `value == null \|\| value === ''` |
 * | date (the adjacent ninth)  | `DateCellRenderer`        | a hand-rolled em-dash, no aria-label | `formatDate('')` draws its own dash       |
 *
 * ── The ruling is per renderer, not one predicate ─────────────────────────
 * Every row lands on the shared `EmptyValue` affordance, but for DIFFERENT
 * reasons and with different sweep widths, and the card asked for exactly
 * that distinction:
 *
 *   - `boolean`: `[]` is not a boolean and holds no entries, so the column
 *     holds NO value — not `false`. Only `[]` moved HERE; `false` stays an
 *     unchecked box. The scalar coercions this card left untouched were
 *     taken next by objectui#8582 (only a real boolean is a value of a
 *     boolean column), pinned in `booleanCell.nonBooleanScalar-8582.test.tsx`.
 *   - number / currency / percent: the `0` was `Number('')` — a coercion
 *     artefact, not a stored zero — so the guard is on the coerced TEXT, and
 *     a stored `''` (the same fabrication one input-shape over) is swept in
 *     DELIBERATELY. Pinned in THE BOUNDARY below.
 *   - email / url / phone: nothing to link to means no anchor in the DOM.
 *   - color: no colour string means no swatch.
 *   - date: the coerced-empty branch reaches the shared affordance rather
 *     than `formatDate`'s private dash (the objectui#8475 class of defect).
 *
 * `EmptyValue`'s accessible name is "No value", a STATEMENT — it is true at
 * every site above because in each case the record holds no value of the
 * field's type.
 *
 * ── Why the POPULATED cases are the load-bearing ones ─────────────────────
 * The caricature is `EmptyValue` drawn unconditionally, populated cells
 * included. It satisfies every "[] renders the affordance" case in this file.
 * What refuses it is the POPULATED block: a real `true` still checks, a real
 * `false` is still an unchecked box, a real stored `0` still prints, a real
 * address still links, a real colour still swatches. Each of those was RUN
 * against the caricature, not predicted — see the PR for the observed
 * failure modes per leg.
 *
 * ── Why the defect leg asserts the ARTEFACT'S ABSENCE FIRST ───────────────
 * Each `[]` case asserts "no fabricated artefact" before "affordance
 * present", so its failure on the unfixed tree ("a checked checkbox is a
 * fabricated value") is textually distinct from a harness that has lost its
 * navigation target ("the shared affordance must be present"). The two legs
 * were observed to fail on those two different sentences.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getCellRenderer, resolveCellRendererType } from '../index';

afterEach(() => cleanup());

/** Resolve + render exactly the way a consumer builds a read-mode cell. */
function renderCell(type: string, value: unknown, field: Record<string, unknown> = {}) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type }) || type);
  return render(
    <Renderer value={value as any} field={{ type, name: type, ...field } as any} />,
  );
}

/** The shared "No value" affordance — a muted glyph carrying an aria-label. */
const affordance = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-slot="empty-value"]');

function expectAffordance(root: HTMLElement, label: string) {
  const empty = affordance(root);
  expect(empty, `${label}: the shared EmptyValue affordance must be present`).not.toBeNull();
  expect(
    empty?.getAttribute('aria-label'),
    `${label}: the affordance must carry its accessible name`,
  ).toBe('No value');
}

/**
 * Every em-dash in the cell must be the shared affordance. `EmptyValue`
 * itself renders U+2014, so "no dash at all" is the wrong instrument; the
 * defect is a dash OUTSIDE it.
 */
function handRolledDashes(root: HTMLElement): HTMLElement[] {
  return within(root)
    .queryAllByText('—')
    .filter((el) => el.getAttribute('data-slot') !== 'empty-value');
}

describe('objectui#8490 — an empty array is not a cell value, and these renderers fabricated one', () => {
  describe('THE DEFECT — [] renders the No-value affordance, not an invented value', () => {
    for (const type of ['boolean', 'toggle'] as const) {
      it(`THE DEFECT — \`${type}\` holding [] draws no checkbox (a checked box was a fabricated \`true\`)`, () => {
        const { container } = renderCell(type, []);
        expect(
          container.querySelector('[role="checkbox"]'),
          `${type}: a checked checkbox is a fabricated value for []`,
        ).toBeNull();
        expectAffordance(container, type);
      });
    }

    it('THE DEFECT — a COMPLETION-named boolean holding [] draws no "Completed" indicator', () => {
      // The sharpest row of the card: the green tick read as an affirmative
      // answer the record never gave.
      const { container } = renderCell('boolean', [], { name: 'completed' });
      expect(
        container.querySelector('[data-testid="completion-indicator"]'),
        'completed: the green "Completed" indicator is a fabricated value for []',
      ).toBeNull();
      expectAffordance(container, 'completed');
    });

    it('THE DEFECT — an ACTIVE-named boolean holding [] draws neither a checkbox nor an "Off" badge', () => {
      const { container } = renderCell('boolean', [], { name: 'active' });
      expect(
        container.querySelector('[role="checkbox"]'),
        'active: a checked checkbox is a fabricated value for []',
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="boolean-warning-badge"]'),
        'active: an "Off" badge would be a fabricated `false` for []',
      ).toBeNull();
      expectAffordance(container, 'active');
    });

    for (const type of ['number', 'slider', 'rating', 'currency'] as const) {
      it(`THE DEFECT — \`${type}\` holding [] prints no digit (\`Number('')\` is 0, the record holds no zero)`, () => {
        const { container } = renderCell(type, []);
        expect(
          within(container).queryAllByText('0').length,
          `${type}: the digit 0 is a fabricated value for []`,
        ).toBe(0);
        expectAffordance(container, type);
      });
    }

    for (const type of ['percent', 'progress'] as const) {
      it(`THE DEFECT — \`${type}\` holding [] draws no progress bar`, () => {
        const { container } = renderCell(type, []);
        expect(
          container.querySelector('[role="progressbar"]'),
          `${type}: a 0% progress bar is a fabricated value for []`,
        ).toBeNull();
        expect(
          within(container).queryAllByText('0%').length,
          `${type}: the text 0% is a fabricated value for []`,
        ).toBe(0);
        expectAffordance(container, type);
      });
    }

    for (const type of ['email', 'url', 'phone'] as const) {
      it(`THE DEFECT — \`${type}\` holding [] renders no anchor (a link with nothing to link to)`, () => {
        const { container } = renderCell(type, []);
        expect(
          container.querySelector('a'),
          `${type}: a live anchor with an empty target is a fabricated affordance for []`,
        ).toBeNull();
        expect(
          container.querySelector('button'),
          `${type}: a copy button for nothing is a fabricated affordance for []`,
        ).toBeNull();
        expectAffordance(container, type);
      });
    }

    it('THE DEFECT — `color` holding [] draws no swatch', () => {
      const { container } = renderCell('color', []);
      expect(
        container.querySelector('[aria-hidden="true"]'),
        'color: a bordered swatch box with no colour is a fabricated value for []',
      ).toBeNull();
      expect(
        container.querySelector('.font-mono'),
        'color: an empty hex span is a fabricated value for []',
      ).toBeNull();
      expectAffordance(container, 'color');
    });

    it('THE DEFECT (adjacent ninth) — `date` holding [] renders the shared affordance, not a hand-rolled em-dash', () => {
      const { container } = renderCell('date', []);
      // Value-span absence FIRST: on the unfixed tree this is the sentence
      // that fails; a harness that has lost the affordance's `data-slot`
      // passes it and fails on the dash-ownership sentence below instead.
      expect(
        container.querySelector('span.tabular-nums'),
        'date: the value span must not be drawn around nothing',
      ).toBeNull();
      expect(
        handRolledDashes(container).length,
        'date: the em-dash must be the shared affordance, not a bare span a screen reader cannot name',
      ).toBe(0);
      expectAffordance(container, 'date');
    });
  });

  describe('POPULATED — these refuse an EMPTY-for-everything implementation', () => {
    it('POPULATED — a real `true` is still a CHECKED checkbox', () => {
      const { container } = renderCell('boolean', true);
      const box = container.querySelector('[role="checkbox"]');
      expect(box, 'boolean: a real true must still draw its checkbox').not.toBeNull();
      expect(box?.getAttribute('aria-checked'), 'boolean: a real true must still be checked').toBe('true');
      expect(affordance(container), 'boolean: a real true must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a real `false` is still an UNCHECKED checkbox (false is a value, not an absence)', () => {
      const { container } = renderCell('boolean', false);
      const box = container.querySelector('[role="checkbox"]');
      expect(box, 'boolean: a real false must still draw its checkbox').not.toBeNull();
      expect(box?.getAttribute('aria-checked'), 'boolean: a real false must still be unchecked').toBe('false');
      expect(affordance(container), 'boolean: a real false must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a completion field holding a real `true` still draws "Completed"', () => {
      const { container } = renderCell('boolean', true, { name: 'completed' });
      const indicator = container.querySelector('[data-testid="completion-indicator"]');
      expect(indicator, 'completed: a real true must still draw the indicator').not.toBeNull();
      expect(indicator?.getAttribute('aria-label'), 'completed: a real true reads "Completed"').toBe('Completed');
    });

    it('POPULATED — an active field holding a real `false` is still an UNCHECKED checkbox (objectui#13412 retired its "Off" badge)', () => {
      const { container } = renderCell('boolean', false, { name: 'active' });
      const box = container.querySelector('[role="checkbox"]');
      expect(box, 'active: a real false must still draw its checkbox').not.toBeNull();
      expect(box?.getAttribute('aria-checked'), 'active: a real false must still be unchecked').toBe('false');
      expect(affordance(container), 'active: a real false must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a real stored `0` still prints as 0 in number, currency and percent', () => {
      const num = renderCell('number', 0);
      expect(within(num.container).queryAllByText('0').length, 'number: a real 0 must still print').toBe(1);
      expect(affordance(num.container), 'number: a real 0 must NOT render the affordance').toBeNull();
      cleanup();

      const cur = renderCell('currency', 0);
      // A currency with none resolved reads at two places, a whole amount
      // included, since objectui#11444 retired the whole-amount trimming
      // (triage comment 5946462862): a real 0 prints `0.00`.
      expect(within(cur.container).queryAllByText('0.00').length, 'currency: a real 0 must still print').toBe(1);
      expect(affordance(cur.container), 'currency: a real 0 must NOT render the affordance').toBeNull();
      cleanup();

      const pct = renderCell('percent', 0);
      const bar = pct.container.querySelector('[role="progressbar"]');
      expect(bar, 'percent: a real 0 must still draw its bar').not.toBeNull();
      expect(bar?.getAttribute('aria-valuenow'), 'percent: a real 0 is a 0% bar').toBe('0');
      expect(within(pct.container).queryAllByText('0%').length, 'percent: a real 0 must still print 0%').toBe(1);
      expect(affordance(pct.container), 'percent: a real 0 must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a non-zero number still prints', () => {
      const { container } = renderCell('number', 42);
      expect(within(container).queryAllByText('42').length, 'number: 42 must still print').toBe(1);
      expect(affordance(container), 'number: 42 must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a real address still links (mailto:, plain href, tel:)', () => {
      const email = renderCell('email', 'ada@example.com');
      const mail = email.container.querySelector('a');
      expect(mail, 'email: a real address must still draw its anchor').not.toBeNull();
      expect(mail?.getAttribute('href'), 'email: a real address still links').toBe('mailto:ada@example.com');
      expect(affordance(email.container), 'email: a real address must NOT render the affordance').toBeNull();
      cleanup();

      const url = renderCell('url', 'https://example.com/');
      const link = url.container.querySelector('a');
      expect(link, 'url: a real URL must still draw its anchor').not.toBeNull();
      expect(link?.getAttribute('href'), 'url: a real URL still links').toBe('https://example.com/');
      expect(affordance(url.container), 'url: a real URL must NOT render the affordance').toBeNull();
      cleanup();

      const phone = renderCell('phone', '+1 555 0100');
      const tel = phone.container.querySelector('a');
      expect(tel, 'phone: a real number must still draw its anchor').not.toBeNull();
      expect(tel?.getAttribute('href'), 'phone: a real number still links').toBe('tel:+1 555 0100');
      expect(affordance(phone.container), 'phone: a real number must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a ONE-entry array of addresses is a value: it still links', () => {
      // Refuses an over-correction spelled `Array.isArray` rather than "is
      // there anything to link to": `['ada@example.com']` coerces to the
      // address and links exactly as the scalar does.
      const { container } = renderCell('email', ['ada@example.com']);
      expect(
        container.querySelector('a')?.getAttribute('href'),
        'email: a one-entry array still links to its one address',
      ).toBe('mailto:ada@example.com');
      expect(affordance(container), 'email: a one-entry array must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a real colour still draws its swatch and its hex', () => {
      const { container } = renderCell('color', '#ff0000');
      expect(
        container.querySelector('[aria-hidden="true"]'),
        'color: a real colour must still draw its swatch',
      ).not.toBeNull();
      expect(within(container).queryAllByText('#ff0000').length, 'color: a real colour prints its hex').toBe(1);
      expect(affordance(container), 'color: a real colour must NOT render the affordance').toBeNull();
    });

    it('POPULATED — a real date still renders in its value span', () => {
      const { container } = renderCell('date', '2024-01-15T00:00:00.000Z', { format: 'short' });
      const span = container.querySelector('span.tabular-nums');
      expect(span, 'date: a real date must still draw its value span').not.toBeNull();
      expect(span?.textContent, 'date: a real date must render a formatted value').toMatch(/24/);
      expect(handRolledDashes(container).length, 'date: a real date draws no dash').toBe(0);
      expect(affordance(container), 'date: a real date must NOT render the affordance').toBeNull();
    });
  });

  describe('THE BOUNDARY — what this change deliberately does and does not sweep', () => {
    it("THE BOUNDARY — a stored '' in the number family is swept in: it is the SAME `Number('')` fabrication", () => {
      // Declared, not incidental. `''` reaches the identical coercion `[]`
      // does, so a guard that let it through would keep printing a zero the
      // record never held one input-shape over.
      for (const type of ['number', 'currency', 'percent'] as const) {
        const { container } = renderCell(type, '');
        expect(
          within(container).queryAllByText(/^0%?$/).length,
          `${type}: a stored '' must not print a fabricated zero either`,
        ).toBe(0);
        expectAffordance(container, `${type} holding ''`);
        cleanup();
      }
    });

    it("THE BOUNDARY — a one-entry array holding '' has no address either: the test is on the coerced text", () => {
      const { container } = renderCell('email', ['']);
      expect(container.querySelector('a'), "email: [''] has nothing to link to").toBeNull();
      expectAffordance(container, "email holding ['']");
    });

    it('THE BOUNDARY — `boolean` holding a scalar `0` is objectui#8582\'s ruling now, not this card\'s: the same affordance, no box', () => {
      // objectui#8490 moved `[]` ONLY, and this pin used to record that a
      // scalar `0` still drew an unchecked box by truthiness. objectui#8582
      // took the scalar half — only a real boolean is a value of a boolean
      // column — so `[]` and `0` now reach the SAME affordance for the same
      // reason (neither is a boolean). The scalar census lives in
      // `booleanCell.nonBooleanScalar-8582.test.tsx`; this pin only records
      // that the two cards agree at their seam.
      const { container } = renderCell('boolean', 0);
      expect(
        container.querySelector('[role="checkbox"]'),
        'boolean: a scalar 0 draws no checkbox since objectui#8582',
      ).toBeNull();
      expectAffordance(container, 'boolean holding 0');
    });

    it('THE BOUNDARY — `json` still draws the literal and `file` still states its count (objectui#8481 fence, unchanged)', () => {
      const json = renderCell('json', []);
      expect(within(json.container).queryAllByText('[]').length, '`json` holding [] still prints the literal').toBe(1);
      cleanup();
      const file = renderCell('file', []);
      expect(within(file.container).queryAllByText('0 files').length, '`file` holding [] still states a count').toBe(1);
    });
  });
});
