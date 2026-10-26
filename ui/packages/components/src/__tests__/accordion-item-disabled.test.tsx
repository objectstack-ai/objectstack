/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `accordion` renderer honors item-level `disabled` (objectui#4652).
 *
 * The same defect as objectui#4632 (PR #4651), one interface up in the same
 * file. `AccordionItem` declared `disabled?` and `icon?` while this renderer
 * read NEITHER — it mapped items to `value`/`title`/`content` only. The
 * finding settled the two keys in opposite directions: `icon` is retired
 * (zero measured pull anywhere in this repo, including the `objectstack`
 * sibling checkout), `disabled` is wired despite also having zero catalog
 * pull today, because item-level `disabled` is already established live
 * convention across `tabs`, `select`, `dropdown-menu`, `menubar`,
 * `context-menu` and (objectui#4632) `toggle-group`, and the underlying
 * Radix item supports it natively.
 *
 * That native support is why this needed no edit to `src/ui/accordion.tsx`:
 * `AccordionItem` there spreads `...props` onto `AccordionPrimitive.Item`,
 * whose `disabled` reaches the trigger's real `<button disabled>` through
 * `@radix-ui/react-collapsible`'s `CollapsibleTrigger` — so the renderer
 * forwarding one prop is the whole fix. `ui/**` is a synced no-touch zone
 * (AGENTS.md #7) and a fix that required editing it would have been the
 * wrong shape.
 *
 * The declaration half — `icon` gone from the interface and the Zod mirror,
 * `disabled` kept — is pinned in
 * `packages/types/src/__tests__/accordion-item-authorable-keys.test.ts`.
 *
 * Both the static `disabled` attribute AND the click-driven expand behavior
 * are asserted here: a disabled trigger carrying `disabled` in the DOM but
 * still expanding on click would be a broken forward (Radix's own attribute,
 * not this renderer's), and asserting only the attribute would miss that.
 * Positive control included throughout: an item that does NOT declare
 * `disabled` must remain clickable/expandable, so the assertions mean
 * "forwarded per item" rather than "the whole accordion is disabled".
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { AccordionSchema } from '@object-ui/types';
// Module scope, not a hook: this import IS the registration, and an unbounded
// module load must never be billed to a bounded window (AGENTS.md §测试纪律).
import '../renderers';

function renderAccordion(schema: AccordionSchema) {
  const Component = ComponentRegistry.get('accordion');
  if (!Component) {
    throw new Error('Component "accordion" is not registered');
  }
  return render(<Component schema={schema} />);
}

const schema = (): AccordionSchema => ({
  type: 'accordion',
  items: [
    { value: 'one', title: 'Section 1', content: 'Content for section 1' },
    { value: 'two', title: 'Section 2', content: 'Content for section 2', disabled: true },
    { value: 'three', title: 'Section 3', content: 'Content for section 3' },
  ],
});

describe('accordion renderer forwards item-level `disabled` (objectui#4652)', () => {
  it('disables exactly the item that declares it', () => {
    renderAccordion(schema());

    expect(screen.getByRole('button', { name: 'Section 2' })).toBeDisabled();
    // The reverse direction, which is what makes the assertion above mean
    // "forwarded per item" rather than "the whole accordion is disabled".
    expect(screen.getByRole('button', { name: 'Section 1' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Section 3' })).not.toBeDisabled();
  });

  it('does not expand the disabled item on click', () => {
    renderAccordion(schema());

    const disabledTrigger = screen.getByRole('button', { name: 'Section 2' });
    expect(disabledTrigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(disabledTrigger);

    expect(disabledTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('positive control: expands a non-disabled item on click', () => {
    renderAccordion(schema());

    const enabledTrigger = screen.getByRole('button', { name: 'Section 1' });
    expect(enabledTrigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(enabledTrigger);

    expect(enabledTrigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('leaves every item enabled and expandable when none declares `disabled`', () => {
    renderAccordion({
      type: 'accordion',
      items: [
        { value: 'one', title: 'Section 1', content: 'Content for section 1' },
        { value: 'two', title: 'Section 2', content: 'Content for section 2' },
      ],
    });

    const trigger = screen.getByRole('button', { name: 'Section 1' });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('still renders each item title', () => {
    renderAccordion(schema());

    expect(screen.getByText('Section 1')).toBeInTheDocument();
    expect(screen.getByText('Section 2')).toBeInTheDocument();
    expect(screen.getByText('Section 3')).toBeInTheDocument();
  });
});
