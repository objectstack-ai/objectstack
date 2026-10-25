/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` — what chooses the detail body (objectui#3818).
 *
 * The positive control for the `layout` retirement. `record:details` published
 * `layout: enum ['auto','custom']` describing itself as the body selector
 * ("auto uses the object highlightFields; custom uses explicit sections"), but
 * the renderer's only read tested `'inline'` | `'compact'` — values the schema
 * never permitted — so both legal values took the same branch and the key
 * selected nothing. @objectstack/spec 17.0.0 removed it (objectstack#6946,
 * ADR-0087 D2) and objectui#3818 removes the input and the dead branch here.
 *
 * Deleting a selector is only safe if the REAL selector is pinned, so this
 * file pins the contract that was doing the work all along and is now the
 * documented one: **what you author decides the body.** `sections` renders the
 * explicit groups (the old `custom`); omitting it falls back to the flat body
 * (the old `auto`). Both directions, because the failure this guards is a body
 * that silently comes up wrong — or blank — with no diagnostic anywhere.
 *
 * WHY THERE IS NO "authoring `layout` changes nothing" ASSERTION HERE. It
 * would be vacuous, and the measurement that says so is worth recording: the
 * deleted branch fed `synthesized.layout`, and `DetailView` never reads
 * `layout` at all (no read site in the file, and it does not spread the schema
 * onward). So the branch was dead TWICE — retired vocabulary AND ignored
 * consumer — and restoring it changes no rendered output. A DOM-equality pin
 * would therefore stay green through the exact regression it appears to guard.
 * The read point is pinned where it can actually go red: the source-text and
 * published-surface assertions in `recordDetailsInputs.spec-parity.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../renderers/record-details';

/**
 * No `name` / `title` / `display_name` VALUE in the data on purpose: the
 * renderer drops the page-H1 title field from the body (`titleCandidates`), and
 * a fixture that tripped that would make an absence assertion below pass for
 * the wrong reason.
 *
 * ⚠️ Keeping that property took a change when the dedupe ladder gained the
 * ADR-0079 resolver rung (objectui#8175). The ladder is no longer six literal
 * names: it asks `deriveTitleField` first, and that walk ends in "the first
 * title-eligible field by DECLARATION ORDER" — which on the old fixture was
 * `phone`, so `555-0100` (asserted below) started disappearing from the grid.
 * That was the ladder working correctly: with no name-ish field declared, the
 * page H1 for this record IS the phone number, because `PageHeaderRenderer`
 * resolves it through the very same derivation.
 *
 * So `name` is DECLARED here and left UNSET on the record. The derivation
 * prefers it (name-ish exact beats declaration order), the record has no value
 * there, and the value-keyed ladder therefore hides nothing — which is what
 * this file wanted all along, now stated as a field rather than as an absence.
 */
const objectSchema = {
  fields: {
    name: { type: 'text', label: 'Name' },
    phone: { type: 'text', label: 'Phone' },
    email: { type: 'text', label: 'Email' },
    industry: { type: 'text', label: 'Industry' },
  },
};

const data = {
  phone: '555-0100',
  email: 'ops@acme.test',
  industry: 'Manufacturing',
};

const renderDetails = (schema: Record<string, unknown>) =>
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="A1"
      data={data}
      objectSchema={objectSchema}
    >
      <RecordDetailsRenderer schema={schema as any} />
    </RecordContextProvider>,
  );

/* ─────────────────────────────────────────────────────────────────────────────
 * objectui#7307 — this file's `/api/v1/security/explain` escape, served here.
 *
 * Nothing below asks for a security verdict, yet every run opened a REAL TCP
 * connection to `http://localhost:3000`. Traced with a stack probe on the
 * network-escape guard's attribution point (measured, not inferred):
 *
 *   RecordDetailsRenderer  packages/plugin-detail/src/renderers/record-details.tsx:302
 *     -> DetailView        packages/plugin-detail/src/DetailView.tsx:290, :296
 *       -> useRecordEditable  packages/plugin-detail/src/useRecordEditable.ts:76
 *         -> `const doFetch = apiFetch ?? fetch`      [the escape]
 *           POST /api/v1/security/explain  (twice per render: edit, then delete)
 *
 * `useRecordEditable` reads the host's AUTHENTICATED `apiFetch` off
 * `SchemaRendererContext` and, with no host supplying one, degrades to the
 * GLOBAL `fetch` by design — a standalone embed must keep rendering rather than
 * crash. Under happy-dom that global is a real HTTP client and the document URL
 * defaults to `http://localhost:3000`, so the relative path resolved to a live
 * request. The read is best-effort (a network or parse failure leaves the
 * record editable — fail open), which is why the cases below stayed green while
 * the request always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches (see
 * `packages/plugin-gantt/src/ObjectGantt.navWidthDefault.test.tsx`).
 * Deliberately NOT a blanket network stub: it records every URL it is handed and
 * `afterEach` fails on any URL outside the set it serves, so an escape to
 * somewhere else reds here instead of vanishing into that `catch`.
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
 * produced are the same value at every read site — nothing below reads the
 * verdict at all.
 * ─────────────────────────────────────────────────────────────────────────── */

const EXPLAIN_ROUTE = '/api/v1/security/explain';

/** Every URL this file's renders handed the global `fetch`, in request order. */
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

beforeEach(installExplainDouble);

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

describe('record:details — `sections` presence decides the body (#3818)', () => {
  it('renders the authored groups when `sections` is present (the old `custom`)', () => {
    renderDetails({
      sections: [
        { name: 'contact_info', label: 'Contact Info', fields: ['phone', 'email'] },
      ],
    });

    // The group heading and its fields are on screen...
    expect(screen.getByText('Contact Info')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByText('ops@acme.test')).toBeInTheDocument();

    // ...and a field OUTSIDE every section is not, which is the half that
    // matters: once `sections` is authored it is the ONLY source of the body.
    // `industry` is present in both the object schema and the data, so its
    // absence is a decision by `sections`, not missing input.
    expect(screen.queryByText('Manufacturing')).not.toBeInTheDocument();
  });

  it('falls back to the flat field body when `sections` is absent (the old `auto`)', () => {
    renderDetails({ fields: ['industry'] });

    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    // No section chrome: the flat arm is a single unlabelled group, so the
    // heading from the other direction must not appear.
    expect(screen.queryByText('Contact Info')).not.toBeInTheDocument();
  });

  it('an empty `sections` array is not "sections authored" — the flat body still wins', () => {
    // The boundary between the two arms. `DetailView` gates the section arm on
    // `sections.length > 0` and the flat arm on `!sections?.length`, so the
    // empty array must behave as absence rather than blanking the body — the
    // blank-page failure mode this block exists to keep closed.
    renderDetails({ sections: [], fields: ['industry'] });

    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
  });
});
