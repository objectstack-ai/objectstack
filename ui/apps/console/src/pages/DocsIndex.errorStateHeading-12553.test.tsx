// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CONTROL for the objectui#12553 page-header pins: an error-state `h1` stays.
 *
 * objectui#12553 moved the console pages that drew a hand-made page header onto
 * `ConsolePageHeader`, and each converted page's pin reads "the page's one
 * `h1` sits inside `page-header`". An `h1` that names an error or empty state
 * is not a page header and was left as it was. This file is the other side of
 * that line, so the pins' reading can be told from a reading that finds no
 * `h1` at all: the docs portal's load-error state still draws its own `h1`,
 * and no page header.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('./use-book-data', () => ({
  useBookData: () => ({ authoredBooks: [], books: [], docs: [], state: 'error', error: 'HTTP 500' }),
}));

import DocsIndex from './DocsIndex';

afterEach(cleanup);

describe('CONTROL: an error-state h1 is not a page header (objectui#12553)', () => {
  it('the docs portal load error draws its own h1 and no page header', () => {
    const { container } = render(
      <MemoryRouter>
        <DocsIndex />
      </MemoryRouter>,
    );
    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe('Failed to load documentation');
    expect(container.querySelector('[data-testid="page-header"]')).toBeNull();
  });
});
