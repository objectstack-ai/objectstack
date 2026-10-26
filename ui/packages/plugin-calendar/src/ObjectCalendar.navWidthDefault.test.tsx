/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins the drawer width a calendar gets when it declares no `navigation`
 * (objectui#6303 — the sibling of `ObjectGantt.navWidthDefault.test.tsx`).
 *
 * `ObjectCalendar` used to spell `min(960px, 60vw)` in TWO places: the
 * `navConfig` default (`{ mode: 'drawer', width: 'min(960px, 60vw)' }`) and,
 * further down, a render-site
 * `width={(navigation.width as any) ?? 'min(960px, 60vw)'}`. The second is why
 * taking only the first would have changed nothing — the old width survived by
 * a different route.
 *
 * `width` is `@deprecated [#2578 -> size]` and `resolveOverlayWidth` gives an
 * explicit `width` priority OVER `size`, so spelling it kept the deprecated
 * branch load-bearing on the path most calendars take. The default is now
 * `{ mode: 'drawer' }` with no render-site fallback: `resolveOverlayWidth`
 * returns `undefined` and RecordDetailDrawer's own `width` default supplies the
 * identical CSS — a zero-pixel change.
 *
 * Both halves below are load-bearing and fail for different reasons:
 *
 *   half 1 — the calendar must stop injecting a width of its own (it has to
 *            hand `undefined` down, or the drawer's default can never apply).
 *            This half is what catches a re-added `??` fallback at the render
 *            site, which half 2 alone cannot see: the fallback's value is the
 *            same string the drawer default produces;
 *   half 2 — the width the REAL drawer then resolves must still be that value.
 *            Without this half the calendar would follow a moved drawer default
 *            invisibly, which is the regression the indirection introduces.
 *
 * A third case pins the other direction: an AUTHORED `navigation.width` still
 * wins. What #6303 removed is the renderer spelling the deprecated key as its
 * own default — not the key's acceptance as an authored value.
 *
 * All three assert the resolved width VALUE — never a `className`, never "it
 * renders", either of which passes in both worlds.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RECORD_OVERLAY_DEFAULT_WIDTH } from '@object-ui/plugin-detail';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ObjectCalendar } from './ObjectCalendar';

/**
 * The width this surface's record overlay resolves to when nothing is authored.
 *
 * ⭐ objectui#9299 moved WHERE this is expressed without moving WHAT it resolves
 * to. It used to be an inline `max-width` on the drawer panel, spelled exactly.
 * The shared shell publishes an authored width as a FLOOR on the `--ov-w`
 * custom property — `max(WIDTH, min(60vw, 880px))` — and for this value that
 * expression reduces to `min(960px, 60vw)` at every viewport:
 *
 *   60vw <= 880px        -> max(60vw,  60vw)  = 60vw  = min(960px, 60vw)
 *   880px < 60vw <= 960px-> max(60vw,  880px) = 60vw  = min(960px, 60vw)
 *   60vw > 960px         -> max(960px, 880px) = 960px = min(960px, 60vw)
 *
 * so the pixels are unchanged — which is what objectui#6584 ruled must hold
 * across all four surfaces. ⛔ The literal is NOT retyped here: it lives in one
 * place, `RECORD_OVERLAY_DEFAULT_WIDTH`, and is imported.
 */
const EXPECTED_WIDTH = `max(${RECORD_OVERLAY_DEFAULT_WIDTH}, min(60vw, 880px))`;

/** What an explicitly authored `720px` resolves to under the same floor. */
const EXPECTED_AUTHORED_WIDTH = 'max(720px, min(60vw, 880px))';

// objectui#9299: the width now crosses into the shared `NavigationOverlay`;
// `RecordDetailDrawer` is no longer on this path at all. Record what the
// renderer hands the shell, then delegate to the REAL shell so half 2 measures
// the actual resolution rather than a stub's idea of it.
let overlayProps: any = null;
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const Real = actual.NavigationOverlay;
  return {
    ...actual,
    NavigationOverlay: (props: any) => {
      overlayProps = props;
      return <Real {...props} />;
    },
  };
});

/**
 * The month grid renders whatever month `currentDate` is on, and `currentDate`
 * initialises to `new Date()` — so the event has to sit in the CURRENT month or
 * there is nothing on screen to click. Noon avoids a timezone shift moving it
 * across a month boundary.
 */
function eventInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0).toISOString();
}

async function openDrawer(navigation?: Record<string, unknown>) {
  render(
    <ObjectCalendar
      schema={{
        type: 'object-calendar',
        objectName: 'events',
        calendar: { startDateField: 'starts_at', titleField: 'name' },
        // `staticData`, not `data: { provider: 'value', items }`: since
        // objectui#8348 this block's published `data` row is `z.array(...)`,
        // so the config object is not a record source here. `staticData` is
        // the block's declared door for inline rows and resolves to the same
        // `{ provider: 'value', items }` config one rung down.
        staticData: [{ id: '1', name: 'On the calendar', starts_at: eventInCurrentMonth() }],
        ...(navigation ? { navigation } : {}),
      } as never}
    />,
  );
  const event = await screen.findByText('On the calendar');
  fireEvent.click(event);
  await waitFor(() => expect(overlayProps).not.toBeNull());
  await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
}

/**
 * The drawer prefers a drag-resized width persisted in localStorage over its
 * prop, which would mask half 2 — and it is keyed by `objectName`, so a value
 * left by any earlier test in the file would be read back here.
 */
function readPanelWidth(): string {
  const panel = document.querySelector('[role="dialog"]') as HTMLElement | null;
  expect(panel, 'drawer panel').not.toBeNull();
  // objectui#9299: the shared shell publishes the resolved width as the
  // `--ov-w` custom property and caps the panel with
  // `sm:max-w-[var(--ov-w,42rem)]`, so the custom property IS the resolved
  // value. Reading `style.maxWidth` here would return an empty string in BOTH
  // worlds and pin nothing.
  return panel!.style.getPropertyValue('--ov-w').trim();
}

/* ────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point:
 *
 *   RecordDetailDrawer (the drawer this file opens)
 *     -> useRecordEditable   packages/plugin-detail/src/useRecordEditable.ts:75
 *       -> `const doFetch = apiFetch ?? fetch`      <- the escape
 *         POST /api/v1/security/explain
 *
 * The hook reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. Under happy-dom that global is a real HTTP client and the document URL
 * defaults to `http://localhost:3000`, so the relative path resolved to a live
 * request. The read is best-effort (a network or parse failure leaves the record editable — fail open), which is why the three cases below stayed green while the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on and
 * `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx`
 * carries. Deliberately NOT a blanket network stub: it records every URL it is
 * handed and `afterEach` fails on any URL that is not the explain route, so an
 * escape to somewhere else reds here instead of vanishing into that `catch`.
 *
 * What it answers, and why that changes no assertion here: the permissive
 * verdict, in the two response shapes the two hooks read (ADR-0090 D6 /
 * ADR-0095 C2) — `{ record: { visible } }` for a single `recordId`,
 * `{ records: [{ recordId, visible }] }` for a batched `recordIds`.
 * `useRecordEditable` initialises `allowed` to `true` and its failure path
 * leaves it there, and the ONLY consumer of the batched lookup is
 * `resolveRowRecordCrudAffordance`, whose rule is `recordVerdict !== false` —
 * so `true` and the absent verdict the failing request produced are the same
 * value at every read site. The drawer's width — everything this file asserts — is not derived from the verdict at all.
 * ──────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL this render handed the global `fetch`, in request order. */
let explainCalls: string[] = [];

/** Serve `POST /api/v1/security/explain` permissively; record everything. */
function installExplainDouble() {
  explainCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      explainCalls.push(url);
      if (url !== EXPLAIN_ROUTE) return { ok: false, status: 404, json: async () => ({}) };
      let body: { recordId?: unknown; recordIds?: unknown } = {};
      try {
        body = JSON.parse(String((init as { body?: unknown } | undefined)?.body ?? '{}'));
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(body.recordIds) ? body.recordIds : null;
      return {
        ok: true,
        status: 200,
        json: async () =>
          recordIds
            ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
            : { record: { visible: true } },
      };
    }),
  );
}

describe('calendar drawer width with no declared `navigation` (objectui#6303)', () => {
  beforeEach(() => {
    overlayProps = null;
    try { window.localStorage.clear(); } catch { /* ignore */ }
    installExplainDouble();
  });
  afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the hook's best-effort `catch`.
  expect(explainCalls.filter((url) => url !== EXPLAIN_ROUTE)).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a verdict effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  });

  it('half 1: the renderer defaults an unauthored width to the ONE ruled literal', async () => {
    await openDrawer();
    // objectui#9299: an unauthored `navigation.width` used to reach
    // `RecordDetailDrawer` as `undefined` so that component's own default
    // applied. The renderer no longer goes through that component, so it reads
    // the exported constant instead — and it must, because the shell's own
    // fallback is `42rem`, which is NARROWER than the ruled value.
    expect(overlayProps.width).toBe(RECORD_OVERLAY_DEFAULT_WIDTH);
  });

  it('half 2: the width the real shell resolves is still the pinned value', async () => {
    await openDrawer();
    expect(readPanelWidth()).toBe(EXPECTED_WIDTH);
  });

  it('an authored `navigation.width` still reaches the drawer unchanged', async () => {
    await openDrawer({ mode: 'drawer', width: '720px' });
    expect(overlayProps.width).toBe('720px');
    // ⚠️ objectui#9299 consequence, pinned rather than left to be discovered:
    // the shared shell treats an authored width as a FLOOR, so an authored
    // value below `min(60vw, 880px)` widens to it. That is the policy
    // `ObjectGrid` and `ObjectTree` have always had; the three drawer-only
    // renderers adopt it along with the shell. The authored value still reaches
    // the shell unchanged — that is the assertion above.
    expect(readPanelWidth()).toBe(EXPECTED_AUTHORED_WIDTH);
  });
});
