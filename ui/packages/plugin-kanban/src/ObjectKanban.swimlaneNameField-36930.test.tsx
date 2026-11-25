/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36930 — a reference swimlane is titled through the target
 * object's declared `nameField` (ADR-0079), the way a column lane over the
 * same reference is.
 *
 * The account object names its records by `code`, and the expanded record
 * also carries a `name`, which the shared title ladder would pick when the
 * target definition is not consulted. So a heading that reads `ZZ-1` proves
 * the target's `nameField` was read; one that reads `Acme Corp` proves it was
 * not.
 *
 * Rows:
 *   (a) the swimlane heading shows the target's `nameField`;
 *   (b) it matches the column-lane heading for the same record.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import type { DataSource } from '@object-ui/types';
import { ObjectKanban } from './ObjectKanban';
import './KanbanImpl';

registerAllFields();

const DEAL = {
  name: 'deal',
  fields: {
    title: { type: 'text', label: 'Title' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'won', label: 'Won' },
      ],
    },
    // No `displayField`: the title comes from the target object alone.
    account_id: { type: 'lookup', label: 'Account', reference: 'account' },
  },
};

/** Names its records by `code`, not by the name-ish `name` key. */
const ACCOUNT = {
  name: 'account',
  nameField: 'code',
  fields: { name: { type: 'text', label: 'Name' }, code: { type: 'text', label: 'Code' } },
};

const ACME = { id: 'a1', name: 'Acme Corp', code: 'ZZ-1' };
const GLOBEX = { id: 'a2', name: 'Globex Inc', code: 'ZZ-2' };

const rows = () => [
  { id: 'd1', title: 'Deal one', stage: 'open', account_id: ACME },
  { id: 'd2', title: 'Deal two', stage: 'won', account_id: GLOBEX },
  { id: 'd3', title: 'Deal three', stage: 'won', account_id: ACME },
];

function makeDataSource(): DataSource {
  return {
    getObjectSchema: vi.fn(async (name: string) =>
      name === 'account' ? ACCOUNT : name === 'deal' ? DEAL : { name, fields: {} },
    ),
    find: vi.fn(async () => ({ value: rows() })),
    update: vi.fn(async () => ({})),
  } as unknown as DataSource;
}

async function mountBoard(extra: Record<string, unknown>) {
  const result = render(
    <ObjectKanban
      schema={{ type: 'object-kanban', objectName: 'deal', cardTitle: 'title', ...extra } as any}
      dataSource={makeDataSource()}
    />,
  );
  expect(await screen.findByText('Deal three')).toBeInTheDocument();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

/** The swimlane header titles (the first text span after the chevron). */
function swimlaneTitles(): string[] {
  const region = screen.getByRole('region', { name: 'Kanban board with swimlanes' });
  return Array.from(region.querySelectorAll<HTMLElement>('button[aria-expanded]')).map(
    (button) => button.querySelectorAll('span')[1]?.textContent ?? '',
  );
}

function columnLaneTitles(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="group"][aria-label]')).map(
    (lane) => lane.getAttribute('aria-label') ?? '',
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a reference swimlane is titled by the target nameField (objectstack#36930)', () => {
  it('(a) the swimlane heading shows the target object\'s declared nameField', async () => {
    await mountBoard({ groupBy: 'stage', swimlaneField: 'account_id' });
    await waitFor(() => expect(swimlaneTitles().sort()).toEqual(['ZZ-1', 'ZZ-2']));
    expect(swimlaneTitles()).not.toContain('Acme Corp');
  });

  it('(b) the swimlane heading matches the column-lane heading for the same record', async () => {
    const { container } = await mountBoard({ groupBy: 'account_id' });
    await waitFor(() => expect(columnLaneTitles(container)).toContain('ZZ-1'));
    const columnTitles = columnLaneTitles(container).filter((t) => t.startsWith('ZZ-')).sort();
    cleanup();

    await mountBoard({ groupBy: 'stage', swimlaneField: 'account_id' });
    await waitFor(() => expect(swimlaneTitles().sort()).toEqual(columnTitles));
    expect(columnTitles).toEqual(['ZZ-1', 'ZZ-2']);
  });
});
