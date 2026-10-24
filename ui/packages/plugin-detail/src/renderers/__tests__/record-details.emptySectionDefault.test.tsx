/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:details` — who owns the empty-section default (objectui#7064,
 * objectui#7129 Q2-C, objectui#8603).
 *
 * TWO DISJOINT DOMAINS, and every case below belongs to exactly one:
 *
 *   - the EMPTY ROWS of a section that still has a filled row — owned by
 *     `DetailSection`'s auto-hide heuristic and the reader's "Show N empty
 *     fields" toggle, with no authored override in either polarity
 *     (objectui#7129 Q2-C, which objectui#8603 leaves untouched);
 *   - an ALL-EMPTY section — owned by the authored `hideEmpty`, hiding by
 *     renderer default, `false` keeping the heading and the label skeleton.
 *
 * The heuristic requires `filledCount > 0` and `hideEmpty` applies only where
 * there is none, so no fixture can be governed by both.
 *
 * ## Why this file has been rewritten twice
 *
 * `RecordDetailsRenderer` used to map every authored section with
 * `hideEmpty: s.hideEmpty ?? true`. That forced default made an unauthored
 * section indistinguishable from an authored `true` at every later read, so
 * every application had to hand-write `hideEmpty: false` per section to stop a
 * hand-created record collapsing to a two-row body — per-app tax for a
 * platform concern (maintainer ruling 2026-08-31, objectui#7064), and the
 * force went.
 *
 * That pass-through then measured the key on all four of its contracts and
 * found three answers (objectui#7129): `@objectstack/spec` 17.2.0 REFUSED
 * `hideEmpty` on a `record:details` section, so on any spec-validated page the
 * "author escape hatch" existed only where nothing validated. The maintainer
 * converged the four on the spec's answer (2026-09-01): the declaration and
 * the read were RETIRED.
 *
 * `@objectstack/spec` 17.3.0 then DECLARED the key on that same section entry
 * (upstream #11289, maintainer ruling 2026-08-23), with a `describe()`
 * promising the behaviour this repo had just removed — so the retirement's
 * premise was false before the pin carrying it moved. objectui#8603 (director
 * seat batch #137 item 3, maintainer 2026-09-15) ruled the protocol correct
 * and RESTORED the read: Q1-A of #7129 is superseded for this key, Q2-C is
 * not. The escape hatch is real this time — `hideEmpty: false` parses green on
 * the strict section object, which is what #7129 measured it could not do.
 *
 * ⚠️ The unauthored all-empty default therefore moved back: an AUTHORED
 * section whose fields are ALL empty renders nothing unless the page writes
 * `false`. WHERE that default is resolved is the design, and the last describe
 * block below is what pins it: `RecordDetailsRenderer` applies `?? true` to an
 * authored section and `DetailSection` tests `=== true`, so a section this
 * renderer did not resolve keeps its skeleton. The direct-`fields` fallback
 * body is one nobody could have written the key on; a hide there would be a
 * hide with no declarable spelling to ask the skeleton back, which is the
 * defect upstream declared the key to fix. The `detail-section` node declares
 * the key (objectui#10485) but resolves no default of its own, so an omitted
 * key keeps the skeleton there too and only an authored `true` hides.
 *
 * Deliberately no i18n provider, so the row labels below are rung 2 of the
 * label ladder: the object's own DECLARED `label`. They read as field NAMES
 * until objectui#8497 — `record:details` handed `DetailSection` a bare
 * `{ name }` with no `label`, so `fieldLabel`'s fallback was the name itself.
 * The renderer now fills that `label` from the bound object definition, and
 * these are the same DOM nodes a translated app fills with translated labels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';

/**
 * No `name` / `title` / `subject` / `display_name` key anywhere: the renderer
 * drops the page-H1 title field from the body (`titleCandidates`), which would
 * make an absence assertion below pass for the wrong reason.
 */
const objectSchema = {
  fields: {
    // DECLARED and left UNSET on every record below, so the `record:details`
    // dedupe ladder resolves its H1 candidate to `name`, finds no value there
    // and hides nothing (objectui#8175). Without it the ladder's ADR-0079
    // derivation rung ends in "first title-eligible field by declaration
    // order" — `industry` — and every `Manufacturing` assertion in this file
    // would be measuring the dedupe instead of the empty-section heuristic
    // these cases exist to pin.
    name: { type: 'text', label: 'Name' },
    industry: { type: 'text', label: 'Industry' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'text', label: 'Amount' },
    close_date: { type: 'text', label: 'Close Date' },
    next_step: { type: 'text', label: 'Next Step' },
  },
};

/** A hand-created sparse record: one filled field, everything else unwritten. */
const sparseData = { industry: 'Manufacturing' };

const renderDetails = (schema: Record<string, unknown>, data: Record<string, unknown> = sparseData) =>
  render(
    <RecordContextProvider
      objectName="crm_opportunity"
      recordId="O1"
      data={data}
      objectSchema={objectSchema}
    >
      <RecordDetailsRenderer schema={schema as any} />
    </RecordContextProvider>,
  );

/** The empty-value placeholder `DetailSection` draws for a field with no value. */
const emptyPlaceholders = () => screen.queryAllByTitle('No value');

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

describe('record:details — the empty-ROW default is DetailSection\'s heuristic, unauthored (#7064)', () => {
  it('a SMALL partly-empty section (below the auto-hide threshold) now shows its empty row', () => {
    // 2 fields, 1 empty: under DetailSection's minimum field count in both the
    // desktop (4) and mobile (3) variant, so the auto-hide heuristic never
    // fires and the empty row is shown. Under the pre-#7064 forced default
    // this row was hidden — the half of that change that was never limited to
    // all-empty sections, and the half objectui#8603 did NOT restore.
    renderDetails({
      sections: [
        { name: 'summary', label: 'Summary', fields: ['industry', 'stage'] },
      ],
    });

    expect(screen.getByText('Summary')).toBeInTheDocument();
    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(emptyPlaceholders()).toHaveLength(1);
  });

  it('the label-graveyard guard is INTACT: a large mostly-empty section still auto-hides', () => {
    // 4 fields, 3 empty, 1 filled — at/above both threshold variants
    // (min fields 4/3, empty ratio 25%/20%) with at least one filled row, so
    // `shouldAutoHideEmpty` still fires exactly as before — through #7064's
    // flip of the unauthored default, through #7129's retirement, and through
    // #8603's restoration. None of the three touched a populated page: this
    // branch has never been an authored decision, in either polarity.
    renderDetails({
      sections: [
        {
          name: 'deal_terms',
          label: 'Deal Terms',
          fields: ['industry', 'stage', 'amount', 'close_date'],
        },
      ],
    });

    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    expect(screen.queryByText('Stage')).not.toBeInTheDocument();
    expect(emptyPlaceholders()).toHaveLength(0);
    // …and the user-facing escape hatch is offered for the rows it hid.
    expect(screen.getByRole('button', { name: /empty fields/i })).toBeInTheDocument();
  });
});

describe('record:details — an authored `hideEmpty` decides the ALL-EMPTY section, and only that (#8603)', () => {
  /**
   * The fixtures are #7064's, unchanged, and so are their controls. What moved
   * is the verdict: objectui#8603 restored the read, so the all-empty cases
   * below assert the behaviour `@objectstack/spec`'s `describe()` promises,
   * while the partly-filled case still asserts the heuristic deciding alone.
   *
   * Every all-empty case carries the sibling CONTROL section #7064 introduced —
   * a section that MUST render. Without it an absence assertion passes just as
   * well when the renderer produced no output at all, which is the one way a
   * "nothing rendered" pin can be green for the wrong reason.
   */
  it('`hideEmpty: true` HIDES an all-empty section: no heading, no skeleton', () => {
    renderDetails({
      sections: [
        { name: 'deal_terms', label: 'Deal Terms', fields: ['stage', 'amount', 'close_date', 'next_step'], hideEmpty: true },
        // CONTROL, kept from #7064: a sibling section that MUST render, so the
        // absences below are a decision about `hideEmpty` and not an artefact
        // of a render that never happened.
        { name: 'firmographics', label: 'Firmographics', fields: ['industry'] },
      ],
    });

    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.getByText('Manufacturing')).toBeInTheDocument();

    // "renders nothing at all: no heading, no skeleton" — the spec's words,
    // asserted on both halves: the heading AND every row it would have drawn.
    expect(screen.queryByText('Deal Terms')).not.toBeInTheDocument();
    for (const label of ['Stage', 'Amount', 'Close Date', 'Next Step']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(emptyPlaceholders()).toHaveLength(0);
  });

  it('UNAUTHORED behaves as `true`: the renderer default hides an all-empty section', () => {
    // The default is the renderer's, not the schema's — `@objectstack/spec`
    // declares the key with NO default, and states the fallback as measured on
    // this renderer. Same fixture as the case above with the key removed, so
    // the pair reads as one measurement of the default.
    renderDetails({
      sections: [
        { name: 'deal_terms', label: 'Deal Terms', fields: ['stage', 'amount', 'close_date', 'next_step'] },
        { name: 'firmographics', label: 'Firmographics', fields: ['industry'] },
      ],
    });

    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.queryByText('Deal Terms')).not.toBeInTheDocument();
    expect(emptyPlaceholders()).toHaveLength(0);
  });

  it('`hideEmpty: false` KEEPS the heading and the label skeleton of an all-empty section', () => {
    // The escape hatch, and the half that makes the key worth declaring: a
    // brand-new record keeps the structure its author wrote. Under objectui#7129
    // this spelling parsed nowhere and read nowhere; it now does both.
    renderDetails({
      sections: [
        { name: 'deal_terms', label: 'Deal Terms', fields: ['stage', 'amount', 'close_date', 'next_step'], hideEmpty: false },
        { name: 'firmographics', label: 'Firmographics', fields: ['industry'] },
      ],
    });

    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.getByText('Deal Terms')).toBeInTheDocument();
    for (const label of ['Stage', 'Amount', 'Close Date', 'Next Step']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(emptyPlaceholders()).toHaveLength(4);
  });

  it('the OTHER domain is untouched: all three spellings render the same partly-filled section (#7129 Q2-C)', () => {
    // 2 fields, 1 empty — below the auto-hide minimum in both threshold
    // variants (4 desktop / 3 mobile), so nothing hides the row. This is the
    // fixture where the PRE-#7129 read decided something and where the
    // restored one deliberately does not: `hideEmpty` owns the all-empty case
    // alone, so an authored value may not move an empty ROW in either
    // direction. ⚠️ Deliberately NOT run on a large sparse section: there the
    // heuristic fires anyway, so all three spellings would agree even if the
    // key had swallowed the whole contract, and the assertion could not fail.
    const fields = ['industry', 'stage'];

    const renderedFor = (section: Record<string, unknown>) => {
      const view = renderDetails({ sections: [{ name: 'summary', label: 'Summary', fields, ...section }] });
      const shown = {
        heading: screen.queryAllByText('Summary').length,
        filled: screen.queryAllByText('Manufacturing').length,
        placeholders: emptyPlaceholders().length,
      };
      view.unmount();
      return shown;
    };

    const absent = renderedFor({});
    // The live control: the unauthored render really produced the skeleton, so
    // "all three agree" is not three renders that all produced nothing.
    expect(absent).toEqual({ heading: 1, filled: 1, placeholders: 1 });

    expect(renderedFor({ hideEmpty: true })).toEqual(absent);
    expect(renderedFor({ hideEmpty: false })).toEqual(absent);
  });
});

describe('record:details — the default reaches ONLY the surface that declares the key (#8603)', () => {
  it('the direct-`fields` fallback body keeps its skeleton when every field is empty', () => {
    // No `sections`, so the body falls back to the authored `fields` list and
    // `DetailView` synthesizes the section itself. There is no entry for an
    // author to write `hideEmpty` on, in the spec or anywhere else, so the
    // default must not reach it — otherwise a brand-new record renders a blank
    // page with nothing the page could say to get its structure back.
    //
    // ⚠️ This case is what makes `=== true` in `DetailSection` load-bearing
    // rather than stylistic: under `!== false` the synthesized section would
    // take the hide, and this body would be empty.
    renderDetails({ fields: ['stage', 'amount', 'close_date', 'next_step'] }, {});

    for (const label of ['Stage', 'Amount', 'Close Date', 'Next Step']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(emptyPlaceholders()).toHaveLength(4);
  });

  it('an AUTHORED section in the same render DOES take the default', () => {
    // The discriminating half: same document, same record, one authored
    // section and — through a second render — the same field list authored as
    // the fallback body. The pair is what shows the two surfaces are treated
    // differently on purpose rather than by accident of fixture shape.
    renderDetails({
      sections: [
        { name: 'deal_terms', label: 'Deal Terms', fields: ['stage', 'amount', 'close_date', 'next_step'] },
        // CONTROL: this one has the record's one filled field, so it renders.
        { name: 'firmographics', label: 'Firmographics', fields: ['industry'] },
      ],
    });

    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.queryByText('Deal Terms')).not.toBeInTheDocument();
    for (const label of ['Stage', 'Amount', 'Close Date', 'Next Step']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });
});
