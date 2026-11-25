/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37142 (ADR-0160 D7) — a related list's toolbar holds no single
 * record: a launch from it runs on the PARENT record. An `ask_ai` action there
 * would focus the assistant on the parent, not on a row of the list, so the
 * toolbar leaves it out even where the in-app assistant is on. Its rows still
 * draw it (they hold one record each).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider } from '@object-ui/react';
import { RelatedList } from '../RelatedList';

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ json: async () => [] }) as any) as any;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ASK = { name: 'ask_about_contact', label: 'Ask AI', type: 'ask_ai' };
const EXPORT = { name: 'export', label: 'Export' };

describe('RelatedList list_toolbar — no ask_ai', () => {
  it('leaves ask_ai out with an in-app assistant installed, and keeps the rest', async () => {
    render(
      <ActionProvider context={{ objectName: 'account', record: { id: 'acc_1' } }} onAskAi={vi.fn()}>
        <RelatedList
          title="Contacts"
          type="table"
          api="contact"
          objectName="contact"
          referenceField="account_id"
          parentId="acc_1"
          columns={[{ accessorKey: 'name', header: 'Name' }]}
          toolbarActions={[ASK, EXPORT] as any}
          onToolbarAction={() => {}}
        />
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Contacts')).toBeInTheDocument());
    expect(screen.queryByTestId('related-toolbar-action-ask_about_contact')).toBeNull();
    expect(screen.getByTestId('related-toolbar-action-export')).toBeInTheDocument();
  });
});
