/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8331 — a `data-table`'s `emptyAction` accepts any `SchemaNode`, so a
 * bare string node must RENDER rather than be silently dropped.
 *
 * ## The defect this pins closed
 *
 * `DataTableSchema.emptyAction` is declared `SchemaNode` on both published
 * faces — `packages/types/src/data-display.ts` and its Zod twin in
 * `packages/types/src/zod/data-display.zod.ts` — and `SchemaNode` is
 * `BaseSchema | string | number | boolean | null | undefined`. The render path
 * additionally required `typeof … === 'object'`, so an authored
 * `emptyAction: 'Create the first record'` rendered NOTHING and reported
 * nothing: declared wider than enforced, failing in the direction that loses
 * the author's content without a diagnostic.
 *
 * The object-only test was not protecting the renderer from anything it cannot
 * handle. What `SchemaRenderer` does with a primitive is pinned in
 * `packages/react/src/__tests__/SchemaRenderer.primitiveSchema.test.tsx`
 * (objectui#4548): a non-empty string renders as its own text, and `''` / `0` /
 * `false` render nothing. The guard was discarding input the declaration
 * promises to accept.
 *
 * Same shape, same answer, one slot over: objectui#7105 (director seat,
 * decision batch #69, 2026-09-07) ruled the identical defect on
 * `EmptySchema.action` — RELAX THE RENDERER, do not narrow the declaration.
 *
 * ## Why the falsy primitives are pinned here too
 *
 * The truthiness leg of the guard is KEPT, and that is a decision, not an
 * oversight. `0` / `false` / `''` render nothing both before and after this
 * change, which is exactly the answer `SchemaRenderer` itself gives them
 * (objectui#4548 pins them as "renders nothing … rather than becoming '0' /
 * 'false'"). When this suite was written, routing them through the bridge
 * instead would have turned them into the text "0" and "false", because
 * `toRenderableSchema` mapped every `number` / `boolean` onto `String(node)` —
 * a SECOND behaviour change on a published surface that nothing ruled and that
 * would have contradicted that pin. This leg is why that never reached this
 * slot.
 *
 * ⚠️ objectui#8908 repaired the bridge itself: it now gives a falsy primitive
 * nothing, so the leg no longer changes the answer here — it reaches the same
 * one a step earlier, and it stays as defence in depth. That makes the cases
 * below CONTROLS rather than the discriminating evidence they were: they are
 * green on the bridge's old spelling and its new one alike, and what they now
 * guard is the slot keeping the platform's answer no matter which side of the
 * boundary decides it. The bridge's own two paths are measured directly in
 * `packages/react/src/__tests__/schema-input.bridgeFidelity.test.tsx`.
 *
 * ## Discriminating power
 *
 * The string case below FAILS on the unfixed guard — that is what makes it
 * evidence. The object case and the sibling suite
 * `data-table-empty-action-visible-when.test.tsx` are the regression controls
 * and are green on both sides; every case additionally asserts the fixture
 * really reached the EMPTY STATE, since that is the only place this slot
 * renders and a fixture that misses it would be green for the wrong reason.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import '../data-table';

const CTA_TYPE = 'test:data-table-empty-action-primitive-probe';
ComponentRegistry.register(CTA_TYPE, () => (
  <span data-testid="empty-action-cta">Create the first record</span>
));

/** The empty state renders only with no rows, no loading and no error. */
function renderEmptyTable(emptyAction: unknown) {
  return render(
    <SchemaRenderer
      schema={{
        type: 'data-table',
        columns: [{ header: 'Name', accessorKey: 'name' }],
        data: [],
        pagination: false,
        searchable: false,
        selectable: false,
        rowActions: false,
        emptyAction,
      } as never}
    />,
  );
}

/**
 * Guard against a green-for-the-wrong-reason pass: assert the fixture really
 * landed in the empty state, where `emptyAction` is the only thing that can
 * render authored content.
 */
function expectEmptyStateReached() {
  expect(screen.getByText(/No results found|table\.noResults/)).toBeInTheDocument();
}

describe('objectui#8331 — data-table emptyAction accepts the whole SchemaNode union', () => {
  describe('the declared change: a bare string node renders instead of vanishing', () => {
    it('renders a bare string emptyAction as its own text', () => {
      const { container } = renderEmptyTable('Create the first record');
      expectEmptyStateReached();
      expect(container.textContent).toContain('Create the first record');
    });

    it('does not report the string as an unknown component type', () => {
      const { container } = renderEmptyTable('Create the first record');
      expectEmptyStateReached();
      expect(container.textContent).not.toContain('Unknown component type');
    });
  });

  describe('unchanged paths', () => {
    /**
     * The empty state's own chrome, with no authored node in the slot. Every
     * "renders nothing" case below is asserted against THIS, not against a
     * substring guess — the table's own text is not this suite's to predict.
     */
    function emptyStateBaselineText() {
      const { container, unmount } = renderEmptyTable(undefined);
      const text = container.textContent ?? '';
      unmount();
      return text;
    }

    it('still renders an object emptyAction through the registry', () => {
      renderEmptyTable({ type: CTA_TYPE });
      expectEmptyStateReached();
      expect(screen.getByTestId('empty-action-cta')).toBeInTheDocument();
    });

    it('renders nothing for a nullish emptyAction', () => {
      const baseline = emptyStateBaselineText();
      for (const value of [null, undefined] as const) {
        const { container, unmount } = renderEmptyTable(value);
        expectEmptyStateReached();
        expect(container.textContent).toBe(baseline);
        unmount();
      }
    });

    it('renders nothing for the falsy primitives, exactly as SchemaRenderer does', () => {
      // objectui#4548 pins `''` / `0` / `false` as rendering nothing, and the
      // slot must keep giving them that answer. ⚠️ Since objectui#8908 repaired
      // the bridge, this case no longer fails if the truthiness leg is "tidied"
      // into a nullish test — both routes now render nothing. It pins the
      // OUTCOME; the leg's own rationale is in the renderer's comment.
      const baseline = emptyStateBaselineText();
      for (const value of ['', 0, false] as const) {
        const { container, unmount } = renderEmptyTable(value);
        expectEmptyStateReached();
        expect(container.textContent).toBe(baseline);
        unmount();
      }
    });
  });
});
