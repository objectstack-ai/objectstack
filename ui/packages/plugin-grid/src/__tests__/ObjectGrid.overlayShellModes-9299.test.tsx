/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9299 — THE REPAIR on the renderer objectui#9113 measured as already
 * correct. 
 *
 * `ObjectGrid` was one of the two the card called right: it carried all four
 * authored `navigation.mode` values across the shell boundary. The measurement
 * round nonetheless found TWO holes here, and this file pins both closed:
 *
 *  - `popover` reached the shell with NO anchor, so it degraded to the compact
 *    `Dialog` fallback. Measured as honoured on NO surface — this renderer
 *    included — and closed by ruling item 3.
 *  - the payload inside the shell was this renderer's own read-only key/value
 *    panel rather than the shared record payload, which is the "nobody gets
 *    both" half of the card: the renderers that honoured the mode drew the
 *    poorer body. Ruling item 1.
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

import { ObjectGrid } from '../ObjectGrid';

const ROWS = [
  { id: '1', name: 'Alice', work_phone: '555-0100' },
];

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => ROWS[0]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'contacts',
      fields: {
        id: { name: 'id', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        work_phone: { name: 'work_phone', label: 'Work Phone', type: 'text' },
      },
    })),
  }) as any;

/**
 * Mount with one authored mode, click the record link, hand back both
 * readings.
 *
 * ⚠️ A DataSource with `getObjectSchema` is supplied deliberately: the shared
 * payload renders the object's DECLARED fields, and a grid with none keeps its
 * own inference panel (the declared-fields gate in `ObjectGrid`). Without a
 * schema this file would be measuring that fallback rather than the shell.
 */
async function readingsFor(mode: string) {
  cleanup();
  hookLog.calls = [];
  shellLog.entries = [];
  render(
    <ObjectGrid
      schema={
        {
          type: 'object-grid',
          objectName: 'contacts',
          columns: [{ field: 'name' }],
          data: { provider: 'object', object: 'contacts' },
          navigation: { mode },
        } as never
      }
      dataSource={makeDataSource()}
    />,
  );
  const cell = await screen.findByText('Alice');
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

describe('objectui#9299 — `ObjectGrid` honours all four overlay modes through the shared shell', () => {
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
    expect(await screen.findAllByText('Alice')).not.toHaveLength(0);
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
    expect(r.boundary.storageKey).toBe('drawer-width:contacts');
    expect(r.boundary.legacyStorageKey).toBe('objectui.drawerWidth.contacts');
  });
});

/**
 * ⭐ THE DEVIATION, DRIVEN RATHER THAN REASONED (objectui#9299).
 *
 * `ObjectGrid` and `ObjectTree` keep their own value-inference panel when the
 * object declares NO fields — an inline `value` grid, or a DataSource with no
 * `getObjectSchema`. The shared payload renders DECLARED fields, so handing it
 * an undeclared record renders raw ISO strings where objectui#4541 put a
 * locale-aware date, drops objectui#8491's localized `Empty` placeholder, and
 * has no `format` hint to honour (objectui#8920). Measured on this branch, not
 * assumed: with the payload ungated, `recordDetailDateLocale` read back
 * `close_date2024-03-15` in a zh session.
 *
 * The ruling's subject is the SHELL, and this block is what makes that
 * distinction checkable rather than a claim about the call graph: on the
 * no-schema path the overlay is still `NavigationOverlay`, it still receives
 * all four authored modes, and ONLY the content inside it differs. If that ever
 * stopped being true the deviation would become the defect this card closed,
 * reproduced on a narrower input — so it is pinned here rather than described
 * in a PR body.
 */
describe('objectui#9299 — the no-schema payload fallback still goes through the shared shell', () => {
  const PLAIN_ROWS = [{ id: '1', name: 'Alice', close_date: '2024-03-15' }];

  /** Mount with NO object schema — nothing declared for the payload to render. */
  async function noSchemaReadingsFor(mode: string) {
    cleanup();
    hookLog.calls = [];
    shellLog.entries = [];
    render(
      <ObjectGrid
        schema={
          {
            type: 'object-grid',
            objectName: 'contacts',
            columns: [{ field: 'name' }],
            data: { provider: 'value', items: PLAIN_ROWS },
            navigation: { mode },
          } as never
        }
      />,
    );
    const cell = await screen.findByText('Alice');
    fireEvent.click(cell);
    await waitFor(() => expect(shellLog.entries.length).toBeGreaterThan(0));
    return {
      resolved: hookLog.calls[hookLog.calls.length - 1],
      boundary: shellLog.entries[shellLog.entries.length - 1],
    };
  }

  it('LIT CONTROL: this mount really does take the fallback, not the shared payload', async () => {
    // Without this the mode readings below would be about the same path the
    // block above already covers, and would prove nothing about the fallback.
    // `close_date` is not a column here, so the only place its value can reach
    // the DOM is the panel — and the fallback is the branch that renders it
    // through the grid's own date inference rather than raw.
    await noSchemaReadingsFor('drawer');
    const panel = await screen.findByTestId('record-detail-panel');
    expect(panel.textContent ?? '').toContain('Mar 15, 2024');
    expect(panel.textContent ?? '').not.toContain('2024-03-15');
  });

  it.each(OVERLAY_MODES)('authored `%s` still reaches the shared shell on the no-schema path', async (mode) => {
    const r = await noSchemaReadingsFor(mode);
    expect(r.resolved.mode).toBe(mode);
    expect(r.boundary.shell).toBe('NavigationOverlay');
    expect(r.boundary.mode).toBe(mode);
  });

  it('⭐ four authored modes still produce FOUR distinct boundary pairs with nothing declared', async () => {
    const pairs: string[] = [];
    for (const mode of OVERLAY_MODES) {
      const r = await noSchemaReadingsFor(mode);
      pairs.push(`${r.boundary.shell}:${String(r.boundary.mode)}`);
    }
    expect(new Set(pairs).size).toBe(4);
    expect(pairs).toEqual([
      'NavigationOverlay:drawer',
      'NavigationOverlay:modal',
      'NavigationOverlay:split',
      'NavigationOverlay:popover',
    ]);
  });

  it('`split` and `popover` are still honoured with nothing declared', async () => {
    // The two modes the card measured as broken. Neither is allowed to degrade
    // on the fallback path either: `split` still gets the grid as
    // `mainContent`, and `popover` still gets the clicked element, so the
    // `Dialog` fallback stays unreachable.
    const split = await noSchemaReadingsFor('split');
    expect(split.boundary.hasMainContent).toBe(true);
    expect(await screen.findAllByText('Alice')).not.toHaveLength(0);

    const pop = await noSchemaReadingsFor('popover');
    const anchor = pop.boundary.anchor as { current: unknown } | undefined;
    expect(anchor, 'popoverAnchorRef').toBeTruthy();
    expect(anchor!.current, 'the element the user clicked').toBeInstanceOf(HTMLElement);
  });
});
