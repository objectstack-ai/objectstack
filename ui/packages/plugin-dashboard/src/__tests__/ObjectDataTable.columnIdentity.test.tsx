/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectDataTable` resolves column identity at the PRODUCER (objectui#5120).
 *
 * `data-table` is an adapter: its column key is `accessorKey`
 * (`TableColumn.accessorKey`, `@object-ui/types`), which `@object-ui/core`
 * deliberately holds OUTSIDE the metadata identity fold — `column-identity.ts`
 * names it `TABLE_ADAPTER_COLUMN_KEY` for exactly that reason. `normalizeColumns`
 * used to hand object columns to that adapter raw, so a column authored in the
 * spec-canonical spelling (`{ field: 'stage' }`) arrived with no `accessorKey`
 * at all: the widget rendered a header over `row[undefined]` — blank cells, no
 * warning — and `computeLookupExpand`'s `$expand` whitelist missed the same
 * column, so a lookup cell showed a raw FK id.
 *
 * The fix is the one objectui#5022 made in `RelatedList` and objectui#5068
 * generalized in `ObjectGrid`, stated there in one line: *metadata vocabulary
 * in, adapter vocabulary out; one translation, one place*. This file pins the
 * producer half of it for the dashboard's table widget.
 *
 * SCOPE. objectui#5120 also rules that `data-table`'s undeclared `col.name`
 * alias (`data-table.tsx:777` / `:786`) retires. That half is NOT implemented
 * here and is NOT pinned here: the card's census-first fork clause tripped —
 * `skills/objectui/guides/data-integration.md` and
 * `skills/objectui/guides/schema-expressions.md` both instruct authors to spell
 * a `data-table` column `{ "name": …, "label": … }`, which is real authorized
 * usage of the limb, so the deletion went back to the maintainer. Everything
 * below is true with the alias in place and stays true after it goes: the
 * producer stamps `accessorKey`, which is the one key the adapter declares.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';

// The REAL renderers, imported at module scope (never behind a lazy boundary
// inside a bounded test window — AGENTS.md §测试纪律). `@object-ui/components`
// registers `data-table` as an import side effect, which is what the seam
// tests below resolve through.
import '@object-ui/components';

vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    // Delegate to the REAL registered renderer for the node the widget emits.
    // A hand-written stand-in would re-implement the adapter's accessor rule,
    // and then the test would pin the stand-in rather than the seam.
    SchemaRenderer: ({ schema }: any) => {
      const Cmp = ComponentRegistry.get(schema.type) as any;
      if (!Cmp) throw new Error(`${schema.type} not registered`);
      return <Cmp schema={schema} />;
    },
    useDataScope: () => undefined,
    SchemaRendererContext: actual.SchemaRendererContext,
  };
});

import { ObjectDataTable, normalizeColumns, computeLookupExpand } from '../ObjectDataTable';

const ROWS = [
  { id: '1', stage: 'Won', amount: 100 },
  { id: '2', stage: 'Lost', amount: 200 },
];

function renderWidget(columns: unknown[]) {
  return render(
    <ObjectDataTable
      schema={{ type: 'object-data-table', data: ROWS, columns, pagination: false, searchable: false } as any}
    />,
  );
}

/** Every rendered body cell's text, row-major. */
function bodyCells(): string[] {
  return Array.from(document.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

describe('ObjectDataTable — normalizeColumns resolves identity at the producer (#5120)', () => {
  it('stamps the adapter key from the spec-canonical `field`', () => {
    // THE FIX. `field` is `ListColumnSchema`'s only required key and the one
    // `columnIdentity` calls canonical; before this card it was invisible here.
    expect(normalizeColumns([{ field: 'stage', header: 'Stage' }])).toEqual([
      { field: 'stage', header: 'Stage', accessorKey: 'stage' },
    ]);
  });

  it('stamps the adapter key from the legacy `name` spelling too', () => {
    // Not a second contract: `name` is a LEGACY_COLUMN_IDENTITY_KEY that the
    // shared `columnIdentity` reader owns (objectui#3104). Reading it HERE is
    // what lets the adapter stop reading it — the translation happens once, in
    // the producer, instead of twice in two vocabularies.
    expect(normalizeColumns([{ name: 'stage', header: 'Stage' }])).toEqual([
      { name: 'stage', header: 'Stage', accessorKey: 'stage' },
    ]);
  });

  it('never overwrites an author-supplied accessorKey, even against a divergent field', () => {
    // Mirror, don't move (`RelatedList`'s rule): a deliberate divergence
    // between the table slot and the metadata key belongs to the author.
    const authored = { accessorKey: 'slot', field: 'stage', header: 'Stage' };
    const [out] = normalizeColumns([authored]);
    expect(out).toBe(authored);
    expect(out.accessorKey).toBe('slot');
  });

  it('returns an already-canonical entry BY REFERENCE', () => {
    // Load bearing, not a micro-optimisation: data-table re-seeds its column
    // state whenever the list is a new object (objectui#4618) and this widget
    // rebuilds its node on every render.
    const authored = { accessorKey: 'stage', header: 'Stage' };
    expect(normalizeColumns([authored])[0]).toBe(authored);
  });

  it('returns an entry with NO resolvable identity untouched — nothing is invented', () => {
    const orphan = { header: 'Mystery' };
    const [out] = normalizeColumns([orphan]);
    expect(out).toBe(orphan);
    expect(out).not.toHaveProperty('accessorKey');
  });

  it('still expands the bare string shorthand into header + accessorKey', () => {
    expect(normalizeColumns(['stage_name'])).toEqual([{ header: 'Stage Name', accessorKey: 'stage_name' }]);
  });
});

describe('ObjectDataTable — the $expand whitelist reads the same identity (#5120)', () => {
  const objectSchema = {
    fields: {
      account: { type: 'lookup', reference: 'accounts' },
      stage: { type: 'text' },
    },
  };

  it('expands a `field`-spelled lookup column', () => {
    // Was `[]`: the whitelist resolved `c.accessorKey || c.name`, so a
    // canonical column never entered it and its cell showed a raw FK id.
    expect(computeLookupExpand({ columns: [{ field: 'account' }], objectName: 'opp' }, objectSchema)).toEqual([
      'account',
    ]);
  });

  it('still expands `name`-spelled and `accessorKey`-spelled lookup columns', () => {
    expect(computeLookupExpand({ columns: [{ name: 'account' }] }, objectSchema)).toEqual(['account']);
    expect(computeLookupExpand({ columns: [{ accessorKey: 'account' }] }, objectSchema)).toEqual(['account']);
    expect(computeLookupExpand({ columns: ['account'] }, objectSchema)).toEqual(['account']);
  });

  it('leaves a non-relational column out of $expand', () => {
    expect(computeLookupExpand({ columns: [{ field: 'stage' }] }, objectSchema)).toEqual([]);
  });
});

describe('ObjectDataTable to data-table — the producer→adapter seam (#5120)', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  it('renders the cells of a `field`-spelled column', () => {
    // The half of this card that FIXES rather than removes. Before the producer
    // resolved identity, this rendered two headers over `row[undefined]`.
    renderWidget([
      { field: 'stage', header: 'Stage' },
      { field: 'amount', header: 'Amount' },
    ]);

    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(bodyCells()).toEqual(['Won', '100', 'Lost', '200']);
  });

  it('renders a declared `accessorKey` column exactly as before', () => {
    renderWidget([
      { accessorKey: 'stage', header: 'Stage' },
      { accessorKey: 'amount', header: 'Amount' },
    ]);

    expect(bodyCells()).toEqual(['Won', '100', 'Lost', '200']);
  });

  it('leaves an unresolvable column standing — and illegible', () => {
    // LEGIBILITY, pinned as behaviour rather than left as folklore, and pinned
    // as MEASURED rather than as assumed. A column whose identity resolves to
    // nothing is not dropped and does not throw: its header renders over empty
    // cells and its neighbour is unaffected.
    //
    // It is not quite silent, and the noise is the interesting part. The
    // adapter keys each cell by the accessor — `key={col.accessorKey}` at
    // `data-table.tsx:1829` — so an unresolved column hands React `undefined`
    // and React emits its generic missing-key warning. That warning names
    // `tr` and `DataTableRenderer`; it names neither the column nor the
    // metadata that produced it, so it points an author at React's docs rather
    // than at the key they mis-spelled. Nothing in ObjectUI's own voice is
    // said at all. This is unchanged by this card — such a column carried no
    // `accessorKey` before it either — and it is the same silence
    // objectui#5349 is weighing for `ObjectGrid`; deliberately NOT answered
    // here.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderWidget([
      { field: 'stage', header: 'Stage' },
      { header: 'Mystery' },
    ]);

    expect(screen.getByText('Mystery')).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const said = [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.join(' '));
    // Not one word about the column, the key, or ObjectUI.
    expect(said.some((line) => /Mystery|accessorKey|column|ObjectUI/i.test(line))).toBe(false);
    // The only thing said at all is React's generic missing-key warning.
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/unique "key" prop/);

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
