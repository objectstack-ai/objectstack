/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `RadioGroupSchema.orientation` must reach the DOM (objectui#6158).
 *
 * The key was DECLARED in two layers and read by none:
 *
 *   - `packages/types/src/form.ts:383` — `orientation?: 'horizontal' | 'vertical'`
 *     with `@default 'vertical'`;
 *   - `packages/types/src/zod/form.zod.ts:282` —
 *     `z.enum(['horizontal', 'vertical']).optional()`;
 *   - `packages/components/src/renderers/form/radio-group.tsx` — contained
 *     neither the string `orientation` nor `direction`, and forwarded only
 *     `defaultValue`, `className`, the form-control DOM whitelist and the
 *     designer props.
 *
 * The measurable consequence: EVERY radiogroup root the library rendered was
 * byte-identical on that axis — no `data-orientation`, no `aria-orientation` —
 * so the docs page's `## Layout Options` section demonstrated a distinction the
 * product could not make. The horizontal demo rendered vertically.
 *
 * ## Why these assertions are shaped the way they are
 *
 * A pin that asserts `orientation: 'horizontal'` renders SOMETHING is a phantom:
 * it passes on the unfixed renderer too, because the unfixed renderer renders
 * something for every input. The defect is an EQUALITY — two authored values
 * producing one output — so the pin has to assert the INEQUALITY. `renders
 * different markup for the two orientations` below is that assertion, and it is
 * red on the unfixed renderer for the right reason: the two roots come back
 * character-for-character equal.
 *
 * Both fixtures are authored HERE rather than reusing
 * `examples/schema-catalog/src/schemas/components-form-radio-group/*`. Those
 * catalog fixtures currently spell the key `direction`, which nothing declares —
 * that divergence is objectui#6157's scope and is deliberately not touched by
 * this branch. Until it lands, the two shipped docs demos still render
 * identically to each other even with this renderer fix in place.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { RadioGroupSchema } from '@object-ui/types';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * One factory, one parameter — so "the fixtures differ in EXACTLY one key" is
 * a property of the code rather than a claim in a comment. Same `id`, same
 * options, same order; a difference in the rendered roots cannot come from
 * anywhere but `orientation`.
 */
function fixture(orientation?: 'horizontal' | 'vertical'): RadioGroupSchema {
  return {
    type: 'radio-group',
    id: 'os6158-size',
    options: [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ],
    ...(orientation ? { orientation } : {}),
  };
}

const HORIZONTAL = fixture('horizontal');
const VERTICAL = fixture('vertical');
/** `orientation` omitted entirely — the `@default 'vertical'` case. */
const DEFAULTED = fixture();

function renderRoot(schema: RadioGroupSchema): HTMLElement {
  const Component = ComponentRegistry.get(schema.type);
  if (!Component) throw new Error('radio-group is not registered');
  const { container } = render(<Component schema={schema} />);
  const root = container.querySelector<HTMLElement>('[role="radiogroup"]');
  if (!root) throw new Error('no [role="radiogroup"] root was rendered');
  return root;
}

describe('radio-group renderer — orientation (objectui#6158)', () => {
  it('renders DIFFERENT markup for the two orientations', () => {
    const horizontal = renderRoot(HORIZONTAL).outerHTML;
    const vertical = renderRoot(VERTICAL).outerHTML;

    // The whole defect in one line. On the unfixed renderer these two strings
    // are equal, which is precisely the bug the card measured off the built
    // site. Anything weaker than an inequality passes before AND after the fix.
    expect(horizontal).not.toBe(vertical);
  });

  it('carries the authored orientation onto the radiogroup root', () => {
    const horizontal = renderRoot(HORIZONTAL);
    const vertical = renderRoot(VERTICAL);

    // Asserted on the DOM, not on a spy over the props reaching Radix: a Radix
    // version that accepted the prop and ignored it would satisfy a spy and
    // still ship the byte-identical markup this card is about.
    expect(horizontal.getAttribute('data-orientation')).toBe('horizontal');
    expect(horizontal.getAttribute('aria-orientation')).toBe('horizontal');
    expect(vertical.getAttribute('data-orientation')).toBe('vertical');
    expect(vertical.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('lays the horizontal group out as a row and the vertical group as a stack', () => {
    const horizontal = renderRoot(HORIZONTAL);
    const vertical = renderRoot(VERTICAL);

    // The attributes above are the a11y/keyboard half. This is the half a
    // reader of the docs page actually sees: `## Layout Options` promises a
    // visual difference, so the layout utilities have to diverge too.
    expect(horizontal.className).toContain('flex');
    expect(horizontal.className).not.toContain('grid');
    expect(vertical.className).toContain('grid');
    expect(vertical.className).not.toContain('flex');
  });

  it('enforces the declared `@default \'vertical\'` when orientation is omitted', () => {
    const defaulted = renderRoot(DEFAULTED);

    // Red before the fix: the unfixed renderer emitted no orientation
    // attribute at all, so the declared default was as unenforced as the
    // explicit values were.
    expect(defaulted.getAttribute('data-orientation')).toBe('vertical');
    expect(defaulted.getAttribute('aria-orientation')).toBe('vertical');

    // ⚠️ This half passes on a revert as well — before the fix the two roots
    // were equal because BOTH were orientation-less. It is kept because it is
    // what makes "the default is vertical" (rather than merely "some default")
    // fall out of the assertion above, and it fails loudly if a later change
    // gives the omitted case its own branch.
    expect(defaulted.outerHTML).toBe(renderRoot(VERTICAL).outerHTML);
  });

  it('lets an author className still win over the orientation layout classes', () => {
    const Component = ComponentRegistry.get('radio-group')!;
    const { container } = render(
      <Component schema={HORIZONTAL} className="gap-8" />,
    );
    const root = container.querySelector<HTMLElement>('[role="radiogroup"]');

    // tailwind-merge resolves the conflict in the author's favour; the
    // orientation classes are a default, not an override.
    expect(root?.className).toContain('gap-8');
    expect(root?.className).not.toContain('gap-4');
  });
});
