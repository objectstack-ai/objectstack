/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `toggle-group` renderer honors item-level `disabled` (objectui#4632).
 *
 * `ToggleGroupItem` declared `icon?` and `disabled?` while this renderer read
 * NEITHER — it mapped items to value + aria-label + label and nothing else. The
 * finding settled the two keys in opposite directions: `icon` is retired (zero
 * measured pull — one catalog entry authored it, no code read it), `disabled` is
 * wired, because item-level `disabled` is already live convention across `tabs`,
 * `select`, `dropdown-menu`, `menubar` and `context-menu`, and the underlying
 * Radix item supports it natively.
 *
 * That native support is why this needed no edit to `src/ui/toggle-group.tsx`:
 * the primitive spreads `...props` onto `ToggleGroupPrimitive.Item`, so the
 * renderer forwarding one prop is the whole fix — `ui/**` is a synced no-touch
 * zone (AGENTS.md #7) and a fix that required editing it would have been the
 * wrong shape.
 *
 * The declaration half — `icon` gone from the interface and the Zod mirror,
 * `disabled` kept — is pinned in
 * `packages/types/src/__tests__/toggle-group-item-authorable-keys.test.ts`.
 *
 * Queried by `aria-label` rather than by role deliberately: Radix gives items
 * `role="radio"` under `selectionType: 'single'` and a pressable button under
 * `'multiple'`, so a role query would silently pin the selection mode too.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { ToggleGroupSchema } from '@object-ui/types';
import { renderComponent } from './test-utils';
// Module scope, not a hook: this import IS the registration, and an unbounded
// module load must never be billed to a bounded window (AGENTS.md §测试纪律).
import '../renderers';

const schema = (selectionType: 'single' | 'multiple'): ToggleGroupSchema => ({
  type: 'toggle-group',
  selectionType,
  items: [
    { value: 'list', label: 'List' },
    { value: 'grid', label: 'Grid' },
    { value: 'table', label: 'Table', disabled: true },
  ],
});

describe('toggle-group renderer forwards item-level `disabled` (objectui#4632)', () => {
  it('disables exactly the item that declares it', () => {
    renderComponent(schema('single'));

    expect(screen.getByLabelText('Table')).toBeDisabled();
    // The reverse direction, which is what makes the assertion above mean
    // "forwarded per item" rather than "the whole group is disabled".
    expect(screen.getByLabelText('List')).not.toBeDisabled();
    expect(screen.getByLabelText('Grid')).not.toBeDisabled();
  });

  it('forwards it in multiple-selection mode too', () => {
    renderComponent(schema('multiple'));

    expect(screen.getByLabelText('Table')).toBeDisabled();
    expect(screen.getByLabelText('List')).not.toBeDisabled();
  });

  it('leaves every item enabled when none declares `disabled`', () => {
    renderComponent({
      type: 'toggle-group',
      selectionType: 'single',
      items: [
        { value: 'list', label: 'List' },
        { value: 'grid', label: 'Grid' },
      ],
    } as ToggleGroupSchema);

    expect(screen.getByLabelText('List')).not.toBeDisabled();
    expect(screen.getByLabelText('Grid')).not.toBeDisabled();
  });

  it('still renders each item label', () => {
    const { container } = renderComponent(schema('single'));

    expect(container.textContent).toContain('List');
    expect(container.textContent).toContain('Grid');
    expect(container.textContent).toContain('Table');
  });
});
