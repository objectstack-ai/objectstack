// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 (the remainder) — the nav-target label resolver names a
 * draft-only target by the label its `_drafts` row carries.
 *
 * On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」, and the seat
 * ruling `6053526025` question 1 (A, at the producer): each `_drafts` row
 * carries the draft body's own label, or `null` (objectstack-ai/objectstack#22200).
 * A label-less nav entry inherits its target's CURRENT label (the runtime's
 * rule, `useNavTargetLabel`), and a host that holds the pending drafts hands
 * them to that resolver as its last rung through `DraftTargetLabels`.
 *
 * Moved out of `StudioDesignSurface.navDraftLabels-11862.test.tsx` when
 * objectstack#36502 retired the Interfaces pillar: its whole-surface and
 * nav-item inspector pins went with the pillar, and the resolver's pins stay.
 *
 *  - a draft-only object answers its `_drafts` row's label;
 *  - the published label still wins where the console's metadata has one;
 *  - a row stored under a plural type spelling is folded, as every `/meta`
 *    reader folds it;
 *  - CONTROL: with no provider the resolver answers as it did.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { DraftTargetLabels, useNavTargetLabel } from './useNavTargetLabel';

/** The package's `_drafts` rows, as objectstack serves them since #22200. */
const DRAFT_ROWS = [
  { type: 'object', name: 'repairs_ticket', packageId: 'com.acme.app', label: 'Repair Ticket', updatedAt: null, updatedBy: null },
  { type: 'dashboard', name: 'ops_board', packageId: 'com.acme.app', label: 'Ops board', updatedAt: null, updatedBy: null },
  { type: 'object', name: 'b2r4_bare', packageId: 'com.acme.app', label: null, updatedAt: null, updatedBy: null },
];

/** The host's metadata cache: published only, so no draft-only target is in it. */
const METADATA = {
  apps: [],
  objects: [{ name: 'b2r4_customer', label: 'Customers' }],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

afterEach(() => {
  cleanup();
});

describe('objectui#11862 — the resolver the nav editor asks: the draft label is the last rung', () => {
  function Probe({ target }: { target: Parameters<ReturnType<typeof useNavTargetLabel>>[0] }) {
    const resolve = useNavTargetLabel();
    return <output data-testid="probe">{resolve(target) ?? '(none)'}</output>;
  }

  function probe(target: Parameters<ReturnType<typeof useNavTargetLabel>>[0], drafts: unknown[]) {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <DraftTargetLabels.Provider value={drafts as never}>
          <Probe target={target} />
        </DraftTargetLabels.Provider>
      </MetadataCtx.Provider>,
    );
    return screen.getByTestId('probe').textContent;
  }

  it("a draft-only object answers its `_drafts` row's label", () => {
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, DRAFT_ROWS)).toBe('Repair Ticket');
  });

  it('the published label still wins over a pending draft of the same object', () => {
    const drafts = [{ type: 'object', name: 'b2r4_customer', label: 'Draft customers' }];
    expect(probe({ kind: 'object', objectName: 'b2r4_customer' }, drafts)).toBe('Customers');
  });

  it('a row stored under a plural type spelling is folded to its singular type', () => {
    const drafts = [{ type: 'objects', name: 'repairs_ticket', label: 'Repair Ticket' }];
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, drafts)).toBe('Repair Ticket');
  });

  it("a draft of another type does not name the target", () => {
    const drafts = [{ type: 'dashboard', name: 'repairs_ticket', label: 'Not this one' }];
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, drafts)).toBe('(none)');
  });

  it('CONTROL: with no provider the resolver answers as it did — nothing for a target the metadata lacks', () => {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <Probe target={{ kind: 'object', objectName: 'repairs_ticket' }} />
      </MetadataCtx.Provider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('(none)');
  });
});
