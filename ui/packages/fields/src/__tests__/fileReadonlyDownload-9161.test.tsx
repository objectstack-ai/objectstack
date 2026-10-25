/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9161 — a `file` field in READ-ONLY state produced no way to reach
 * the file it holds.
 *
 * ## What the card measured, and what was measured on `main` before this
 *
 * The reporter's DOM reading of a populated `file` field block was
 * `<button>` x 1 (the delete icon) and `<a>` x 0 — an attachment that uploaded
 * successfully could not be opened or downloaded from the product's own PC
 * Console. The card ruled out every other layer with its own controls: the
 * record read returns the expanded `{id, name, size, mimeType, url}`, the
 * signing endpoint answers 200, fetching the signed URL answers 200 with a
 * correct `content-disposition`, and a cross-owner read answers 200 too. Only
 * the rendering was broken, and it was broken on three surfaces at once:
 *
 *  - the CELL renderer, which is the face a record-detail page actually
 *    resolves for `file` (`getCellRenderer`'s table maps `file` / `video` /
 *    `audio` to `FileCellRenderer`, and both call sites resolve inside render):
 *    an array rendered a localized COUNT and nothing else, a single value
 *    rendered a bare name;
 *  - `FileField`'s `readonly` branch, which rendered one bare `<span>` per file;
 *  - `FileField`'s edit-state rows, which rendered icon + name + size + a
 *    delete button — the reporter's reading, byte for byte.
 *
 * ## Why no new endpoint, key or authoring switch appears in the fix
 *
 * `readFileValue` already hands every view a `url`: the expanded value's own
 * `url`, or the stable `/api/v1/storage/files/:id` endpoint derived from a bare
 * `sys_file` id (which 302-redirects to a freshly-signed short-lived URL on
 * every request). The fix turns that URL into an anchor. The assertions below
 * therefore read HREFS, not fetches — there is nothing new to fetch.
 *
 * ## The shape of the assertions here
 *
 * - **Every pin reads RENDERED DOM**, never source text.
 * - **`getByRole('link', { name })` is deliberate over a `querySelector`.** It
 *   asserts the two things the ruling requires of the affordance at once: that
 *   it is in the accessibility tree as a link (so it is keyboard reachable —
 *   an `<a>` without `href` is not) and that its accessible name is the file
 *   name. A `querySelector('a')` would pass on an anchor no keyboard can reach.
 * - **A value that resolves to NO url must stay plain text.** objectui#8490
 *   ruled that shape out for `email` / `url` / `phone` — "nothing to link to,
 *   no link" — and a dead anchor is worse here than no anchor: it reads as a
 *   working download and navigates nowhere.
 * - **The two invariants this card renders THROUGH are pinned in this file as
 *   well as in their own**: objectui#8496's "an empty array states its count"
 *   (`0 files`, not the em-dash) and objectui#8441's channel (the count and the
 *   fallback name both come from the pack, so they vary by locale). Pinning
 *   them beside the new behaviour is what says the new behaviour did not eat
 *   them — the pins in `cellRenderers.countLabelI18n-8441.test.tsx` moved for
 *   the NON-empty array, which is exactly the behaviour this card changes.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

import { getCellRenderer } from '../index';
import { FileField } from '../widgets/FileField';

/** The expanded read-path shape the card quotes from its own record read. */
const EXPANDED = {
  id: 'f_1928',
  name: 'att-1928.txt',
  size: 56,
  mimeType: 'text/plain',
  url: '/api/v1/storage/files/f_1928',
};
const SECOND = {
  id: 'f_1929',
  name: 'material-cert.pdf',
  size: 91002,
  mimeType: 'application/pdf',
  url: '/api/v1/storage/files/f_1929',
};

/**
 * A bare `sys_file` id — the STORED form, and the one the card actually saw:
 * the reporter's row read the fallback name because the value had not been
 * expanded. `isFileIdToken` accepts `[A-Za-z0-9_-]{1,64}`, so this matches and
 * `fileUrlFromId` derives its URL.
 */
const BARE_ID = 'kR3mQ8xf_2Tb-9Lw';
const BARE_ID_URL = '/api/v1/storage/files/kR3mQ8xf_2Tb-9Lw';

/** A value carrying a name and NO resolvable url — the plain-text case. */
const NAMED_ONLY = { name: 'unresolvable.txt', size: 12 };

const fileField = { name: 'attachment', label: 'Attachment', type: 'file', multiple: true } as any;

/**
 * Resolve and render exactly the way the production call sites do — resolve the
 * component, then render it as an ELEMENT, which is what `DetailSection` and
 * `renderFieldValue` do.
 */
function renderCell(type: string, value: unknown, field: any = fileField, language = 'en') {
  const CellRenderer = getCellRenderer(type);
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <CellRenderer value={value} field={field} />
    </I18nProvider>,
  );
}

const textOf = (container: HTMLElement) => container.textContent ?? '';
const links = (container: HTMLElement) => Array.from(container.querySelectorAll('a'));

beforeEach(() => {
  cleanup();
});

/* -------------------------------------------------------------------------- */
/* THE DEFECT — the cell renderer, which is the record-detail read face.        */
/* -------------------------------------------------------------------------- */

describe('objectui#9161 — the `file` CELL renderer produces a per-file affordance', () => {
  it('THE DEFECT — a multi-value field renders one link per file, not the bare count `1 file`', () => {
    // The card's headline reading: a `multiple: true` field holding ONE
    // attachment rendered the text `1 file` and nothing else.
    const { container } = renderCell('file', [EXPANDED]);
    const link = within(container).getByRole('link', { name: EXPANDED.name });
    expect(link).toHaveAttribute('href', EXPANDED.url);
    expect(textOf(container), 'the count sentence is replaced by the file itself').toBe(EXPANDED.name);
  });

  it('THE DEFECT — two attachments are two independently reachable links', () => {
    // The card asks for each item to be independently actionable when the
    // field is multi-valued; two files means two hrefs, not one summary.
    const { container } = renderCell('file', [EXPANDED, SECOND]);
    expect(
      links(container).map((a) => a.getAttribute('href')),
      'every item carries its own href, in order',
    ).toEqual([EXPANDED.url, SECOND.url]);
    within(container).getByRole('link', { name: EXPANDED.name });
    within(container).getByRole('link', { name: SECOND.name });
  });

  it('THE DEFECT — a single (non-array) value links too, instead of printing a bare name', () => {
    const { container } = renderCell('file', EXPANDED, { ...fileField, multiple: false });
    expect(within(container).getByRole('link', { name: EXPANDED.name })).toHaveAttribute(
      'href',
      EXPANDED.url,
    );
  });

  it('THE STORED FORM — a bare `sys_file` id resolves to the stable download endpoint', () => {
    // This is the arm the reporter saw as the pack's fallback word instead
    // of a filename: an unexpanded reference. It
    // carries no name of its own, so the name is the pack's fallback — but the
    // URL is derivable, so the affordance is NOT optional here.
    const { container } = renderCell('file', [BARE_ID]);
    const fallback = (en as any).fields.file.fileFallback;
    expect(within(container).getByRole('link', { name: fallback })).toHaveAttribute(
      'href',
      BARE_ID_URL,
    );
  });

  it('⛔ NEVER a dead anchor — a value with no resolvable url stays plain TEXT', () => {
    // objectui#8490's ruling for `email` / `url` / `phone`, applied here: an
    // anchor that navigates nowhere reads as a working download and is worse
    // than no anchor at all.
    const { container } = renderCell('file', [NAMED_ONLY]);
    expect(links(container), 'no url, no link').toHaveLength(0);
    expect(textOf(container), 'but the name is still stated').toBe(NAMED_ONLY.name);
  });

  it('a mixed array links only the items that resolve', () => {
    const { container } = renderCell('file', [EXPANDED, NAMED_ONLY]);
    expect(links(container).map((a) => a.getAttribute('href'))).toEqual([EXPANDED.url]);
    expect(textOf(container)).toBe(`${EXPANDED.name}${NAMED_ONLY.name}`);
  });

  it('every anchor opens in a new tab with `rel="noopener noreferrer"`', () => {
    const { container } = renderCell('file', [EXPANDED, SECOND]);
    // Counted FIRST: a `for` over an empty list satisfies every assertion
    // inside it, so without this the pin would pass on the very defect it is
    // here to catch (measured: it did, on the pre-fix run).
    expect(links(container), 'both files must have produced an anchor').toHaveLength(2);
    for (const a of links(container)) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('`video` and `audio` ride the same renderer and get the same affordance', () => {
    // `getCellRenderer` maps all three media types to `FileCellRenderer`, so
    // this change reaches them too. Pinned rather than left as a side effect.
    for (const type of ['video', 'audio'] as const) {
      const { container } = renderCell(type, [EXPANDED], { ...fileField, type });
      expect(
        within(container).getByRole('link', { name: EXPANDED.name }),
        `${type} must reach its file too`,
      ).toHaveAttribute('href', EXPANDED.url);
      cleanup();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The invariants this card renders THROUGH, pinned beside the new behaviour.   */
/* -------------------------------------------------------------------------- */

describe('objectui#9161 — objectui#8496 and objectui#8441 survive per-item rendering', () => {
  it('objectui#8496 — an EMPTY array still states its count, and draws no anchor', () => {
    const { container } = renderCell('file', []);
    expect(textOf(container), '`[]` states `0 files`; it was never blank').toBe('0 files');
    expect(links(container), 'nothing to link to').toHaveLength(0);
  });

  it('objectui#8496 — the count sentence is byte-equal to the `en` pack, not a literal', () => {
    // The duty `cellRenderers.countLabelI18n-8441.test.tsx` performs for the
    // provider-less fallback, performed here for the one count call that
    // survives this card: `check:i18n-keys` cannot see a ternary fallback, so
    // a pin is the comparison.
    const { container } = renderCell('file', []);
    expect(textOf(container)).toBe((en as any).detail.fileCount_other.replace('{{count}}', '0'));
  });

  it('objectui#8441 — the fallback NAME is on the i18n channel: it varies by locale', () => {
    // The new per-item rendering introduces no new user-facing string — it
    // reuses `fields.file.fileFallback`, the key `FileField` already reads. If
    // this ever renders English under `zh`, the channel was bypassed.
    const { container } = renderCell('file', [BARE_ID], fileField, 'zh');
    const packed = (zh as any).fields.file.fileFallback;
    expect(within(container).getByRole('link', { name: packed })).toHaveAttribute('href', BARE_ID_URL);
    expect(packed, 'control: the zh pack must not simply repeat the English word').not.toBe(
      (en as any).fields.file.fileFallback,
    );
  });

  it('objectui#8596 — `{}` is still not a file: the shared empty affordance, and no anchor', () => {
    const { container } = renderCell('file', {});
    expect(container.querySelector('[data-slot="empty-value"]'), '`{}` reads as No value').not.toBeNull();
    expect(links(container)).toHaveLength(0);
  });

  it('a falsy value is still the empty affordance', () => {
    const { container } = renderCell('file', null);
    expect(container.querySelector('[data-slot="empty-value"]')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The widget's own two surfaces.                                              */
/* -------------------------------------------------------------------------- */

describe('objectui#9161 — `FileField`s readonly branch reaches the file', () => {
  const props = { field: fileField, onChange: () => {} } as any;

  it('THE DEFECT — the readonly branch rendered a bare name; it now renders a link', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <FileField {...props} readonly value={[EXPANDED, SECOND]} />
      </I18nProvider>,
    );
    expect(links(container).map((a) => a.getAttribute('href'))).toEqual([EXPANDED.url, SECOND.url]);
    within(container).getByRole('link', { name: EXPANDED.name });
    within(container).getByRole('link', { name: SECOND.name });
  });

  it('⛔ NEVER a dead anchor — readonly keeps plain text for an unresolvable value', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <FileField {...props} readonly value={[NAMED_ONLY]} />
      </I18nProvider>,
    );
    expect(links(container)).toHaveLength(0);
    expect(textOf(container)).toBe(NAMED_ONLY.name);
  });
});

describe('objectui#9161 — the edit-state row reaches the file too', () => {
  const props = { field: fileField, onChange: () => {} } as any;

  it('THE CARD DOM READING — the row had 1 button and 0 anchors; the delete button stays', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <FileField {...props} value={[EXPANDED]} />
      </I18nProvider>,
    );
    // The file is now reachable from the edit state…
    expect(within(container).getByRole('link', { name: EXPANDED.name })).toHaveAttribute(
      'href',
      EXPANDED.url,
    );
    // …and the row's own control is untouched. The dropzone (`role="button"`)
    // plus the per-file delete button are the two the edit state renders.
    expect(
      container.querySelectorAll('button').length,
      'the delete button is still exactly one',
    ).toBe(1);
  });

  it('the bare-id row — an unexpanded reference — now carries a working link under its fallback name', () => {
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <FileField {...props} value={[BARE_ID]} />
      </I18nProvider>,
    );
    expect(
      within(container).getByRole('link', { name: (en as any).fields.file.fileFallback }),
    ).toHaveAttribute('href', BARE_ID_URL);
  });
});
