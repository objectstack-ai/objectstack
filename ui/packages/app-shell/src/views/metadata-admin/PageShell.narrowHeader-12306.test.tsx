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
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageShell } from './PageShell';
import { StudioTitleRowProvider } from '../studio-design/studioTitleRow';

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
    expect(meta).toContainElement(screen.getByText('Access'));
    expect(meta).toContainElement(screen.getByText('Can be added'));
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

// objectstack#37455 put the page's Save and the AI assistant at the end of
// PageShell's rows under Studio; objectstack#37520 pins them there (S2) and
// the hairline before the assistant (N3). The surface hands the controls down
// through `StudioTitleRowProvider`; stubs stand in for them here.
const SAVE = (
  <button type="button" data-testid="studio-save">
    Save
  </button>
);
const ASSISTANT = (
  <button type="button" data-testid="topbar-ai-assistant">
    AI
  </button>
);

function renderUnderStudio(
  shell: Partial<React.ComponentProps<typeof PageShell>>,
  save: React.ReactNode = null,
) {
  render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/metadata/permission/showcase_contributor']}>
      <StudioTitleRowProvider save={save} assistant={ASSISTANT}>
        <PageShell entry={ENTRY as never} {...shell}>
          <div>body</div>
        </PageShell>
      </StudioTitleRowProvider>
    </MemoryRouter>,
  );
}

const testIds = (el: Element) =>
  Array.from(el.querySelectorAll('[data-testid]')).map((n) => n.getAttribute('data-testid'));

const ACTION = <button type="button" data-testid="page-action">Clone to customize</button>;

describe('PageShell under Studio: the page controls end its rows (objectstack#37520)', () => {
  it('the compact row: the page\'s actions, then Save, the hairline and the assistant, in the right-aligned group', () => {
    renderUnderStudio({ itemName: 'showcase_contributor', actions: ACTION }, SAVE);
    const meta = screen.getByTestId('page-shell-header-meta');
    const ai = within(meta).getByTestId('topbar-ai-assistant');
    const group = screen.getByTestId('page-action').parentElement as HTMLElement;
    expect(group).toContainElement(ai);
    expect(testIds(group)).toEqual(['page-action', 'studio-save', 'studio-title-row-divider', 'topbar-ai-assistant']);
    expect(screen.getAllByTestId('topbar-ai-assistant')).toHaveLength(1);
  });

  it('an embedded compact row (a page inside another page) draws neither Save nor the assistant', () => {
    renderUnderStudio({ itemName: 'showcase_contributor', actions: ACTION, embedded: true }, SAVE);
    expect(screen.getByTestId('page-shell-header-meta')).toContainElement(screen.getByTestId('page-action'));
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(screen.queryByTestId('topbar-ai-assistant')).toBeNull();
    expect(screen.queryByTestId('studio-title-row-divider')).toBeNull();
  });

  it('an embedded list row draws neither either', () => {
    renderUnderStudio({ actions: ACTION, embedded: true }, SAVE);
    expect(screen.getByTestId('page-action')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(screen.queryByTestId('topbar-ai-assistant')).toBeNull();
  });

  it.each([
    ['compact', { itemName: 'showcase_contributor' }],
    ['list', {}],
  ] as const)('N3 — a %s row with no stats, no actions and nothing unsaved: the assistant, no hairline before it', (_row, shell) => {
    renderUnderStudio(shell);
    expect(screen.getByTestId('topbar-ai-assistant')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-title-row-divider')).toBeNull();
  });

  it.each([
    ['compact', { itemName: 'showcase_contributor' }],
    ['list', {}],
  ] as const)('N3 CONTROL — a %s row with stats of its own: the hairline before the assistant', (_row, shell) => {
    renderUnderStudio({ ...shell, stats: [{ label: 'Objects granted', value: 9 }] });
    const ai = screen.getByTestId('topbar-ai-assistant');
    expect(ai.previousElementSibling).toHaveAttribute('data-testid', 'studio-title-row-divider');
  });

  // ResourceEditPage's embedded frame passes actions without `embedded`: the
  // actions alone, with no stats and nothing unsaved, bring the hairline.
  it.each([
    ['compact', { itemName: 'showcase_contributor' }],
    ['list', {}],
  ] as const)('N3 CONTROL — a %s row with actions of its own and no stats: the hairline before the assistant', (_row, shell) => {
    renderUnderStudio({ ...shell, actions: ACTION });
    const ai = screen.getByTestId('topbar-ai-assistant');
    expect(screen.queryByTestId('studio-save')).toBeNull();
    expect(ai.previousElementSibling).toHaveAttribute('data-testid', 'studio-title-row-divider');
    expect(testIds(screen.getByTestId('page-action').parentElement as HTMLElement)).toEqual([
      'page-action',
      'studio-title-row-divider',
      'topbar-ai-assistant',
    ]);
  });

  it('N3 CONTROL — no actions but unsaved edits: Save, then the hairline, then the assistant', () => {
    renderUnderStudio({ itemName: 'showcase_contributor' }, SAVE);
    const ai = screen.getByTestId('topbar-ai-assistant');
    expect(testIds(ai.parentElement as HTMLElement)).toEqual(['studio-save', 'studio-title-row-divider', 'topbar-ai-assistant']);
  });
});
