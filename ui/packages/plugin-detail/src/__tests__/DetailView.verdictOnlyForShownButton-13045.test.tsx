/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13045 — `DetailView` asks the record-level explain verdict for an
 * operation only when the host shows that operation's button.
 *
 * Each verdict feeds one thing: `showEdit` / `showDelete`. The console record
 * page's `record:details` body shows neither (the page header owns Edit and
 * Delete), yet it asked both questions on every open. While the header asked
 * too, the body merely joined the header's in-flight request; once the header
 * stopped asking for an operation its object turns off, the body sent the
 * question alone.
 *
 * Pinned here, against the real hook and a counting explain double:
 *   - a standalone `DetailView` with `showEdit` / `showDelete` still asks both,
 *     and its buttons follow the verdict;
 *   - with only one button shown, only that question is asked;
 *   - with neither shown, nothing is asked.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import type { DetailViewSchema } from '@object-ui/types';

let verdicts: Record<string, boolean> = {};
let explainOps: string[] = [];

function installExplainDouble() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const { operation } = JSON.parse(String(init?.body ?? '{}')) as { operation: string };
      explainOps.push(operation);
      return { ok: true, json: async () => ({ record: { visible: verdicts[operation] } }) };
    }),
  );
}

function schemaFor(overrides: Partial<DetailViewSchema>): DetailViewSchema {
  return {
    type: 'detail-view',
    title: 'Contact',
    objectName: 'contact_13045',
    resourceId: 'c1',
    data: { name: 'Alice' },
    fields: [{ name: 'name', label: 'Name' }],
    showBack: false,
    ...overrides,
  };
}

async function mount(overrides: Partial<DetailViewSchema>) {
  render(<DetailView schema={schemaFor(overrides)} />);
  // Let the verdict effects run and their answers land before counting.
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function editButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^edit$/i });
}

async function overflowItems(): Promise<string[]> {
  const trigger = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  await waitFor(() => expect(screen.getByRole('menu')).toBeInTheDocument());
  return screen.getAllByRole('menuitem').map((el) => (el.textContent ?? '').trim());
}

beforeEach(() => {
  __clearRecordEditableCache();
  verdicts = { update: true, delete: true };
  explainOps = [];
  installExplainDouble();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DetailView asks a verdict only for a button it shows (objectui#13045)', () => {
  it('showEdit + showDelete: both asked, and an allowing verdict offers both buttons', async () => {
    await mount({ showEdit: true, showDelete: true });

    expect([...explainOps].sort()).toEqual(['delete', 'update']);
    expect(editButton()).toBeInTheDocument();
    expect(await overflowItems()).toContain('Delete');
  });

  it('showEdit + showDelete: both asked, and a denying verdict hides both buttons', async () => {
    verdicts = { update: false, delete: false };
    await mount({ showEdit: true, showDelete: true });

    expect([...explainOps].sort()).toEqual(['delete', 'update']);
    await waitFor(() => expect(editButton()).toBeNull());
    expect(await overflowItems()).not.toContain('Delete');
  });

  it('only showEdit: only the update verdict is asked', async () => {
    await mount({ showEdit: true });

    expect(explainOps).toEqual(['update']);
  });

  it('only showDelete: only the delete verdict is asked', async () => {
    await mount({ showDelete: true });

    expect(explainOps).toEqual(['delete']);
  });

  it('neither button shown (the record page body): no verdict is asked', async () => {
    await mount({});

    expect(explainOps).toEqual([]);
  });
});
