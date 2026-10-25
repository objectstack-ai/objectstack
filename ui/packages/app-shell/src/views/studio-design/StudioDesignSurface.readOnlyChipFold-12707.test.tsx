// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12707 — the read-only link at the end of an item's tab row folds to
 * its layers glyph when the row cannot hold it whole, instead of being cut to
 * "Rea" at the row's scrolled edge. Folded, its text stays its accessible name
 * and its title stays its tooltip; it links to the same place in both forms.
 * The tab labels keep `nowrap` and the row keeps its sideways scroll
 * (objectui#12611).
 *
 * The REAL `AutomationsPillar` over a read-only package with a flow open. jsdom
 * has no layout, so the tab row's geometry is stubbed: the row's width is the
 * case's, each tab has a fixed width laid out from the row's start, and the
 * link is as wide as its form (full or folded). The fold reads only that
 * geometry, so the row width alone decides it. Gaps and paddings read 0 here
 * (no stylesheet); the browser readings are in the pull request.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Workflow } from 'lucide-react';

const PKG = 'com.acme.readonly';

const FLOW = {
  name: 'enroll_members',
  label: 'Enroll Members in Campaign',
  type: 'screen',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const server = vi.hoisted(() => ({ active: new Map<string, Record<string, unknown>>() }));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  const client = {
    withPreviewDrafts: vi.fn((): unknown => client),
    list: vi.fn(async (type: string) =>
      [...server.active.entries()].filter(([key]) => key.startsWith(`${type}/`)).map(([, row]) => row),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: eff, overlay: null, overlayScope: null, effective: eff, editable: false, deletable: false, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async () => ({})),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
  return client;
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { StudioItemHeader, StudioTab, useStudioTabRowFold } from './StudioItemHeader';
import { STUDIO_STATUS_TEXT_FOLD, STUDIO_TAB, STUDIO_TAB_ROW } from './studio-tokens';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

const LINK = t('engine.studio.pkg.readonlyLink', 'en');
const HINT = t('engine.studio.pkg.readonlyHint', 'en');
const HREF = `/apps/setup/metadata?package=${PKG}`;

/** Stubbed widths: a tab is as wide as its label suggests; the link by its form. */
const TAB_WIDTH = 80;
const LINK_FULL = 250;
const LINK_FOLDED = 28;
const layout = { row: 800 };

const spies: Array<{ mockRestore: () => void }> = [];
const resizeCallbacks = new Set<() => void>();
const realRect = HTMLElement.prototype.getBoundingClientRect;
const rect = (left: number, width: number) =>
  ({ left, right: left + width, width, top: 0, bottom: 36, height: 36, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

/** The tab row a probe or a link sits in: the `nav` the header draws. */
const isTabRow = (el: Element) => el.tagName === 'NAV';

beforeEach(() => {
  server.active.clear();
  server.active.set(`flow/${FLOW.name}`, FLOW);
  layout.row = 800;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        resizeCallbacks.add(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.cb);
      }
    },
  );
  spies.push(vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (isTabRow(this)) return rect(0, layout.row);
    const parent = this.parentElement;
    if (parent && isTabRow(parent) && this.tagName === 'BUTTON') {
      const index = Array.from(parent.children).indexOf(this);
      return rect(index * TAB_WIDTH, TAB_WIDTH);
    }
    if (this.dataset.testid === 'studio-readonly-link' || this.dataset.testid === 'probe-chip') {
      return rect(0, this.hasAttribute('data-folded') ? LINK_FOLDED : LINK_FULL);
    }
    return realRect.call(this);
  }));
  spies.push(
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return isTabRow(this) ? layout.row : 0;
    }),
  );
});

afterEach(() => {
  cleanup();
  resizeCallbacks.clear();
  // Only this file's spies: `failOnAbsorbedFetchError` reads its own after this.
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.unstubAllGlobals();
});

async function renderReadOnlyFlow(): Promise<HTMLElement> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly />
    </MemoryRouter>,
  );
  await screen.findByTestId('auto-tab-canvas', undefined, { timeout: 8000 });
  return screen.findByTestId('studio-readonly-link');
}

/** The row resizes: the observer the fold registered measures it again. */
function resizeRow(width: number) {
  layout.row = width;
  act(() => {
    for (const cb of resizeCallbacks) cb();
  });
}

const labelOf = (link: HTMLElement) => link.querySelector('span') as HTMLElement;

describe('the read-only link at the tab row’s end folds to its glyph (objectui#12707)', () => {
  it('at an 800 px tab row it shows whole', async () => {
    const link = await renderReadOnlyFlow();
    // The link sits in the tab row, after the tabs.
    expect(link.closest('nav')).toBe(screen.getByTestId('auto-tab-canvas').parentElement);
    expect(link).not.toHaveAttribute('data-folded');
    expect(labelOf(link)).toHaveTextContent(LINK);
    expect(labelOf(link)).not.toHaveClass('sr-only');
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveAccessibleName(LINK);
  });

  it('at a 560 px tab row it is its glyph alone; its text is its accessible name, its title the tooltip, its target the same', async () => {
    layout.row = 560;
    const link = await renderReadOnlyFlow();
    expect(link).toHaveAttribute('data-folded', 'true');
    expect(link.querySelector('svg')).not.toBeNull();
    expect(labelOf(link)).toHaveClass('sr-only');
    expect(link).toHaveAccessibleName(LINK);
    expect(link).toHaveAttribute('title', HINT);
    expect(link).toHaveAttribute('href', HREF);
  });

  it('it follows the row: folds when the row narrows, unfolds when it widens again', async () => {
    const link = await renderReadOnlyFlow();
    expect(link).not.toHaveAttribute('data-folded');
    resizeRow(560);
    expect(link).toHaveAttribute('data-folded', 'true');
    resizeRow(800);
    expect(link).not.toHaveAttribute('data-folded');
    expect(link).toHaveAttribute('href', HREF);
  });

  it('at a 560 px tab row the tab labels stay whole on one line and the row still scrolls sideways', async () => {
    layout.row = 560;
    const link = await renderReadOnlyFlow();
    const nav = link.closest('nav') as HTMLElement;
    expect(nav).toHaveClass(...STUDIO_TAB_ROW.split(' '));
    expect(nav).toHaveClass('overflow-x-auto');
    const tabs = Array.from(nav.querySelectorAll('button'));
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    for (const tab of tabs) {
      expect(tab).toHaveClass(...STUDIO_TAB.split(' '));
      expect(tab).toHaveClass('whitespace-nowrap', 'shrink-0');
    }
    expect(screen.getByTestId('auto-tab-canvas')).toHaveTextContent(t('engine.studio.if.tabCanvas', 'en'));
  });
});

/** A chip that folds by the shared rule, placed by the case. */
function Probe() {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const folded = useStudioTabRowFold(ref, 'Read-only');
  return (
    <span ref={ref} data-testid="probe-chip" data-folded={folded || undefined}>
      Read-only
    </span>
  );
}

describe('the fold belongs to the tab row alone (objectui#12707)', () => {
  // objectui#12897 — in a title row's actions slot the chip folds by another
  // rule: only when the title would otherwise be cut. This title is not cut
  // (no layout here, and no stub for the title row), so the tab row's width
  // alone does not fold it; `StudioItemHeader.titleRowFold-12897.test.tsx`
  // pins the title row's rule.
  it('CONTROL — the same chip in a title row’s actions slot does not fold by the tab row’s width', () => {
    layout.row = 100;
    render(<StudioItemHeader icon={Workflow} title="Item" actions={<Probe />} />);
    expect(screen.getByTestId('probe-chip')).not.toHaveAttribute('data-folded');
  });

  it('the same chip at a tab row’s end folds by the same rule', () => {
    layout.row = 100;
    render(
      <StudioItemHeader
        icon={Workflow}
        title="Item"
        tabs={
          <>
            <StudioTab active>One</StudioTab>
            <span className="ml-auto flex items-center self-center pl-3">
              <Probe />
            </span>
          </>
        }
      />,
    );
    expect(screen.getByTestId('probe-chip')).toHaveAttribute('data-folded', 'true');
  });

  it('CONTROL — the Unpublished draft chip already folds its text by objectui#12611: whole-word only, never cut', () => {
    render(<StudioItemHeader icon={Workflow} title="Item" status={{ label: 'Unpublished draft' }} />);
    const chip = screen.getByTestId('studio-item-status');
    expect(chip).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(chip.querySelector('[data-slot="status-text"]')).toHaveClass(...STUDIO_STATUS_TEXT_FOLD.split(' '));
  });
});
