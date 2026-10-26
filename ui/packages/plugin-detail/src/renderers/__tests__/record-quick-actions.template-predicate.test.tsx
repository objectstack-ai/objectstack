/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3871 — the `${…}` predicate spelling on `record:quick_actions`.
 *
 * This surface is the one place where BOTH halves of the defect are observable
 * in one mount: the actions are surfaced through
 * `ActionEngine.getActionsForLocation` (which normalizes `visible` and
 * evaluates it fail-CLOSED) and each button's `disabled` is evaluated by the
 * renderer fail-SOFT. The double wrap therefore produced two opposite constants
 * on the same component:
 *
 *   visible: '${…}'   → the predicate threw → the engine's catch HID the action
 *                       (even when it held) — measured before the fix: the
 *                       button was absent for both polarities.
 *   disabled: '${…}'  → the unparsed string came back → `Boolean` = constant
 *                       `true` → greyed out forever.
 *
 * ## Reverse verification (direction predicted before running)
 *
 * Restore the unconditional wrap in `toPredicateInput` and exactly the two
 * "the predicate should have let it through" cases go red — `visible` that
 * HOLDS (was hidden) and `disabled` that FAILS (was greyed). Their siblings
 * stay green: a hidden action and a greyed button look the same whether the
 * reason is the author's verdict or an unparseable predicate, which is why both
 * polarities are pinned and labelled rather than just the failing one.
 *
 * The `disabled`-gate suite next door (`record-quick-actions.disabled-declared-
 * gate.test.tsx`, objectui#3849) covers the empty/boolean/bare-expression
 * shapes on this surface; this file adds only the template spelling.
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

const present = () => screen.queryByRole('button', { name: LABEL }) !== null;
const isDisabled = () =>
  (screen.getByRole('button', { name: LABEL }) as HTMLButtonElement).disabled;

describe('record:quick_actions — `${…}` template `visible` (objectui#3871, fail-closed via the engine)', () => {
  const gated = { ...ACT, visible: '${record.status === "open"}' };

  it('a template `visible` that HOLDS renders the quick action (DETECTOR)', () => {
    mount(gated, { status: 'open' });
    expect(present()).toBe(true);
  });

  it('a template `visible` that FAILS hides it (green before the fix, for the wrong reason)', () => {
    mount(gated, { status: 'closed' });
    expect(present()).toBe(false);
  });
});

describe('record:quick_actions — `${…}` template `disabled` (objectui#3871, fail-soft in the renderer)', () => {
  const gated = { ...ACT, disabled: '${record.status === "closed"}' };

  it('a template `disabled` that FAILS leaves the quick action clickable (DETECTOR)', () => {
    mount(gated, { status: 'open' });
    expect(isDisabled()).toBe(false);
  });

  it('a template `disabled` that HOLDS greys it out (green before the fix, for the wrong reason)', () => {
    mount(gated, { status: 'closed' });
    expect(isDisabled()).toBe(true);
  });
});
