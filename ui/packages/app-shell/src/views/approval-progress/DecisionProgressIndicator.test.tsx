/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * DecisionProgressIndicator — one pin per `decision_progress` shape
 * (objectui#12033, the A3 primitive of objectui#2763).
 *
 * The approval-service contract declares three behaviors for the tally:
 * `unanimous` (approvals of every approver), `quorum` (approvals of the M
 * threshold) and `per_group` (satisfied groups, plus per-group detail). Each
 * gets its own pin below, plus the continuous-bar branch a long tally takes.
 *
 * What is asserted is the indicator's structure — tick count, filled ticks,
 * the progressbar's value range, the group ticks — and WHICH pack row each
 * label is read from. The expected strings are produced by the same i18next
 * instance the render uses, asked for the key, so a pin names the row and its
 * interpolation arguments rather than restating English prose.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { ApprovalDecisionProgress } from '../../hooks/useRecordApprovals';
import { DecisionProgressIndicator } from './DecisionProgressIndicator';

const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });

/** The pack row a label must come from, rendered by the instance under test. */
function row(key: string, args?: Record<string, unknown>): string {
  return String(i18n.t(`approvalsInbox.${key}`, args));
}

async function renderIndicator(progress: ApprovalDecisionProgress, eligibleApprovers?: number) {
  render(
    <I18nProvider instance={i18n}>
      <DecisionProgressIndicator progress={progress} eligibleApprovers={eligibleApprovers} />
    </I18nProvider>,
  );
  return screen.findByRole('progressbar');
}

/** The bar's own children: one per tick, or the single continuous track. */
function ticks(bar: HTMLElement): Element[] {
  return Array.from(bar.children);
}

function filled(bar: HTMLElement): Element[] {
  return ticks(bar).filter((el) => (el.getAttribute('class') ?? '').split(/\s+/).includes('bg-emerald-500'));
}

afterEach(() => {
  cleanup();
});

describe('DecisionProgressIndicator — the decision_progress shapes (objectui#12033)', () => {
  it('unanimous: one tick per approver, filled up to the approvals recorded', async () => {
    const bar = await renderIndicator({ behavior: 'unanimous', got: 1, need: 3 }, 2);

    expect(screen.getByText(row('progressApprovals', { got: 1, need: 3 }))).toBeTruthy();
    expect(screen.getByText(row('progressEligible', { count: 2 }))).toBeTruthy();
    expect(bar.getAttribute('aria-label')).toBe(row('progressBar'));
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('3');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(ticks(bar)).toHaveLength(3);
    expect(filled(bar)).toHaveLength(1);
    // Group ticks belong to `per_group` alone.
    expect(bar.nextElementSibling).toBeNull();
  });

  it('quorum (M-of-N): the ticks count the M threshold, the eligible N rides beside it', async () => {
    const bar = await renderIndicator({ behavior: 'quorum', got: 1, need: 2 }, 5);

    expect(screen.getByText(row('progressApprovals', { got: 1, need: 2 }))).toBeTruthy();
    expect(screen.getByText(row('progressEligible', { count: 5 }))).toBeTruthy();
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    // M ticks, not N: the bar is the threshold the engine finalizes on.
    expect(ticks(bar)).toHaveLength(2);
    expect(filled(bar)).toHaveLength(1);
    expect(bar.nextElementSibling).toBeNull();
  });

  it('quorum with no eligible count shows the tally alone', async () => {
    await renderIndicator({ behavior: 'quorum', got: 0, need: 2 });

    expect(screen.getByText(row('progressApprovals', { got: 0, need: 2 }))).toBeTruthy();
    expect(screen.queryByText(row('progressEligible', { count: 0 }))).toBeNull();
  });

  it('per_group (countersign): a tick per group, the satisfied ones filled, a badge per group, no eligible count', async () => {
    const bar = await renderIndicator(
      {
        behavior: 'per_group',
        got: 1,
        need: 2,
        groups: [
          { group: 'quality', got: 1, need: 1, satisfied: true },
          { group: 'production', got: 0, need: 2, satisfied: false },
        ],
      },
      3,
    );

    expect(screen.getByText(row('progressGroups', { got: 1, need: 2 }))).toBeTruthy();
    // The approver count describes approvals, not groups — never shown here.
    expect(screen.queryByText(row('progressEligible', { count: 3 }))).toBeNull();
    expect(ticks(bar)).toHaveLength(2);
    expect(filled(bar)).toHaveLength(1);

    const quality = screen.getByText('quality 1/1');
    const production = screen.getByText('production 0/2');
    expect(quality.getAttribute('title')).toBe('1/1');
    expect(production.getAttribute('title')).toBe('0/2');
    // Satisfied groups carry the check, open ones the hollow circle.
    expect(quality.querySelector('svg')?.getAttribute('class')).toMatch(/\blucide-check\b/);
    expect(production.querySelector('svg')?.getAttribute('class')).toMatch(/\blucide-circle\b/);
    // Both badges sit in the one group row that follows the bar.
    expect(quality.parentElement).toBe(bar.nextElementSibling);
    expect(production.parentElement).toBe(bar.nextElementSibling);
  });

  it('a tally past a dozen decisions is one continuous fill, not hairline ticks', async () => {
    const bar = await renderIndicator({ behavior: 'unanimous', got: 5, need: 20 });

    expect(bar.getAttribute('aria-valuemax')).toBe('20');
    expect(ticks(bar)).toHaveLength(1);
    const fill = ticks(bar)[0].firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('caps the progressbar value at the requirement', async () => {
    const bar = await renderIndicator({ behavior: 'quorum', got: 3, need: 2 });

    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(filled(bar)).toHaveLength(2);
  });
});
