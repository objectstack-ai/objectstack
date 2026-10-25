/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectKanban`'s record-detail drawer heading speaks the session locale —
 * objectui#3459 (the #3426 family, third of five hosts).
 *
 * ── Why this path is user-reachable (the issue left it unverified) ─────────
 * `object-kanban` is a PUBLIC page block (`packages/core/src/registry/
 * public-blocks.ts`) and its overlay needs no authoring at all: `navConfig`
 * DEFAULTS to `{ mode: 'drawer' }` when the schema declares no `navigation`,
 * and every card's `onCardClick` is wired straight to `navigation.handleClick`.
 * So a page that simply drops a kanban block gets this drawer on card click.
 * The heading falls back to the object-derived title whenever the board
 * declares no `cardTitle`/`titleField` (or the record's value is empty).
 *
 * The hosts that DO suppress it — `ListView`, which passes its own
 * `onRowClick` (that takes full priority inside `useNavigationOverlay`) and
 * owns a unified overlay — are host overrides of a public block, not proof the
 * branch is dead. The test below drives the standalone path.
 *
 * ── One correction to the issue's premise ─────────────────────────────────
 * The issue filed this as a `NavigationOverlay` `title` prop. It is not:
 * `ObjectKanban` renders `RecordDetailDrawer` (from `@object-ui/plugin-detail`),
 * whose `title` becomes an **`sr-only` `SheetTitle`** — DetailView's own
 * HeaderHighlight draws the visible heading. So this string is the drawer's
 * ACCESSIBLE NAME, not a visible label. That makes it no less user-facing (it
 * is the whole announcement a screen-reader user gets on open, and the same
 * file already sources its resize-handle `aria-label` from the locale packs for
 * exactly that reason) — but the assertions below check the accessible name,
 * not a visible heading, because that is what the code actually renders.
 *
 * ── Direction of these assertions ─────────────────────────────────────────
 * The non-English cases (zh / ja / de) were RED before the change — the drawer
 * was named by a TypeScript template literal, so a zh session announced
 * "Contacts Detail" — and are GREEN after. The `en` cases were GREEN before AND
 * after: they pin that routing the heading through `t()` did not change a byte
 * of what an English session gets, including the underscore-to-space
 * humanization of the object name.
 *
 * The second branch of `detailTitle` (`schema.objectName` absent, formerly the
 * literal `'Card Details'`) has NO test here on purpose: it is unreachable.
 * The drawer that consumes it bails on the very same condition
 * (`if (!objectName || recordId == null) return null` in `ObjectKanban.tsx`),
 * so no dialog ever opens without an object name — verified by rendering a
 * kanban with no `objectName`, clicking a card, and finding no dialog at all.
 * A test asserting a heading there would pass because nothing is produced, not
 * because the logic is right.
 *
 * The provider-less fallback is asserted in
 * `ObjectKanban.overlayTitleNoProviderFallback.test.tsx` — it cannot live in
 * this file, because `createI18n` registers its instance as react-i18next's
 * module-global default and that registration survives `cleanup()`; a
 * "no provider" render here would silently resolve against whichever locale a
 * previous test mounted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ObjectKanban } from './ObjectKanban';

// Pay the board's lazy chunk at import time, not inside a `findBy` budget
// (AGENTS.md §测试纪律). `KanbanRenderer` renders
// `React.lazy(() => import('./KanbanImpl'))` behind a Suspense boundary, and
// every assertion below sits AFTER that boundary — a card has to be on screen
// before it can be clicked. Under full CI parallelism a first `import()` has
// been measured at ~976ms against RTL's 1000ms default, so without this the
// suite would race the module loader. The specifier must stay byte-identical to
// the one in `./index` — ESM caches by resolved specifier, which is what makes
// the component's own lazy factory resolve immediately.
import './KanbanImpl';

registerAllFields();

const cards = [
  { id: '1', title: 'On the board', status: 'todo' },
  { id: '2', title: 'Second card', status: 'todo' },
];

function renderKanbanIn(language: string, schemaExtra: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <ObjectKanban
        schema={{
          type: 'object-kanban',
          groupBy: 'status',
          columns: [{ id: 'todo', title: 'To Do' }],
          data: cards,
          ...schemaExtra,
        // ⚠️ Still escaped, and NOT by oversight (objectui#7322 item ②). This
        // board is STATIC — `columns` plus inline `data`, no fetch — so it
        // authors no `objectName`, which `ObjectKanbanSchema` declares REQUIRED.
        // That requiredness is objectui#7780's subject (the renderer reads inline
        // `data` ahead of the fetch and never needs the object name for a board
        // like this one); until it is answered, no declared type accepts this
        // node. The other four in-package fixtures that mount an `object-kanban`
        // board dropped their `as never` for a real `satisfies ObjectKanbanSchema`
        // in objectui#7322 — when #7780 lands, this one follows.
        } as never}
      />
    </I18nProvider>,
  );
}

/** Open the detail drawer the way a user does: click a card. */
async function openDrawer() {
  const card = await screen.findByText('On the board');
  fireEvent.click(card);
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
}

/* ─────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point (measured, not inferred):
 *
 *   RecordDetailDrawer (the drawer this file opens)
 *     -> DetailView            packages/plugin-detail/src/DetailView.tsx:290,296
 *       -> useRecordEditable   packages/plugin-detail/src/useRecordEditable.ts:76
 *         -> `const doFetch = apiFetch ?? fetch`      <- the escape
 *           POST /api/v1/security/explain  (twice per open: edit, then delete)
 *
 * The hook reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. Under happy-dom that global is a real HTTP client and the document URL
 * defaults to `http://localhost:3000`, so the relative path resolved to a live
 * request. The read is best-effort (a network or parse failure leaves the
 * record editable — fail open), which is why the cases below stayed green while
 * the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and
 * by this batch's sibling
 * `packages/plugin-calendar/src/ObjectCalendar.navWidthDefault.test.tsx`.
 * Deliberately NOT a blanket network stub: it records every URL it is handed
 * and `afterEach` fails on any URL that is not the explain route, so an escape
 * to somewhere else reds here instead of vanishing into that `catch`.
 *
 * What it answers, and why that changes no assertion here: the permissive
 * verdict, in the two response shapes the two explain hooks read —
 * `{ record: { visible } }` for a single `recordId`, and
 * `{ records: [{ recordId, visible }] }` for a batched `recordIds`. Only the
 * FIRST is reached from this file (every call measured above comes from
 * `useRecordEditable`); the batched branch is kept so this router stays
 * byte-identical to its siblings rather than forking per file.
 * `useRecordEditable` initialises `allowed` to `true` and its failure path
 * leaves it there, so `true` and the absent verdict the failing request
 * produced are the same value at every read site. The drawer's accessible
 * name — everything this file asserts — is not derived from the verdict at all.
 * ─────────────────────────────────────────────────────────────────────────── */

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

beforeEach(() => installExplainDouble());

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

describe('ObjectKanban record-detail drawer heading (objectui#3459)', () => {
  it('names the drawer in English under an en session', async () => {
    renderKanbanIn('en', { objectName: 'contacts' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Contacts Detail');
  });

  it('keeps the underscore-to-space humanization of the object name', async () => {
    renderKanbanIn('en', { objectName: 'support_cases' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Support cases Detail');
  });

  it('names the drawer from the zh bundle under a zh session', async () => {
    renderKanbanIn('zh', { objectName: 'contacts' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Contacts详情');
    // The whole point of the issue: no English leaks into a zh drawer.
    expect(screen.queryByText('Contacts Detail')).toBeNull();
  });

  it('names the drawer from the ja bundle under a ja session', async () => {
    renderKanbanIn('ja', { objectName: 'contacts' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Contactsの詳細');
  });

  it('names the drawer from the de bundle under a de session', async () => {
    renderKanbanIn('de', { objectName: 'contacts' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Contacts-Details');
  });

  /**
   * The record's own title still wins over the keyed fallback — this fix must
   * not start overriding a board that names its cards.
   */
  it('still prefers the record title field when the board declares one', async () => {
    renderKanbanIn('zh', { objectName: 'contacts', cardTitle: 'title' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('On the board');
  });
});

describe('ObjectKanban record-detail drawer — no-objectName branch is dead (objectui#3459)', () => {
  /**
   * Pins the reachability finding above, so a future reader does not "restore"
   * a heading for a branch that cannot render. Without `objectName` the drawer
   * IIFE returns `null`, so there is no dialog to carry any heading at all.
   */
  it('opens no drawer at all when the board declares no objectName', async () => {
    renderKanbanIn('en', {});
    const card = await screen.findByText('On the board');
    fireEvent.click(card);

    await waitFor(() => expect(screen.getByText('Second card')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
