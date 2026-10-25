/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6799 — field-level security on `generateColumns()`'s AUTHORED
 * `columns` path, the third and last of its three default paths.
 *
 * ## The defect
 *
 * `generateColumns()` has three default paths. After objectui#6723 two of them
 * re-applied FLS and the authored `columns` path did not:
 *
 *   `schema.columns` authored          -> authored path     -> FLS SKIPPED
 *   host passes `data`, `fields`       -> inline-data path  -> FLS (objectui#6723)
 *   neither                            -> object-schema     -> FLS
 *
 * This path is the MOST REACHABLE of the three, which is what separates it from
 * objectui#6723: the inline-data path needs the host to hand rows down, while
 * the authored path runs whether the grid fetches its own rows or not. Every
 * case below therefore lets the GRID fetch (no `data` prop) except the one that
 * pins the host-fed shape explicitly.
 *
 * Maintainer ruling 2026-08-30: take the same defence-in-depth fix as
 * objectui#6723, three paths consistent.
 *
 * ## The limit is the point, not an optimisation
 *
 * Only keys the OBJECT DECLARES are judged. Host-joined and derived keys pass
 * through untouched. A `ListColumn` carries `label` / `link` / `action` /
 * `prefix` / `width`, and a column whose `field` the object does not declare is
 * a legitimate authored derived column — judging it would silently delete
 * authored work, which the ruling refuses by name. PIN 3 and PIN 3b are that
 * boundary, and a fix that passed PIN 2 by dropping everything fails them.
 *
 * ## Which key is judged — never a bare string
 *
 * The ruling is explicit: for the `ListColumn[]` arm the judged key is read
 * through `columnIdentity` / `resolvesToDataColumn`, not off a bare string.
 * `columnIdentity` accepts all three authored shapes (`'stage'`,
 * `{ field: 'stage' }`, and the legacy `{ name: 'stage' }`), which is why one
 * predicate serves both arms. PIN 5 pins the legacy spelling specifically: a
 * bare-string read would see no identity there and wave the column through.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * Inherited verbatim from `inlineDataFls-6723.test.tsx`, for the same reason:
 * `PermissionProvider` (role-based) answers `true` for a field no policy
 * mentions, so under it a derived key survives whether or not the guard judges
 * it — the limit would be untestable and PIN 3 green in both worlds for the
 * wrong reason. The stub models a server that ENUMERATES readable fields. The
 * real provider still gets a case of its own (WIRING), so nothing here rests
 * solely on an imitation.
 *
 * ## ABLATION — see the PR body for the recorded run.
 *
 * `vitest.config.mts` aliases every `@object-ui/*` specifier to that package's
 * `src`, and this file imports `../ObjectGrid` relatively, so no build step
 * stands between the edit and the run — the ablation reads source directly.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

/**
 * Stable stub identity: `ObjectGrid` carries `perms` in `useCallback` /
 * `useMemo` dependency arrays, so a fresh object per call would churn those
 * memos on every render.
 */
const { permsStub, state } = vi.hoisted(() => {
  const state: {
    /** Has `/me/permissions` answered yet? `false` = defer, filter nothing. */
    isLoaded: boolean;
    /** Fields this principal may READ. Anything absent is denied. */
    readable: string[];
    /** Bypass the stub and run the REAL provider-backed hook instead. */
    useRealProvider: boolean;
  } = { isLoaded: true, readable: [], useRealProvider: false };
  return {
    state,
    permsStub: {
      get isLoaded() { return state.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? state.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

// The real module stays reachable so the WIRING case below exercises the ACTUAL
// `PermissionProvider` gate rather than a hand-written imitation of it.
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return state.useRealProvider ? real : (permsStub as any);
    },
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';
import { PermissionProvider } from '@object-ui/permissions';
import type { ObjectPermissionConfig, RoleDefinition } from '@object-ui/types';

registerAllFields();

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  state.isLoaded = true;
  state.readable = [];
  state.useRealProvider = false;
});
afterEach(() => cleanup());

const OBJECT = 'opportunity';

/**
 * `salary` is the field under test: DECLARED by the object and denied to this
 * principal. `computed_score` is deliberately NOT declared — it is the
 * host-joined / derived key the limit protects.
 */
const OPPORTUNITY_SCHEMA = {
  name: OBJECT,
  label: 'Opportunity',
  fields: {
    name: { type: 'text', label: 'Opportunity Name' },
    amount: { type: 'currency', label: 'Amount', currency: 'USD' },
    salary: { type: 'number', label: 'Salary' },
  },
};

/**
 * Rows as the grid's own fetch returns them — INCLUDING a payload for the
 * denied field, which is what makes PIN 2 about the renderer: the value is in
 * memory and must still not reach the screen.
 */
const ROWS = [
  { id: 'o-1', name: 'Acme expansion', amount: 42000, salary: 120000, computed_score: 'A+' },
];

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => OPPORTUNITY_SCHEMA),
    ...overrides,
  } as any;
}

/**
 * The DATA columns' header labels, in render order. Two kinds of furniture are
 * dropped: cells with no header text (selection checkbox, row-action kebab) and
 * the row-index column, whose header is a literal `#`.
 */
function dataHeaders(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th'))
    .map((th) => (th.textContent ?? '').trim())
    .filter((text) => text.length > 0 && text !== '#');
}

/**
 * No `data` prop: the GRID fetches. That is the reachability claim this card
 * turns on, so it is the default shape here rather than an extra case.
 */
function renderAuthoredGrid(
  schemaOverrides: Record<string, unknown> = {},
  dataSource?: any,
  wrap?: (el: React.ReactElement) => React.ReactElement,
) {
  const ds = dataSource ?? makeDataSource();
  const schema: any = { type: 'object-grid', objectName: OBJECT, ...schemaOverrides };
  const inner = (
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} />
    </ActionProvider>
  );
  const utils = render(wrap ? wrap(inner) : inner);
  return { ...utils, ds };
}

describe('ObjectGrid — FLS on the authored `columns` path (#6799)', () => {
  /* ------------------------------------------------------------------ *
   * The security pins. Both arms, because both are in the ruling.       *
   * ------------------------------------------------------------------ */

  it('PIN 1 — ListColumn[]: a declared field the principal CAN read renders its column', async () => {
    state.readable = ['name', 'amount'];
    const { container, ds } = renderAuthoredGrid({
      columns: [{ field: 'name' }, { field: 'amount' }],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Amount']));

    // The positive half: a guard that dropped everything would also satisfy
    // PIN 2, so the readable columns have to be pinned present.
    expect(screen.getByText('Acme expansion')).toBeInTheDocument();
  });

  it('PIN 2 — ListColumn[]: a declared field the principal CANNOT read does not render', async () => {
    state.readable = ['name'];
    const { container, ds } = renderAuthoredGrid({
      columns: [{ field: 'name' }, { field: 'salary', label: 'Salary' }],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name']));

    // The absence half, twice over: not the header, and not the VALUE the fetch
    // already put in the row. `120000` is `salary` on the only row.
    expect(dataHeaders(container)).not.toContain('Salary');
    expect(screen.queryByText('120000')).toBeNull();
  });

  it('PIN 2b — string[]: a declared field the principal CANNOT read does not render', async () => {
    state.readable = ['name'];
    const { container, ds } = renderAuthoredGrid({ columns: ['name', 'salary'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('120000')).toBeNull();
  });

  it('PIN 2c — the host-fed shape reaches the same gate', async () => {
    // `if (cols)` is judged before the inline-data path, so an authored
    // projection wins even when a host hands rows down. Same defect, other
    // door — and the door objectui#6723 did NOT close.
    state.readable = ['name'];
    const ds = makeDataSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', 'salary'] } as any}
          dataSource={ds}
          data={ROWS}
        />
      </ActionProvider>,
    );

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('120000')).toBeNull();
  });

  /* ------------------------------------------------------------------ *
   * Boundaries — green in BOTH worlds. Controls, not restatements.      *
   * ------------------------------------------------------------------ */

  it('PIN 3 — a key the object does not declare survives (host-joined / derived)', async () => {
    // `computed_score` is not an object field and the allowlist does not name
    // it, so a guard that judged undeclared keys would delete this authored
    // column. That drop is the failure the ruling refuses by name.
    state.readable = ['name'];
    const { container, ds } = renderAuthoredGrid({
      columns: [{ field: 'name' }, { field: 'computed_score', label: 'Score' }],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Score']));
    expect(screen.getByText('A+')).toBeInTheDocument();
  });

  it('PIN 3b — an INHERITED name is not mistaken for a declared field', async () => {
    // `objectSchema.fields.constructor` resolves through the prototype chain,
    // so a truthiness read (`fields?.[name]`) would call it declared, ask the
    // allowlist about it, and drop a derived column named `constructor`.
    state.readable = ['name'];
    const ds = makeDataSource({
      find: vi.fn(async () => ({
        data: [{ ...ROWS[0], constructor: 'derived-value' }],
        total: 1,
      })),
    });
    const { container } = renderAuthoredGrid({ columns: ['name', 'constructor'] }, ds);

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toContain('Constructor'));
  });

  it('PIN 4 — a derived column keeps its authored furniture, not just its slot', async () => {
    // The over-eager-filter failure has a quieter form than deletion: keeping
    // the column but losing what a `ListColumn` carries. `label` is the visible
    // one, so it is the one pinned.
    state.readable = ['name'];
    const { container, ds } = renderAuthoredGrid({
      columns: [
        { field: 'name' },
        { field: 'computed_score', label: 'Fit Score', width: 120 },
      ],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Fit Score']));
  });

  it('PIN 5 — the legacy `{ name }` identity spelling is judged too', async () => {
    // `columnIdentity` folds `field` / `name` / `fieldName`. A gate that read a
    // bare `col.field` would find no identity here and wave a DENIED declared
    // field straight through — the exact failure the ruling forbids by naming
    // `columnIdentity` as the reader.
    state.readable = ['name'];
    const { container, ds } = renderAuthoredGrid({
      columns: [{ field: 'name' }, { name: 'salary', field: 'salary' }],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('120000')).toBeNull();
  });

  it('CONTROL — permissions not loaded yet: nothing is filtered', async () => {
    // `/me/permissions` has not answered. The other two paths defer in exactly
    // this case (`perms?.isLoaded &&`), and so must this one: a grid that
    // blanked its columns while perms were in flight would be a worse defect
    // than the one being fixed.
    state.isLoaded = false;
    state.readable = [];
    const { container, ds } = renderAuthoredGrid({ columns: ['name', 'salary'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Salary']));
  });

  it('CONTROL — no `objectName`: an object-less grid is untouched', async () => {
    // No object behind the columns means no policy to apply. `checkField` needs
    // an object to answer about, and the other two gates read
    // `schema.objectName` for the same reason.
    state.readable = [];
    const ds = makeDataSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', columns: ['name', 'salary'] } as any}
          data={ROWS}
          dataSource={ds}
        />
      </ActionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    expect(dataHeaders(container)).toEqual(['Name', 'Salary']);
  });

  it('CONTROL — object schema still in flight: authored columns are untouched', async () => {
    // `objectSchema` is `null`, so NOTHING is declared yet and every key is a
    // derived key as far as this gate can tell. Deferring here is the same
    // fail-open the declared-key limit already implies; blanking a grid while
    // its schema loads would be the worse defect.
    state.readable = [];
    const pending = new Promise(() => { /* never resolves */ });
    const ds = makeDataSource({ getObjectSchema: vi.fn(() => pending) });
    // Rows come from the HOST here. A grid that fetches its own rows waits on
    // the object schema and would sit on a spinner forever, pinning nothing.
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, columns: ['name', 'salary'] } as any}
          dataSource={ds}
          data={ROWS}
        />
      </ActionProvider>,
    );

    // objectui#10657: with the schema in flight an untyped column is WITHHELD
    // (drawn as the mask, never as text), so the row is waited for by its mask,
    // not by the raw name it used to print.
    await waitFor(() => expect(container.querySelector('tbody')?.textContent ?? '').toContain('••••••'));
    expect(screen.queryByText('Acme expansion')).toBeNull();
    expect(dataHeaders(container)).toEqual(['Name', 'Salary']);
  });

  it('CONTROL — hidden columns stay dropped and unresolvable ones stay dropped', async () => {
    // `resolvesToDataColumn` runs before the field gate and must keep owning
    // its own decisions. A gate bolted on ahead of it would resurrect a hidden
    // column or a mis-spelled one.
    state.readable = ['name', 'amount'];
    const { container, ds } = renderAuthoredGrid({
      columns: [
        { field: 'name' },
        { field: 'amount', hidden: true },
        { accessorKey: 'salary' },
      ],
    });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
  });

  it('WIRING — the REAL PermissionProvider gate drops the denied authored column', async () => {
    // Everything above runs against the stub. This case runs the actual
    // `@object-ui/permissions` provider end to end, so the fix is pinned to the
    // real `checkField` and not only to the shape of a double.
    state.useRealProvider = true;
    const roles: RoleDefinition[] = [{ name: 'restricted', label: 'Restricted' }];
    const permissions: ObjectPermissionConfig[] = [
      {
        object: OBJECT,
        roles: {
          restricted: {
            actions: ['read'],
            fieldPermissions: [{ field: 'salary', read: false, write: false }],
          },
        },
      },
    ];

    const { container, ds } = renderAuthoredGrid(
      { columns: [{ field: 'name' }, { field: 'salary' }] },
      undefined,
      (el) => (
        <PermissionProvider roles={roles} permissions={permissions} userRoles={['restricted']}>
          {el}
        </PermissionProvider>
      ),
    );

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('120000')).toBeNull();
  });
});
