/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:quick_actions` — the empty bar tells "named none" from "named, all
 * withheld" (objectui#12995).
 *
 * The bar used to draw its authoring placeholder, "record:quick_actions — no
 * actions configured", whenever the resolved list was empty. A member viewing
 * a block whose named actions all declare a capability they do not hold
 * (`requiredPermissions`, dropped by the action engine) saw that developer
 * sentence, and it was false: the block names configured actions.
 *
 * The three cases:
 *   (a) a block naming two actions, both withheld, draws NOTHING — at runtime
 *       and on a preview surface alike, as the record header and the row menu
 *       draw nothing for a fully withheld set;
 *   (b) a block naming none draws the placeholder on a design / preview
 *       surface (`PreviewModeProvider`) only, and nothing at runtime;
 *   (c) CONTROL: a block naming one held action draws that action, so the
 *       withheld case cannot pass on a bar that never draws anything.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, PreviewModeProvider, RecordContextProvider } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

/** The viewer REPORTS capabilities, and does not hold `manage_org_users`. */
const USER = { id: 'u1', systemPermissions: ['setup.access'] };
const RECORD = { id: 'env-1', name: 'Prod env' };

const action = (name: string, label: string, requiredPermissions?: string[]) => ({
  name,
  label,
  type: 'api',
  locations: ['record_header'],
  ...(requiredPermissions ? { requiredPermissions } : {}),
});

const RESET = action('reset_env', 'Reset environment', ['manage_org_users']);
const DELETE = action('delete_env', 'Delete environment', ['manage_org_users']);
const REFRESH = action('refresh_env', 'Refresh environment');

const PLACEHOLDER = /no actions configured/i;

function mount(schema: Record<string, unknown>, opts: { preview?: boolean } = {}) {
  const bar = (
    <ActionProvider context={{ user: USER } as any}>
      <RecordContextProvider objectName="sys_environment" recordId={RECORD.id} data={RECORD}>
        <RecordQuickActionsRenderer schema={schema as any} />
      </RecordContextProvider>
    </ActionProvider>
  );
  return render(opts.preview ? <PreviewModeProvider>{bar}</PreviewModeProvider> : bar);
}

describe('record:quick_actions — the empty bar (objectui#12995)', () => {
  it('(a) a block naming two actions, both withheld by requiredPermissions, draws nothing at runtime', () => {
    const { container } = mount({ actions: [RESET, DELETE] });
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(container.textContent).toBe('');
  });

  it('(a) …and on a preview surface too: the block names actions, so the placeholder is false there as well', () => {
    const { container } = mount({ actions: [RESET, DELETE] }, { preview: true });
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(container.textContent).toBe('');
  });

  it('(b) a block naming no action draws the placeholder on a preview surface', () => {
    mount({}, { preview: true });
    expect(screen.getByText(PLACEHOLDER)).toBeInTheDocument();
  });

  it('(b) …and nothing in a runtime view', () => {
    const { container } = mount({});
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('(c) CONTROL: a block naming one held action draws that action', () => {
    mount({ actions: [REFRESH] });
    expect(screen.getByRole('button', { name: /Refresh environment/i })).toBeInTheDocument();
    expect(screen.queryByText(PLACEHOLDER)).toBeNull();
  });

  it('(c) …and beside a withheld one, draws only the held action', () => {
    mount({ actions: [RESET, REFRESH] });
    expect(screen.getByRole('button', { name: /Refresh environment/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset environment/i })).toBeNull();
  });
});
