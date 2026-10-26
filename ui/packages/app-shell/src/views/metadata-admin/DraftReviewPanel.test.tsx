/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ADR-0033 Phase B — the generic, type-agnostic draft↔published review/diff.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DraftReviewPanel, computeDraftChangeCount } from './DraftReviewPanel';

const published = { label: 'Accounts', object: 'account', columns: ['name'] };
//  label modified, columns modified, object removed, icon added
const draft = { label: 'All Accounts', columns: ['name', 'industry'], icon: 'building' };

describe('computeDraftChangeCount', () => {
  it('counts added + changed + removed top-level keys', () => {
    // label (changed), columns (changed), object (removed), icon (added) = 4
    expect(computeDraftChangeCount(published, draft)).toBe(4);
  });

  it('is 0 when draft equals published', () => {
    expect(computeDraftChangeCount(published, { ...published })).toBe(0);
  });

  it('treats a brand-new item (no published baseline) as all-added', () => {
    expect(computeDraftChangeCount(null, { a: 1, b: 2 })).toBe(2);
  });
});

describe('DraftReviewPanel', () => {
  it('renders one row per changed key and omits unchanged keys', () => {
    render(<DraftReviewPanel published={published} draft={draft} locale="en-US" />);
    const panel = screen.getByTestId('draft-review-panel');
    expect(panel).toBeTruthy();
    // changed/added/removed keys appear; an unchanged key would not — here all differ.
    expect(panel.textContent).toContain('label');
    expect(panel.textContent).toContain('columns');
    expect(panel.textContent).toContain('object'); // removed
    expect(panel.textContent).toContain('icon'); // added
    // status labels (en) render
    expect(panel.textContent).toMatch(/Added/);
    expect(panel.textContent).toMatch(/Removed/);
    expect(panel.textContent).toMatch(/Changed/);
  });

  it('shows the empty state when nothing differs', () => {
    render(<DraftReviewPanel published={published} draft={{ ...published }} locale="en-US" />);
    expect(screen.queryByTestId('draft-review-panel')).toBeNull();
    expect(screen.getByText(/No changes vs the published version/i)).toBeTruthy();
  });
});
