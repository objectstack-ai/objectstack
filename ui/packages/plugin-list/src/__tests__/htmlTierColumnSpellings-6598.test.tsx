/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6598 — the reporter's EIGHT `columns` spellings, end to end on a
 * `kind:'html'` page, pinned as a matrix.
 *
 * ## What was reported, and what this file is for
 *
 * The production report (objectstack#12649, hotcrm, promo-video recon) tried
 * eight ways of getting columns onto a `<list-view>` in an html-kind page and
 * got ONE picture from all eight: the row count ("23 records"), the
 * filter/group/sort toolbar, and **no data columns at all — only the index
 * column**, with zero diagnostics anywhere. That uniformity is what made the
 * card so hard to anchor: it read as a single bug, and it was not one. It was
 * three unrelated mechanisms whose failure modes happened to look identical
 * from the page:
 *
 *   - a GRAMMAR limit — `interpretBrace` materialized strict JSON only, so the
 *     single-quoted array every JSX author writes became an inert `{ $expr }`
 *     marker nothing downstream evaluates (fixed by objectui#6614 / PR #6669);
 *   - a HANDOFF lie — `ListView` spelled "the author declared nothing" as
 *     `fields: []`, and an empty array is truthy, so `ObjectGrid` pinned its
 *     projection at zero and neither default-columns derivation could run
 *     (fixed by objectui#6598's first half, PR #6679);
 *   - two spellings that were never the contract at all (`viewName` / `view`),
 *     plus two that fail loudly: one a page-fatal compile error, and one the
 *     block answers with its "no object named" hint (a compile error too until
 *     objectui#11605 stopped `list-view` requiring `objectName`).
 *
 * Sibling files pin the mechanisms one at a time:
 * `literal-subset-6614.test.ts` and `inert-expression-6598.test.ts` in
 * `@object-ui/sdui-parser` own the grammar and its diagnostic;
 * `ListView.unauthoredColumnProjection-6598.test.tsx` owns the handoff against
 * a stub grid; `htmlTierListViewDefaultColumns-6598.test.tsx` takes the
 * unauthored case end to end.
 *
 * ⚠️ None of them pins THE CARD'S OWN CLAIM, which is a statement about all
 * eight spellings at once: *whatever* an author writes for `columns` on this
 * tier, the page must never again land in the reported state. That claim can
 * only be checked as a matrix, and only through the real live registration —
 * so this file runs the real page renderer, the real html-tier compile against
 * the real registry manifest, the real `list-view` registration and the real
 * `object-grid`, once per spelling.
 *
 * ## The invariant, and why it is shaped this way
 *
 * The reported failure had two halves: the page showed no data columns, AND it
 * said nothing about why. So the invariant every spelling must satisfy is a
 * disjunction — each form either
 *
 *   (a) renders a table with at least one DATA column, or
 *   (b) fails LOUDLY, with the compile-error block on screen, or with the
 *       block's own "no object named" hint naming the key it is missing.
 *
 * What no form may do is what all eight did when the card was filed: render a
 * populated table whose only header is the index column. A spelling moving
 * between (a) and (b) is a design decision someone can argue about; a spelling
 * falling out of both is this card regressing.
 *
 * Registered in `heavyDomTests` for the setup's `@object-ui/plugin-grid`
 * side-effect registration — the same route the sibling end-to-end file takes.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import '../index';

const OBJECT = 'opportunity';

const dataSource = {
  find: async () => ({
    data: [
      { id: 'o-1', name: 'Acme expansion', amount: 1000, stage: 'new' },
      { id: 'o-2', name: 'Globex renewal', amount: 2000, stage: 'won' },
    ],
    total: 23,
    hasMore: true,
  }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  count: async () => 23,
  getObjectSchema: async (name: string) => ({
    name,
    label: 'Opportunity',
    fields: {
      id: { type: 'text', label: 'Id', hidden: true },
      name: { type: 'text', label: 'Opportunity Name' },
      stage: { type: 'text', label: 'Stage' },
      amount: { type: 'currency', label: 'Amount' },
    },
  }),
  getObjects: async () => [],
  onMutation: () => () => {},
} as any;

const INDEX_COLUMN = '#';

interface Rendered {
  headers: string[];
  dataHeaders: string[];
  compileFailed: boolean;
  /** The block's "no object named" hint (objectui#11605). */
  noObjectHint: boolean;
  text: string;
}

/**
 * Render one spelling and settle on whichever terminal state it reaches — a
 * table, or the page-level compile-error block. Deliberately NOT
 * `waitFor(table)`: two of the eight spellings are page-fatal by design, and a
 * helper that can only wait for a table would report those as a timeout rather
 * than as the loud failure they are.
 */
async function renderSpelling(source: string): Promise<Rendered> {
  const { container } = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={{ type: 'page', kind: 'html', name: 'columns_page', source } as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => {
    const settled =
      container.querySelector('table') !== null ||
      container.querySelector('[data-testid="list-view-no-object"]') !== null ||
      /failed to compile/i.test(container.textContent || '');
    expect(settled).toBe(true);
  });
  const headers = Array.from(container.querySelectorAll('th')).map((th) => (th.textContent || '').trim());
  const text = container.textContent || '';
  return {
    headers,
    dataHeaders: headers.filter((h) => h !== INDEX_COLUMN),
    compileFailed: /failed to compile/i.test(text),
    noObjectHint: container.querySelector('[data-testid="list-view-no-object"]') !== null,
    text,
  };
}

/** The reported state, named once so every case can assert against it. */
function expectNotTheReportedSymptom(r: Rendered): void {
  const renderedDataColumns = !r.compileFailed && r.dataHeaders.length > 0;
  const failedLoudly = r.compileFailed || r.noObjectHint;
  // Before the fixes: `headers` was exactly ['#'] with `compileFailed` false —
  // rows on screen, no data columns, and nothing said so.
  expect(renderedDataColumns || failedLoudly).toBe(true);
  expect(r.headers).not.toEqual([INDEX_COLUMN]);
}

describe("#6598 — all eight reported `columns` spellings on a kind:'html' page", () => {
  describe('the spellings that render the AUTHORED projection', () => {
    it('form 1 — a single-quoted JSX array literal (the spelling the report leads with)', async () => {
      // The grammar case objectui#6614/#6669 legalised. Credit is #6669's; this
      // is the end-to-end guard that the materialised array survives all the
      // way to a header row.
      const r = await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} columns={['name','amount']} />`);

      expectNotTheReportedSymptom(r);
      expect(r.headers).toEqual([INDEX_COLUMN, 'Opportunity Name', 'Amount']);
      expect(r.headers).not.toContain('Stage');
      expect(r.text).toContain('23 records');
    });

    it('form 3 — an object-array with bare identifier keys', async () => {
      const r = await renderSpelling(
        `<list-view data={{provider:'object',object:'${OBJECT}'}} columns={[{field:'name',label:'Opportunity Name'},{field:'amount',label:'Amount'}]} />`,
      );

      expectNotTheReportedSymptom(r);
      expect(r.headers).toEqual([INDEX_COLUMN, 'Opportunity Name', 'Amount']);
      expect(r.headers).not.toContain('Stage');
    });
  });

  describe("the spellings that declare no projection this tier can read — the block's DEFAULTS render", () => {
    // ⚠️ Deliberately "which business columns are present", never an exact
    // header list: WHICH defaults a grid derives is a separate, live question
    // against `packages/plugin-grid` (objectui#6677) and it moves this list. It
    // must not be able to move whether the page shows data columns at all,
    // which is the only thing this card is about.
    const expectDefaults = (r: Rendered) => {
      expectNotTheReportedSymptom(r);
      expect(r.headers).toContain('Opportunity Name');
      expect(r.headers).toContain('Amount');
      expect(r.text).toContain('23 records');
    };

    it('form 7 — no `columns` attribute at all', async () => {
      // The only one of the eight that failed with ZERO diagnostics, and the
      // half PR #6679 fixed: ListView must hand the grid NO projection when the
      // author declared none, so the grid's own defaults can run.
      expectDefaults(await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} />`));
    });

    it('form 2 — a JSON STRING where an array is declared', async () => {
      // ⛔ Not honoured as a projection, and that is contract-first (AGENTS.md
      // #0.1), not a gap: `columns` is declared `array`, so a string draws a
      // warning-severity `type-mismatch` from the manifest validator and is
      // refused. Parsing it anyway would be exactly the consumer-side tolerance
      // alias the rule forbids. What matters to THIS card is that refusing it
      // no longer costs the page its columns.
      const r = await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} columns='["name","amount"]' />`);

      expectDefaults(r);
      // The string was not silently adopted as a two-column projection: the
      // undeclared third field is on screen, so these are the defaults.
      expect(r.headers).toContain('Stage');
    });

    it('form 4 — a `viewName` reference to a saved view', async () => {
      // `viewName` is not declared by the live `list-view` registration and is
      // not a base prop, so it draws `unknown-prop`. It was never the spelling
      // for a saved view on this tier — see objectui#6678, which is about that
      // being undiscoverable, not about this page losing its columns.
      expectDefaults(await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} viewName="all_opps" />`));
    });

    it('form 5 — a `view` reference to a saved view', async () => {
      expectDefaults(await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} view="all_opps" />`));
    });

    it('form 8b — the kebab-case `view-name` variant', async () => {
      expectDefaults(await renderSpelling(`<list-view data={{provider:'object',object:'${OBJECT}'}} view-name="all_opps" />`));
    });
  });

  describe('the spellings that fail LOUDLY, which is the opposite of the report', () => {
    it('form 6 — child <column> elements', async () => {
      const r = await renderSpelling(
        `<list-view data={{provider:'object',object:'${OBJECT}'}}><column field="name" /><column field="amount" /></list-view>`,
      );

      expectNotTheReportedSymptom(r);
      expect(r.compileFailed).toBe(true);
      // The author is told the actual reason, on the page.
      expect(r.text).toContain('column');
      expect(r.headers).toEqual([]);
    });

    it('form 8a — the kebab-case `object-name` variant', async () => {
      // `object-name` names nothing this block reads, so the list names no
      // object, and the page says so by name. Since objectui#11605 the compile
      // no longer refuses it (the object is not required: a `dataSource`
      // binding can supply it), so the saying moved from the compile-error
      // block to the block's own hint, which fetches nothing and, since
      // objectui#12099, names the page key `data.object` rather than the
      // retired `objectName`.
      const r = await renderSpelling(`<list-view object-name="${OBJECT}" columns={['name','amount']} />`);

      expectNotTheReportedSymptom(r);
      expect(r.compileFailed).toBe(false);
      expect(r.noObjectHint).toBe(true);
      expect(r.text).toContain('data.object');
      expect(r.text).not.toContain('objectName');
      expect(r.headers).toEqual([]);
    });
  });
});
