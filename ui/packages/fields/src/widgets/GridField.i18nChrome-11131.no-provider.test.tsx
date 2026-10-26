/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * With no `I18nProvider` mounted, the line-items grid's chrome is the English
 * it rendered before objectui#11131 moved it onto pack keys, byte for byte.
 *
 * This is the provider-less path — a standalone embed, this package's own
 * tests — served by each call site's inline `defaultValue` through
 * `createSafeTranslation`'s fallback, including the `{{label}}` hole of the
 * list-mode empty text. The zh half is `GridField.i18nChrome-11131.test.tsx`.
 *
 * Its own FILE on purpose: `createI18n` registers its instance as
 * react-i18next's module-global default, and that registration outlives
 * `cleanup()`, so one provider mount earlier in a file would answer every
 * later "no provider" render in it. Do not import or mount `I18nProvider`
 * here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { GridField } from './GridField';

afterEach(() => cleanup());

const columns = [{ name: 'description', label: 'Description', type: 'text' as const }];

/** The cell's whole text, so a split into several text nodes still compares. */
const cellText = (text: RegExp) => screen.getByText(text, { selector: 'td' }).textContent;

describe('GridField chrome with no i18n provider (objectui#11131)', () => {
  it('the Add button reads `Add line`', () => {
    render(<GridField value={[]} onChange={() => {}} field={{ columns } as never} />);
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
  });

  it('the list-mode empty text is the old sentence, naming `Add`', () => {
    render(
      <GridField value={[]} onChange={() => {}} field={{ columns } as never} displayMode="list" onAdd={() => {}} />,
    );
    expect(cellText(/^No items yet/)).toBe('No items yet — click “Add” to begin.');
  });

  it('an authored `addLabel` fills the hole on this path too', () => {
    render(
      <GridField
        value={[]}
        onChange={() => {}}
        field={{ columns, addLabel: 'New row' } as never}
        displayMode="list"
        onAdd={() => {}}
      />,
    );
    expect(cellText(/^No items yet/)).toBe('No items yet — click “New row” to begin.');
    expect(screen.getByRole('button', { name: 'New row' })).toBeInTheDocument();
  });

  it('the read-only grid over no rows reads `No items`', () => {
    render(<GridField value={[]} onChange={() => {}} field={{ columns } as never} readonly />);
    expect(cellText(/^No items$/)).toBe('No items');
  });
});
