/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5935 — `ViewSwitcher` takes the shared seam and KEEPS its `null`.
 *
 * This file carried its own `toPascalCase` + `iconNameMap` + `icons[...]` — the
 * fourth copy of `resolve-icon.ts`, and the one that sat outside an earlier
 * grep's pathspec and so was missed by a count that called itself measured. It
 * now imports `resolveIcon` from `@object-ui/components`.
 *
 * Two `null` behaviours live here and they are DIFFERENT, so both are pinned:
 *
 *   - a VIEW whose authored `icon` does not resolve draws no glyph at all
 *     (`getViewIcon` only falls back to `DEFAULT_VIEW_ICONS` when no `icon` is
 *     authored — an authored-but-dead name is not the same input as none);
 *   - a VIEW ACTION whose authored `icon` does not resolve falls back to
 *     `DEFAULT_VIEW_ACTION_ICONS[action.type]`, at the call site, via `||`.
 *
 * Collapsing those two into one would be exactly the "the seam decides the
 * fallback" shape the 2026-09-03 ruling (option C) refused.
 *
 * RED BEFORE: the `layout_dashboard` row only. This site's `split('-')` turned
 * it into the dead key `Layout_dashboard`. Every other row is green in both
 * worlds and pins that nothing moved.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ViewSwitcher } from '../ViewSwitcher';
import type { ViewSwitcherSchema } from '@object-ui/types';

// Mirrors `ViewSwitcher.test.tsx`: avoids the circular dependency and the
// data-invalidation bus `@object-ui/components` touches at module-eval time.
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

afterEach(cleanup);

const views = (icon?: string): ViewSwitcherSchema => ({
  type: 'view-switcher',
  variant: 'buttons',
  views: [{ type: 'grid', label: 'Grid', ...(icon === undefined ? {} : { icon }) }],
} as unknown as ViewSwitcherSchema);

const withAction = (icon: string): ViewSwitcherSchema => ({
  type: 'view-switcher',
  variant: 'buttons',
  views: [{ type: 'grid', label: 'Grid' }],
  viewActions: [{ type: 'share', icon }],
} as unknown as ViewSwitcherSchema);

describe('ViewSwitcher view icons keep their `null` (objectui#5935)', () => {
  it('CONTROL — the switcher renders its view button and label', () => {
    render(<ViewSwitcher schema={views('definitely-not-a-lucide-icon')} />);
    expect(screen.getByText('Grid')).toBeTruthy();
  });

  it('CONTROL — a resolvable authored name really does draw THAT glyph', () => {
    // Establishes the instrument can see a glyph here, and that the glyph is
    // the AUTHORED one rather than `DEFAULT_VIEW_ICONS.grid` (`Grid3x3`).
    const { container } = render(<ViewSwitcher schema={views('file-text')} />);
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
    expect(container.querySelector('svg.lucide-grid-3x3')).toBeNull();
  });

  it('draws NO glyph for an authored name that does not resolve — unchanged', () => {
    // ⚠️ Specifically NOT the type default: an authored-but-dead name is a
    // different input from no name, and `getViewIcon` has always distinguished
    // them. Pinned so a later "tidy-up" that reaches for the default is a
    // deliberate decision.
    const { container } = render(<ViewSwitcher schema={views('definitely-not-a-lucide-icon')} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Grid')).toBeTruthy();
  });

  it('falls back to the TYPE default when no icon is authored — unchanged', () => {
    const { container } = render(<ViewSwitcher schema={views(undefined)} />);
    expect(container.querySelector('svg.lucide-grid-3x3')).not.toBeNull();
  });

  it('RED BEFORE — `layout_dashboard` now resolves here', () => {
    const { container } = render(<ViewSwitcher schema={views('layout_dashboard')} />);
    expect(container.querySelector('svg.lucide-layout-dashboard')).not.toBeNull();
  });

  it('keeps the `Home` -> `House` rename it already carried', () => {
    const { container } = render(<ViewSwitcher schema={views('home')} />);
    expect(container.querySelector('svg.lucide-house')).not.toBeNull();
  });
});

describe('ViewSwitcher ACTION icons keep their own `||` default (objectui#5935)', () => {
  it('CONTROL — a resolvable action icon draws the AUTHORED glyph, not the default', () => {
    const { container } = render(<ViewSwitcher schema={withAction('file-text')} />);
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
    expect(container.querySelector('svg.lucide-share-2')).toBeNull();
  });

  it('falls back to the action-type default when the name does not resolve — unchanged', () => {
    // `DEFAULT_VIEW_ACTION_ICONS.share` is `Share2`. This is the SECOND of this
    // file's two `null` behaviours, and it lives at the call site — the seam
    // returns `null` and the `||` here decides what that means.
    const { container } = render(<ViewSwitcher schema={withAction('definitely-not-a-lucide-icon')} />);
    expect(container.querySelector('svg.lucide-share-2')).not.toBeNull();
  });
});
