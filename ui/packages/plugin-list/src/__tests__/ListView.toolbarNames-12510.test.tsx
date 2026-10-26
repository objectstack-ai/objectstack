/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12510 — the list toolbar's buttons are named by the words they show.
 *
 * The Studio's Records tab renders this toolbar. The 2026-10-15 test pass read
 * Hide fields, Filter, Group and Sort as buttons with no name; the browser's
 * computed tree on that tab names each one by its visible text. This pins the
 * names by role, so a restyle that hides the text from the tree (an
 * `aria-hidden` label, an icon-only chip without an `aria-label`) turns red.
 */

import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { ListView } from '../ListView';
import type { DataSource, ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

const dataSource = {
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

describe('the list toolbar names its buttons by their visible words (objectui#12510)', () => {
  it('Hide fields, Filter, Group and Sort are buttons named by their text', () => {
    const schema = {
      type: 'list-view',
      compactToolbar: false,
      objectName: 'contacts',
      viewType: 'grid',
      columns: ['name', 'email'],
      userActions: { hideFields: true, filter: true, group: true, sort: true },
    } as unknown as ListViewSchema;

    render(
      <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
        <ListView schema={schema} />
      </SchemaRendererProvider>,
    );

    for (const name of ['Hide fields', 'Filter', 'Group', 'Sort']) {
      expect(screen.getByRole('button', { name }), name).toBeTruthy();
    }
  });
});
