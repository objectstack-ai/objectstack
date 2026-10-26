/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectKanban`'s record-detail drawer heading still resolves to ENGLISH, and
 * to the SAME BYTES as before, when no `I18nProvider` is mounted —
 * objectui#3459.
 *
 * This is not a nice-to-have. Routing a literal through `t()` without a working
 * default is exactly how a provider-less consumer breaks, and it breaks in a
 * suite that is not this one: `object-kanban` is a public page block, so any
 * host that renders schema without mounting a provider (this package's own
 * tests, the preview gallery, an embedding app) reads whatever the defaults map
 * says. The English defaults live in `KANBAN_DEFAULT_TRANSLATIONS`
 * (`ObjectKanban.tsx`) — that map is what `createSafeTranslation` falls back to
 * when its `detail.recordDetail` probe comes back unresolved.
 *
 * Direction: this file was GREEN before the change and is GREEN after. It pins
 * the FALLBACK, not the fix — the fix is asserted in
 * `ObjectKanban.overlayTitleI18n.test.tsx`. A missing map entry would have
 * turned it red by rendering the raw key `detail.recordDetailWithLabel`, which
 * is precisely the regression it exists to catch.
 *
 * ── Why this is its own FILE, not a describe block ────────────────────────
 * `createI18n` calls `instance.use(initReactI18next)`, and `initReactI18next`
 * registers that instance as **react-i18next's module-global default**. The
 * registration survives unmount and `cleanup()`. So the moment any test in a
 * file mounts `<I18nProvider config={{ defaultLanguage: 'zh' }}>`, every later
 * "no provider" render in that same file silently resolves against the Chinese
 * instance — a green-looking file that asserts nothing about the fallback.
 *
 * Vitest's `dom` project runs with `isolate: true`, so a file that never mounts
 * a provider gets a genuinely clean global. Keep it that way: **do not import
 * or mount `I18nProvider` here.**
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { registerAllFields } from '@object-ui/fields';
import { ObjectKanban } from './ObjectKanban';

// Same reason as the sibling i18n file: the board's `KanbanImpl` chunk is
// `React.lazy`-loaded behind Suspense and every assertion here is after that
// boundary, so the cost is paid at import time rather than raced against a
// `findBy` timeout (AGENTS.md §测试纪律). Specifier byte-identical to `./index`'s.
import './KanbanImpl';

registerAllFields();

const cards = [
  { id: '1', title: 'On the board', status: 'todo' },
  { id: '2', title: 'Second card', status: 'todo' },
];

function renderKanban(schemaExtra: Record<string, unknown>) {
  return render(
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
    />,
  );
}

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

describe('ObjectKanban drawer heading — English fallback with no provider (objectui#3459)', () => {
  it('interpolates the capitalized object name in English, never the raw key', async () => {
    renderKanban({ objectName: 'contacts' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Contacts Detail');
    expect(screen.queryByText('detail.recordDetailWithLabel')).toBeNull();
  });

  it('keeps the underscore-to-space humanization in the fallback path', async () => {
    renderKanban({ objectName: 'support_cases' });
    await openDrawer();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Support cases Detail');
  });
});
