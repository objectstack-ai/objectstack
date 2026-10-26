/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9485 — `FileCell`, the compact `file` control a line-item grid row
 * draws, stated a filename and produced no way to reach the file behind it.
 *
 * ## The third surface of one defect
 *
 * objectui#9161 ruled the same class over the CELL renderer, `FileField`'s
 * `readonly` branch and `FileField`'s edit-state rows, and landed the shared
 * `FileValueAffordance` for them. Its dispatch named the `readonly` branch and
 * the edit-state rows; `FileCell` is the third component in this widget file
 * and was left outside that file surface on purpose, so it kept rendering a
 * chip of thumbnail-or-icon + name + delete button with no anchor anywhere
 * inside it. Same defect class, a surface further down — this is not a
 * duplicate of that card and does not reopen it.
 *
 * ## `disabled` is the worse half, and it is why this is not cosmetic
 *
 * `disabled` is this control's READ-ONLY state: it draws no picker button and
 * no delete button, so the chip is *nothing but* a filename. Every assertion
 * below is therefore run in both states, and the `disabled` ones additionally
 * count the buttons — zero — because that is what makes the anchor the only
 * route to the file rather than one of several.
 *
 * ## Why these assertions read the RENDERED CELL
 *
 * ⚠️ The card was filed from a source reading and says so in its own words:
 * nobody had driven this. These pins are the first actual measurement, so they
 * go through the rendered component and read the DOM — ⛔ never a helper's
 * return value and ⛔ never source text, either of which would pass on a
 * component that never renders what the helper returns.
 *
 * `getByRole('link', { name })` is deliberate over `querySelector('a')`: it
 * asserts in one call that the affordance is in the accessibility tree as a
 * link — an `<a>` without `href` is not, so no keyboard can reach it — and
 * that its accessible name is the file name.
 *
 * ⛔ **A value that resolves to no URL stays plain TEXT.** objectui#8490's
 * ruling for `email` / `url` / `phone` ("nothing to link to, no link") applies
 * here too: an anchor with an empty `href` reads as a working download and
 * navigates nowhere, which is worse than the bare name it replaced. That case
 * is green on BOTH sides of this fix — it is what proves the fallback rather
 * than the happy path.
 *
 * Nothing new is fetched. `readFileValues` already resolves every stored form
 * to a URL — the expanded value's own `url`, or the stable
 * `/api/v1/storage/files/:id` endpoint derived from a bare `sys_file` id — so
 * these assertions read HREFS.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

import { FileCell } from '../widgets/FileField';

/** The expanded read-path shape, as objectui#9161 quotes it from a record read. */
const EXPANDED = {
  id: 'f_1928',
  name: 'delivery-note.pdf',
  size: 56,
  mimeType: 'application/pdf',
  url: '/api/v1/storage/files/f_1928',
};

/** An image value, so the chip draws a thumbnail instead of its file icon. */
const IMAGE = {
  id: 'f_1930',
  name: 'material-cert.png',
  size: 4211,
  mimeType: 'image/png',
  url: '/api/v1/storage/files/f_1930',
};

/**
 * A bare `sys_file` id — the STORED form. It carries no name of its own (the
 * fallback name comes off the i18n channel) but its URL is derivable, so the
 * affordance is not optional on this arm either.
 */
const BARE_ID = 'kR3mQ8xf_2Tb-9Lw';
const BARE_ID_URL = '/api/v1/storage/files/kR3mQ8xf_2Tb-9Lw';

/** A value carrying a name and NO resolvable url — the plain-text case. */
const NAMED_ONLY = { name: 'unresolvable.txt', size: 12 };

function renderCell(
  value: unknown,
  opts: { disabled?: boolean; language?: string } = {},
) {
  const { disabled, language = 'en' } = opts;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <FileCell value={value} onChange={() => {}} multiple disabled={disabled} />
    </I18nProvider>,
  );
}

const textOf = (container: HTMLElement) => container.textContent ?? '';
const links = (container: HTMLElement) => Array.from(container.querySelectorAll('a'));
const chipOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="file-cell-chip"]') as HTMLElement;

/** Both states of the control, named the way the card names them. */
const STATES = [
  { label: 'enabled', disabled: false },
  { label: 'disabled (the read-only state)', disabled: true },
] as const;

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* THE DEFECT — the grid cell's chip now reaches its file, in both states.     */
/* -------------------------------------------------------------------------- */

describe('objectui#9485 — `FileCell` produces a view/download affordance', () => {
  for (const { label, disabled } of STATES) {
    it(`THE DEFECT — ${label}: the chip's bare name becomes a link with a real href`, () => {
      const { container } = renderCell([EXPANDED], { disabled });
      expect(
        within(container).getByRole('link', { name: EXPANDED.name }),
      ).toHaveAttribute('href', EXPANDED.url);
      expect(chipOf(container), 'the chip itself is still the carrier').not.toBeNull();
    });

    it(`THE STORED FORM — ${label}: a bare \`sys_file\` id resolves to the stable endpoint`, () => {
      const { container } = renderCell([BARE_ID], { disabled });
      expect(
        within(container).getByRole('link', { name: (en as any).fields.file.fileFallback }),
      ).toHaveAttribute('href', BARE_ID_URL);
    });

    it(`⛔ NEVER a dead anchor — ${label}: an unresolvable value stays plain TEXT`, () => {
      const { container } = renderCell([NAMED_ONLY], { disabled });
      expect(links(container), 'no url, no link').toHaveLength(0);
      expect(textOf(container), 'but the name is still stated').toBe(NAMED_ONLY.name);
    });

    it(`${label}: the affordance draws no icon of its own — \`icon={false}\``, () => {
      const { container } = renderCell([EXPANDED], { disabled });
      const link = within(container).getByRole('link', { name: EXPANDED.name });
      expect(
        link.querySelector('svg'),
        'the chip already drew a file icon to its left; a second one inside the link is the duplication `icon={false}` exists to avoid',
      ).toBeNull();
      expect(
        chipOf(container).querySelector('svg'),
        "control: the chip's OWN icon is still drawn, so the assertion above is not passing on an empty chip",
      ).not.toBeNull();
    });

    it(`${label}: an image value keeps its thumbnail AND gains the link`, () => {
      const { container } = renderCell([IMAGE], { disabled });
      const thumb = container.querySelector('img');
      expect(thumb, 'the thumbnail is the chip furniture this card does not touch').not.toBeNull();
      expect(thumb).toHaveAttribute('src', IMAGE.url);
      expect(
        within(container).getByRole('link', { name: IMAGE.name }),
      ).toHaveAttribute('href', IMAGE.url);
    });

    it(`${label}: every anchor opens in a new tab with \`rel="noopener noreferrer"\``, () => {
      const { container } = renderCell([EXPANDED, IMAGE], { disabled });
      // Counted FIRST: a `for` over an empty list satisfies every assertion
      // inside it, so without this the pin would pass on the very defect it is
      // here to catch.
      expect(links(container), 'both files must have produced an anchor').toHaveLength(2);
      expect(links(container).map((a) => a.getAttribute('href'))).toEqual([
        EXPANDED.url,
        IMAGE.url,
      ]);
      for (const a of links(container)) {
        expect(a).toHaveAttribute('target', '_blank');
        expect(a).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });
  }
});

/* -------------------------------------------------------------------------- */
/* `disabled` — the state the card calls the worse half.                       */
/* -------------------------------------------------------------------------- */

describe('objectui#9485 — under `disabled` the link is the ONLY route to the file', () => {
  it('THE CARD DOM READING — `disabled` renders no picker and no delete button', () => {
    const { container } = renderCell([EXPANDED], { disabled: true });
    expect(
      container.querySelectorAll('button'),
      'no upload button, no delete button — this is why the missing anchor left no route at all',
    ).toHaveLength(0);
    expect(
      within(container).getByRole('link', { name: EXPANDED.name }),
      'so the anchor is the entire affordance here',
    ).toHaveAttribute('href', EXPANDED.url);
  });

  it('⛔ and when nothing resolves, `disabled` is text with no controls and no anchor', () => {
    const { container } = renderCell([NAMED_ONLY], { disabled: true });
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(links(container)).toHaveLength(0);
    expect(textOf(container)).toBe(NAMED_ONLY.name);
  });
});

/* -------------------------------------------------------------------------- */
/* The chip furniture this card must not have eaten.                           */
/* -------------------------------------------------------------------------- */

describe('objectui#9485 — the editable chip keeps the controls it already had', () => {
  it('the per-file delete button survives, under its own accessible name', () => {
    const { container } = renderCell([EXPANDED]);
    expect(
      within(container).getByRole('button', {
        name: (en as any).fields.file.remove.replace('{{name}}', EXPANDED.name),
      }),
      'the delete button is named for its file, and the link never took its place',
    ).toBeInTheDocument();
    expect(within(container).getByRole('link', { name: EXPANDED.name })).toBeInTheDocument();
  });

  it('the fallback NAME stays on the i18n channel: it varies by locale', () => {
    // This card introduces no new user-facing string — it reuses the key
    // `FileCell` already read. English text rendered under `zh` would mean the
    // channel was bypassed.
    const { container } = renderCell([BARE_ID], { disabled: true, language: 'zh' });
    const packed = (zh as any).fields.file.fileFallback;
    expect(within(container).getByRole('link', { name: packed })).toHaveAttribute(
      'href',
      BARE_ID_URL,
    );
    expect(packed, 'control: the zh pack must not simply repeat the English word').not.toBe(
      (en as any).fields.file.fileFallback,
    );
  });
});
