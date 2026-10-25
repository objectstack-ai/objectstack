/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10614, through a rendered face: a file value whose URL's last
 * segment is not a valid percent-encoding renders, named by its raw segment.
 *
 * `nameFromUrl` (in `file-value.ts`) passed that segment to
 * `decodeURIComponent` unguarded, so `https://cdn.example.com/100%.png` and
 * `{ url: 'https://cdn.example.com/a%zz.pdf' }` threw `URIError: URI malformed`
 * out of `readFileValue`, during render. Measured at the base `eca2760`
 * before this fix (a historical reading, not re-derived here): every face
 * that reads such a value threw that error during render, and none of them
 * contained it. Mounted through `SchemaRenderer`, the nearest error boundary
 * caught it and replaced the WHOLE view with its "failed to render" panel:
 * an `object-grid` lost its table (the `data-table` node), valid rows
 * included, and an `object-gallery` lost every card.
 *
 * The helper-level pins, and the control that a valid escape still decodes,
 * sit in `file-value.test.ts`. This file renders the record-detail face, the
 * `file` cell renderer, resolved the way production call sites resolve it.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import type { FileFieldMetadata } from '@object-ui/types';

import { getCellRenderer } from '../index';

const BARE_PERCENT = 'https://cdn.example.com/100%.png';
const INVALID_ESCAPE = { url: 'https://cdn.example.com/a%zz.pdf' };
const VALID_ESCAPE = 'https://cdn.example.com/report%20q3.pdf';

const fileField: FileFieldMetadata = { name: 'attachment', label: 'Attachment', type: 'file', multiple: true };

function renderFileCell(value: unknown) {
  const CellRenderer = getCellRenderer('file');
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <CellRenderer value={value} field={fileField} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('objectui#10614: the file cell renders a URL whose last segment holds a bare `%`', () => {
  it('both reported values render as links named by their raw last segment', () => {
    const { container } = renderFileCell([BARE_PERCENT, INVALID_ESCAPE]);
    expect(within(container).getByRole('link', { name: '100%.png' })).toHaveAttribute('href', BARE_PERCENT);
    expect(within(container).getByRole('link', { name: 'a%zz.pdf' })).toHaveAttribute('href', INVALID_ESCAPE.url);
  });

  it('a single (non-array) value with a bare `%` renders too', () => {
    const { container } = renderFileCell(BARE_PERCENT);
    expect(within(container).getByRole('link', { name: '100%.png' })).toHaveAttribute('href', BARE_PERCENT);
  });

  it('THE CONTROL: a valid escape in the same cell still decodes', () => {
    const { container } = renderFileCell([VALID_ESCAPE, BARE_PERCENT]);
    expect(within(container).getByRole('link', { name: 'report q3.pdf' })).toHaveAttribute('href', VALID_ESCAPE);
    expect(within(container).getByRole('link', { name: '100%.png' })).toHaveAttribute('href', BARE_PERCENT);
  });
});
