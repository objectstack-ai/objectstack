/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The WHOLE record page has one definition of emptiness, and it TRIMS
 * (objectui#8394, widening objectui#8376 past `DetailSection`).
 *
 * ## The defect
 *
 * objectui#8350 gave the `record:details` dedupe ladder the H1's authority;
 * objectui#8376 converged `DetailSection`'s three raw spellings onto
 * `hasCellValue`. Four more raw `null | undefined | ''` tests were left on the
 * SAME page, none of them trimming — so for a whitespace-only value the H1 said
 * "empty", the body grid said "empty", and the bands between and around them
 * said "filled" and painted nothing:
 *
 *  - `HeaderHighlight` — the ADR-0085 strip, one band above the body grid and
 *    directly under the H1: a blank chip where the em-dash belongs;
 *  - `DetailView` — the `summaryFields` chips beside the H1: a blank Badge;
 *  - `HistoryTimeline` — a blank audit cell where `'—'` means "nothing";
 *  - `RecordMetaFooter` — a blank actor slot.
 *
 * ## Two sites are NOT a simple predicate swap, and the cases say so
 *
 * ⭐ `DetailView` decides this TWICE. `autoSummaryFields`' `has()` picks which
 * field becomes a chip, and the render decides whether that chip draws. They
 * must give the same answer: with `status` holding only spaces, the raw picker
 * spent the single status slot on it, and a render-only fix then dropped the
 * chip — leaving NO status chip where a genuinely filled `stage` would have
 * shown one. `PICKER AND RENDER AGREE` is red for a fix applied only at the
 * render site (the line the card names).
 *
 * ⭐ `RecordMetaFooter` asks it FOUR times over one value — `hasCreated`, the
 * `sameUser` suppression, the `label` choice, and `MetaEntry`'s `{user ? … }`
 * gate — and only the last reaches `UserRef` (the line the card names). Fixing
 * `UserRef` alone leaves the "Created by" label and the `·` separator in place
 * over an actor that is not there. `THE "BY"-LESS LABEL` is red for that
 * partial fix, so the footer is normalized at the READ instead.
 *
 * ## Controls
 *
 * "The blank is gone" is trivially true of a document that rendered nothing, so
 * every case asserts a sibling that DID render, by value. `NON-REGRESSION — an
 * emptiness test that answers EMPTY for everything` is the case that is red for
 * deleting the feature, which every other case here would otherwise accept, and
 * `NON-REGRESSION — object-valued highlights` is the case that is red for
 * delegating the object half to `recordDisplayValueAt` wholesale.
 *
 * ## Reading the affordances
 *
 * ⚠️ This instrument was re-derived by objectui#8506 and the reason is worth
 * keeping. It used to read the strip's affordance as
 * `[aria-label="No value"]:not([data-slot="empty-value"])`, because two
 * DIFFERENT placeholders could carry that name on this page — `HeaderHighlight`'s
 * own hand-rolled span, and `@object-ui/components`' `EmptyValue`, which the
 * field cell renderers draw — and only the latter carried the `data-slot`.
 * objectui#8506 made the strip adopt the shared component, so that `:not()`
 * matched NOTHING and this case failed while the surface was perfectly correct:
 * the harness navigated by exactly the thing that changed.
 *
 * The replacement navigates by the field LABEL, which no placeholder change can
 * move: each chip is `<span>{label}</span>` followed by the value slot, so
 * `chipOf(label)` is the chip box and the affordance is read INSIDE it. That
 * also strengthens the assertion from "how many" to "which chip".
 *
 * ⚠️ **The summary chips below were re-derived the same way, and for the same
 * reason, by objectui#8729** — declared here rather than done quietly, because
 * this instrument belongs to this card and not to that one.
 *
 * They used to be navigated by `[aria-label^="<storedName>: "]`, which made the
 * harness depend on the chip NAMING ITS FIELD BY THE STORED COLUMN — the very
 * thing objectui#8729 changed (the chip now resolves a label through
 * `fieldLabel`, as every other band of this page already did). That is exactly
 * the objectui#8506 shape one paragraph up: the navigation target moved, so
 * `chipFor` matched nothing and two cases failed while the emptiness authority
 * they exist to guard was untouched.
 *
 * `chipFor` now navigates by `data-summary-chip="<storedName>"`, the machine
 * handle objectui#8464 added. That is strictly better here than either
 * spelling of the name: it is a handle rather than a reader-facing string, so
 * no display or naming decision can move it, and it also finds the
 * renderer-backed chips — which carry no `aria-label` at all and which the old
 * selector could never have seen.
 *
 * ⭐ **This card's subject did not move.** Every emptiness answer below —
 * which chip renders, which does not, and that the picker and the render agree
 * — is asserted on exactly the same fields with exactly the same data. One
 * assertion about the chip's NAME moved (`stage: Won` → `Stage: Won`); its
 * stated purpose, "the chip that took the slot reads its value", is preserved
 * and now reads the value under the field's resolved label.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { recordDisplayValueAt } from '@object-ui/core';
import { HeaderHighlight } from '../HeaderHighlight';
import { DetailView } from '../DetailView';
import { HistoryTimeline, type HistoryEntry } from '../HistoryTimeline';
import { RecordMetaFooter } from '../RecordMetaFooter';
import { hasCellValue } from '../emptiness';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * Desktop. `DetailView` reads `useIsMobile()` for its own layout, and the
 * `DetailSection`s it renders switch auto-hide thresholds on it — pinned rather
 * than inherited from happy-dom's default so no assertion here is green only
 * because of an unpinned viewport.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(cleanup);

/** Presence as a VALUE — `getByText` would throw before `expect` ran and the
 *  CI summary would carry none of the reason. */
const shown = (text: string) => screen.queryByText(text) !== null;

/**
 * The chip box a field's LABEL sits in — the strip renders the label as the
 * chip's first child. Anchored on the label, never on the placeholder: see the
 * docblock.
 */
const chipOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

/** WHICH of `labels`' chips draw the em-dash affordance — see the docblock. */
const chipsDrawingAffordance = (labels: string[]) =>
  labels.filter((l) => chipOf(l).querySelector('[data-slot="empty-value"]') !== null);

/**
 * The summary chip for `field`, read by the machine handle the Badge carries —
 * never by the name it gives the field, which is objectui#8729's subject and
 * not this card's. See the docblock.
 */
const chipFor = (c: HTMLElement, field: string) =>
  c.querySelector(`[data-summary-chip="${field}"]`);

const highlightSchema = {
  fields: {
    industry: { type: 'text', label: 'Industry' },
    notes: { type: 'text', label: 'Notes' },
    amount: { type: 'number', label: 'Amount' },
    office_location: { type: 'location', label: 'Office Location' },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [
        { value: 'alpha', label: 'Alpha' },
        { value: 'beta', label: 'Beta' },
      ],
    },
  },
};

const highlights = (names: string[]) =>
  names.map((name) => ({
    name,
    // The strip labels a chip from `HighlightField.label`; declared here so the
    // controls below can find a chip by name without depending on how an
    // i18n-less test environment renders a missing label.
    label: (highlightSchema.fields as Record<string, { label: string }>)[name].label,
  })) as any;

describe('HeaderHighlight — the ADR-0085 strip trims (#8394)', () => {
  it('AFFORDANCE — a whitespace-only highlight draws the `No value` em-dash, not a blank chip', () => {
    // The card's headline site: after objectui#8376 this was the ONLY band on
    // the page still calling a whitespace-only value FILLED, and it sits
    // between the H1 (which calls it empty) and the body grid (which now does
    // too) — the contradiction is visible in one screenful.
    const { container } = render(
      <HeaderHighlight
        fields={highlights(['industry', 'notes', 'amount'])}
        data={{ industry: 'Manufacturing', notes: '   ', amount: 42 }}
        objectSchema={highlightSchema}
      />,
    );

    // CONTROLS — the strip rendered, and both ordinary chips rendered BY VALUE.
    expect(shown('Manufacturing'), 'CONTROL: the filled text chip rendered').toBe(true);
    expect(shown('42'), 'CONTROL: the filled number chip rendered').toBe(true);
    // CONTROL — the whitespace chip's own slot exists, so the assertion below
    // is about what that chip DRAWS and not about whether it is on screen.
    expect(shown('Notes'), 'CONTROL: the whitespace-only chip is on screen at all').toBe(true);

    expect(
      chipsDrawingAffordance(['Industry', 'Notes', 'Amount']),
      'exactly the whitespace-only chip draws the strip\'s `No value` em-dash',
    ).toEqual(['Notes']);
    expect(
      container.textContent,
      'the raw whitespace must not reach the DOM as a rendered value',
    ).not.toMatch(/ {3}/);
  });

  it('NON-REGRESSION — object-valued highlights are still FILLED (the half that must NOT delegate)', () => {
    // `recordDisplayValueAt` calls both of these EMPTY — neither carries a
    // name-ish key — yet both render real content through their type-aware cell
    // renderer. This case is RED for a wholesale delegation, which is what the
    // card warns the fix must not be.
    const { container } = render(
      <HeaderHighlight
        fields={highlights(['office_location', 'tags', 'industry'])}
        data={{
          office_location: { latitude: 30.2741, longitude: 120.1551 },
          tags: ['alpha', 'beta'],
          industry: 'Manufacturing',
        }}
        objectSchema={highlightSchema}
      />,
    );

    expect(shown('Manufacturing'), 'CONTROL: the ordinary filled chip rendered').toBe(true);
    expect(
      container.textContent,
      'a geolocation object renders as coordinates, not as the em-dash',
    ).toContain('30.2741, 120.1551');
    expect(shown('Alpha'), 'a multiselect array renders its options').toBe(true);
    expect(shown('Beta'), 'a multiselect array renders its options').toBe(true);
    expect(
      chipsDrawingAffordance(['Office Location', 'Tags', 'Industry']),
      'NO chip here is empty — an object value is a value on this surface',
    ).toEqual([]);
  });

  it('NON-REGRESSION — an emptiness test that answers EMPTY for everything is refused (`0` and a string)', () => {
    // Every whitespace case above is ALSO satisfied by deleting the feature.
    // This one is not: `0` is the value a careless `!value` rewrite loses.
    render(
      <HeaderHighlight
        fields={highlights(['industry', 'amount'])}
        data={{ industry: 'Manufacturing', amount: 0 }}
        objectSchema={highlightSchema}
      />,
    );

    expect(shown('Manufacturing'), 'a plain string is a value').toBe(true);
    expect(shown('0'), '`0` is a value, not a blank').toBe(true);
    expect(
      chipsDrawingAffordance(['Industry', 'Amount']),
      'no chip draws the em-dash — nothing here is empty',
    ).toEqual([]);
  });
});

describe('DetailView — the summary chips beside the H1 trim (#8394)', () => {
  const render8394 = (schema: Partial<DetailViewSchema>) =>
    render(<DetailView schema={{ type: 'detail-view', objectName: 'deal', ...schema } as DetailViewSchema} />);

  it('CHIP — a whitespace-only summary field renders no chip, and its neighbour still does', () => {
    const { container } = render8394({
      data: { id: 'D1', name: 'Acme', notes: '   ', amount: 42 },
      summaryFields: ['notes', 'amount'] as any,
      fields: [{ name: 'notes', label: 'Notes' }, { name: 'amount', label: 'Amount' }] as any,
    });

    // CONTROL — the page rendered its H1 at all.
    expect(container.querySelector('h1'), 'CONTROL: the header rendered').not.toBeNull();
    // CONTROL — the sibling chip IS there, so the absence below is a decision
    // about this value and not about the chip row.
    expect(
      chipFor(container, 'amount'),
      'CONTROL: the filled summary field still renders its chip',
    ).not.toBeNull();

    expect(
      chipFor(container, 'notes'),
      'a whitespace-only summary field must render no chip at all, not a blank one',
    ).toBeNull();
  });

  it('⭐ PICKER AND RENDER AGREE — a whitespace-only `status` must not consume the auto-detected status slot', () => {
    // `autoSummaryFields` decides emptiness a SECOND time, one rung before the
    // render. Raw, it picked `status` (spaces satisfy `!== ''`), and a
    // render-only fix then dropped that chip — so the header showed NO status
    // chip, where the genuinely filled `stage` should have taken the slot.
    const { container } = render8394({
      data: { id: 'D2', name: 'Acme', status: '   ', stage: 'Won' },
      fields: [{ name: 'status', label: 'Status' }, { name: 'stage', label: 'Stage' }] as any,
    });

    expect(container.querySelector('h1'), 'CONTROL: the header rendered').not.toBeNull();

    expect(
      chipFor(container, 'status'),
      'the whitespace-only `status` is not a chip',
    ).toBeNull();
    expect(
      chipFor(container, 'stage'),
      'the auto-detected status slot goes to `stage`, which actually has a value — a render-only fix leaves this slot EMPTY',
    ).not.toBeNull();
    expect(
      chipFor(container, 'stage')!.getAttribute('aria-label'),
      'and the chip that took the slot reads its value',
      // The NAME half of this string is objectui#8729's (the chip resolves the
      // field's label, `Stage`, where it used to print the stored column,
      // `stage`); the VALUE half is this card's and is unmoved. Re-pinned here
      // rather than loosened, so this line keeps failing for a render-only fix.
    ).toBe('Stage: Won');
  });
});

describe('HistoryTimeline — the audit placeholder trims (#8394)', () => {
  const entry = (changes: HistoryEntry['changes']): HistoryEntry => ({
    id: 'h1',
    action: 'update',
    user_name: 'Jane Doe',
    created_at: '2024-06-01T00:00:00Z',
    changes,
  });

  it('PLACEHOLDER — a whitespace-only audit value reads as `—`, not as a blank cell', () => {
    const { container } = render(
      <HistoryTimeline
        entries={[
          entry([
            { field: 'industry', label: 'Industry', from: 'finance', to: '   ' },
            { field: 'name', label: 'Name', from: 'Acme', to: 'Acme Corp' },
          ]),
        ]}
      />,
    );

    // CONTROLS — the entry rendered, and the sibling row kept both its values.
    expect(shown('Jane Doe'), 'CONTROL: the timeline entry rendered').toBe(true);
    expect(shown('Acme Corp'), 'CONTROL: the sibling change row renders its new value').toBe(true);
    // CONTROL — this row's OLD value is untouched, so the assertion below is
    // about the new value only and not about the row disappearing.
    expect(shown('finance'), 'CONTROL: the `from` value of the same row still renders').toBe(true);

    expect(
      container.textContent,
      'the whitespace-only `to` value reads as the em-dash placeholder',
    ).toContain('finance → —');
    expect(
      container.textContent,
      'the raw whitespace must not reach the DOM as a rendered value',
    ).not.toMatch(/ {3}/);
  });

  it('NON-REGRESSION — object and falsy audit values are still values', () => {
    const { container } = render(
      <HistoryTimeline
        entries={[
          entry([
            { field: 'geo', label: 'Geo', from: null, to: { lat: 1, lng: 2 } },
            { field: 'active', label: 'Active', from: true, to: false },
          ]),
        ]}
      />,
    );

    expect(shown('Jane Doe'), 'CONTROL: the timeline entry rendered').toBe(true);
    expect(
      container.textContent,
      'an object audit value is still JSON, not the placeholder',
    ).toContain('{"lat":1,"lng":2}');
    expect(
      container.textContent,
      '`false` is a value — an emptiness test answering EMPTY for everything fails here',
    ).toContain('true → false');
  });
});

describe('RecordMetaFooter — an actor is normalized at the READ (#8394)', () => {
  const footer = (data: Record<string, unknown>) =>
    render(<RecordMetaFooter data={data} objectSchema={{ fields: { name: { type: 'text' } } }} />);

  it('⭐ THE "BY"-LESS LABEL — a whitespace-only `created_by` is no actor at all', () => {
    // Fixing only `UserRef` (the line the card names) removes the blank but
    // leaves BOTH the "Created by" label and the `·` separator standing over
    // an actor that is not there — "Created by · 5m ago", the dangling phrase
    // the label branch exists to prevent. That is why the footer normalizes at
    // the read: this case is red for the renderer-only fix.
    const { container } = footer({
      created_at: '2024-06-01T00:00:00Z',
      created_by: '   ',
    });

    // CONTROL — the footer rendered at all.
    expect(screen.getByTestId('record-meta-footer'), 'CONTROL: the footer rendered').toBeTruthy();

    expect(shown('Created'), 'the "by"-less label is used when there is no actor').toBe(true);
    expect(shown('Created by'), 'the "Created by" label must not stand over a missing actor').toBe(
      false,
    );
    expect(
      container.textContent,
      'no actor means no `·` separator either',
    ).not.toContain('·');
    expect(
      container.textContent,
      'the raw whitespace must not reach the DOM as a rendered actor',
    ).not.toMatch(/ {3}/);
  });

  it('NON-REGRESSION — a real actor still labels, separates and renders (id and expanded object)', () => {
    // The control for the case above AND the object half: an expanded
    // `{ id, name }` reference is a value here because `UserRef` hands objects
    // to `LookupCellRenderer`, which resolves them through its own display
    // chain. This case is red for an emptiness test that answers EMPTY for
    // everything.
    const { container } = footer({
      created_at: '2024-06-01T00:00:00Z',
      created_by: { id: 'u1', name: 'Jane Doe' },
    });

    expect(screen.getByTestId('record-meta-footer'), 'CONTROL: the footer rendered').toBeTruthy();
    expect(shown('Created by'), 'a real actor takes the "by" label').toBe(true);
    expect(shown('Jane Doe'), 'an expanded reference object still renders its name').toBe(true);
    expect(container.textContent, 'a real actor keeps the `·` separator').toContain('·');
  });
  it('NON-REGRESSION — a bare `{ id }` actor still renders (the footer\'s object half must NOT delegate)', () => {
    // MEASURED on this branch, not assumed: `LookupCellRenderer` draws `u1` for
    // this payload (an opaque 32-char id is the case it hides behind its own
    // placeholder — objectui#2688 — and this is not that). The TITLE authority
    // calls a bare `{ id }` payload EMPTY, so delegating the object half here
    // would drop the actor entirely: the label would fall back to the
    // "by"-less `Created` and `u1` would leave the screen. This is the case
    // that makes the footer\'s object half load-bearing.
    const { container } = footer({
      created_at: '2024-06-01T00:00:00Z',
      created_by: { id: 'u1' },
    });

    expect(screen.getByTestId('record-meta-footer'), 'CONTROL: the footer rendered').toBeTruthy();
    expect(shown('Created by'), 'a bare `{ id }` payload is still an actor').toBe(true);
    expect(
      container.textContent,
      'the reference renderer draws it — a wholesale delegation would blank it',
    ).toContain('u1');
  });
});

describe('The one authority, asserted rather than cited (#8394)', () => {
  /**
   * An ADDITION to the DOM cases above, never a substitute. It measures the
   * shared predicate directly so the split the whole page depends on is stated
   * once, in one place, instead of being inferred from five renders.
   */
  it('MEASUREMENT — `hasCellValue` trims scalars and keeps objects, and the authority does not', () => {
    expect(hasCellValue('   '), 'whitespace-only is EMPTY').toBe(false);
    expect(hasCellValue(''), 'empty string is EMPTY').toBe(false);
    expect(hasCellValue(null), 'null is EMPTY').toBe(false);
    expect(hasCellValue(undefined), 'undefined is EMPTY').toBe(false);
    expect(hasCellValue(0), '`0` is a value').toBe(true);
    expect(hasCellValue(false), '`false` is a value').toBe(true);
    expect(hasCellValue('Acme'), 'a plain string is a value').toBe(true);

    // The object half — a value HERE, and empty to the title authority. These
    // two expectations are the measurement behind the split; they disagree on
    // purpose.
    const geo = { latitude: 30.2741, longitude: 120.1551 };
    expect(hasCellValue(geo), 'a geolocation object is a cell VALUE').toBe(true);
    expect(
      recordDisplayValueAt({ value: geo }, 'value'),
      'the same object has no display NAME — a wholesale delegation would blank it',
    ).toBeUndefined();
    expect(hasCellValue(['alpha', 'beta']), 'an option array is a cell VALUE').toBe(true);
    expect(
      recordDisplayValueAt({ value: ['alpha', 'beta'] }, 'value'),
      'the same array has no display NAME',
    ).toBeUndefined();
  });
});
