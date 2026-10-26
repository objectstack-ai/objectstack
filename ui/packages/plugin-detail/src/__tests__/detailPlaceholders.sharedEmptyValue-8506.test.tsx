/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailSection` and `HeaderHighlight` draw the SHARED `EmptyValue`
 * (objectui#8506).
 *
 * ## What changed, and what did NOT
 *
 * Both files hand-rolled a `<span>—</span>` that resolved its own accessible
 * name from `detail.noValue`. `@object-ui/components`' `EmptyValue` resolves
 * EXACTLY that key, with the same `"No value"` English fallback, through the
 * provider-safe `useObjectTranslation` — so the accessible name is byte-identical
 * before and after in every locale. The card that filed this feared the opposite
 * ("a translated label traded for an untranslated one"); the sibling file
 * `detailPlaceholders.sharedEmptyValueI18n-8506.test.tsx` measures the locale
 * half in `zh` and `de`, and the PROVIDER-LESS case below measures the fallback
 * half here, in a file that mounts no provider at all (see that file's docblock
 * for why the two legs cannot share one file).
 *
 * ## The two per-site decisions this file pins
 *
 * 1. ⭐ **Typography: both sites take the shared treatment, deliberately.** Each
 *    retired a `text-muted-foreground/60 text-sm` spelling of its own. That was
 *    not a neutral difference: a type-aware cell renderer draws the SAME shared
 *    `EmptyValue` at `/50` for a value `hasCellValue` waves through but the
 *    renderer cannot draw — an unparseable `datetime` is the reachable example
 *    (measured on objectui#8503, whose card had attributed the branch to
 *    `DateCellRenderer`; it is `DateTimeCellRenderer`'s). So one section could
 *    show two dashes in two greys, one row apart. `THE AGREEMENT` is that exact
 *    pair, in one render.
 *
 * 2. ⭐ **`DetailSection` keeps its `title`, and keeps it ALIVE.** The `title`
 *    arrived in the same commit as the `aria-label` (`7ca7203ec`) — it is the
 *    sighted-mouse counterpart of the accessible name — and two landed pins read
 *    it as the only instrument that tells this placeholder apart from a cell
 *    renderer's (`DetailSection.emptinessAuthority-8376`,
 *    `record-details.emptySectionDefault`). It rides through `EmptyValue`'s
 *    `...props`. But the shared component sets `pointer-events-none`, and a
 *    `title` on an element that can never be hovered is a dead attribute: the
 *    hover falls through to the row's own `title={t('detail.editInlineHint')}`.
 *    Hence `pointer-events-auto` at that site only — `HeaderHighlight` has no
 *    `title`, so it takes `pointer-events-none` as-is. `THE TOOLTIP IS ALIVE`
 *    pins that, and it is the case the PLAUSIBLE WRONG FIX below reddens.
 *
 * ## Which cases DISCRIMINATE — MEASURED, not predicted
 *
 * Three ablations were RUN against this file, each proved on disk in both
 * directions and restored by state. The results, not the predictions:
 *
 *  - **THE CARICATURE** — `EmptyValue` returned unconditionally from both sites,
 *    filled values included. ⭐ The FIRST run reddened 7 of 8 cases and **not one
 *    of them through its headline assertion**: every failure came out of a
 *    CONTROL ("CONTROL: the filled text row rendered"), because a surface that
 *    draws nothing but placeholders satisfies "the empty row has an accessible
 *    name", "the title survives" and "the two branches agree" perfectly well —
 *    and the 8th, the provider-less fallback, survived outright. That reading is
 *    why this file is shaped the way it is: the two NON-REGRESSION cases now
 *    state `drawingAffordance([...])` FIRST, ahead of their own controls,
 *    because it is the only assertion here that refuses the caricature on its
 *    own terms; and the provider-less case gained a value control and a label
 *    saying what it does not decide. RE-MEASURED after that change: 8 of 8, with
 *    the two `drawingAffordance` cases failing on their HEADLINE and naming the
 *    rows that wrongly drew a dash (`expected ['industry','notes','amount'] to
 *    deeply equal ['notes']`). The other six still fail through a control, which
 *    is what a control is for; they are scope declarations on this axis.
 *  - **THE PLAUSIBLE WRONG FIX** — the swap made, but each site's own
 *    `className` dropped (`pointer-events-auto`, `block`). This is the leg that
 *    matters, because it is what a mechanical swap actually produces and it is
 *    invisible to every assertion that only reads the accessible name. Exactly
 *    three cases refuse it, all three through their HEADLINE: `THE TOOLTIP IS
 *    ALIVE`, `THE AGREEMENT`, `THE LAYOUT CLASS SURVIVES`.
 *  - **THE HARNESS KILL** — the field LABEL removed from both surfaces. Every
 *    lookup here is anchored on that label, never on the placeholder, precisely
 *    so a mutation cannot erase what the harness navigates by (objectui#8504).
 *    All 8 cases redden, and LOUDLY — `Unable to find an element with the text:
 *    industry` — so the anchor is load-bearing rather than decorative, and no
 *    case here can pass over a surface that stopped rendering.
 *
 * ## Reading the DOM
 *
 * ⚠️ `queryByText` throws on MULTIPLE matches as well as on ambiguity, and the
 * failure surfaces as a `waitFor`/assertion pointing at the component rather
 * than at the query. Every lookup below is either scoped to one row/chip first
 * or counted with `queryAllByText`.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import * as React from 'react';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';
import type { DetailViewSection } from '@object-ui/types';

/**
 * Desktop. `DetailSection` renders an entirely different iOS-style row on
 * mobile, and `HeaderHighlight`'s chip widths switch too — pinned rather than
 * inherited from happy-dom's default so nothing below is green only because of
 * an unpinned viewport (objectui#8399).
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(cleanup);

const objectSchema = {
  fields: {
    industry: { type: 'text', label: 'Industry' },
    notes: { type: 'text', label: 'Notes' },
    amount: { type: 'number', label: 'Amount' },
    when: { type: 'datetime', label: 'When' },
  },
};

/**
 * The row/chip a field's LABEL sits in.
 *
 * ⭐ THE ANCHOR. `DetailSection` renders `<div>{LABEL}</div>` as the first child
 * of the row box; `HeaderHighlight` renders `<span>{LABEL}</span>` as the first
 * child of the chip box. Neither is touched by the placeholder swap, by the
 * caricature, or by the wrong fix — which is the whole point: an anchor the
 * mutation can erase makes the harness die first and the pin measure nothing
 * while reading as a strong refusal.
 */
const boxOf = (label: string) => screen.getByText(label).parentElement as HTMLElement;

/** The shared placeholder inside ONE row/chip, or null. */
const emptyIn = (el: HTMLElement): HTMLElement | null =>
  el.querySelector('[data-slot="empty-value"]');

/**
 * WHICH of `labels`' rows/chips draw the placeholder — never merely how many.
 * Anchored on the label like everything else here, so the caricature cannot
 * satisfy it by drawing placeholders and nothing else.
 */
const drawingAffordance = (labels: string[]) =>
  labels.filter((l) => emptyIn(boxOf(l)) !== null);

/** Class tokens of one element, as a set. */
const classesOf = (el: HTMLElement) => new Set(el.className.split(/\s+/).filter(Boolean));

/** Tokens in exactly one of the two sets. */
const symmetricDifference = (a: Set<string>, b: Set<string>) =>
  [...new Set([...a, ...b])].filter((t) => a.has(t) !== b.has(t)).sort();

const sectionOf = (fields: string[]): DetailViewSection =>
  ({ title: 'Details', fields: fields.map((name) => ({ name })) }) as DetailViewSection;

const renderSection = (fields: string[], data: Record<string, unknown>) =>
  render(<DetailSection section={sectionOf(fields)} data={data} objectSchema={objectSchema} />);

const renderStrip = (fields: string[], data: Record<string, unknown>) =>
  render(
    <HeaderHighlight
      fields={
        fields.map((name) => ({
          name,
          label: (objectSchema.fields as Record<string, { label: string }>)[name].label,
        })) as any
      }
      data={data}
      objectSchema={objectSchema}
    />,
  );

describe('DetailSection — the body grid draws the shared EmptyValue (#8506)', () => {
  it('THE DEFECT — the empty row draws the SHARED placeholder, and keeps its accessible name', () => {
    renderSection(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '',
      amount: 42,
    });

    // CONTROLS — the section rendered, and the sibling rows rendered BY VALUE.
    // Without these, a section that gave up on values entirely passes below.
    expect(screen.queryAllByText('Details').length, 'CONTROL: the section heading rendered')
      .toBeGreaterThan(0);
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the filled text row')
      .not.toBeNull();
    expect(within(boxOf('amount')).queryByText('42'), 'CONTROL: the filled number row').not.toBeNull();

    const placeholder = emptyIn(boxOf('notes'));
    expect(placeholder, 'the empty row draws the shared component, not a hand-rolled span')
      .not.toBeNull();
    expect(
      placeholder!.getAttribute('aria-label'),
      'the accessible name survives the swap — a word, never a naked punctuation mark',
    ).toBe('No value');
    expect(placeholder!.textContent, 'and it is still the EM-dash the sites always drew').toBe('—');
  });

  it('⭐ THE TOOLTIP IS ALIVE — the title survives AND can still be hovered', () => {
    renderSection(['industry', 'notes'], { industry: 'Manufacturing', notes: '' });
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the filled row')
      .not.toBeNull();

    const placeholder = emptyIn(boxOf('notes'))!;
    expect(placeholder, 'CONTROL: the placeholder is on screen').not.toBeNull();
    expect(
      placeholder.getAttribute('title'),
      'the deliberate hover affordance rides through `...props`',
    ).toBe('No value');
    // THE DISCRIMINATING HALF. `EmptyValue` ships `pointer-events-none`; a
    // `title` on a non-hoverable element never renders a tooltip, so keeping
    // the attribute without keeping the pointer events keeps a DEAD attribute
    // that two landed pins would go on reading as if it were alive.
    const classes = classesOf(placeholder);
    expect(classes.has('pointer-events-auto'), 'the site restores pointer events for its title')
      .toBe(true);
    expect(classes.has('pointer-events-none'), 'and `cn` collapsed the shared default away')
      .toBe(false);
  });

  it('⭐ THE AGREEMENT — the section\'s own branch and a cell renderer\'s draw the same placeholder', () => {
    // Row 0 takes `DetailSection`'s own `!hasCellValue` branch. Row 1 is NOT
    // empty to `hasCellValue` and reaches `DateTimeCellRenderer`, whose own
    // empty branch has always returned the shared component. Before this
    // change those two dashes were different greys, one row apart.
    renderSection(['notes', 'when', 'industry'], {
      notes: '',
      when: 'not-a-date',
      industry: 'Manufacturing',
    });

    const ownBranch = emptyIn(boxOf('notes'));
    const rendererBranch = emptyIn(boxOf('when'));
    expect(ownBranch, "the section's own branch drew a placeholder").not.toBeNull();
    expect(rendererBranch, "CONTROL: the renderer's branch drew one too").not.toBeNull();
    // CONTROL — the section still renders real values, so this is not a
    // section that gave up: a filled row is right there.
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: a filled row')
      .not.toBeNull();

    expect(
      classesOf(ownBranch!).has('text-muted-foreground/50'),
      'the section now paints the SHARED grey',
    ).toBe(true);
    expect(
      ownBranch!.className,
      'and the retired `text-muted-foreground/60 text-sm` treatment is gone',
    ).not.toContain('/60');
    expect(
      symmetricDifference(classesOf(ownBranch!), classesOf(rendererBranch!)),
      'the ONLY class the two branches disagree on is the non-visual pointer-events pair',
    ).toEqual(['pointer-events-auto', 'pointer-events-none']);
  });

  it('⭐ NON-REGRESSION — exactly the EMPTY row draws the placeholder (the caricature refusal)', () => {
    renderSection(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '',
      amount: 0,
    });

    // STATED FIRST, deliberately, and the ordering was MEASURED rather than
    // chosen. With the controls ahead of it, the caricature reddened every case
    // in this file THROUGH a control and not one headline assertion ever ran —
    // so the CI summary for a placeholder defect read "CONTROL: the filled text
    // row rendered". This is the assertion that should name it, so it goes
    // first; `0` is also the value a careless `!value` rewrite loses.
    expect(
      drawingAffordance(['industry', 'notes', 'amount']),
      'exactly the empty row draws the placeholder — a filled row draws none',
    ).toEqual(['notes']);

    // CONTROLS — after it, so a section that rendered nothing is still refused.
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the value reaches the filled row')
      .not.toBeNull();
    expect(within(boxOf('amount')).queryByText('0'), 'CONTROL: `0` is a value, not a blank').not.toBeNull();
  });
});

describe('HeaderHighlight — the ADR-0085 strip draws the shared EmptyValue (#8506)', () => {
  it('THE DEFECT — the empty chip draws the SHARED placeholder, and keeps its accessible name', () => {
    renderStrip(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '   ',
      amount: 42,
    });

    // CONTROLS — the strip rendered its neighbours BY VALUE.
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the filled text chip')
      .not.toBeNull();
    expect(within(boxOf('Amount')).queryByText('42'), 'CONTROL: the filled number chip').not.toBeNull();

    const placeholder = emptyIn(boxOf('Notes'));
    expect(placeholder, 'the empty chip draws the shared component').not.toBeNull();
    expect(
      placeholder!.getAttribute('aria-label'),
      'the accessible name survives the swap',
    ).toBe('No value');
    expect(placeholder!.textContent, 'still the EM-dash').toBe('—');
    // The strip carries no `title` of its own and never did, so it takes the
    // shared non-interactive default unmodified.
    expect(placeholder!.getAttribute('title'), 'the strip has no tooltip to preserve').toBeNull();
  });

  it('⭐ THE LAYOUT CLASS SURVIVES — `block` is layout, not typography', () => {
    renderStrip(['industry', 'notes'], { industry: 'Manufacturing', notes: '   ' });
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the filled chip')
      .not.toBeNull();

    const placeholder = emptyIn(boxOf('Notes'))!;
    expect(placeholder, 'CONTROL: the placeholder is on screen').not.toBeNull();
    // THE DISCRIMINATING HALF for a swap that drops the site's own className:
    // the filled branch beside it is a `block` span in the same `min-w-0
    // flex-1` box, and an inline dash sits on a different baseline.
    expect(classesOf(placeholder).has('block'), 'the chip keeps its block display').toBe(true);
    expect(
      classesOf(placeholder).has('text-muted-foreground/50'),
      'and takes the SHARED grey — the retired /60 is a deliberate change',
    ).toBe(true);
    expect(placeholder.className, 'the retired treatment is gone').not.toContain('/60');
  });

  it('⭐ NON-REGRESSION — exactly the EMPTY chip draws the placeholder (the caricature refusal)', () => {
    renderStrip(['industry', 'notes', 'amount'], {
      industry: 'Manufacturing',
      notes: '   ',
      amount: 0,
    });

    // First for the same measured reason as its twin above.
    expect(
      drawingAffordance(['Industry', 'Notes', 'Amount']),
      'exactly the empty chip draws the placeholder — a filled chip draws none',
    ).toEqual(['Notes']);

    // CONTROLS — after it.
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the value reaches the filled chip')
      .not.toBeNull();
    expect(within(boxOf('Amount')).queryByText('0'), 'CONTROL: `0` is a value, not a blank').not.toBeNull();
  });
});

describe('The provider-less path — no I18nProvider is mounted in this FILE (#8506)', () => {
  /**
   * The half an `en` locale can never decide, stated from the other side.
   *
   * The old spelling read `t('detail.noValue', { defaultValue: 'No value' })`
   * through `useDetailTranslation`, whose `DETAIL_DEFAULT_TRANSLATIONS` map
   * carries the row. `EmptyValue` reads the bare key through
   * `useObjectTranslation` and maps the raw-key answer to `"No value"` itself.
   * Two different mechanisms, one required outcome: never a raw key on screen.
   */
  it('BOTH sites announce the English fallback, never the raw key', () => {
    // ⚠️ SCOPE DECLARATION on the caricature axis, MEASURED: this case was the
    // ONE survivor of `EmptyValue`-everywhere, and it should be — "the name is
    // English, not a raw key" is perfectly true of a surface that draws nothing
    // but placeholders. It is kept for the fallback half only. The control
    // below was added afterwards so it is at least not vacuous, and the
    // harness-kill leg reddens it loudly.
    renderSection(['industry', 'notes'], { industry: 'Manufacturing', notes: '' });
    expect(within(boxOf('industry')).queryByText('Manufacturing'), 'CONTROL: the section rendered a real value')
      .not.toBeNull();
    const bodyName = emptyIn(boxOf('notes'))!.getAttribute('aria-label');
    cleanup();

    renderStrip(['industry', 'notes'], { industry: 'Manufacturing', notes: '   ' });
    expect(within(boxOf('Industry')).queryByText('Manufacturing'), 'CONTROL: the strip rendered a real value')
      .not.toBeNull();
    const stripName = emptyIn(boxOf('Notes'))!.getAttribute('aria-label');

    expect(bodyName, 'the body grid falls back to English').toBe('No value');
    expect(stripName, 'and so does the strip').toBe('No value');
    // Stated separately because it is the failure this could actually have:
    // a provider-less host rendering the i18n key into the accessible name.
    expect(bodyName, 'never the raw key').not.toBe('detail.noValue');
    expect(stripName, 'never the raw key').not.toBe('detail.noValue');
  });
});
