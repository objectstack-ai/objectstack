/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9299 — THE REPAIR, pinned where objectui#9113 measured the defect.
 *
 * This file REPLACES `ObjectTree.overlayShellControl-9113.test.tsx`, the CONTROL of
 * that measurement round. `ObjectTree` always carried the resolved mode across
 * the shell boundary — four authored values, four distinct boundary pairs —
 * and the control existed so the gantt/kanban/calendar reading of ONE pair
 * meant something. Two of its readings are now false by repair rather than by
 * regression, which is why it is replaced rather than kept:
 *
 *  - its `SECOND READING` pinned `expect(rendered.split).toBe(0)` — an
 *    authored `split` rendered NOTHING on this renderer, because the shell's
 *    split branch opens `if (!isOpen || !mainContent) return null` and this
 *    renderer passed no `mainContent`. That blank is ruling item 2.
 *  - `popover` reached the shell but with no anchor, so it degraded to the
 *    compact `Dialog` fallback. That is ruling item 3.
 *
 * ## Why the assertions are on the mode VALUE and not on a rendered drawer
 *
 * Measured on the base tree and unchanged by the repair:
 * `packages/components/src/ui/sheet.tsx` and `.../ui/dialog.tsx` BOTH import
 * `@radix-ui/react-dialog`, and neither stamps a `data-slot`. `drawer` and
 * `modal` therefore reach the DOM as the same Radix role, separated only by
 * Tailwind class strings — so `expect(drawer).toBeVisible()` reads the same
 * before and after this change and is blind to the defect BY CONSTRUCTION.
 *
 * The two instruments are objectui#9296's, reused so the two rounds are
 * comparable: a pass-through spy on `useNavigationOverlay` reporting what the
 * component RESOLVED, and a pass-through recorder on both shells reporting
 * what crossed the handoff. They used to DISAGREE, and the disagreement was
 * the defect. They agree now, and that agreement is the repair.
 */

import React from 'react';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import '@testing-library/jest-dom';

/** What the component RESOLVED, read off the real hook on its way through. */
const hookLog = vi.hoisted(() => ({
  calls: [] as Array<{ mode: string; isOverlay: boolean }>,
}));

/** What crossed the handoff into an overlay shell. */
const shellLog = vi.hoisted(() => ({
  entries: [] as Array<{
    shell: string;
    mode: unknown;
    carriesMode: boolean;
    hasMainContent: boolean;
    anchor: unknown;
    storageKey: unknown;
    legacyStorageKey: unknown;
  }>,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useNavigationOverlay: (options: any) => {
      const state = actual.useNavigationOverlay(options);
      hookLog.calls.push({ mode: state.mode, isOverlay: state.isOverlay });
      return state;
    },
  };
});

/**
 * BOTH shells are recorded, not just the one this renderer uses today.
 * Recording only `NavigationOverlay` would leave "and `RecordDetailDrawer` is
 * no longer reached" as an assumption; recorded, it is a reading.
 */
vi.mock('@object-ui/plugin-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/plugin-detail')>();
  return {
    ...actual,
    RecordDetailDrawer: (props: any) => {
      shellLog.entries.push({
        shell: 'RecordDetailDrawer',
        mode: props?.mode,
        carriesMode: props != null && 'mode' in props,
        hasMainContent: false,
        anchor: undefined,
        storageKey: undefined,
        legacyStorageKey: undefined,
      });
      return null;
    },
    deriveRecordPageHref: () => null,
  };
});

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/components')>();
  const Real = actual.NavigationOverlay;
  return {
    ...actual,
    NavigationOverlay: (props: any) => {
      shellLog.entries.push({
        shell: 'NavigationOverlay',
        mode: props?.mode,
        carriesMode: props != null && 'mode' in props,
        hasMainContent: props?.mainContent != null,
        anchor: props?.popoverAnchorRef,
        storageKey: props?.storageKey,
        legacyStorageKey: props?.legacyStorageKey,
      });
      return <Real {...props} />;
    },
  };
});

import { ObjectTree } from './ObjectTree';

const ROWS = [
  { id: '1', name: 'Acme', parent_id: null },
  { id: '2', name: 'Engineering', parent_id: '1' },
];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'org_chart_node',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        parent_id: { name: 'parent_id', type: 'text' },
      },
    })),
  }) as any;

/**
 * Mount with one authored mode, click a node, hand back both readings.
 *
 * ⚠️ A DataSource is supplied — the control file handed rows through the `data`
 * prop and needed none. The shared payload renders the object's DECLARED
 * fields, so a tree with no object schema keeps the plain row reading instead
 * (the declared-fields gate in `ObjectTree`), and this file would then be
 * measuring the fallback rather than the shell.
 */
async function readingsFor(mode: string) {
  cleanup();
  hookLog.calls = [];
  shellLog.entries = [];
  render(
    <ObjectTree
      schema={
        {
          type: 'object-tree',
          objectName: 'org_chart_node',
          parentField: 'parent_id',
          labelField: 'name',
          fields: ['name'],
          data: { provider: 'object', object: 'org_chart_node' },
          navigation: { mode },
        } as never
      }
      dataSource={makeDataSource()}
    />,
  );
  const cell = await screen.findByText('Acme');
  fireEvent.click(cell);
  await waitFor(() => expect(shellLog.entries.length).toBeGreaterThan(0));
  return {
    resolved: hookLog.calls[hookLog.calls.length - 1],
    boundary: shellLog.entries[shellLog.entries.length - 1],
  };
}

const OVERLAY_MODES = ['drawer', 'modal', 'split', 'popover'] as const;

beforeEach(() => {
  hookLog.calls = [];
  shellLog.entries = [];
  try { window.localStorage.clear(); } catch { /* private mode */ }
  // The shared payload's `DetailView` asks `POST /api/v1/security/explain`
  // whether the record may be updated and deleted. With no host `apiFetch`
  // that degrades to the global `fetch`, which under happy-dom is a real HTTP
  // client — served from a double rather than the network. Nothing here reads
  // the verdict; `useRecordEditable` fails open either way.
  installRecordSecurityExplainDouble(vi);
});

afterEach(() => {
  // A request to any OTHER endpoint reds here rather than vanishing into
  // `useRecordEditable`'s best-effort `catch`.
  assertNoOtherNetworkEscape(expect);
  // Unmount BEFORE restoring the real `fetch` (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
});

describe('objectui#9299 — `ObjectTree` honours all four overlay modes through the shared shell', () => {
  it('LIT CONTROL: both instruments fire on a single mount', async () => {
    // First, because every assertion below reads a captured value. A recorder
    // that never fired would make "the shell received `modal`" vacuously
    // unfalsifiable rather than red.
    const r = await readingsFor('drawer');
    expect(hookLog.calls.length).toBeGreaterThan(0);
    expect(shellLog.entries.length).toBeGreaterThan(0);
    expect(r.resolved.isOverlay).toBe(true);
    expect(r.boundary.shell).toBe('NavigationOverlay');
  });

  it.each(OVERLAY_MODES)(
    'authored `%s` is resolved by the hook AND received by the shell',
    async (mode) => {
      const r = await readingsFor(mode);
      expect(r.resolved.mode).toBe(mode);
      expect(r.resolved.isOverlay).toBe(true);
      expect(r.boundary.shell).toBe('NavigationOverlay');
      expect(r.boundary.carriesMode).toBe(true);
      expect(r.boundary.mode).toBe(mode);
    },
  );

  it('⛔ `RecordDetailDrawer` is no longer reached, under any overlay mode', async () => {
    for (const mode of OVERLAY_MODES) {
      await readingsFor(mode);
      expect(shellLog.entries.map((e) => e.shell)).not.toContain('RecordDetailDrawer');
    }
  });

  it('⭐ THE REPAIR READING: four authored modes produce FOUR distinct boundary pairs', async () => {
    // The measurement round read ONE pair here, against the `ObjectTree`
    // control's four. Both numbers are four now.
    const pairs: string[] = [];
    const resolvedModes: string[] = [];
    for (const mode of OVERLAY_MODES) {
      const r = await readingsFor(mode);
      pairs.push(`${r.boundary.shell}:${String(r.boundary.mode)}`);
      resolvedModes.push(r.resolved.mode);
    }
    expect(new Set(resolvedModes).size).toBe(4);
    expect(new Set(pairs).size).toBe(4);
    expect(pairs).toEqual([
      'NavigationOverlay:drawer',
      'NavigationOverlay:modal',
      'NavigationOverlay:split',
      'NavigationOverlay:popover',
    ]);
  });

  it('item 2 — `split` is handed this renderer\'s own view as `mainContent`, and renders it', async () => {
    // The shell's split branch opens `if (!isOpen || !mainContent) return
    // null`, so a renderer that passes no `mainContent` renders NOTHING for an
    // authored `split`. Both halves are read: the prop crossed, and the view is
    // still on screen beside the record panel.
    //
    // ⭐ The CLOSED state is pinned too, and not here — it is pinned by
    // `readingsFor` itself, which finds and clicks an element of the view
    // BEFORE anything is open. A renderer that enters its split path on the
    // authored MODE alone renders nothing until a record is selected, and
    // nothing can be selected because there is no view to click; that reads
    // here as "unable to find" on every `split` case rather than as a failed
    // assertion. It is not hypothetical — `ObjectGrid` did exactly that, and
    // this file is what caught it.
    await readingsFor('split');
    const split = shellLog.entries.filter((e) => e.mode === 'split');
    expect(split.length).toBeGreaterThan(0);
    expect(split[split.length - 1].hasMainContent).toBe(true);
    expect(await screen.findByTestId('object-tree')).toBeInTheDocument();
  });

  it('item 3 — `popover` is handed the clicked element, so the Dialog fallback is unreachable', async () => {
    // The shell falls back to a compact `Dialog` only when it is given neither
    // `popoverTrigger` nor `popoverAnchorRef`; the ruling forbids any of the
    // five from reaching that after this card. The ref's CONTENTS are read too
    // — a ref handed down empty would satisfy the branch while anchoring the
    // popover to nothing.
    await readingsFor('popover');
    const pop = shellLog.entries.filter((e) => e.mode === 'popover');
    expect(pop.length).toBeGreaterThan(0);
    const anchor = pop[pop.length - 1].anchor as { current: unknown } | undefined;
    expect(anchor, 'popoverAnchorRef').toBeTruthy();
    expect(anchor!.current, 'the element the user clicked').toBeInstanceOf(HTMLElement);
  });

  it('item 4 — the shell is handed both width keys, so an existing width carries over', async () => {
    const r = await readingsFor('drawer');
    expect(r.boundary.storageKey).toBe('drawer-width:org_chart_node');
    expect(r.boundary.legacyStorageKey).toBe('objectui.drawerWidth.org_chart_node');
  });
});

/**
 * ⭐ THE DEVIATION, DRIVEN RATHER THAN REASONED — the `ObjectTree` half.
 *
 * Same reading as `ObjectGrid.overlayShellModes-9299.test.tsx`'s closing block,
 * and it matters more here: a tree is routinely fed rows through the `data`
 * prop with no object schema at all, so this is the COMMON path on this
 * renderer rather than an edge. The shared payload renders DECLARED fields, so
 * with nothing declared the plain row reading stands — but the SHELL does not
 * change, and that is what the ruling is about.
 */
describe('objectui#9299 — the no-schema payload fallback still goes through the shared shell', () => {
  /** Rows through the `data` prop: no DataSource, so nothing is declared. */
  async function noSchemaReadingsFor(mode: string) {
    cleanup();
    hookLog.calls = [];
    shellLog.entries = [];
    render(
      <ObjectTree
        schema={
          {
            type: 'object-tree',
            objectName: 'org_chart_node',
            parentField: 'parent_id',
            labelField: 'name',
            fields: ['name'],
            navigation: { mode },
          } as never
        }
        data={ROWS}
      />,
    );
    const cell = await screen.findByText('Acme');
    fireEvent.click(cell);
    await waitFor(() => expect(shellLog.entries.length).toBeGreaterThan(0));
    return {
      resolved: hookLog.calls[hookLog.calls.length - 1],
      boundary: shellLog.entries[shellLog.entries.length - 1],
    };
  }

  it.each(OVERLAY_MODES)('authored `%s` still reaches the shared shell on the no-schema path', async (mode) => {
    const r = await noSchemaReadingsFor(mode);
    expect(r.resolved.mode).toBe(mode);
    expect(r.boundary.shell).toBe('NavigationOverlay');
    expect(r.boundary.mode).toBe(mode);
  });

  it('⭐ `split` still renders, and `popover` is still anchored, with nothing declared', async () => {
    // The two modes this renderer was measured as breaking. `split` rendered
    // NOTHING before this card; both must hold on the fallback path too, or the
    // deviation would reproduce the defect on a narrower input.
    const split = await noSchemaReadingsFor('split');
    expect(split.boundary.hasMainContent).toBe(true);
    expect(await screen.findByTestId('object-tree')).toBeInTheDocument();

    const pop = await noSchemaReadingsFor('popover');
    const anchor = pop.boundary.anchor as { current: unknown } | undefined;
    expect(anchor, 'popoverAnchorRef').toBeTruthy();
    expect(anchor!.current, 'the element the user clicked').toBeInstanceOf(HTMLElement);
  });
});
