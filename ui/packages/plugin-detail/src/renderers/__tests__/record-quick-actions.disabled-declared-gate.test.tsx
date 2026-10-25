/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3849 — `record:quick_actions`, the fifth and last site whose
 * declared-`disabled` test stayed on `!= null` after objectui#3842 / PR #3851.
 *
 * `toPredicateInput('')` is `undefined` and `evaluateCondition(undefined)` is
 * `true`. On `visible` that `true` means SHOW, so an over-broad "is a gate
 * declared?" test cancels out; on `disabled` it means DISABLE, so the two
 * compound: `disabled: ''` — an empty predicate, i.e. nothing declared — greyed
 * the quick action out permanently. The gate now reads
 * `hasDeclaredVisibilityGate` (`!= null && !== ''`) from the one definition on
 * the action face, imported through the `@object-ui/components` barrel (the
 * cross-package route objectui#3835 opened for exactly this).
 *
 * This surface has NO legacy `enabled` leg (unlike `action:button` /
 * `action:icon` / the two `action:group` leaves / `action:menu`), so the chain is
 * a single gate and the four shapes below are the whole behaviour.
 *
 * The host is driven for real — `useActionEngine` filters by `locations`, the
 * renderer maps the survivors to `QuickActionButton`, and the button's own
 * `useCondition` / `toPredicateInput` are the genuine ones. Nothing about
 * evaluation is stubbed, because the empty-predicate chain IS the mechanism
 * under test.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

const LABEL = 'Act';
/** `locations` is not defaulted — `getActionsForLocation` requires the match. */
const ACT = { name: 'act', label: LABEL, type: 'script', locations: ['record_header'] };

function mount(action: any, record: Record<string, unknown> = {}) {
  return render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="rec-1"
      data={{ id: 'rec-1', ...record }}
    >
      <RecordQuickActionsRenderer schema={{ actions: [action] } as any} />
    </RecordContextProvider>,
  );
}

const isDisabled = () =>
  (screen.getByRole('button', { name: LABEL }) as HTMLButtonElement).disabled;

describe('record:quick_actions — declared `disabled` gate (objectui#3849)', () => {
  it("an empty-string `disabled` is not a declared gate — the action stays clickable", () => {
    mount({ ...ACT, disabled: '' });
    expect(isDisabled()).toBe(false);
  });

  it('disabled:true → the action is disabled', () => {
    mount({ ...ACT, disabled: true });
    expect(isDisabled()).toBe(true);
  });

  it('disabled:false → the action is not disabled', () => {
    mount({ ...ACT, disabled: false });
    expect(isDisabled()).toBe(false);
  });

  it('no `disabled` at all → the action is not disabled (ungated stays ungated)', () => {
    mount({ ...ACT });
    expect(isDisabled()).toBe(false);
  });

  it('an expression-valued `disabled` keeps its verdict — true disables, false does not', () => {
    // The predicate is evaluated against the bound record (the renderer passes
    // `{ record }` as the local scope), so this also pins that the narrowed gate
    // did not disturb the record-scoped evaluation path.
    const gated = { ...ACT, disabled: 'record.status == "closed"' };
    const { unmount } = mount(gated, { status: 'closed' });
    expect(isDisabled()).toBe(true);
    unmount();
    mount(gated, { status: 'open' });
    expect(isDisabled()).toBe(false);
  });
});
