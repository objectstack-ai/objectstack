/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37142 (ADR-0160 D7) — `ask_ai` focuses the assistant on ONE
 * record. The bulk bar runs a def once per selected row, so it would pin each
 * row in turn and count every run a success. It never offers one, even where
 * the in-app assistant is on.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ActionProvider } from '@object-ui/react';
import type { BulkActionDef } from '@object-ui/types';
import { BulkActionBar } from '../components/SelectionBar';

const ASK: BulkActionDef = {
  name: 'ask_about_account',
  label: 'Ask AI',
  operation: 'custom',
  // A def promoted from an object action carries the action's type here.
  actionDef: { name: 'ask_about_account', type: 'ask_ai' },
};
const TAG: BulkActionDef = { name: 'tag', label: 'Tag', operation: 'custom' };

describe('BulkActionBar — never offers ask_ai', () => {
  it('leaves ask_ai out with an in-app assistant installed, and keeps the rest', () => {
    render(
      <ActionProvider context={{ objectName: 'account' }} onAskAi={vi.fn()}>
        <BulkActionBar
          selectedRows={[{ id: 'r1' }, { id: 'r2' }]}
          actions={[]}
          actionDefs={[ASK, TAG]}
          onActionDef={() => {}}
          onAction={() => {}}
        />
      </ActionProvider>,
    );
    expect(screen.queryByTestId('bulk-action-ask_about_account')).toBeNull();
    expect(screen.getByTestId('bulk-action-tag')).toBeInTheDocument();
  });
});
