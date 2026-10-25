/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `list-view` — the two undeclared keys `ListView` reads, ruled per key
 * (objectui#8653, the objectui#8327 family's `plugin-list` card).
 *
 * Sibling of `plugin-grid/src/__tests__/gridNonAuthorKeys.test.tsx`, which is
 * where objectui#5091's four grid keys were said out loud to the tooling. This
 * file does the same job one package over, for two keys that took OPPOSITE
 * exits — and the reason they differ is a measurement, re-derived below rather
 * than asserted in prose.
 *
 * ## The governing ruling (objectui#8327 family triage)
 *
 * `packages/types` is a MIRROR, not an authority: its `ListViewSchema` is
 * `z.input` of a zod object that imports `@objectstack/spec/ui`'s own slots by
 * reference. So declaring a key here that the platform contract does not
 * declare makes this repo ACCEPT WHAT THE PLATFORM REFUSES. Each key therefore
 * has three exits — declare · retire the read · route to the producer — and
 * which one is available is decided by the contract, per key, not by taste.
 *
 * ## `title` — RETIRED (item 1)
 *
 * The card reported `title` as "read undeclared off `ListViewSchema`,
 * compiling only through the string index signature". Re-measured with the
 * TypeScript checker against the emitted declarations (⛔ never a grep,
 * objectui#8410): `title` is indeed NOT a declared member — but the read was
 * `(schema as any).title`, an `as any` CAST, so the index signature was never
 * what carried it. That matters, because the cast was also laundering a second
 * defect: `viewLabel` is `string`, `ListViewSchema.label` is the spec's INLINE
 * locale map `string | I18nLabel`, and `X || any` collapses the whole
 * expression to `any`. A locale-map label therefore reached
 * `sanitizeFileNameBase` as an OBJECT and exported as `[object Object]`.
 *
 * The exit is retire-the-read, and the two measurements that chose it:
 *
 *   - the platform contract REFUSES `title` on the list surface BY NAME
 *     (`unrecognized_keys: ['title']`) while ACCEPTING it on the grid surface.
 *     That asymmetry is the whole reason objectui#6639 could take the DECLARE
 *     branch for `ObjectGridSchema.title` and this card cannot: declaring it
 *     here would publish a key the save gate rejects. Pinned in section 1.
 *   - a parse-based, order-agnostic census of `apps/ examples/ content/` and
 *     `packages/` found ZERO `list-view` nodes authoring `title`, against 2
 *     `object-grid` nodes that do (the same two `content/docs/api/
 *     schema-reference.md` hits objectui#6639's census reported). #6639 chose
 *     DECLARE because authors existed; here they do not, so nothing loses a
 *     caption. ⚠️ That census is a one-shot reading taken on this branch and
 *     nothing re-derives it (AGENTS.md #9) — it is recorded as the reason the
 *     branch was chosen, never as a live fact. What IS re-derived every run is
 *     everything asserted below.
 *
 * ## `rowActionDefs` — EXEMPT AND STILL READ, now pinned (item 2)
 *
 * objectui#5091 ruled this same producer-derived key NON-AUTHOR SURFACE for
 * `object-grid` on 2026-08-19 (a knowing reversal of the 2026-08-18 line). The
 * card's question was whether that exemption extends to `ListView`'s read
 * sites, which carried no docblock and no pin. It does, and on the same three
 * legs plus two this site adds:
 *
 *   - the producer is the same one: `app-shell`'s `ObjectView` derives it from
 *     `objectDef.actions` filtered by `locations.includes('list_item')` and
 *     writes it onto a `fullSchema: ListViewSchema`; `plugin-view`'s
 *     `ObjectView` composes the same key onto a `list-view` node.
 *   - the platform contract REFUSES `rowActionDefs` by name on BOTH the list
 *     and the grid surface, so "declare" is off the table on either.
 *   - `@object-ui/types` declares it on NEITHER mirror, which is why both
 *     renderers read it through a cast.
 *   - ⭐ this reader RELAYS it onward to the child `object-grid` node, where
 *     the data-table surface DOES declare it. Deleting the read here silently
 *     removes the row-action menu the host composed.
 *   - ⭐ this reader also feeds it to `listViewPredicates`, so a field named
 *     only by a row action's `visible` CEL reaches `$select`. Deleting the read
 *     here silently drops that operand from the projection — objectui#3501's
 *     fail-closed CEL fault (`No such key`), reached with a success receipt.
 *
 * ## Why the pin is written this way
 *
 * The existing protection for this key is `app-shell`'s
 * `ObjectView.relayRungCensus-7559.test.ts`, whose `WRITE_EXCEPTIONS` entry
 * names the read in a REASON STRING. That census re-derives what the PRODUCER
 * writes; nothing in it re-derives that the READER still reads. Deleting either
 * `ListView` read site leaves it green — which is exactly the decay the card
 * was filed about, and exactly what sections 3 and 4 below remove.
 *
 * Every assertion here is a RUNTIME or CONTRACT reading. ⛔ No assertion is a
 * source grep: `SchemaRenderer` hands a node's leftover keys to the component
 * as props, so a `schema.KEY` grep returns a confident zero on keys that are
 * really consumed (AGENTS.md, "a source grep cannot answer this"). Each
 * negative carries a same-instrument control that fires, so a zero is a
 * reading rather than a broken probe.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListViewSchema as SpecListViewSchema, ObjectGridPropsSchema } from '@objectstack/spec/ui';
import { ListViewSchema as ListViewMirror, ObjectGridSchema as ObjectGridMirror } from '@object-ui/types/zod';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. THE CONTRACT — what the platform accepts, per key, per surface.
 *
 * Verdicts are asserted as KEY verdicts (`unrecognized_keys`) over an
 * otherwise-LEGAL fixture, never as a whole-document `success`: that would
 * confuse "this key is refused" with "this document is well-formed" — the
 * shape `gridNonAuthorKeys.test.tsx` argues for at its assertion 2.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** A minimal LEGAL `@objectstack/spec/ui` list view: `columns` is its one required key. */
const SPEC_LIST_LEGAL = { name: 'all', columns: ['name'] };
/** A minimal LEGAL `@objectstack/spec/ui` object-grid props object. */
const SPEC_GRID_LEGAL = { objectName: 'account' };

/**
 * The narrow slice of a zod result this file reads. Spelled out rather than
 * imported so the helper below needs no `any`: `unrecognized_keys` is the one
 * issue code asserted anywhere here.
 */
type ParseLike = {
  safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ code: string; keys?: string[] }> } };
};

/** The keys a `safeParse` refused BY NAME — `[]` when the document parsed clean. */
function refusedKeys(schema: ParseLike, base: object, extra: object): string[] {
  const r = schema.safeParse({ ...base, ...extra });
  if (r.success || !r.error) return [];
  return r.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .flatMap((i) => i.keys ?? []);
}

describe('objectui#8653 §1 — the platform contract decides which exit each key has', () => {
  it('CONTROLS: the legal fixtures parse clean, and a nonsense key is refused by name on both surfaces', () => {
    // Without these, every refusal below could be an artefact of a fixture that
    // was never legal in the first place, and every acceptance could be an
    // artefact of a schema that refuses nothing.
    expect(SpecListViewSchema.safeParse(SPEC_LIST_LEGAL).success).toBe(true);
    expect(ObjectGridPropsSchema.safeParse(SPEC_GRID_LEGAL).success).toBe(true);
    expect(refusedKeys(SpecListViewSchema, SPEC_LIST_LEGAL, { zzqx_no_such_key: 1 })).toEqual(['zzqx_no_such_key']);
    expect(refusedKeys(ObjectGridPropsSchema, SPEC_GRID_LEGAL, { zzqx_no_such_key: 1 })).toEqual(['zzqx_no_such_key']);
  });

  it('`title`: REFUSED on the list surface, ACCEPTED on the grid surface — the asymmetry that ruled out objectui#6639\'s declare branch here', () => {
    expect(refusedKeys(SpecListViewSchema, SPEC_LIST_LEGAL, { title: 'Quarterly Review' })).toEqual(['title']);
    expect(refusedKeys(ObjectGridPropsSchema, SPEC_GRID_LEGAL, { title: 'Quarterly Review' })).toEqual([]);
    // The declared spelling the list surface DOES offer, and the one the reader
    // now uses exclusively.
    expect(refusedKeys(SpecListViewSchema, SPEC_LIST_LEGAL, { label: 'Quarterly Review' })).toEqual([]);
  });

  it('`rowActionDefs`: REFUSED BY NAME on BOTH surfaces, while its authored sibling `bulkActionDefs` is accepted on both', () => {
    expect(refusedKeys(SpecListViewSchema, SPEC_LIST_LEGAL, { rowActionDefs: [{ name: 'archive' }] })).toEqual(['rowActionDefs']);
    expect(refusedKeys(ObjectGridPropsSchema, SPEC_GRID_LEGAL, { rowActionDefs: [{ name: 'archive' }] })).toEqual(['rowActionDefs']);
    // The CONTROL of the pair: computed vs authored is the whole distinction,
    // and without an accepted sibling "not published" would mean nothing.
    expect(refusedKeys(SpecListViewSchema, SPEC_LIST_LEGAL, { bulkActionDefs: [] })).toEqual([]);
    expect(refusedKeys(ObjectGridPropsSchema, SPEC_GRID_LEGAL, { bulkActionDefs: [] })).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE MIRROR — membership is read off `.shape`, never off acceptance.
 *
 * Both mirrors extend a `.passthrough()` base, so `unrecognized_keys` can never
 * fire and parse ACCEPTANCE cannot tell "declared" from "admitted unexamined"
 * (the reading `object-grid-title-mirrored.test.ts` established for #6639).
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('objectui#8653 §2 — the `@object-ui/types` mirrors declare neither key on the list surface', () => {
  const listKeys = () => Object.keys(ListViewMirror.shape);
  const gridKeys = () => Object.keys(ObjectGridMirror.shape);

  it('CONTROL: both mirror shapes are non-empty and carry their declared list/grid vocabulary', () => {
    expect(listKeys().length).toBeGreaterThan(20);
    expect(listKeys()).toEqual(expect.arrayContaining(['label', 'rowActions', 'bulkActionDefs', 'objectName']));
    expect(gridKeys()).toEqual(expect.arrayContaining(['label', 'rowActions', 'objectName']));
  });

  it('`title` is NOT a member of the list mirror, and IS a member of the grid mirror (objectui#6639)', () => {
    expect(listKeys()).not.toContain('title');
    expect(gridKeys()).toContain('title');
  });

  it('`rowActionDefs` is a member of NEITHER mirror — which is why both renderers read it through a cast', () => {
    expect(listKeys()).not.toContain('rowActionDefs');
    expect(gridKeys()).not.toContain('rowActionDefs');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. THE READER — `title` is retired, and the export filename is where it shows.
 *
 * `viewLabel` has exactly one consumer: `buildExportFileName`, whose output
 * lands on the download anchor. So the anchor's `download` attribute is the
 * instrument — the real read path, not a re-implementation of it.
 * ═══════════════════════════════════════════════════════════════════════════ */

const ROWS = [{ id: '1', name: 'Acme', industry: 'tech', owner: 'u-1' }];

/** Captured `download` attributes, in click order. */
let downloads: string[] = [];
let lastGridProps: Record<string, unknown> | null = null;
let prevObjectGrid: unknown;
let clickSpy: ReturnType<typeof vi.spyOn>;

const OBJECT_DEF = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'text', label: 'Industry' },
    owner: { type: 'text', label: 'Owner' },
    archived_at: { type: 'datetime', label: 'Archived At' },
    escalated_at: { type: 'datetime', label: 'Escalated At' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
  };
}

const BASE_SCHEMA = {
  type: 'list-view',
  objectName: 'account',
  viewType: 'grid',
  columns: ['name'],
  exportOptions: { formats: ['csv'] },
} as unknown as ListViewSchema;

async function renderList(overrides: Record<string, unknown>) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource as never}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...BASE_SCHEMA, ...overrides } as ListViewSchema} dataSource={dataSource as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.getObjectSchema).toHaveBeenCalled());
  return dataSource;
}

async function exportCsv() {
  fireEvent.click(screen.getByRole('button', { name: /export/i }));
  fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
  await waitFor(() => expect(downloads.length).toBeGreaterThan(0));
  return downloads[downloads.length - 1];
}

beforeAll(() => {
  // plugin-grid is not a dependency of plugin-list (that would be a cycle), so
  // the child view is a stub that records what ListView hands it — the device
  // every other plugin-list test in this package uses.
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: Record<string, unknown>) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid as never);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => {
  downloads = [];
  lastGridProps = null;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});
afterEach(() => {
  clickSpy.mockRestore();
  vi.restoreAllMocks();
  cleanup();
  downloads = [];
  lastGridProps = null;
});

describe('objectui#8653 §3 — `title` is retired from the list surface', () => {
  it('CONTROL: the DECLARED `label` still reaches the export filename', async () => {
    // The control that makes the two negatives below readings rather than a
    // probe that sees nothing at all. It varies only the claim — same
    // component, same fixture, same instrument, one key.
    await renderList({ label: 'Quarterly Review' });
    expect(await exportCsv()).toContain('Quarterly Review');
  });

  it('a list node authoring ONLY the legacy `title` contributes nothing to the filename', async () => {
    await renderList({ title: 'Quarterly Review' });
    const name = await exportCsv();
    expect(name).not.toContain('Quarterly Review');
    // …and the filename is still well-formed, so the assertion above cannot
    // pass because the export path broke.
    expect(name).toMatch(/^account-\d{8}-\d{6}\.csv$/);
  });

  it('an INLINE LOCALE MAP `label` resolves against the display locale instead of stringifying to `[object Object]`', async () => {
    // The defect the `as any` cast was laundering: `viewLabel` is `string`,
    // `label` is `string | I18nLabel`, and `X || any` collapsed the expression
    // to `any`, so the object reached `sanitizeFileNameBase` unresolved.
    await renderList({ label: { en: 'Quarterly Review', zh: '季度复盘' } });
    const name = await exportCsv();
    expect(name).not.toContain('[object Object]');
    expect(name).toContain('Quarterly Review');
  });

  it('`title` is inert on this surface: it is not forwarded to the child view either', async () => {
    await renderList({ title: 'Quarterly Review', rowActionDefs: [{ name: 'archive', label: 'Archive' }] });
    await waitFor(() => expect(lastGridProps).not.toBeNull());
    // The CONTROL is in the same fixture: a key that IS relayed proves the
    // stub is receiving a real composition, so `title`'s absence is a reading.
    expect(lastGridProps).toHaveProperty('rowActionDefs');
    expect(lastGridProps).not.toHaveProperty('title');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE READER — `rowActionDefs` is exempt AND STILL READ, at both sites.
 *
 * The ruling kept every read site; only the status changed. Deleting a read is
 * the one move that makes a host's composition quietly do nothing, and it is
 * exactly what a reader who sees "non-author surface" might think is the tidy
 * finish (gridNonAuthorKeys.test.tsx, assertion 4).
 * ═══════════════════════════════════════════════════════════════════════════ */

describe('objectui#8653 §4 — `rowActionDefs` stays read, at both sites', () => {
  const ROW_ACTIONS = [
    { name: 'archive', label: 'Archive', visible: 'record.archived_at == null' },
  ];
  const BULK_ACTIONS = [
    { name: 'escalate', label: 'Escalate', operation: 'custom', visible: 'record.escalated_at == null' },
  ];

  it('SITE 1 (relay): the host-composed defs reach the child `object-grid` node', async () => {
    await renderList({ rowActionDefs: ROW_ACTIONS, bulkActionDefs: BULK_ACTIONS });
    await waitFor(() => expect(lastGridProps).not.toBeNull());
    expect(lastGridProps?.rowActionDefs).toEqual(ROW_ACTIONS);
    // CONTROL: the DECLARED sibling of the pair travels the same relay, so a
    // green above cannot be an artefact of the stub receiving everything.
    expect(lastGridProps?.bulkActionDefs).toEqual(BULK_ACTIONS);
  });

  it('SITE 2 (projection): a field named only by a row action\'s `visible` CEL reaches `$select`', async () => {
    const ds = await renderList({ rowActionDefs: ROW_ACTIONS, bulkActionDefs: BULK_ACTIONS });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const select = (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
    // CONTROLS first: the projection is real (it carries the authored column)
    // and it is not simply "every declared field" (a field nobody names is
    // absent), so the positive below is a reading of this key's contribution.
    expect(select).toContain('name');
    expect(select).not.toContain('industry');
    expect(select).toContain('escalated_at'); // via the DECLARED `bulkActionDefs`
    expect(select).toContain('archived_at');  // via the exempt `rowActionDefs`
  });
});
