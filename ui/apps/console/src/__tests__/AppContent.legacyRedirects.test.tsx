// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The console host's legacy URL redirects land on the CANONICAL metadata-admin
 * routes in one hop, never on the deprecated alias (objectui#3639).
 *
 * ## What was wrong
 *
 * `ObjectRedirect` and `MetadataRedirect` rewrote onto
 * `…/component/metadata/resource[/:name]?type=:type`. app-shell declares that
 * spelling as a legacy *alias* — its route element is `LegacyMetadataRedirect`,
 * which immediately `<Navigate>`s onto `…/metadata/:type[/:name]`. So every
 * `system/metadata/*` and `system/objects/*` URL took two hops to a place the
 * host could name directly, and both docblocks called the alias "the engine
 * route", which is how the #3610 dispatch came to believe `component/…` was
 * canonical (it is the opposite).
 *
 * ## What these tests measure
 *
 * `ChainRecorder` records every distinct location the router settles on, so the
 * assertion is about the *chain*, not only its endpoint. Endpoint-only
 * assertions cannot tell a one-hop rewrite from a two-hop one — both finish at
 * `…/metadata/object` — which is exactly the property this issue is about.
 *
 * The route table below declares the canonical routes AND the alias routes as
 * terminal probes. That is what makes the direction falsifiable: restore either
 * redirect's old target and the alias probe renders, the canonical probe does
 * not, and the recorded chain ends on `component/metadata/resource`.
 *
 * `systemRoutes` is imported from the module under test rather than transcribed
 * here on purpose. app-shell's own `AppContent.noAppComponentRoutes.test.tsx`
 * had to copy `MetadataRedirect` (it cannot import across Vitest projects) and
 * annotated the copy "keep identical to the original" — a copy is exactly what
 * this file must not become.
 *
 * ## Since objectstack ADR-0146 D1 (N-28)
 *
 * Setup carries no metadata editor and no metadata catalog, and app-shell's
 * canonical `…/metadata/*` routes themselves redirect into Studio's "All
 * metadata" area. Aiming at them would be the same two-hop shape this file was
 * written against, one level up, so the host now aims at Studio directly:
 * `/studio/<leg>/metadata/…`, the query kept (`?package=`, `?scope=`,
 * `?review=`). A datasource is the exception — it stays in Setup — and still
 * lands on the canonical route. The canonical probes are kept, so a host that
 * drifted back onto them renders them and fails.
 *
 * ## Scope
 *
 * This measures the HOST's rewrite only. What app-shell then does with the
 * alias (`LegacyMetadataRedirect`) is pinned by app-shell's own tests; the
 * alias route is deliberately kept alive for bookmarks and external links, and
 * nothing here asks for its removal.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';

import { systemRoutes } from '../AppContent';

/**
 * Records every distinct location the router settles on. `<Navigate replace>`
 * re-renders the tree once per hop, so a two-hop chain shows up as three
 * entries and a one-hop chain as two.
 */
function ChainRecorder({ sink }: { sink: string[] }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}${location.hash}`;
  if (sink[sink.length - 1] !== here) sink.push(here);
  return null;
}

/** Terminal probe: reports which route matched and with which params. */
function Probe({ id }: { id: string }) {
  const params = useParams();
  return <div data-testid={id}>{JSON.stringify(params)}</div>;
}

/**
 * The destinations both spellings compete for. `metadata/*` mirrors app-shell's
 * canonical metadata-admin routes; `component/metadata/*` mirrors the legacy
 * aliases it declares alongside them. Here both are terminal — this file asks
 * *which one the host aims at*, not what the alias does afterwards.
 */
function renderAt(url: string): string[] {
  const chain: string[] = [];
  render(
    <MemoryRouter initialEntries={[url]}>
      <ChainRecorder sink={chain} />
      <Routes>
        <Route path="/apps/:appName">
          {systemRoutes}
          <Route path="metadata" element={<Probe id="canonical-directory" />} />
          <Route path="metadata/:type" element={<Probe id="canonical-list" />} />
          <Route path="metadata/:type/:name" element={<Probe id="canonical-item" />} />
          <Route path="component/metadata/directory" element={<Probe id="alias-directory" />} />
          <Route path="component/metadata/resource/*" element={<Probe id="alias-resource" />} />
          <Route path="component/metadata/resource" element={<Probe id="alias-resource" />} />
        </Route>
        {/* The Studio app the host mounts beside `/apps/*` (objectstack ADR-0146 D1). */}
        <Route path="/studio/*" element={<Probe id="studio" />} />
        <Route path="*" element={<Probe id="unmatched" />} />
      </Routes>
    </MemoryRouter>,
  );
  return chain;
}

/** No alias route may appear anywhere in the chain, not merely at its end. */
function expectNoAliasAnywhere(chain: string[]) {
  expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
  expect(screen.queryByTestId('alias-resource')).not.toBeInTheDocument();
  expect(screen.queryByTestId('alias-directory')).not.toBeInTheDocument();
}

describe('console host legacy redirects → Studio\'s All metadata area, in ONE hop (objectui#3639, ADR-0146 D1)', () => {
  /** One `<Navigate>`, straight to Studio: no stop on Setup's canonical route or on the alias. */
  function expectStudioInOneHop(chain: string[], from: string, to: string) {
    expect(chain).toEqual([from, to]);
    expect(screen.getByTestId('studio')).toBeInTheDocument();
    expect(screen.queryByTestId('canonical-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canonical-item')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canonical-directory')).not.toBeInTheDocument();
    expectNoAliasAnywhere(chain);
  }

  it.each([
    ['/apps/x/system/metadata/object', '/studio/~all/metadata/object'],
    ['/apps/x/system/metadata/object/account', '/studio/~all/metadata/object/account'],
    ['/apps/x/system/metadata', '/studio/~all/metadata'],
    ['/apps/x/system/objects/account', '/studio/~all/metadata/object/account'],
    ['/apps/x/system/objects', '/studio/~all/metadata/object'],
    ['/apps/my-app/system/metadata/permission/admin', '/studio/~all/metadata/permission/admin'],
  ])('%s → %s', (from, to) => {
    expectStudioInOneHop(renderAt(from), from, to);
  });

  it.each([
    ['/apps/x/system/metadata/object?package=crm', '/studio/crm/metadata/object?package=crm'],
    ['/apps/x/system/metadata/position?scope=environment', '/studio/~all/metadata/position?scope=environment'],
    ['/apps/x/system/metadata/object/account?review=1', '/studio/~all/metadata/object/account?review=1'],
    ['/apps/x/system/objects/account?package=crm#fields', '/studio/crm/metadata/object/account?package=crm#fields'],
    ['/apps/x/system/metadata/object?keep=me#frag', '/studio/~all/metadata/object?keep=me#frag'],
  ])('the query and hash are carried, onto the leg the query names: %s', (from, to) => {
    // The old chain arrived with a bare path (objectui#3639 measured it, and
    // kept it). The area gives `?package=`, `?scope=` and `?review=` their
    // Setup meaning, so they are kept now, and the leg is chosen here, so the
    // area adds no second hop.
    expectStudioInOneHop(renderAt(from), from, to);
  });

  it.each([
    ['/apps/x/system/positions', '/studio/~all/metadata/position?scope=environment'],
    ['/apps/x/system/roles', '/studio/~all/metadata/position?scope=environment'],
    ['/apps/x/system/permissions', '/studio/~all/metadata/permission?scope=environment'],
  ])('the retired catalog page %s opens the catalog in Studio', (from, to) => {
    expectStudioInOneHop(renderAt(from), from, to);
  });

  it('a datasource stays in Setup: the canonical route, the app prefix preserved', () => {
    // ADR-0146 D1 places the datasource in Setup, and the area sends it back
    // there, so the host must not send it to Studio.
    const chain = renderAt('/apps/my-app/system/metadata/datasource');

    expect(chain).toEqual(['/apps/my-app/system/metadata/datasource', '/apps/my-app/metadata/datasource']);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"datasource"');
    expect(screen.queryByTestId('studio')).not.toBeInTheDocument();
    expectNoAliasAnywhere(chain);
  });

  it('a datasource item stays in Setup too', () => {
    const chain = renderAt('/apps/x/system/metadata/datasource/main');

    expect(chain).toEqual(['/apps/x/system/metadata/datasource/main', '/apps/x/metadata/datasource/main']);
    expect(screen.getByTestId('canonical-item')).toHaveTextContent('"name":"main"');
    expectNoAliasAnywhere(chain);
  });
});
