// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12306 — the compact (detail page) header of every metadata admin
 * page must WRAP when its content does not fit, never squeeze the breadcrumb.
 *
 * Measured in Chromium at an 820x900 window on the permission set editor
 * (`.../metadata/permission/showcase_contributor`), before the fix: the header
 * was a no-wrap row whose `shrink-0` chip, stat and action groups left the
 * `min-w-0` breadcrumb 0px wide, and the breadcrumb's own `shrink-0` links
 * painted underneath the SECURITY and create-only chips and the subtitle — the
 * row a browser-pass runner read as "All Metadata T…SECURITY Pe create-only P…".
 * After the fix the breadcrumb keeps a line of its own and the chips, stats and
 * actions move below it. At widths where everything fits, the header renders
 * exactly as before.
 *
 * happy-dom lays nothing out, so this pins the CLASS CONTRACT that lets the
 * browser wrap; the before/after browser measurement is on the pull request.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageShell } from './PageShell';

afterEach(cleanup);

const ENTRY = {
  type: 'permission',
  label: 'Permission Set',
  domain: 'security',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
} as const;

function renderCompactHeader() {
  render(
    <MemoryRouter initialEntries={['/apps/setup/metadata/permission/showcase_contributor']}>
      <PageShell
        entry={ENTRY as never}
        itemName="showcase_contributor"
        subtitle="Permission set"
        stats={[
          { label: 'Objects granted', value: 9 },
          { label: 'Field overrides', value: 0 },
        ]}
        actions={<button type="button">Clone to customize</button>}
      >
        <div>body</div>
      </PageShell>
    </MemoryRouter>,
  );
  const item = screen.getByText('showcase_contributor');
  const nav = item.closest('nav') as HTMLElement;
  const row = nav.parentElement as HTMLElement;
  return { item, nav, row };
}

const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean);

describe('PageShell compact header wraps instead of squeezing the breadcrumb (objectui#12306)', () => {
  it('the header row is a wrapping flex row', () => {
    const { row } = renderCompactHeader();
    expect(classes(row)).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
    expect(classes(row)).not.toContain('flex-nowrap');
  });

  it('everything after the breadcrumb travels as ONE cluster, so it moves below the breadcrumb as a whole', () => {
    const { nav, row } = renderCompactHeader();
    expect(row.children).toHaveLength(2);
    expect(row.firstElementChild).toBe(nav);
    const meta = screen.getByTestId('page-shell-header-meta');
    expect(nav.nextElementSibling).toBe(meta);
    // The chips, the subtitle, the stats and the actions all live in it.
    expect(meta).toContainElement(screen.getByText('Security'));
    expect(meta).toContainElement(screen.getByText('create-only'));
    expect(meta).toContainElement(screen.getByText('Permission set'));
    expect(meta).toContainElement(screen.getByText('Objects granted'));
    expect(meta).toContainElement(screen.getByRole('button', { name: 'Clone to customize' }));
  });

  it('the cluster keeps a content-sized basis (`flex-auto`, not `flex-1`) and wraps within itself', () => {
    renderCompactHeader();
    const meta = classes(screen.getByTestId('page-shell-header-meta'));
    // `flex-1` is `flex: 1 1 0%`: a zero basis always "fits" beside the
    // breadcrumb, so the row would never wrap and the squeeze would return.
    expect(meta).toEqual(expect.arrayContaining(['flex-auto', 'flex-wrap', 'min-w-0']));
    expect(meta).not.toContain('flex-1');
    expect(meta).not.toContain('shrink-0');
  });

  it('the breadcrumb may narrow only by truncating the item name', () => {
    const { item, nav } = renderCompactHeader();
    expect(classes(nav)).toContain('min-w-0');
    expect(classes(item)).toContain('truncate');
    expect(item).toHaveAttribute('title', 'showcase_contributor');
  });

  it('stats and actions stay right-aligned on whichever line they land, and wrap among themselves', () => {
    renderCompactHeader();
    const actions = screen.getByRole('button', { name: 'Clone to customize' }).parentElement as HTMLElement;
    expect(actions).toContainElement(screen.getByText('Objects granted'));
    expect(classes(actions)).toEqual(expect.arrayContaining(['ml-auto', 'flex-wrap', 'justify-end']));
    expect(classes(actions)).not.toContain('shrink-0');
  });
});
