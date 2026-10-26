/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8809 — the readonly `date` widget faces draw `formatDate`'s
 * em-dash through the shared `EmptyValue` affordance. **The carrier changes,
 * the glyph does not.**
 *
 * ── The defect, stated precisely ─────────────────────────────────────────
 * The dash these faces drew for an unparsable value was NOT an unnoticed
 * accident. objectui#8194 enumerated the four `formatDate` sites, fed each
 * the same `'not-a-date'`, and split them 3-1 ON PURPOSE — three inherit the
 * shared function's empty face, `GridField` keeps the raw stored string
 * ("showing the user what is actually stored beats hiding it", objectui#3569).
 * That card chose the GLYPH and pinned it.
 *
 * What was still defective is the CARRIER: the dash was painted in a plain
 * span with no `data-slot` of `empty-value` and no accessible name, so a
 * screen reader got naked punctuation — the objectui#8475 (`RelatedList`) /
 * objectui#8491 (`ObjectGrid`) class of defect. This card repairs exactly
 * that and nothing else.
 *
 * ── Why the compatibility claim is the interesting half ──────────────────
 * `EmptyValue`'s OWN default glyph is the em-dash
 * (`components/src/custom/empty.tsx`, `glyph = "—"`). So the rendered TEXT is
 * unchanged, and objectui#8194's three landed `textContent` assertions stay
 * green. That is not a lucky accident — it is the whole reason this repair is
 * available to this card at all. Moving these faces to the raw string instead
 * would reverse #8194's documented, pinned choice and turn its pin red; that
 * is a maintainer-level reversal, deliberately NOT taken here.
 *
 * Every case below therefore asserts BOTH halves: the affordance is present
 * (the repair) and the text is still a dash (the compatibility claim). A
 * future change that satisfies one and breaks the other fails here.
 *
 * ── Directions ───────────────────────────────────────────────────────────
 * Reverting either site's guard to its former `formatDate`-into-a-plain-span
 * spelling turns `THE REPAIR` red at that site (no affordance, no accessible
 * name) while leaving `THE COMPATIBILITY CLAIM` green — the text is a dash
 * either way, which is precisely why a text-only pin could never have caught
 * this defect and why these cases read the DOM instead.
 *
 * `LIVE CONTROL` is what stops this file passing over a harness that rendered
 * nothing: a populated value must still render its formatted face and must
 * NOT carry the affordance. An empty container fails it.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { formatDate } from '@object-ui/core';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DateField } from '../widgets/DateField';
import { FormulaField } from '../widgets/FormulaField';
import { GridField } from '../widgets/GridField';
import { renderLookupColumnValue } from '../widgets/lookupColumnDisplay';

afterEach(cleanup);

/** `EmptyValue`'s own default glyph, and therefore `formatDate`'s too. */
const DASH = '—';

/**
 * Truthy values `new Date(...)` cannot read. Both reach `formatDate` through
 * the old `value ?` guard; the second is the card's own second example and is
 * a well-formed ISO SHAPE, so it cannot be filtered by spelling.
 */
const UNPARSABLE = ['not-a-date', '2024-13-45'] as const;

/** A value that parses, for the live control. Past-year, so its face is stable. */
const PARSEABLE = '2024-07-04';

/**
 * The accessible name the affordance carries, per locale. Read from two
 * DIFFERENT locales on purpose: a hardcoded English literal would still pass
 * if the name stopped being translated, and the point of the repair is that
 * the dash acquires a NAME, not that it acquires one particular string.
 */
const NO_VALUE = { en: 'No value', zh: '无' } as const;

function session(language: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: undefined }}>{node}</LocalizationProvider>
    </I18nProvider>,
  );
}

const affordanceIn = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-slot="empty-value"]');

/**
 * The two sites this card repairs. `GridField` and the `$date` fallback are
 * deliberately absent — see `SCOPE FENCE` below for what holds each out.
 */
const SITES: ReadonlyArray<readonly [string, (locale: string, value: unknown) => HTMLElement]> = [
  [
    'DateField (readonly `date` widget)',
    (locale, value) =>
      session(
        locale,
        <DateField value={value as string} onChange={() => {}} field={{ type: 'date', name: 'when' } as any} readonly />,
      ).container,
  ],
  [
    'FormulaField (`returnType: date`)',
    (locale, value) =>
      session(
        locale,
        <FormulaField value={value as any} onChange={() => {}} field={{ type: 'formula', name: 'c', returnType: 'date' }} />,
      ).container,
  ],
];

describe.each(SITES)('objectui#8809 — %s', (_name, renderSite) => {
  describe('THE REPAIR — an unparsable value draws the shared affordance, with a name', () => {
    it.each(UNPARSABLE)('%s renders `data-slot` of empty-value', (value) => {
      const el = affordanceIn(renderSite('en', value));
      expect(el).not.toBeNull();
      expect(el).toHaveAttribute('data-slot', 'empty-value');
    });

    it.each(UNPARSABLE)('%s gives that dash an accessible name', (value) => {
      const el = affordanceIn(renderSite('en', value));
      expect(el).toHaveAccessibleName(NO_VALUE.en);
    });

    it('the name is the localized one, not a hardcoded literal', () => {
      expect(affordanceIn(renderSite('zh', UNPARSABLE[0]))).toHaveAccessibleName(NO_VALUE.zh);
    });
  });

  describe('THE COMPATIBILITY CLAIM — the glyph did not move', () => {
    /**
     * This is what keeps objectui#8194's three landed `textContent`
     * assertions green. If a future change moves these faces to the raw
     * string, THIS is the case that goes red first and names the card whose
     * ruling is being reversed.
     */
    it.each(UNPARSABLE)('%s still reads as the em-dash', (value) => {
      expect(renderSite('en', value).textContent).toBe(DASH);
    });
  });

  describe('LIVE CONTROL — a populated value is untouched', () => {
    it('a parseable value still renders its formatted face', () => {
      const root = renderSite('en', PARSEABLE);
      // Non-empty and equal to the shared function: a harness that rendered
      // nothing fails both halves of this line.
      expect(root.textContent).not.toBe('');
      expect(root.textContent).toBe(formatDate(PARSEABLE, undefined, { locale: 'en' }));
    });

    it('a parseable value does NOT carry the affordance', () => {
      expect(affordanceIn(renderSite('en', PARSEABLE))).toBeNull();
    });

    it('the two inputs really do render different DOM', () => {
      // Guards against a harness where every input collapses to one face —
      // which would make every assertion above pass for free.
      expect(affordanceIn(renderSite('en', UNPARSABLE[0]))).not.toBeNull();
      expect(affordanceIn(renderSite('en', PARSEABLE))).toBeNull();
    });
  });
});

/**
 * The two `formatDate` sites this card did NOT touch, pinned so a future sweep
 * has to move a pin deliberately rather than pass silently — the same
 * discipline objectui#8194's own scope fence uses.
 */
describe('objectui#8809 — SCOPE FENCE', () => {
  it('GridField still shows the raw stored value: it is on the OTHER side of #8194 split', () => {
    // objectui#3569, pinned twice already (#8194's file and GridField's own).
    // Its `!ymd` guard runs BEFORE `formatDate`, so it never draws a dash to
    // re-carry. Giving it the affordance would delete a deliberate exception.
    session(
      'en',
      <GridField
        value={[{ when: UNPARSABLE[0] }]}
        onChange={() => {}}
        readonly
        field={{ columns: [{ name: 'when', label: 'When', type: 'date' as const }] } as any}
      />,
    );
    const table = screen.getByTestId('line-items-readonly');
    expect(table.textContent).toContain(UNPARSABLE[0]);
    expect(affordanceIn(table)).toBeNull();
  });

  it('the `$date` lookup fallback still returns plain TEXT, not an element', () => {
    /**
     * Held out for a measured reason, not an aesthetic one: this site's
     * landed pin (objectui#8194's file) reads the function's RETURN VALUE
     * through `String(...)`, not rendered DOM. Returning the affordance here
     * would make that pin read `[object Object]` and turn it red, and the
     * repair may not be bought by rewriting a landed pin. The branch also
     * sits inside a documented plain-text fallback whose every other arm
     * returns a string (objectui#5492). Converging it is a separate decision
     * about that function's contract.
     */
    const out = renderLookupColumnValue(
      { f: { $date: UNPARSABLE[0] } },
      { field: 'f' } as any,
      { descriptors: {}, displayLocale: 'en' } as any,
    );
    expect(typeof out).toBe('string');
    expect(out).toBe(DASH);
  });
});
