/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6575 — `ObjectDataTable` must not forward a `bind` it has already
 * consumed into the `data-table` node it delegates to.
 *
 * ## Why this test exists in THIS package
 *
 * #6575 makes `data-table` warn when a node carries a `bind`, because
 * `data-table` does not read one — that is the trap the card closes.
 * `ObjectDataTable` DOES read `bind`: `const boundData = useDataScope(schema.bind)`
 * resolves the rows, and the widget then builds its inner node as
 * `{ ...schema, type: 'data-table', data: finalData, … }`. That spread carried
 * the already-consumed `bind` straight through to a component that cannot read
 * it.
 *
 * So a correctly authored `object-data-table` bound with `bind` — the form the
 * published guides TEACH, and which `skill-guide-data-table-binding.test.tsx`
 * pins as a genuine reader — would have printed "your `bind` is ignored" on
 * every render, over rows that were on screen precisely BECAUSE the `bind` had
 * been honoured. A diagnostic that fires on working, taught code is worse than
 * the silence it replaces; `plugin-grid`'s `columnSpellingDiagnostics.ts` says
 * so in as many words about its own predicate.
 *
 * The fix is on the PRODUCER rather than as a tolerance carve-out in the
 * consumer: a key this widget has consumed is this widget's to stop. Its own
 * sibling `DashboardGridLayout` already forwards in exactly that shape —
 * `const { data: _data, ...restOptions } = options`.
 *
 * ## What is measured, and the legs that keep each other honest
 *
 * The node handed to `SchemaRenderer`, captured at the delegation seam (the
 * same `vi.mock` shape the sibling suites in this directory use, so this does
 * not depend on the component registry). Three legs, because any one alone is
 * satisfied by a wrong fix:
 *
 *   1. the forwarded node carries no `bind` — the fix;
 *   2. the rows still arrive — so the `bind` was CONSUMED, not deleted
 *      (leg 1 alone passes if the binding stops working entirely);
 *   3. an unrelated authored key still comes through — so the spread is still
 *      a spread (legs 1-2 alone pass if the whole `...schema` were dropped).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';
import React from 'react';

const captured = vi.hoisted(() => ({ schemas: [] as any[] }));

// Only `SchemaRenderer` is stubbed. `SchemaRendererProvider` and `useDataScope`
// stay REAL — the binding under test has to resolve for real, or leg 2 below
// would be measuring the stub instead of the widget.
vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => {
      captured.schemas.push(schema);
      return (
        <div data-testid="table">
          {(schema.data ?? []).map((row: any, i: number) => (
            <span key={i}>{String(row.name)}</span>
          ))}
        </div>
      );
    },
  };
});

import { ObjectDataTable } from '../ObjectDataTable';
import type { DataSource } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

afterEach(() => {
  cleanup();
  captured.schemas.length = 0;
});

const I18N_CONFIG = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

const ROWS = [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }];

/**
 * The authored form: an `object-data-table` bound with `bind`, as the guides
 * teach it. `caption` is along for leg 3 — an ordinary authored key with no
 * part in this fix, which must still survive the spread.
 */
const BOUND_SCHEMA = {
  type: 'object-data-table',
  bind: 'customers',
  caption: 'Customers',
  columns: ['name'],
} as any;

function renderBound() {
  return render(
    <I18nProvider config={I18N_CONFIG}>
      {/* objectui#9308 — `bind` resolves the ambient predicate scope. The
          adapter seam stays mounted, and is inert for these three legs. */}
      <PredicateScopeProvider scope={{ customers: ROWS }}>
        <SchemaRendererProvider dataSource={{ customers: ROWS } as unknown as DataSource}>
          <ObjectDataTable schema={BOUND_SCHEMA} />
        </SchemaRendererProvider>
      </PredicateScopeProvider>
    </I18nProvider>,
  );
}

function innerNode(): any {
  // Counter-probe: the seam really did capture a delegation. Assertions over an
  // empty capture list would pass vacuously and prove nothing.
  expect(captured.schemas.length).toBeGreaterThan(0);
  const inner = captured.schemas[captured.schemas.length - 1];
  expect(inner.type).toBe('data-table');
  return inner;
}

describe('ObjectDataTable — a consumed `bind` is not forwarded to data-table (#6575)', () => {
  it('leg 1: hands the inner data-table node no `bind` at all', () => {
    renderBound();
    const inner = innerNode();

    // `in`, not a truthiness check: `bind: undefined` present on the node is
    // still a key, and the #6575 predicate is about what was written.
    expect('bind' in inner).toBe(false);
    expect(inner.bind).toBeUndefined();
  });

  it('leg 2: still resolves the bound rows — the `bind` is consumed, not dropped', () => {
    const { getByTestId } = renderBound();
    const inner = innerNode();

    expect(inner.data).toEqual(ROWS);
    expect(getByTestId('table').textContent).toContain('Ada Lovelace');
    expect(getByTestId('table').textContent).toContain('Grace Hopper');
  });

  it('leg 3: unrelated authored keys still come through the spread', () => {
    renderBound();
    const inner = innerNode();

    // `bind` is stopped BY NAME. Nothing else about the delegation moved.
    expect(inner.caption).toBe('Customers');
  });
});
