/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `button-group` renderer honors per-button `disabled` (objectui#7077).
 *
 * ## The defect
 *
 * `ButtonGroupButton` declares `disabled?: boolean` (`packages/types/src/
 * navigation.ts`, mirrored `z.boolean().optional()`), and the renderer read it
 * NOWHERE — it mapped `schema.buttons` to `Button` elements passing `variant`,
 * `size`, `className` and `label` and nothing else. Every sibling that declares
 * item-level `disabled` forwards it: `tabs`, `select`, `dropdown-menu`,
 * `menubar`, `context-menu`, and `toggle-group` since objectui#4632.
 * `button-group` was the one outlier, so an author writing the declared key got
 * a schema that validated, published, and rendered a live button.
 *
 * ## Why this asserts the rendered DOM and not the schema
 *
 * A test asserting `disabled` is a member of `ButtonGroupButtonSchema.shape`
 * would restate the declaration this card did not change, and would stay green
 * with the forwarding deleted again — the exact hole that let the key sit
 * unread. The assertions below read the rendered `button` elements, so removing
 * `disabled={button.disabled}` from the renderer turns this file red. The
 * enabled siblings are asserted in the same breath: without them "the button is
 * disabled" would also be satisfied by a group that disabled everything.
 *
 * ## `onClick` is deliberately NOT exercised here
 *
 * The card and the 2026-09-04 ruling both name `onClick` as the second
 * declared-but-unwired key. It is neither, on this tree: objectui#6124 (PR
 * #7339, landed 2026-09-02) RETIRED it — `onClick?: never` on the TypeScript
 * face, `handlerKeyRefusal('onClick', 'retired', …)` on the mirror, and a
 * `never` row on the docs page. Wiring it would be an un-retirement, decided at
 * `packages/types`, not here. `button-group-doc-surface-6347.test.ts` already
 * pins the refusal.
 */

import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { ButtonGroupSchema } from '@object-ui/types';
import { renderComponent } from './test-utils';
// Module scope, not a hook: this import IS the registration, and an unbounded
// module load must never be billed to a bounded window (AGENTS.md §测试纪律).
import '../renderers';

const schema = (): ButtonGroupSchema => ({
  type: 'button-group',
  buttons: [
    { label: 'Copy' },
    { label: 'Cut', disabled: true },
    { label: 'Paste' },
  ],
});

describe('button-group renderer forwards per-button `disabled` (objectui#7077)', () => {
  it('disables exactly the button that declares it', () => {
    renderComponent(schema());

    expect(screen.getByRole('button', { name: 'Cut' })).toBeDisabled();
    // The reverse direction, which is what makes the assertion above mean
    // "forwarded per button" rather than "the whole group is disabled".
    expect(screen.getByRole('button', { name: 'Copy' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Paste' })).not.toBeDisabled();
  });

  it('honors `disabled: false` as an explicit enable, not as a truthy presence', () => {
    // `disabled={button.disabled}` forwards the VALUE; a presence check
    // (`disabled={'disabled' in button}`) would pass the test above and fail
    // this one.
    renderComponent({
      type: 'button-group',
      buttons: [{ label: 'Left', disabled: false }, { label: 'Right', disabled: true }],
    } as ButtonGroupSchema);

    expect(screen.getByRole('button', { name: 'Left' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Right' })).toBeDisabled();
  });

  it('leaves every button enabled when none declares `disabled`', () => {
    renderComponent({
      type: 'button-group',
      buttons: [{ label: 'Day' }, { label: 'Week' }],
    } as ButtonGroupSchema);

    expect(screen.getByRole('button', { name: 'Day' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Week' })).not.toBeDisabled();
  });

  it('still renders the group and every label', () => {
    const { container } = renderComponent(schema());

    // Non-vacuity for the queries above: this IS a rendered button group.
    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(container.textContent).toContain('Copy');
    expect(container.textContent).toContain('Cut');
    expect(container.textContent).toContain('Paste');
  });
});
