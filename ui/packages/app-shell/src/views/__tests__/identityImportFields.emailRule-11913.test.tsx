/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The user import's preview checks its email column by the identity
 * endpoint's rule, and its import button follows that check (objectui#11913).
 *
 * `/api/v1/auth/admin/import-users` refuses a non-ASCII or placeholder address
 * with `INVALID_EMAIL` (plugin-auth's `isLikelyEmail` / `isPlaceholderEmail`),
 * in its dry run too. `identityImportFields` once typed that column `text`, so
 * the preview checked nothing there and the button counted those rows until
 * Validate was clicked.
 *
 * The real `ImportWizard` is driven with the real `identityImportFields`.
 * `ImportWizard` is imported at module scope rather than through `ObjectView`'s
 * `React.lazy` boundary (AGENTS.md 测试纪律), so its cost lands in the import
 * phase, which no test timeout bounds.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '@object-ui/plugin-grid';
import { identityImportFields } from '../IdentityImportPanels';

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

const cell = (row: number, col: number) => screen.getByTestId(`import-preview-cell-${row}-${col}`);

describe('identityImportFields: the email column is checked by the identity rule (objectui#11913)', () => {
  it('types the email column `email` and flags it for the identity rule', () => {
    const email = identityImportFields(undefined).find((f) => f.name === 'email');
    expect(email).toMatchObject({ type: 'email', emailRule: 'identity' });
  });

  it('marks a non-ASCII and a placeholder address, and the button counts the clean row only', async () => {
    render(
      <ImportWizard
        objectName="sys_user"
        fields={identityImportFields(undefined)}
        dataSource={{}}
        open
        onOpenChange={() => {}}
      />,
    );
    pasteRows('Email\tName\nada@example.com\tAda\n735431496@柴仟.com\tLi\nu-abc@placeholder.invalid\tPhone only');
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    const button = await screen.findByTestId('import-run-btn');

    expect(cell(0, 0)).toHaveAttribute('aria-invalid', 'false');
    expect(cell(1, 0)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(2, 0)).toHaveAttribute('aria-invalid', 'true');
    expect(cell(1, 0).closest('td')).toHaveAttribute('title', 'Invalid email');
    expect(button).toHaveTextContent('Import 1 Row');
  });
});
