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
 * This file REPLACES `ObjectKanban.overlayShellCollapse-9113.test.tsx`, which pinned what
 * was true on the base tree: `ObjectKanban` rendered the one
 * `RecordDetailDrawer` for all four authored `navigation.mode` values, so the
 * hook resolved `modal` / `split` / `popover` correctly and the component then
 * handed the record to a shell with no `mode` parameter to receive it. The
 * ruling (director seat, decision batch #128 item 1) closes that: one payload,
 * mounted through the shared `NavigationOverlay`, on all five list-type
 * renderers. ⛔ The measurement file is not kept alongside this one — it pins
 * the branch this card deleted, and a pin that asserts the defect still holds
 * is a pin that fails for being fixed.
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
 *
 * ⚠️ objectstack#26677 retired `modal`, `split` and `popover` from the spec's
 * `NavigationMode` (an object opens its records in the drawer, which expands
 * to the full page; a side-by-side pane is a reader's own preference), and
 * with them the shell faces and the anchor this file pinned. The rows are
 * FLIPPED, not deleted: `drawer` is still resolved and received exactly as
 * before, and a retired mode that reaches the renderer past the parse (an
 * authored one is refused there, a stored one converted) now opens NO shell.
 * The `split` (item 2) and `popover` (item 3) rows went with their faces.
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
        storageKey: props?.storageKey,
        legacyStorageKey: props?.legacyStorageKey,
      });
      return <Real {...props} />;
    },
  };
});

import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time, not inside a `findBy` budget
// (AGENTS.md 测试纪律) — the specifier must stay byte-identical to `./index`'s.
import './KanbanImpl';

registerAllFields();

const CARDS = [{ id: '1', title: 'On the board', status: 'todo' }];

/** Mount with one authored mode, click a card, hand back both readings. */
async function readingsFor(mode: string, expectShell = true) {
  cleanup();
  hookLog.calls = [];
  shellLog.entries = [];
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ObjectKanban
        schema={
          {
            type: 'object-kanban',
            objectName: 'duly_card',
            groupBy: 'status',
            columns: [{ id: 'todo', title: 'To Do' }],
            data: CARDS,
            navigation: { mode },
          } as never
        }
      />
    </I18nProvider>,
  );
  const card = await screen.findByText('On the board');
  fireEvent.click(card);
  if (expectShell) await waitFor(() => expect(shellLog.entries.length).toBeGreaterThan(0));
  else await new Promise((settle) => setTimeout(settle, 50));
  return {
    resolved: hookLog.calls[hookLog.calls.length - 1],
    boundary: shellLog.entries[shellLog.entries.length - 1],
  };
}

/** `drawer` is the one overlay mode the spec keeps (objectstack#26677). */
const OVERLAY_MODES = ['drawer'] as const;
/** The members objectstack#26677 retired: a stale one opens NO shell. */
const RETIRED_MODES = ['modal', 'split', 'popover'] as const;

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

describe('objectui#9299 — `ObjectKanban` honours the drawer through the shared shell (objectstack#26677)', () => {
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

  it('⭐ objectstack#26677: a RETIRED mode reaching the renderer past the parse opens NO shell — the drawer is the one overlay', async () => {
    // This row used to read FOUR distinct boundary pairs, one per authored
    // overlay mode. `modal`, `split` and `popover` left the spec: an authored
    // one is refused at parse and a stored one converted, so one arrives here
    // only past a cast — and the renderer then draws no overlay at all. The
    // LIT CONTROL above is the same mount under `drawer`, which draws one.
    for (const mode of RETIRED_MODES) {
      const r = await readingsFor(mode, false);
      expect(r.resolved?.isOverlay, mode).toBe(false);
      expect(shellLog.entries.filter((e) => e.shell === 'NavigationOverlay'), mode).toEqual([]);
    }
  });

  it('item 4 — the shell is handed both width keys, so an existing width carries over', async () => {
    const r = await readingsFor('drawer');
    expect(r.boundary.storageKey).toBe('drawer-width:duly_card');
    expect(r.boundary.legacyStorageKey).toBe('objectui.drawerWidth.duly_card');
  });
});
