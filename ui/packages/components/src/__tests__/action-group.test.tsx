/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `action:group` placement (objectui#3142).
 *
 * This renderer carried a THIRD reading of `locations`: `!a.locations ||
 * a.locations.includes(loc)` — an action with `locations: undefined` showed,
 * while one with `locations: []` was hidden, for no stated reason. Both now
 * mean the same thing (no declared placement → not rendered here) because both
 * go through `actionRendersAt`. Nothing pinned this file's behaviour before,
 * which is how the third dialect survived.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';

// Action renderers are loaded by the shared vitest setup (see action-bar.test).
const renderGroup = (schema: Record<string, unknown>) => renderComponent(schema as never);

describe('action:group — placement', () => {
  it('renders only actions that declare the requested location', () => {
    renderGroup({
      type: 'action:group',
      location: 'list_toolbar',
      actions: [
        { name: 'here', label: 'Here', type: 'script', locations: ['list_toolbar'] },
        { name: 'elsewhere', label: 'Elsewhere', type: 'script', locations: ['record_header'] },
      ],
    });
    expect(screen.getByText('Here')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });

  it('treats an undeclared placement the same as an empty one — both hide', () => {
    renderGroup({
      type: 'action:group',
      location: 'list_toolbar',
      actions: [
        { name: 'undeclared', label: 'Undeclared', type: 'script' },
        { name: 'empty', label: 'Empty', type: 'script', locations: [] },
        { name: 'here', label: 'Here', type: 'script', locations: ['list_toolbar'] },
      ],
    });
    // Pre-#3142 `Undeclared` rendered and `Empty` did not — same key, two answers.
    expect(screen.queryByText('Undeclared')).not.toBeInTheDocument();
    expect(screen.queryByText('Empty')).not.toBeInTheDocument();
    expect(screen.getByText('Here')).toBeInTheDocument();
  });

  it('renders every action when the group sets no location filter', () => {
    renderGroup({
      type: 'action:group',
      actions: [
        { name: 'a', label: 'Alpha', type: 'script' },
        { name: 'b', label: 'Beta', type: 'script', locations: ['record_header'] },
      ],
    });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
