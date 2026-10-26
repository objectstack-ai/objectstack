/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: a `visibleWhen` authored on a `data-table`'s `emptyAction` node
 * must actually gate that node.
 *
 * ## The bypass
 *
 * `visibleWhen` is not a per-block concern in this platform. It is enforced
 * ONCE, generically, in `packages/react/src/SchemaRenderer.tsx`: `shouldHide`
 * tests `visibleWhen` ahead of the hoisted `visible` (objectui#5454), sets
 * `_hidden`, and `if (evaluatedSchema._hidden) return null` fires BEFORE the
 * registry dispatches. A block renderer cannot ignore the gate, because it
 * never sees the node.
 *
 * The `emptyAction` slot was the one authored-node exception in the tree: it
 * resolved the registry DIRECTLY (`ComponentRegistry.get(node.type)`) and
 * mounted the result itself, so the node never passed through `SchemaRenderer`
 * and its `visibleWhen` was never evaluated — declared-not-enforced, the same
 * class objectui#5401 / #5505 closed for `record:alert`, one level down. The
 * fix routes the slot through `SchemaRenderer` rather than adding a second
 * evaluator here; a local `visibleWhen` check bolted onto the slot would be a
 * FOURTH evaluator and exactly the drift this repo already records for
 * `page:tabs`' item-level predicate.
 *
 * ## Why the counter-probes are not optional
 *
 * "The gate is enforced" is satisfiable by never rendering the slot at all —
 * which would silently delete the feature and stay invisible to the negative
 * assertion alone. So the true-polarity and the no-predicate cases are pinned
 * beside it, and every case additionally asserts the EMPTY STATE was actually
 * reached (`emptyAction` renders only there): a fixture that never reaches the
 * empty state is green for the wrong reason.
 *
 * ## The fault case is MEASURED, not chosen
 *
 * A predicate naming a genuinely unbound root must behave the way the central
 * gate behaves, not some new way. The central gate fails CLOSED since
 * objectui#13299 — a declared predicate that cannot be evaluated withholds its
 * node — so the node is not drawn. Pinned here so a future change to the slot cannot
 * quietly pick a different answer than the one `SchemaRenderer` gives every
 * other node.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react';
import '../data-table';

/**
 * A probe component registered under a type of this test's own, so the slot's
 * render is observable without depending on which module's `button` / `text`
 * registration happens to win the import order.
 */
const CTA_TYPE = 'test:data-table-empty-action-probe';
ComponentRegistry.register(CTA_TYPE, () => (
  <span data-testid="empty-action-cta">Create the first record</span>
));

/** The empty state renders only with no rows, no loading and no error. */
function renderEmptyTable(emptyAction: unknown, canCreate: boolean) {
  return render(
    <PredicateScopeProvider scope={{ features: { can_create: canCreate } }}>
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
      />
    </PredicateScopeProvider>,
  );
}

/**
 * Guard against a green-for-the-wrong-reason pass: assert the fixture really
 * landed in the empty state, where `emptyAction` is the only thing that can
 * render the CTA.
 */
function expectEmptyStateReached() {
  expect(screen.getByText(/No results found|table\.noResults/)).toBeInTheDocument();
}

describe('data-table emptyAction — the central visibleWhen gate applies', () => {
  it('does NOT render an emptyAction whose `visibleWhen` resolves false', () => {
    renderEmptyTable(
      {
        type: CTA_TYPE,
        visibleWhen: { dialect: 'cel', source: 'features.can_create == true' },
      },
      /* canCreate */ false,
    );
    expectEmptyStateReached();
    expect(screen.queryByTestId('empty-action-cta')).toBeNull();
  });

  it('DOES render the same emptyAction when its `visibleWhen` resolves true', () => {
    renderEmptyTable(
      {
        type: CTA_TYPE,
        visibleWhen: { dialect: 'cel', source: 'features.can_create == true' },
      },
      /* canCreate */ true,
    );
    expectEmptyStateReached();
    expect(screen.getByTestId('empty-action-cta')).toBeInTheDocument();
  });

  it('DOES render an emptyAction that declares no `visibleWhen` at all', () => {
    renderEmptyTable({ type: CTA_TYPE }, /* canCreate */ false);
    expectEmptyStateReached();
    expect(screen.getByTestId('empty-action-cta')).toBeInTheDocument();
  });

  it('withholds the node on a faulting predicate — the central gate fails closed (objectui#13299)', () => {
    renderEmptyTable(
      {
        type: CTA_TYPE,
        visibleWhen: { dialect: 'cel', source: 'nothing_is_bound_here.flag == true' },
      },
      /* canCreate */ false,
    );
    expectEmptyStateReached();
    expect(screen.queryByTestId('empty-action-cta')).toBeNull();
  });

  it('honours the bare-string spelling of the same predicate', () => {
    renderEmptyTable(
      { type: CTA_TYPE, visibleWhen: 'features.can_create == true' },
      /* canCreate */ false,
    );
    expectEmptyStateReached();
    expect(screen.queryByTestId('empty-action-cta')).toBeNull();
  });
});
