/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-grid` NORMALIZES before it joins `$orderby` (objectui#8973).
 *
 * ## What was wrong
 *
 * This block lowers `schema.sort` with private code rather than the shared
 * sink, and its array arm was a bare template interpolation:
 *
 *     params.$orderby = schemaSort.map((s: any) => `${s.field} ${s.order}`).join(', ');
 *
 * Every key was interpolated UNCONDITIONALLY, so an entry missing `field` or
 * `order` reached the wire as the literal text `undefined`. The legacy
 * `defaultSort` arm one `else` down had the identical defect on a single
 * object. (That arm is gone since objectui#5861 retired the key; its section
 * below now pins it inert.)
 *
 * ## Why this is a wire defect and not a cosmetic one — MEASURED, not assumed
 *
 * `normalizeSortNodes` (`@objectstack/metadata-protocol`, the one normalizer
 * every server ingress funnels through) reads the join string by splitting on
 * whitespace and validating the direction token:
 *
 *   - `"name undefined"` → direction `'undefined'`, "neither 'asc' nor 'desc'"
 *     → **`400 INVALID_QUERY`**. The list does not render degraded; it fails.
 *   - `"undefined desc"` → a WELL-FORMED sort on a column literally named
 *     `undefined` — the silently-wrong-ordering half of the same defect.
 *   - `""` → `[]`, i.e. benign at the server. Omitting the key is still the
 *     correct lowering, and it is the correction `toFilterNode` already made
 *     for `$filter: {}` on the filter leg of this very same query build:
 *     asking a question with no content is not the same as not asking.
 *
 * ## The wire shape does NOT move here
 *
 * The join string stays. Routing this arm through `convertSortToQueryParams`
 * would send that sink's `{field: direction}` map — route B on objectui#8767,
 * DECLINED by the maintainer on 2026-09-10 pending a card that measures the
 * server contract AND both readers. What IS shared is the decision the two
 * copies disagreed about: `normalizeSortEntries`, exported from
 * `@object-ui/core` alongside the map builder that now also delegates to it.
 * One operation, one implementation — for the operation that had two copies.
 *
 * ## Deliberately untouched
 *
 * The export path's `{field, direction}` projection, and the header-arrow
 * reader `parseSchemaSort` — untouched BY THIS CARD. ⛔ Do not read the latter
 * as a standing description of that reader: objectui#8961 has since narrowed it
 * to the declared `[{ field, order }]` array (ruled letter A, director batch
 * #135 item 5), so a retired string spelling now lights no arrow either and the
 * two readers of this key agree. Nothing below reads the header indicators, so
 * this file's pins are unaffected. The `headerSort` arm also keeps sending
 * `SortNode[]` objects rather than a join string — a documented, deliberate
 * difference, not a defect.
 *
 * ⚠️ The sentence this replaces cited objectui#8961 by its LABEL
 * (`pm:blocked`), which had moved before anyone read the line again. A card's
 * label is state nothing in this file re-derives; its RULING does not move, so
 * that is what is named here.
 *
 * ⭐ The CONTROL rows are what make the rest a measurement rather than a block
 * that mangles everything: if the fix had broken lowering outright, the
 * `"name desc"` rows would have gone dark and every "key is absent" assertion
 * would have passed for the wrong reason.
 *
 * ## objectui#8071 slice 17 — this file is now `object-grid.sort`'s MEMBER PIN
 *
 * The sections above were read end to end and promoted: they already constrain
 * what the renderer READS out of each `sort` entry, which is objectui#8068's
 * criterion. ⚠️ The "deliberately untouched" paragraph above stays true of the
 * CARD it describes and is no longer true of the FILE: a fourth section below
 * reads both of the arms #8973 left alone — the export projection and
 * {@link parseSchemaSort} — because a member pin has to say what every reader
 * of the member does with it. It changes neither of them. The registry entry
 * for this key lives in
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { ActionProvider, SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { resetRetiredSortSpellingReports } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid, parseSchemaSort } from '../ObjectGrid';
// Registers `object-grid` and its `view:grid` alias.
import '../index';

registerAllFields();

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799, and the gate that closed the class,
 * objectui#8953).
 *
 * The read below stood on `join(process.cwd(), …)` under the comment "Read off
 * the vitest root — this project's `import.meta.url` is not a file URL, so the
 * sibling `import.meta`-relative idiom does not work here". BOTH HALVES OF THAT
 * ARE FALSE, and each had already been falsified before this file was written:
 *
 *  - `import.meta.url` IS a `file:` URL in this project. objectui#7800
 *    (comment 5555131785) measured it across three packages and both cwds; the
 *    sibling `groupedPartialDisclosure-7189.test.tsx` derived its root this way
 *    from PR #7806 until objectui#10881 retired it. What Vite rewrites is the
 *    TWO-ARGUMENT `new URL(rel, import.meta.url)`, which is why only the bare
 *    form is read here and taken apart by hand.
 *  - "the vitest root" and `process.cwd()` are not the same directory. This
 *    package's own `test` script — `vitest run --root ../.. packages/plugin-grid/`,
 *    which is what `pnpm --filter @object-ui/plugin-grid test` and
 *    `turbo run test` both run — sets the VITEST root to the repo root and
 *    leaves the cwd in `packages/plugin-grid/`, so the path below resolved to
 *    `packages/plugin-grid/packages/plugin-grid/src/ObjectGrid.tsx` and the read
 *    threw (objectui#7791, objectui#7799).
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / plugin-grid / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

function makeAdapter() {
  return {
    find: vi.fn().mockResolvedValue({
      data: [{ id: '1', name: 'Acme', status: 'active' }],
      total: 1,
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
    }),
  };
}

/** Render the block and return the params of its first `find` call. */
async function findParamsFor(schema: Record<string, unknown>) {
  const adapter = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(adapter.find).toHaveBeenCalled());
  return (adapter.find.mock.calls[0] as [string, any])[1];
}

const BASE = { type: 'object-grid', objectName: 'account', columns: [{ field: 'name' }] };

/** `$orderby` is absent ENTIRELY — not present-and-empty. */
function expectNoOrderBy(params: Record<string, unknown>) {
  expect(params.$orderby).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(params, '$orderby')).toBe(false);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRetiredSortSpellingReports();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  cleanup();
  vi.restoreAllMocks();
});

describe('object-grid array `sort` arm — the card’s six-row probe table (objectui#8973)', () => {
  it('CONTROL — a fully-specified entry still lowers to the join string, byte for byte', async () => {
    const params = await findParamsFor({ ...BASE, sort: [{ field: 'name', order: 'desc' }] });
    // The wire shape route B would change and this card keeps.
    expect(params.$orderby).toBe('name desc');
  });

  it('`order` omitted lowers to `asc` — it used to go out as `"name undefined"`', async () => {
    const params = await findParamsFor({ ...BASE, sort: [{ field: 'name' }] });
    expect(params.$orderby).toBe('name asc');
    expect(params.$orderby).not.toContain('undefined');
  });

  it('normalizes only the member that is missing one, leaving its neighbour alone', async () => {
    const params = await findParamsFor({
      ...BASE,
      sort: [{ field: 'name', order: 'desc' }, { field: 'status' }],
    });
    // Was `"name desc, status undefined"`.
    expect(params.$orderby).toBe('name desc, status asc');
  });

  it('an empty array carries NO `$orderby` — it used to send `""`', async () => {
    expectNoOrderBy(await findParamsFor({ ...BASE, sort: [] }));
  });

  it('the retired ARRAY-OF-STRINGS form names no field, so nothing survives', async () => {
    const params = await findParamsFor({ ...BASE, sort: ['name desc'] });
    // Was `"undefined undefined"` — a hard 400 at the server.
    expectNoOrderBy(params);
    // ⭐ The RETURN value above is the half a later reader is most likely to get
    // wrong, so it stays first and it stays unchanged: objectui#9955 moved
    // nothing about it. A string entry still names no field, still survives
    // nothing, and this block still sends no `$orderby`.
    //
    // ⚠️ The DIAGNOSTIC half is what moved. This comment used to read
    // "Deliberately NOT a new refusal diagnostic … dropped exactly as the shared
    // sink drops an unusable entry — silently", and routed the widening to
    // whichever card would own it. objectui#9955 is that card and it landed: the
    // shared sink now REFUSES a string ENTRY out loud, in its own words, because
    // the retirement is about the SPELLING and not about the container the
    // spelling arrives in. ⛔ Loud is still not accepted — that is the line above.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    // Assert what ONLY the entry message says. A bare `toHaveBeenCalled()`, or a
    // match on `objectui#8221`, would be satisfied just as well by the SCALAR
    // refusal — and the input here is an ARRAY, so a pin that cannot tell the two
    // messages apart is not reading this arm at all.
    expect(message).toContain('a `sort` ARRAY ENTRY is the retired string clause');
    expect(message).not.toContain('the legacy string `sort` clause is retired');
    // …and it quotes the entry that arrived, so an author can find it in their JSON.
    expect(message).toContain('"name desc"');
  });

  it('`field` omitted names nothing to order by, so the entry is skipped', async () => {
    // Was `"undefined desc"` — a well-formed sort on a column named `undefined`.
    expectNoOrderBy(await findParamsFor({ ...BASE, sort: [{ order: 'desc' }] }));
  });

  it('drops only the unusable members of a mixed array, keeping the usable one', async () => {
    const params = await findParamsFor({
      ...BASE,
      sort: [{ order: 'desc' }, { field: 'name' }],
    });
    expect(params.$orderby).toBe('name asc');
  });
});

/**
 * objectui#5861 — the legacy `defaultSort` arm #8973 normalized is GONE.
 *
 * `@objectstack/spec` 17.3.0 turned `object-grid`'s `defaultSort` into a
 * retired-key tombstone the protocol refuses by name, and objectui#5861
 * removed the arm (ADR-0049 enforce-or-remove). These three cells pinned it
 * as WORKING; they are flipped rather than deleted, so every shape it used to
 * lower — the fully-specified one included — now asserts NO `$orderby`. The
 * canonical control is the first cell of the six-row table above (`CONTROL —
 * a fully-specified entry still lowers to the join string`), repeated here on
 * the same document so the flip cannot pass because lowering broke outright.
 */
describe('object-grid legacy `defaultSort` arm — RETIRED, nothing lowers (objectui#5861)', () => {
  it('a fully-specified `defaultSort` carries NO `$orderby` — it used to lower to `"name desc"`', async () => {
    expectNoOrderBy(await findParamsFor({ ...BASE, defaultSort: { field: 'name', order: 'desc' } }));
    // CONTROL — the canonical spelling of the same sort, same block, same run.
    const params = await findParamsFor({ ...BASE, sort: [{ field: 'name', order: 'desc' }] });
    expect(params.$orderby).toBe('name desc');
  });

  it('`order` omitted carries NO `$orderby` — it used to lower to `"name asc"`', async () => {
    expectNoOrderBy(await findParamsFor({ ...BASE, defaultSort: { field: 'name' } }));
  });

  it('`field` omitted carries NO `$orderby` — unchanged, and no longer for #8973\'s reason', async () => {
    expectNoOrderBy(await findParamsFor({ ...BASE, defaultSort: { order: 'desc' } }));
  });
});

describe('object-grid — the arms this card deliberately does NOT move', () => {
  it('a header-click sort still sends `SortNode[]` objects, not a join string', () => {
    // Named rather than absorbed (the triage comment asked for exactly this):
    // this block already sends TWO different `$orderby` shapes depending on
    // which arm fires, and that predates this card. The `SortNode[]` form is
    // documented at the read site as deliberate — it is the shape the server
    // names in its own error messages and it survives a field name containing
    // a space. Both shapes are accepted by `normalizeSortNodes`.
    // Rooted at this file, never at the cwd — see `REPO_ROOT` above.
    const src = readFileSync(join(REPO_ROOT, 'packages/plugin-grid/src/ObjectGrid.tsx'), 'utf8');

    // Instrument check FIRST, in both directions: a probe that silently read
    // the wrong file (or an empty one) would make every `toContain` below a
    // vacuous pass, and a `not.toContain` a vacuous one at that.
    expect(src).toContain('export function parseSchemaSort');
    expect(src).not.toContain('a token that is definitely not in this file');

    expect(src).toContain('params.$orderby = headerSort.map((s) => ({ field: s.field, order: s.order }));');
  });

  it('the string `sort` arm is still objectui#8767’s refusal, unchanged', async () => {
    const params = await findParamsFor({ ...BASE, sort: 'name desc' });
    expectNoOrderBy(params);
    // #8758's OWN diagnostic still fires — this card did not absorb it.
    expect(errorSpy).toHaveBeenCalled();
    expect(String(errorSpy.mock.calls[0][0])).toContain('objectui#8221');
  });
});

/**
 * The SAME two members, read by this block's OTHER TWO readers
 * (objectui#8071 slice 17).
 *
 * `sort` is read three times in `ObjectGrid`, and the sections above pin one of
 * them — the fetch path's `"field order"` join. The other two are the
 * server-side EXPORT projection (`{ field, direction }`) and the header-arrow
 * reader {@link parseSchemaSort} (`{ field, order }`). Three readers, three
 * spellings of the same authored member, which is precisely what a declaration
 * saying `[{ field, order }]` cannot publish.
 *
 * ⚠️⚠️ **They do NOT agree, and the disagreement is pinned rather than
 * repaired.** `normalizeSortEntries` folds any `order` that is not `'desc'` to
 * `'asc'` for the wire, and `parseSchemaSort` does the same for the arrow — but
 * the export projection reads `(s.order) ?? 'asc'`, which passes an
 * UNRECOGNISED direction through verbatim. So one authored
 * `{ field: 'name', order: 'descending' }` orders the screen ascending, draws
 * an ascending arrow, and asks the export door for `direction: 'descending'`.
 * ⛔ Not repaired here: objectui#8071 slice 17 is a member PIN, and a fix that
 * changes what the export door receives is a change to a shipped request shape.
 * Reported as a finding instead; this section is the reproduction.
 *
 * ⭐ `exportServer.test.tsx` already pins the HAPPY path of that projection
 * (`order: 'desc'` → `direction: 'desc'`). What is new here is the member
 * disposition on the values that are not already canonical.
 */
describe('object-grid `sort` members — the block’s other two readers (objectui#8071)', () => {
  beforeAll(() => {
    // jsdom has no object-URL plumbing; the download path calls these.
    if (!URL.createObjectURL) (URL as any).createObjectURL = () => 'blob:export';
    if (!URL.revokeObjectURL) (URL as any).revokeObjectURL = () => {};
  });

  /** Drive a server-streamed export and hand back the request it sent. */
  async function exportRequestFor(sort: unknown) {
    const exportDownload = vi
      .fn()
      .mockResolvedValue(new Blob(['ID,Name\n1,Acme'], { type: 'text/csv' }));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const dataSource = {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      getObjectSchema: async (name: string) => ({
        name,
        fields: { id: { type: 'text' }, name: { type: 'text' } },
      }),
      exportDownload,
    } as any;

    render(
      <ActionProvider>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'account',
            columns: [{ field: 'name', label: 'Name' }],
            exportOptions: { formats: ['csv'] },
            sort,
          } as any}
          dataSource={dataSource}
        />
      </ActionProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /export/i }));
    fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
    await waitFor(() => expect(exportDownload).toHaveBeenCalledTimes(1));
    return exportDownload.mock.calls[0][1];
  }

  it('CONTROL — the three readers agree on a canonical `order`', async () => {
    const sort = [{ field: 'name', order: 'desc' }];
    expect((await findParamsFor({ ...BASE, sort })).$orderby).toBe('name desc');
    expect(parseSchemaSort(sort)).toEqual([{ field: 'name', order: 'desc' }]);
    cleanup();
    expect((await exportRequestFor(sort)).sort).toEqual([{ field: 'name', direction: 'desc' }]);
  });

  it('an UNRECOGNISED `order` is normalized for two readers and passed through by the third', async () => {
    const sort = [{ field: 'name', order: 'descending' }];
    // The wire: anything that is not `desc` is `asc`.
    expect((await findParamsFor({ ...BASE, sort })).$orderby).toBe('name asc');
    // The arrow: the same fold, so the screen and the wire agree.
    expect(parseSchemaSort(sort)).toEqual([{ field: 'name', order: 'asc' }]);
    cleanup();
    // The export door: the author's word, verbatim — a THIRD answer from one
    // authored member. Pinned as what ships (see this section's docblock).
    expect((await exportRequestFor(sort)).sort).toEqual([
      { field: 'name', direction: 'descending' },
    ]);
  });

  it('an entry with no `field` is dropped by all three readers', async () => {
    const sort = [{ order: 'desc' }, { field: 'name' }];
    expect((await findParamsFor({ ...BASE, sort })).$orderby).toBe('name asc');
    expect(parseSchemaSort(sort)).toEqual([{ field: 'name', order: 'asc' }]);
    cleanup();
    expect((await exportRequestFor(sort)).sort).toEqual([{ field: 'name', direction: 'asc' }]);
  });
});
