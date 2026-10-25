/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5935 — this package's TWO icon call sites take the shared seam and
 * KEEP their own fallbacks.
 *
 * | surface            | draws when the name does not resolve |
 * |--------------------|--------------------------------------|
 * | `TabBar`           | nothing (`null`)                     |
 * | `ListView` empty   | the `Inbox` glyph                    |
 *
 * That split is the maintainer ruling of 2026-09-03 (comment 5523286738,
 * verbatim 「同意你的建议」, option C) taken over the 2026-08-31 shape, which
 * would have moved the decision onto the seam as an `onUnresolvable` parameter.
 * The seam answers `name -> component | null` and nothing else; what a surface
 * draws for `null` stays at the surface, visibly.
 *
 * ## Which rows discriminate, stated so a green run is not over-read
 *
 * - **RED BEFORE.** The `home` row on `TabBar` and the `layout_dashboard` row
 *   on `ListView`. Both sites used `split('-')` with NO rename map, so `home`
 *   reached a dead `Home` key and `layout_dashboard` reached a dead
 *   `Layout_dashboard`. Both rendered the fallback. They are the widening this
 *   card ships, and the only rows here whose answer changed.
 * - **GREEN IN BOTH WORLDS.** Every fallback row. They are not evidence the
 *   consolidation is right — they are the guard that it changed nothing, which
 *   is this card's whole acceptance criterion.
 *
 * ## ⚠️ The trap these suites are shaped around
 *
 * A fallback row asserting "no `svg.lucide-file-text` is present" passes just
 * as well against a component that never rendered — an error boundary and a
 * missing glyph look identical to that query. So every fallback row sits in a
 * describe whose FIRST row proves the surface rendered, and asserts the
 * fallback POSITIVELY (`svg.lucide-inbox` is there) rather than only asserting
 * an absence.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { TabBar, type ViewTab } from '../components/TabBar';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

afterEach(cleanup);

// ── TabBar — keeps `null` ────────────────────────────────────────────────────

const tab = (icon?: string): ViewTab[] => [{ name: 'open', label: 'Open', icon } as ViewTab];

describe('TabBar keeps its `null` (objectui#5935)', () => {
  it('CONTROL — the tab bar renders, with its label, whatever the icon does', () => {
    render(<TabBar tabs={tab('definitely-not-a-lucide-icon')} />);
    expect(screen.getByTestId('view-tabs')).toBeTruthy();
    expect(screen.getByTestId('view-tab-open')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
  });

  it('CONTROL — a resolvable name really does draw a glyph here', () => {
    // Without this, "draws no glyph" below would be green against a TabBar that
    // never draws one at all.
    const { container } = render(<TabBar tabs={tab('file-text')} />);
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
  });

  it('draws NO glyph for an unresolvable name — unchanged', () => {
    const { container } = render(<TabBar tabs={tab('definitely-not-a-lucide-icon')} />);
    expect(container.querySelector('svg')).toBeNull();
    // …and the pill itself is still there, so the absence above is about the
    // glyph and not about the render.
    expect(screen.getByTestId('view-tab-open').textContent).toContain('Open');
  });

  it('draws NO glyph when no icon is authored — unchanged', () => {
    const { container } = render(<TabBar tabs={tab(undefined)} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByTestId('view-tab-open')).toBeTruthy();
  });

  it('RED BEFORE — `home` now resolves here, through the shared rename', () => {
    // This site carried `split('-')` and NO rename map, so `home` reached the
    // dead `Home` key and drew nothing while four other surfaces drew `House`.
    // A widening, never a regression: `Home` is not a live record key, so
    // nothing that resolved before stopped.
    const { container } = render(<TabBar tabs={tab('home')} />);
    expect(container.querySelector('svg.lucide-house')).not.toBeNull();
  });

  it('RED BEFORE — a snake_case name resolves here too', () => {
    const { container } = render(<TabBar tabs={tab('file_text')} />);
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
  });
});

// ── ListView empty state — keeps `Inbox` ─────────────────────────────────────

function emptyDataSource() {
  return {
    find: vi.fn().mockResolvedValue([]),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

async function emptyState(icon?: string): Promise<HTMLElement> {
  const ds = emptyDataSource();
  const schema = {
    type: 'list-view',
    objectName: 'work_order',
    fields: ['name'],
    ...(icon === undefined ? {} : { emptyState: { icon } }),
  } as unknown as ListViewSchema;
  const { container } = render(
    <SchemaRendererProvider dataSource={ds as any}>
      <ListView schema={schema} dataSource={ds as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
  });
  return container.querySelector('[data-testid="empty-state"]') as HTMLElement;
}

describe('ListView empty state keeps its `Inbox` fallback (objectui#5935)', () => {
  it('CONTROL — the empty state renders, and a resolvable name draws THAT glyph', () => {
    // Both halves in one row on purpose: it establishes that this surface can
    // show a non-`Inbox` glyph, which is what makes every `Inbox` row below a
    // reading rather than a tautology.
    return emptyState('file-text').then((state) => {
      expect(state).not.toBeNull();
      expect(state.querySelector('svg.lucide-file-text')).not.toBeNull();
      expect(state.querySelector('svg.lucide-inbox')).toBeNull();
    });
  });

  it('draws `Inbox` for an unresolvable name — unchanged', async () => {
    const state = await emptyState('definitely-not-a-lucide-icon');
    expect(state.querySelector('svg.lucide-inbox')).not.toBeNull();
  });

  it('draws `Inbox` when no empty-state icon is authored — unchanged', async () => {
    const state = await emptyState(undefined);
    expect(state.querySelector('svg.lucide-inbox')).not.toBeNull();
  });

  it('RED BEFORE — `layout_dashboard` now resolves instead of falling back', async () => {
    // The enumeration's own named case. This site's inline `split('-')` turned
    // it into the dead key `Layout_dashboard` and drew `Inbox`.
    const state = await emptyState('layout_dashboard');
    expect(state.querySelector('svg.lucide-layout-dashboard')).not.toBeNull();
    expect(state.querySelector('svg.lucide-inbox')).toBeNull();
  });
});
