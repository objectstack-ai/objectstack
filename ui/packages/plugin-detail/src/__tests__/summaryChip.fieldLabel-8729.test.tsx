/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The summary chip beside the record H1 names its field the way its SIBLINGS
 * name theirs (objectui#8729).
 *
 * ## The defect
 *
 * The chip carries no visible label, so `${field}: ${value}` is the whole of
 * what a screen-reader user hears the field called — and the name half was
 * `fieldName`, the raw stored column. Every other band of the same page
 * resolves a label through one shared helper: `HeaderHighlight` calls
 * `fieldLabel(objectName, field.name, field.label)`, `DetailSection` calls it
 * with `field.label || field.name`. So one band out of several announced the
 * database spelling, and it was the band only a screen-reader user hears.
 *
 * ⇒ this is a DIVERGENCE from an in-repo pattern, not a missing capability, and
 * the fix is the sibling's own call. Which is why the headline case below is
 * stated as AGREEMENT WITH THE STRIP — read out of the strip's own DOM, never
 * re-derived here. A per-chip `toBe('Account Owner: …')` would go green on a
 * repair that humanized the name differently from its siblings, which is the
 * same defect one level up.
 *
 * ## The three name sites, because the chip has three render branches
 *
 * A census of the chip's render (objectui#8464 gave it a cell-renderer branch;
 * objectui#8728 a percent branch) finds the field name reaching a reader in
 * THREE places, and a fix touching only `aria-label` would have left one:
 *
 *  1. the string branch's `aria-label`;
 *  2. the percent branch's `aria-label`;
 *  3. the renderer branch's `sr-only` prefix span — content, not `aria-label`,
 *     because an `aria-label` there would OVERRIDE the element the branch
 *     exists to draw (objectui#8464's own reasoning, unchanged here).
 *
 * `data-summary-chip` is a fourth appearance of the raw name and is NOT one of
 * these: it is a machine handle for tests and automation, where the stored
 * column is exactly the right answer. Every navigation below uses it.
 *
 * ## Reading the accessible name — MEASURED, both branches
 *
 * Measured on this branch with `toHaveAccessibleName` (jest-dom over
 * dom-accessibility-api), because the two branches do NOT compute the same way
 * and assuming they did would have made half these assertions vacuous:
 *
 *  - string / percent branch — the `Badge` is a `div` carrying `aria-label`,
 *    and the computed accessible name is that label, verbatim. There is no
 *    `title`, no `aria-labelledby` and no visible label anywhere on the chip,
 *    so it really is the whole name.
 *  - renderer branch — the same `div` carries NO `aria-label`, and its computed
 *    accessible name is the EMPTY STRING: the name is not composed from the
 *    `sr-only` span, because a plain `div` is `role="generic"`, which takes no
 *    name from its content. What that span buys is what a reader is READ: the
 *    chip's text, announced in document order. So case 3 asserts the chip's
 *    TEXT, and does not pretend to be an accessible-name assertion.
 *
 * ## Controls
 *
 * "The stored name is gone" is trivially true of a chip that stopped rendering,
 * so every case reads a chip that is on screen and asserts what it says. Two
 * more controls guard the edges the fix must not move:
 *
 *  - `STORED NAME IS THE LABEL` — a field whose authored label equals its
 *    stored name must announce byte-for-byte as before;
 *  - `THE PERCENTAGE HALF` — objectui#9072 (card objectui#8728) left this card
 *    a free hand over the NAME half by asserting only the percentage half. That
 *    half is re-asserted here, from this side, so this card cannot move it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { DetailView } from '../DetailView';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * `useRecordEditable` falls back to the GLOBAL fetch with no
 * `SchemaRendererProvider` in the tree; under happy-dom that is a real request.
 * Served from a double so no case here depends on the network — the shape the
 * sibling chip pins already use.
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

const renderPage = (
  schema: Record<string, unknown>,
  opts: {
    wrap?: (n: React.ReactNode) => React.ReactNode;
    /** Object metadata, which this component only ever learns from a source. */
    objectSchema?: Record<string, unknown>;
  } = {},
) => {
  const wrap = opts.wrap ?? ((n: React.ReactNode) => n);
  const dataSource = opts.objectSchema
    ? ({ getObjectSchema: async () => opts.objectSchema } as any)
    : undefined;
  return render(
    <>
      {wrap(
        <DetailView
          dataSource={dataSource}
          schema={{ type: 'record:details', objectName: 'account', ...schema } as unknown as DetailViewSchema}
        />,
      )}
    </>,
  ).container;
};

/** The chip, navigated by the machine handle — never by the name under test. */
const requireChip = (c: HTMLElement, field: string): HTMLElement => {
  const chip = c.querySelector<HTMLElement>(`[data-summary-chip="${field}"]`);
  expect(chip, `a summary chip for "${field}" is beside the H1`).not.toBeNull();
  return chip!;
};

const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/**
 * The label the HIGHLIGHT STRIP prints for its one field, read out of the
 * sibling band's own DOM. The strip gives its columns no handle of their own,
 * so the navigation is structural — which is safe only for a single-column
 * strip, and that is asserted rather than assumed.
 */
const stripLabel = (c: HTMLElement): string => {
  const strip = c.querySelector<HTMLElement>('section[aria-label]');
  expect(strip, 'CONTROL: the highlight strip rendered at all').not.toBeNull();
  const columns = strip!.querySelectorAll(':scope > div > div');
  expect(columns.length, 'exactly one highlight column, so its first span is ITS label').toBe(1);
  const label = strip!.querySelector('span');
  expect(label, 'the strip labels its column with a span').not.toBeNull();
  return (label!.textContent ?? '').trim();
};

describe('objectui#8729 — the summary chip names its field like its siblings', () => {
  /**
   * ⭐ THE RULING, as agreement rather than as a string. The stored column and
   * the authored label differ on purpose: a chip whose stored name happens to
   * equal its label cannot show this defect at all.
   */
  it('SIBLING AGREEMENT — the chip and the highlight strip name the same field the same way', () => {
    const container = renderPage({
      summaryFields: ['owner_ref'],
      highlightFields: [{ name: 'owner_ref', label: 'Account Owner', type: 'text' }],
      fields: [{ name: 'owner_ref', label: 'Account Owner', type: 'text' }],
      data: { id: 'A1', name: 'Acme', owner_ref: 'Ada Lovelace' },
    });

    // CONTROL — the page drew its H1, so anything missing below is about the
    // chip and not about a header that failed to render.
    expect(container.querySelector('h1'), 'CONTROL: the record H1 rendered').not.toBeNull();

    const chip = requireChip(container, 'owner_ref');
    // CONTROL — the chip is on screen with its value, so "the stored name is
    // gone" cannot be satisfied by a chip that stopped rendering.
    expect(textOf(chip), 'CONTROL: the chip still shows its value').toBe('Ada Lovelace');

    const fromTheStrip = stripLabel(container);
    // CONTROL — the sibling band resolved a label at all, and it is not the
    // stored column: without this, agreement on `owner_ref` would read as a
    // pass.
    expect(fromTheStrip, 'CONTROL: the strip named the field').not.toBe('');
    expect(fromTheStrip, 'CONTROL: the strip does not print the stored column').not.toBe('owner_ref');

    expect(chip).toHaveAccessibleName(`${fromTheStrip}: Ada Lovelace`);
  });

  it('ACCESSIBLE NAME — the stored column is not what a screen reader hears', () => {
    const container = renderPage({
      summaryFields: ['owner_ref'],
      fields: [{ name: 'owner_ref', label: 'Account Owner', type: 'text' }],
      data: { id: 'A2', name: 'Acme', owner_ref: 'Ada Lovelace' },
    });

    const chip = requireChip(container, 'owner_ref');
    expect(textOf(chip), 'CONTROL: the chip still shows its value').toBe('Ada Lovelace');
    expect(chip).toHaveAccessibleName('Account Owner: Ada Lovelace');
    expect(
      chip.getAttribute('aria-label'),
      'the stored column may not reach the name half at all',
    ).not.toContain('owner_ref');
    // The machine handle keeps it — that is what a handle is for.
    expect(
      chip.getAttribute('data-summary-chip'),
      'the test/automation handle still carries the stored column',
    ).toBe('owner_ref');
  });

  /**
   * ⭐ THE THIRD NAME SITE. A renderer-backed chip carries no `aria-label`
   * (objectui#8464: it would override the element the branch draws), so its
   * field name lives in an `sr-only` span — content, which is why this case
   * asserts TEXT and the accessible name is asserted to be absent, exactly as
   * the branch intends. A fix applied only to `aria-label` is red here.
   */
  it('RENDERER-BACKED CHIP — the sr-only prefix names the field, not the column', () => {
    const container = renderPage({
      summaryFields: ['owner_ref'],
      fields: [{ name: 'owner_ref', label: 'Account Owner', type: 'lookup' }],
      data: { id: 'A3', name: 'Acme', owner_ref: { id: 'u-1', name: 'Ada Lovelace' } },
    });

    const chip = requireChip(container, 'owner_ref');
    expect(
      chip.getAttribute('aria-label'),
      'CONTROL: this branch still sets no aria-label — it would override its own value',
    ).toBeNull();
    expect(
      chip.querySelector('.sr-only')?.textContent,
      'the visually-hidden prefix carries the resolved label',
    ).toBe('Account Owner: ');
    expect(textOf(chip), 'and the whole chip reads label then value').toBe(
      'Account Owner: Ada Lovelace',
    );
  });

  /**
   * The chip is addressed by NAME (`summaryFields: ['owner_ref']`), so unlike
   * its siblings — whose inputs are field objects carrying a label — it may
   * have no view entry at all. The object schema is then the only label source
   * on the page, and this render already holds it.
   */
  it('NAME-ONLY ADDRESSING — with no view entry the object schema supplies the label', async () => {
    const container = renderPage(
      {
        summaryFields: ['owner_ref'],
        // No `fields` entry for `owner_ref` at all.
        fields: [{ name: 'name', label: 'Name', type: 'text' }],
        data: { id: 'A4', name: 'Acme', owner_ref: 'Ada Lovelace' },
      },
      { objectSchema: { fields: { owner_ref: { type: 'text', label: 'Account Owner' } } } },
    );

    // CONTROL — the chip is on screen with its value BEFORE the metadata
    // arrives, so the wait below is about the label and not about the chip.
    expect(textOf(requireChip(container, 'owner_ref')), 'CONTROL: the chip shows its value').toBe(
      'Ada Lovelace',
    );
    await waitFor(() =>
      expect(requireChip(container, 'owner_ref')).toHaveAccessibleName('Account Owner: Ada Lovelace'),
    );
  });

  it('VIEW ENTRY WINS — an authored label overrides the object schema, as everywhere else', async () => {
    const container = renderPage(
      {
        summaryFields: ['owner_ref', 'region'],
        fields: [{ name: 'owner_ref', label: 'Deal Owner', type: 'text' }],
        data: { id: 'A5', name: 'Acme', owner_ref: 'Ada Lovelace', region: 'EMEA' },
      },
      {
        objectSchema: {
          fields: {
            owner_ref: { type: 'text', label: 'Account Owner' },
            // The ARRIVAL PROBE: `region` has no view entry, so its label can
            // only come from this metadata. Waiting on it is what makes the
            // precedence assertion below a statement about precedence, and not
            // about a fetch that had not landed yet.
            region: { type: 'text', label: 'Region' },
          },
        },
      },
    );

    await waitFor(() =>
      expect(requireChip(container, 'region'), 'CONTROL: the object metadata arrived').
        toHaveAccessibleName('Region: EMEA'),
    );

    expect(requireChip(container, 'owner_ref')).toHaveAccessibleName('Deal Owner: Ada Lovelace');
  });

  /**
   * ⛔ THE FLOOR. A field with no label anywhere still has to say something,
   * and the stored name is the honest last resort — the same floor
   * `DetailSection` spells as `field.label || field.name`. Red for a repair
   * that announces a bare `: value`.
   */
  it('FLOOR — a field with no label anywhere keeps the stored name as its last resort', () => {
    const container = renderPage({
      summaryFields: ['owner_ref'],
      fields: [{ name: 'owner_ref', type: 'text' }],
      data: { id: 'A6', name: 'Acme', owner_ref: 'Ada Lovelace' },
    });

    expect(requireChip(container, 'owner_ref')).toHaveAccessibleName('owner_ref: Ada Lovelace');
  });

  /**
   * CONTROL — the byte-identical half. A field whose authored label IS its
   * stored name must announce exactly as it did before this change, so the fix
   * cannot be "humanize the column name".
   */
  it('STORED NAME IS THE LABEL — the announcement is byte-identical to before', () => {
    const container = renderPage({
      summaryFields: ['stage'],
      fields: [{ name: 'stage', label: 'stage', type: 'text' }],
      data: { id: 'A7', name: 'Acme', stage: 'Won' },
    });

    const chip = requireChip(container, 'stage');
    expect(chip).toHaveAccessibleName('stage: Won');
    expect(textOf(chip), 'CONTROL: and the visible face is unchanged too').toBe('Won');
  });

  /**
   * ⭐ CONTROL — objectui#9072's half. That card fixed the percent text/bar
   * disagreement on this same render and deliberately asserted only that the
   * accessible name ENDS WITH the on-screen percentage, leaving this card a
   * free hand over the name half. Re-asserted from this side so a name change
   * cannot quietly take the percentage with it.
   *
   * ⚠️ The percentage itself moved from `12.3%` to `12%` in objectui#9167,
   * which routed the chip's text through the list cell's own `formatPercent` at
   * the field's declared precision (`0` here, undeclared). The RELATION this
   * case exists for — the name ends with whatever is on screen, and the NAME
   * half is `Win Ratio:` — is untouched: it is asserted against `textOf(chip)`
   * rather than against a literal, which is why only the two pinned strings
   * below had to move.
   */
  it('THE PERCENTAGE HALF — untouched: the name still ends with the percentage on screen', () => {
    const container = renderPage({
      summaryFields: ['ratio'],
      fields: [{ name: 'ratio', label: 'Win Ratio', type: 'percent' }],
      data: { id: 'A8', name: 'Acme', ratio: 0.123 },
    });

    const chip = requireChip(container, 'ratio');
    expect(textOf(chip), 'CONTROL: the percent branch still states the percentage').toBe('12%');
    const label = chip.getAttribute('aria-label') ?? '';
    expect(label.endsWith(textOf(chip)), `the name ends with the percentage (got "${label}")`).toBe(
      true,
    );
    // And the name half moved with this card — the percent branch is one of the
    // three sites, not an exception to them.
    expect(chip).toHaveAccessibleName('Win Ratio: 12%');
  });
});

/**
 * ⭐ THE HELPER, not a local read of `label`.
 *
 * Everything above is equally green for a chip that read `sectionField.label`
 * straight off the schema — and that chip would diverge from its siblings the
 * moment a session is translated, which is precisely the failure the ruling is
 * about. Under a locale that translates the field, the strip and the chip must
 * still agree, and they can only do that by asking the SAME resolver.
 *
 * ⚠️ KEEP THIS BLOCK LAST IN THE FILE. `I18nProvider` registers its instance as
 * react-i18next's module-global default and that registration survives
 * `cleanup()`, so every case after it would resolve against this locale instead
 * of the provider-less path the cases above deliberately exercise.
 */
describe('objectui#8729 — the resolver is the siblings\', not a local label read', () => {
  const TRANSLATED = 'Record Owner';

  it('A TRANSLATED SESSION — strip and chip move together', async () => {
    const container = renderPage(
      {
        summaryFields: ['owner_ref'],
        highlightFields: [{ name: 'owner_ref', label: 'Account Owner', type: 'text' }],
        fields: [{ name: 'owner_ref', label: 'Account Owner', type: 'text' }],
        data: { id: 'A9', name: 'Acme', owner_ref: 'Ada Lovelace' },
      },
      { wrap: (node) => (
        <I18nProvider
          config={{
            defaultLanguage: 'en',
            detectBrowserLanguage: false,
            // `crm` is an app namespace: `getAppNamespaces` discovers any
            // top-level key carrying `fields`, and `fieldLabel` then resolves
            // `<ns>.fields.<object>.<field>`.
            resources: { en: { crm: { fields: { account: { owner_ref: TRANSLATED } } } } },
          }}
        >
          {node}
        </I18nProvider>
      ) },
    );

    // The provider loads its pack asynchronously; wait for the sibling band to
    // show the translation before comparing the two.
    await waitFor(() => expect(stripLabel(container)).toBe(TRANSLATED));

    const chip = requireChip(container, 'owner_ref');
    // CONTROL — the authored label really is different, so agreeing on the
    // TRANSLATION is a statement about the resolver and not about the schema.
    expect(TRANSLATED, 'CONTROL: the translation differs from the authored label').not.toBe(
      'Account Owner',
    );
    expect(chip).toHaveAccessibleName(`${stripLabel(container)}: Ada Lovelace`);
    expect(chip).toHaveAccessibleName(`${TRANSLATED}: Ada Lovelace`);
  });
});
