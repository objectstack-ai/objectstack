import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as ObjectUIReact from '@object-ui/react';
import { ObjectCalendarRenderer } from './index';
import type { DataSource } from '@object-ui/types';

// Partial mock — override ONLY what this test controls, keep every other real
// export (objectui#3219).
//
// A whole-module `vi.mock('@object-ui/react', () => ({ ... }))` used to list
// just `useSchemaContext` + `SchemaRendererContext`. That made the file's
// result depend on HOW the module graph resolved, so the two vitest configs in
// this repo disagreed about it:
//
//   - root `vitest.config.mts` (what CI runs): this file is in `heavyDomTests`,
//     and `vitest.setup.dom.tsx` eagerly imports `@object-ui/components`. That
//     evaluates `components/src/hooks/related-count-store.ts` — which imports
//     `subscribeDataChanges` from `@object-ui/react` — against the REAL module
//     before the mock applies. Green, by accident.
//   - `packages/plugin-calendar/vitest.config.ts` (what `pnpm --filter … test`
//     and `turbo run test` ran AT THE TIME): no such setup, so
//     `@object-ui/components` is first evaluated inside the mocked graph.
//     Vitest 4 hard-errors on a missing export instead of silently yielding
//     `undefined`, so the suite failed to load at all: `No "subscribeDataChanges"
//     export is defined on the "@object-ui/react" mock`.
//
// That second config no longer exists — objectui#3240 deleted all 17 of them and
// made the root config the single entry, so both commands now run the FIRST bullet.
// The history is kept because it is the measurement the fix below was derived from,
// and because the fix outlives it: unification removes the disagreement between two
// configs, not the fragility of a whole-module mock, which would still break the
// moment `@object-ui/react` gains an export this file did not list.
//
// Spreading `importOriginal()` removes the sensitivity: the mock is a superset
// of the real module under either resolution, so a transitive consumer can
// never trip over an export this test never intended to replace. Adding a new
// `@object-ui/react` export can no longer break this file.
vi.mock(import('@object-ui/react'), async (importOriginal) => ({
  ...(await importOriginal()),
  // Only the pieces this test drives:
  // The marker object below is NOT an adapter: the stubbed widget prints
  // `dataSource.type`, which is the whole point of this registration probe.
  // `useSchemaContext` declares the published `DataSource` contract since
  // objectui#7912, so the crossing is explicit; the value is unchanged.
  useSchemaContext: vi.fn(() => ({ dataSource: { type: 'mock-datasource' } as unknown as DataSource })),
}));

// Mock the implementation. Deliberate whole-module replacement of a LOCAL
// module: stubbing `ObjectCalendar` is the isolation boundary this test is
// about, and `./ObjectCalendar`'s only runtime export is the component itself
// (`ObjectCalendarComponentProps` is type-only and erased at runtime).
vi.mock('./ObjectCalendar', () => ({
  ObjectCalendar: ({ dataSource, data, loading }: any) => (
    <div data-testid="calendar-mock">
        {dataSource ? `DataSource: ${dataSource.type}` : 'No DataSource'}
        {data !== undefined ? ` Data: ${JSON.stringify(data)}` : ''}
        {loading !== undefined ? ` Loading: ${loading}` : ''}
    </div>
  )
}));

describe('Plugin Calendar Registration', () => {
  it('renderer passes dataSource from context', () => {
    render(<ObjectCalendarRenderer schema={{ type: 'object-calendar' }} />);
    expect(screen.getByTestId('calendar-mock')).toHaveTextContent('DataSource: mock-datasource');
  });

  it('renderer passes data and loading props through to ObjectCalendar (no double-fetch)', () => {
    const preloadedData = [{ id: 1, name: 'Event A' }];
    render(
      <ObjectCalendarRenderer
        schema={{ type: 'object-calendar' }}
        data={preloadedData}
        loading={false}
      />
    );
    const el = screen.getByTestId('calendar-mock');
    expect(el).toHaveTextContent('Data: [{"id":1,"name":"Event A"}]');
    expect(el).toHaveTextContent('Loading: false');
  });

  // Regression guard for objectui#3219 — keep this test.
  //
  // It pins the exact invariant whose absence made the root config and the
  // package config disagree about this file: the `@object-ui/react` mock must
  // expose every export the real module has. When that holds, no transitive
  // importer of `@object-ui/react` can hit a missing export, so the file
  // behaves identically no matter which config resolved the module (source via
  // the root alias, or `dist` via the package config) and no matter whether a
  // setup file happened to pre-load the consumer first.
  //
  // Deliberately compares export SETS rather than naming `subscribeDataChanges`:
  // naming the one export that broke would just re-arm the same trap for the
  // next export somebody adds.
  it('mocks @object-ui/react as a superset of the real module (pins both run paths to the same result)', async () => {
    const actual = await vi.importActual<typeof ObjectUIReact>('@object-ui/react');

    const missing = Object.keys(actual)
      .filter((name) => !(name in ObjectUIReact))
      .sort();

    expect(missing).toEqual([]);
  });
});
