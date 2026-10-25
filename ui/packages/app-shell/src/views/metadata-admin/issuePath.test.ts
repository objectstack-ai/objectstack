/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { describeIssuePath } from './issuePath';

describe('describeIssuePath', () => {
  const dashboard = { widgets: [{ id: 'kpi_tasks' }, { id: 'priority_split' }] };

  it('returns the head label unchanged for a single-segment path', () => {
    expect(describeIssuePath('Widgets', 'widgets', dashboard)).toBe('Widgets');
  });

  it('names the offending array item by id for a nested path', () => {
    expect(describeIssuePath('Widgets', 'widgets.1.layout', dashboard)).toBe(
      'Widgets → priority_split → layout',
    );
  });

  it('falls back to a 1-based index when the item has no identity', () => {
    expect(describeIssuePath('Widgets', 'widgets.0.values', { widgets: [{}] })).toBe(
      'Widgets → #1 → values',
    );
  });

  it('resolves an I18nLabel identity object to its string', () => {
    const d = { sections: [{ title: { key: 's.overview', defaultValue: 'Overview' } }] };
    expect(describeIssuePath('Sections', 'sections.0.fields', d)).toBe(
      'Sections → Overview → fields',
    );
  });

  it('handles a missing array gracefully (index past the end)', () => {
    expect(describeIssuePath('Widgets', 'widgets.3.layout', {})).toBe('Widgets → #4 → layout');
  });
});
