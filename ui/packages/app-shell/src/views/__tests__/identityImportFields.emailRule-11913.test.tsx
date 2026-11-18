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
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '@object-ui/plugin-grid';
import { identityImportFields, IdentityImportOptions } from '../IdentityImportPanels';
import { createIdentityImportDataSource, IDENTITY_IMPORT_OBJECT } from '../identityImport';

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

describe('identityImportFields: the positions column (objectstack#33113)', () => {
  it('offers `positions`, the column the endpoint assigns positions from', () => {
    const positions = identityImportFields(undefined).find((f) => f.name === 'positions');
    expect(positions).toMatchObject({ type: 'text' });
  });

  it('the options panel explains the column', () => {
    render(<IdentityImportOptions policy="auto" onPolicyChange={() => {}} />);
    expect(screen.getByTestId('identity-import-positions-hint')).toHaveTextContent(/position machine names.*";"/);
  });
});

describe('identityImportFields: the manager column reaches import-users as `manager_id` (objectstack#34536)', () => {
  beforeAll(() => {
    if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = vi.fn(() => false);
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });

  it('offers `manager_id` as a text column labelled by the object field', () => {
    expect(identityImportFields(undefined).find((f) => f.name === 'manager_id'))
      .toEqual({ name: 'manager_id', label: 'Manager', type: 'text' });
    expect(identityImportFields({ manager_id: { label: 'Reports to' } }).find((f) => f.name === 'manager_id'))
      .toMatchObject({ label: 'Reports to', type: 'text' });
  });

  it('the options panel explains the column', () => {
    render(<IdentityImportOptions policy="auto" onPolicyChange={() => {}} />);
    expect(screen.getByTestId('identity-import-manager-hint')).toHaveTextContent(/email address.*reported on its row/);
  });

  it('a pasted manager column is mapped and sent on every row that names one', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const authFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { rows: unknown[] } & Record<string, unknown>;
      bodies.push(body);
      const rows = body.rows.map((_, i) => ({ row: i + 1, ok: true, action: 'created', id: `u-${i}` }));
      return new Response(JSON.stringify({
        success: true,
        data: {
          summary: { total: rows.length, created: rows.length, updated: 0, skipped: 0, errors: 0, dryRun: body.dryRun === true },
          rows,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const dataSource = createIdentityImportDataSource({
      base: {}, authFetch, baseUrl: 'http://srv', getPasswordPolicy: () => 'auto',
    });
    const onComplete = vi.fn();
    render(
      <ImportWizard
        objectName={IDENTITY_IMPORT_OBJECT}
        fields={identityImportFields(undefined)}
        dataSource={dataSource as never}
        open
        onOpenChange={() => {}}
        onComplete={onComplete}
      />,
    );
    pasteRows('Email\tName\tmanager_id\nada@example.com\tAda\t\nbob@example.com\tBob\tada@example.com');
    const next = await screen.findByTestId('import-next-btn');
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    const run = await screen.findByTestId('import-run-btn');
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    const sent = bodies.filter((b) => b.dryRun !== true);
    expect(sent).toHaveLength(1);
    expect(sent[0].rows).toEqual([
      { email: 'ada@example.com', name: 'Ada', manager_id: '' },
      { email: 'bob@example.com', name: 'Bob', manager_id: 'ada@example.com' },
    ]);
  });
});
