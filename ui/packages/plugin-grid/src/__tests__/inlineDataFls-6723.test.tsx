/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6723 — field-level security on `generateColumns()`'s INLINE-DATA
 * path, and the limit that makes it safe.
 *
 * ## The defect
 *
 * `generateColumns()` re-applied FLS at exactly one place: the object-schema
 * path (`if (perms?.isLoaded && schema.objectName && !perms.checkField(...))
 * return;`). The inline-data path — taken when a host hands rows down as `data`
 * AND the author declared a `fields` projection — had no equivalent check. Both
 * paths serve object-bound grids, so the same object with the same authored
 * projection did or did not re-check FLS purely according to WHO FETCHED THE
 * ROWS:
 *
 *   grid fetches, `fields` declared   -> object-schema path -> FLS re-applied
 *   host passes `data`, `fields`      -> inline-data path   -> FLS SKIPPED
 *
 * A security invariant may not be decided by the data's provenance. Maintainer
 * ruling 2026-08-29: take the NARROW defence-in-depth fix.
 *
 * ## The limit is the point, not an optimisation
 *
 * Only keys the OBJECT DECLARES are judged. Host-joined and derived keys pass
 * through untouched, because keeping them is this path's whole reason to exist
 * (the object-schema path drops them outright: `if (!field) return;`). Judging
 * them would silently drop derived columns — the failure the issue's own
 * analysis warned about, and the one the ruling refuses by name.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * `PermissionProvider` (role-based) answers `true` for a field no policy
 * mentions, so under it a derived key survives whether or not the guard judges
 * it — the limit above would be untestable, and PIN 3 would be green in both
 * worlds for the wrong reason. The stub therefore models the shape a server
 * that ENUMERATES readable fields produces: deny anything not listed. That is
 * the only policy shape under which the limit is load-bearing, so it is the one
 * the limit is pinned against. The real provider still gets a case of its own
 * (WIRING below), so nothing here rests solely on an imitation.
 *
 * ## ABLATION — guard removed (this file restored to d06059f24), this file only
 *
 * 2 red / 6 green. Both reds are the same assertion asked twice, once of the
 * stub and once of the real provider — which is what says the fix is wired to
 * the actual gate and not only to the shape of a double:
 *
 *   x PIN 2 — a declared field the principal cannot read is NOT rendered
 *       -> AssertionError: expected [ 'Opportunity Name', 'Salary' ] to deeply
 *          equal [ 'Opportunity Name' ]
 *   x WIRING — the REAL PermissionProvider gate drops the denied column
 *       -> AssertionError: expected [ 'Opportunity Name', 'Salary' ] to deeply
 *          equal [ 'Opportunity Name' ]
 *
 * PIN 1, PIN 3, PIN 3b and the three controls DID NOT MOVE, which is the half
 * that says the guard is narrow: they are the boundaries it must not cross, not
 * restatements of it. Restoring the guard returns the file to 8 green.
 *
 * `vitest.config.mts` aliases every `@object-ui/*` specifier to that package's
 * `src`, and this file imports `../ObjectGrid` relatively, so no build step
 * stands between the edit and the run — the ablation reads source directly, and
 * the mutation was confirmed on disk by blob hash before the run.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

/**
 * Stable stub identity: `ObjectGrid` carries `perms` in `useCallback` /
 * `useMemo` dependency arrays, so a fresh object per call would churn those
 * memos on every render. Same hoisted-state shape as
 * `inlineEditPermissionGate.test.tsx`.
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
// `PermissionProvider` gate rather than a hand-written imitation of it. The
// real hook is invoked on every render so hook order is stable whichever branch
// is returned.
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
 * Rows exactly as a host hands them down — INCLUDING a payload for the denied
 * field. That is what makes PIN 2 about the grid and not about the fetch: the
 * value is right there in memory and must still not reach the screen.
 */
const HOST_ROWS = [
  { id: 'o-1', name: 'Acme expansion', amount: 42000, salary: 120000, computed_score: 'A+' },
];

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    // A host owns the fetch, so the grid must never call this.
    find: vi.fn(async () => ({ data: [], total: 0 })),
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

function renderHostFedGrid(
  schemaOverrides: Record<string, unknown> = {},
  dataSource?: any,
  wrap?: (el: React.ReactElement) => React.ReactElement,
) {
  const ds = dataSource ?? makeDataSource();
  const schema: any = { type: 'object-grid', objectName: OBJECT, ...schemaOverrides };
  const inner = (
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds} data={HOST_ROWS} />
    </ActionProvider>
  );
  const utils = render(wrap ? wrap(inner) : inner);
  return { ...utils, ds };
}

describe('ObjectGrid — FLS on the inline-data path (#6723)', () => {
  it('PIN 1 — a declared field the principal CAN read renders its column', async () => {
    state.readable = ['name', 'amount'];
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'amount'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Amount']));

    // The positive half: a guard that dropped everything would also satisfy
    // PIN 2, so the readable columns have to be pinned present.
    expect(screen.getByText('Acme expansion')).toBeInTheDocument();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('PIN 2 — a declared field the principal CANNOT read does not render, even with host data for it', async () => {
    state.readable = ['name'];
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'salary'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name']));

    // The absence half, twice over: not the header, and not the VALUE the host
    // already put in the payload. `120000` is `salary` on the only row.
    expect(dataHeaders(container)).not.toContain('Salary');
    expect(screen.queryByText('120000')).toBeNull();
  });

  it('PIN 3 — a key the object does not declare is unaffected by the gate', async () => {
    // `computed_score` is not an object field, and the allowlist does not name
    // it, so a guard that judged undeclared keys would drop it here. That drop
    // is the failure mode the ruling refuses by name.
    state.readable = ['name'];
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'computed_score'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Computed score']));
    expect(screen.getByText('A+')).toBeInTheDocument();
  });

  it('PIN 3b — an INHERITED name is not mistaken for a declared field', async () => {
    // `objectSchema.fields.constructor` resolves through the prototype chain,
    // so a truthiness read (`fields?.[name]`) would call it declared, ask the
    // allowlist about it, and drop a derived column named `constructor`. The
    // guard reads `hasOwnProperty` for exactly this reason.
    state.readable = ['name'];
    const rows = [{ ...HOST_ROWS[0], constructor: 'derived-value' }];
    const ds = makeDataSource();
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', objectName: OBJECT, fields: ['name', 'constructor'] } as any}
          dataSource={ds}
          data={rows}
        />
      </ActionProvider>,
    );

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toContain('Constructor'));
  });

  /* ------------------------------------------------------------------ *
   * Boundaries — green in BOTH worlds. Controls, not restatements.      *
   * ------------------------------------------------------------------ */

  it('CONTROL — permissions not loaded yet: nothing is filtered', async () => {
    // `/me/permissions` has not answered. The existing object-schema gate defers
    // in exactly this case (`perms?.isLoaded &&`), and so must this one: a grid
    // that blanked its columns while perms were in flight would be a worse
    // defect than the one being fixed.
    state.isLoaded = false;
    state.readable = [];
    const { container, ds } = renderHostFedGrid({ fields: ['name', 'salary'] });

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() =>
      expect(dataHeaders(container)).toEqual(['Opportunity Name', 'Salary']));
  });

  it('CONTROL — no `objectName`: a pure inline-data grid is untouched', async () => {
    // No object behind the data means no policy to apply. `checkField` needs an
    // object to answer about, and the existing gate reads `schema.objectName`
    // for the same reason.
    state.readable = [];
    const { container } = render(
      <ActionProvider>
        <ObjectGrid
          schema={{ type: 'object-grid', fields: ['name', 'salary'] } as any}
          data={HOST_ROWS}
        />
      </ActionProvider>,
    );

    await waitFor(() => expect(screen.getByText('Acme expansion')).toBeInTheDocument());
    expect(dataHeaders(container)).toEqual(['Name', 'Salary']);
  });

  it('CONTROL — object schema still in flight: the row-key fallback is untouched', async () => {
    // `objectSchema` is `null`, so NOTHING is declared yet and every key is a
    // derived key as far as this gate can tell. First paint keeps the row keys
    // rather than blanking (the boundary #6677 pinned), and the gate must not
    // move that.
    state.readable = [];
    const pending = new Promise(() => { /* never resolves */ });
    const ds = makeDataSource({ getObjectSchema: vi.fn(() => pending) });
    const { container } = renderHostFedGrid({}, ds);

    // objectui#10657: with the schema in flight an untyped column is WITHHELD
    // (drawn as the mask, never as text), so the row is waited for by its mask,
    // not by the raw name it used to print.
    await waitFor(() => expect(container.querySelector('tbody')?.textContent ?? '').toContain('••••••'));
    expect(screen.queryByText('Acme expansion')).toBeNull();
    expect(dataHeaders(container)).toEqual(['Id', 'Name', 'Amount', 'Salary', 'Computed score']);
  });

  it('WIRING — the REAL PermissionProvider gate drops the denied declared column', async () => {
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

    const { container, ds } = renderHostFedGrid({ fields: ['name', 'salary'] }, undefined, (el) => (
      <PermissionProvider roles={roles} permissions={permissions} userRoles={['restricted']}>
        {el}
      </PermissionProvider>
    ));

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith(OBJECT));
    await waitFor(() => expect(dataHeaders(container)).toEqual(['Opportunity Name']));
    expect(screen.queryByText('120000')).toBeNull();
  });
});
