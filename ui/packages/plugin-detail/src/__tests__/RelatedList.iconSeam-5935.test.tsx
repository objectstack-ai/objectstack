/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5935 — `RelatedList` takes the shared seam and KEEPS its `Inbox`.
 *
 * This file held the tree's only `split(/[-_\s]/)` and NO rename map. It now
 * calls `resolveIcon` from `@object-ui/components` and applies `?? Inbox`
 * itself:
 *
 *     function resolveIconComponent(name) { return resolveIcon(name) ?? Inbox; }
 *
 * ⭐ That one line IS the maintainer ruling of 2026-09-03 (comment 5523286738,
 * option C). The 2026-08-31 shape would have made the fallback a parameter of
 * the seam — `onUnresolvable: 'placeholder' | 'null'` — a domain that cannot
 * express `Inbox` at all, which is how the tree's four unresolvable behaviours
 * came to be measured and the parameter dropped. The fallback stays here,
 * visible, at the call site.
 *
 * RED BEFORE: the `home` row only — this site had no rename map, so `home`
 * reached the dead `Home` key and drew the `Inbox`. Every other row is green in
 * both worlds and pins that nothing moved.
 *
 * ## The trap this file is shaped around
 *
 * "`svg.lucide-file-text` is absent" is green against a component that threw
 * into an error boundary. So each describe opens with a row proving the
 * surface rendered, and every fallback row asserts `Inbox` POSITIVELY.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { RelatedList, RelatedToolbarButton } from '../RelatedList';

// Keep the data-table out of the way; the icons under test are drawn by
// RelatedList itself, above the renderer.
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, SchemaRenderer: () => null };
});

afterEach(cleanup);

function renderSection(icon?: string) {
  return render(
    <RelatedList
      title="Line Items"
      type="table"
      api="line_item"
      data={[{ id: '1', name: 'One' }]}
      {...(icon === undefined ? {} : { icon })}
    />,
  );
}

describe('RelatedList section header keeps its `Inbox` fallback (objectui#5935)', () => {
  it('CONTROL — the section renders, with its title', () => {
    renderSection('definitely-not-a-lucide-icon');
    expect(screen.getByText('Line Items')).toBeTruthy();
  });

  it('CONTROL — a resolvable name draws THAT glyph and NOT the fallback', () => {
    // Establishes that this header can show something other than `Inbox`,
    // which is what makes every `Inbox` row below a reading.
    const { container } = renderSection('file-text');
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
    expect(container.querySelector('svg.lucide-inbox')).toBeNull();
  });

  it('draws `Inbox` for an unresolvable name — unchanged', () => {
    const { container } = renderSection('definitely-not-a-lucide-icon');
    expect(container.querySelector('svg.lucide-inbox')).not.toBeNull();
    expect(screen.getByText('Line Items')).toBeTruthy();
  });

  it('draws `Inbox` when no icon is authored — unchanged', () => {
    const { container } = renderSection(undefined);
    expect(container.querySelector('svg.lucide-inbox')).not.toBeNull();
  });

  it('RED BEFORE — `home` now resolves here, through the shared rename', () => {
    // This site carried NO rename map. `home` drew the `Inbox` while four other
    // surfaces drew `House` — the sidebar-vs-elsewhere disagreement this card
    // exists to end. A widening: `Home` is not a live record key, so nothing
    // that resolved before stopped resolving.
    const { container } = renderSection('home');
    expect(container.querySelector('svg.lucide-house')).not.toBeNull();
    expect(container.querySelector('svg.lucide-inbox')).toBeNull();
  });

  it('still resolves the snake_case spelling this site already accepted', () => {
    // Green in both worlds — `split(/[-_\s]/)` already split on `_` here. It is
    // pinned because the shared tokeniser had to ADOPT this site's width rather
    // than the more common `split('-')`, and a narrowing would land right here.
    const { container } = renderSection('file_text');
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
  });
});

describe('RelatedList toolbar buttons keep the same `Inbox` (objectui#5935)', () => {
  const action = (icon?: string) => ({ name: 'export_rows', label: 'Export', icon }) as any;

  it('CONTROL — the button renders, with its label', () => {
    render(<RelatedToolbarButton action={action('definitely-not-a-lucide-icon')} onToolbarAction={() => {}} />);
    expect(screen.getByTestId('related-toolbar-action-export_rows')).toBeTruthy();
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('CONTROL — a resolvable name draws THAT glyph', () => {
    const { container } = render(
      <RelatedToolbarButton action={action('file-text')} onToolbarAction={() => {}} />,
    );
    expect(container.querySelector('svg.lucide-file-text')).not.toBeNull();
  });

  it('draws `Inbox` for an unresolvable name — unchanged', () => {
    const { container } = render(
      <RelatedToolbarButton action={action('definitely-not-a-lucide-icon')} onToolbarAction={() => {}} />,
    );
    expect(container.querySelector('svg.lucide-inbox')).not.toBeNull();
  });

  it('draws NO glyph when the action authors no icon — unchanged', () => {
    // ⚠️ A THIRD behaviour in this one file, and the reason the `Inbox` rows
    // above are not the whole story: this call site guards with
    // `action.icon ? ... : null`, so an ABSENT name draws nothing while an
    // unresolvable one draws `Inbox`. The seam answers `null` to both; the
    // difference is decided here.
    const { container } = render(
      <RelatedToolbarButton action={action(undefined)} onToolbarAction={() => {}} />,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('Export')).toBeTruthy();
  });
});
