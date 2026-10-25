/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: the selection bulk-action bar must honor each `BulkActionDef`'s
 * `visible` predicate (a permission / feature gate). It used to render every
 * `bulkActionDefs` entry unconditionally, ignoring `visible` entirely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PredicateScopeProvider } from '@object-ui/react';
import { BulkActionBar } from '../components/BulkActionBar';

function renderBar(actionDefs: any[], scope: Record<string, any> = {}) {
  return render(
    <PredicateScopeProvider scope={scope}>
      <BulkActionBar
        selectedRows={[{ id: '1' }]}
        actions={[]}
        actionDefs={actionDefs}
        onActionDef={() => {}}
      />
    </PredicateScopeProvider>,
  );
}

describe('BulkActionBar — bulk action visible CEL', () => {
  it('hides a bulk action whose `visible` predicate is false', () => {
    renderBar(
      [{ name: 'bulk_delete', label: 'Delete', visible: 'features.canBulkDelete == true' }],
      { features: { canBulkDelete: false } },
    );
    expect(screen.queryByTestId('bulk-action-bulk_delete')).toBeNull();
    // The bar itself still renders (the selection count / Clear affordance).
    expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
  });

  it('shows a bulk action whose `visible` predicate is true', () => {
    renderBar(
      [{ name: 'bulk_delete', label: 'Delete', visible: 'features.canBulkDelete == true' }],
      { features: { canBulkDelete: true } },
    );
    expect(screen.getByTestId('bulk-action-bulk_delete')).toBeInTheDocument();
  });

  it('renders a bulk action with no `visible` predicate', () => {
    renderBar([{ name: 'bulk_tag', label: 'Tag' }]);
    expect(screen.getByTestId('bulk-action-bulk_tag')).toBeInTheDocument();
  });

  // [objectui#3492] A boolean `visible` reached the CEL engine as
  // `{ dialect: 'cel', source: undefined }`, faulted, and — on this fail-closed
  // path — disqualified every selected record. So `visible: true`, the most
  // explicit way to say "always offer this", hid the button from everyone; and
  // `visible: false` was misread as "ungated" by the render guard's truthiness
  // test and rendered the button anyway. Both are inverted; both are fixed by
  // short-circuiting booleans the way every other action surface does.
  describe('boolean visible', () => {
    it('renders a `visible: true` action for everyone', () => {
      renderBar([{ name: 'always', label: 'Always', visible: true }]);
      expect(screen.getByTestId('bulk-action-always')).toBeInTheDocument();
    });

    it('hides a `visible: false` action from everyone', () => {
      renderBar([{ name: 'never', label: 'Never', visible: false }]);
      expect(screen.queryByTestId('bulk-action-never')).toBeNull();
      expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
    });
  });

  // [objectui#11322] A BLANK `visible` is no gate on this bar, as on the row
  // menu and the toolbars of the same grid. The bar asked "is a gate declared?"
  // with `!= null && !== ''` (`hasVisibilityGate`) and handed the value to core's
  // fold, whose own opening test also stops at `''`. So a whitespace-only
  // `visible` counted as a gate, every selected record failed it, and the button
  // disappeared. `hasVisibilityGate` now asks the action family's one definition,
  // and `partitionBulkRows` asks it before handing anything to the fold.
  //
  // The `''` and no-gate rows are the controls the card measured as shown
  // before the fix; `visible: false` keeps "no gate" from passing as "always
  // show". A blank is reported once (ADR-0137 D4), so the console is quieted
  // and its text is not asserted here.
  describe('blank visible (objectui#11322)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    it.each([
      ['a whitespace-only string', '   '],
      ['an envelope whose `source` is whitespace', { dialect: 'cel', source: '   ' }],
      ['an envelope whose `source` is empty', { dialect: 'cel', source: '' }],
    ])('shows an action whose `visible` is %s', (_label, visible) => {
      renderBar([{ name: 'blank_gate', label: 'Blank gate', visible }]);
      expect(screen.getByTestId('bulk-action-blank_gate')).toBeInTheDocument();
    });

    it.each([
      ['an empty string (control)', { visible: '' }, true],
      ['no `visible` key (control)', {}, true],
      ['`false`, a declared gate (control)', { visible: false }, false],
    ])('`visible` as %s', (_label, gate, shown) => {
      renderBar([{ name: 'control', label: 'Control', ...gate }]);
      if (shown) expect(screen.getByTestId('bulk-action-control')).toBeInTheDocument();
      else expect(screen.queryByTestId('bulk-action-control')).toBeNull();
      expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
    });
  });
});
