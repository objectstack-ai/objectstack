// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 — the Access pillar's permission-set list shows a set's label
 * as the primary text and its machine name as secondary text.
 *
 * On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」:
 *
 *  - a set with a label reads as the label, with its machine name beneath it
 *    (small, monospace), and the row's accessible name stays the label;
 *  - CONTROL: a set with no label reads as its name alone, once;
 *  - a set that exists only as a draft reads as the label its `_drafts` row
 *    carries (objectstack-ai/objectstack#22200, ruling `6053526025` question 1),
 *    with its machine name beneath it. The label is read off that row: the
 *    set itself is not read for it;
 *  - a draft's locale-map label reads in the designer locale, never as
 *    `[object Object]`;
 *  - CONTROL: a draft whose `_drafts` row carries no label (`null`, the
 *    producer's honest answer) reads as its name alone, once.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockClient = {
  list: vi.fn(async (type: string) => {
    if (type === 'permission') return [{ name: 'technician', label: 'Technician' }, { name: 'field_lead' }];
    if (type === 'object') return [{ name: 'a_account' }];
    return [];
  }),
  // Draft-only sets: each `_drafts` row carries the draft body's own label,
  // or `null` when the body declares none (objectstack-ai/objectstack#22200).
  listDrafts: vi.fn(async () => [
    { type: 'permission', name: 'dispatcher', packageId: 'app.a', label: 'Dispatcher' },
    { type: 'permission', name: 'night_shift', packageId: 'app.a', label: { en: 'Night shift', 'zh-CN': '夜班' } },
    { type: 'permission', name: 'auditor', packageId: 'app.a', label: null },
  ]),
  layered: vi.fn(async (_type: string, name: string) => ({
    effective: { name, label: name === 'technician' ? 'Technician' : undefined, objects: {}, fields: {} },
    code: null,
    overlay: null,
    overlayScope: null,
  })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { AccessPillar } from './StudioDesignSurface';

// jsdom has no matchMedia — useIsMobile (rail overlay) needs a stub.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

afterEach(cleanup);

function renderPillar() {
  render(
    <MemoryRouter>
      <AccessPillar packageId="app.a" />
    </MemoryRouter>,
  );
}

describe('objectui#11862 — the permission-set list: label first, machine name second', () => {
  it('a set with a label reads as the label, its machine name as secondary text', async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'Technician' });
    expect(within(row).getByText('Technician')).toBeInTheDocument();
    expect(within(row).getByText('technician')).toHaveClass('font-mono', 'text-[10px]');
    expect(within(row).getByText('technician')).toHaveAttribute('aria-hidden', 'true');
  });

  it('CONTROL: a set with no label reads as its name alone, once', async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'field_lead' });
    expect(within(row).getAllByText('field_lead')).toHaveLength(1);
  });

  it("a draft-only set reads as its `_drafts` row's label, its machine name as secondary text", async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'Dispatcher' });
    expect(within(row).getByText('Dispatcher')).toBeInTheDocument();
    expect(within(row).getByText('dispatcher')).toHaveClass('font-mono', 'text-[10px]');
    expect(within(row).getByText('dispatcher')).toHaveAttribute('aria-hidden', 'true');
    // Read off the row: the draft-only set is never read for its label.
    const reads = [...mockClient.layered.mock.calls, ...mockClient.getDraft.mock.calls, ...mockClient.get.mock.calls];
    expect(reads.filter((call) => (call as unknown[])[1] === 'dispatcher')).toEqual([]);
  });

  it("a draft's locale-map label reads in the designer locale", async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'Night shift' });
    expect(within(row).getByText('night_shift')).toHaveClass('font-mono');
    expect(row).not.toHaveTextContent('[object Object]');
  });

  it('CONTROL: a draft whose `_drafts` row carries no label reads as its name alone, once', async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'auditor' });
    expect(within(row).getAllByText('auditor')).toHaveLength(1);
  });
});
