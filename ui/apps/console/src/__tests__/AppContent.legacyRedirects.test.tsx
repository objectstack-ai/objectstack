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
  const here = `${location.pathname}${location.search}`;
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

describe('console host legacy redirects → canonical metadata routes (objectui#3639)', () => {
  it('system/metadata/:type reaches metadata/:type in ONE hop', () => {
    const chain = renderAt('/apps/x/system/metadata/object');

    // The whole point: two entries, i.e. a single `<Navigate>`. Before the fix
    // this was three, with the alias in the middle.
    expect(chain).toEqual(['/apps/x/system/metadata/object', '/apps/x/metadata/object']);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"object"');
    expectNoAliasAnywhere(chain);
  });

  it('system/metadata/:type/:name reaches metadata/:type/:name in ONE hop', () => {
    const chain = renderAt('/apps/x/system/metadata/object/account');

    expect(chain).toEqual([
      '/apps/x/system/metadata/object/account',
      '/apps/x/metadata/object/account',
    ]);
    const probe = screen.getByTestId('canonical-item');
    expect(probe).toHaveTextContent('"type":"object"');
    expect(probe).toHaveTextContent('"name":"account"');
    expectNoAliasAnywhere(chain);
  });

  it('bare system/metadata reaches the metadata directory in ONE hop', () => {
    // The typeless arm used to aim at `component/metadata/directory`, the
    // second alias — a different route from the resource one, same detour.
    const chain = renderAt('/apps/x/system/metadata');

    expect(chain).toEqual(['/apps/x/system/metadata', '/apps/x/metadata']);
    expect(screen.getByTestId('canonical-directory')).toBeInTheDocument();
    expectNoAliasAnywhere(chain);
  });

  it('system/objects/:objectName reaches metadata/object/:name in ONE hop', () => {
    const chain = renderAt('/apps/x/system/objects/account');

    expect(chain).toEqual(['/apps/x/system/objects/account', '/apps/x/metadata/object/account']);
    const probe = screen.getByTestId('canonical-item');
    expect(probe).toHaveTextContent('"type":"object"');
    expect(probe).toHaveTextContent('"name":"account"');
    expectNoAliasAnywhere(chain);
  });

  it('bare system/objects reaches the object list in ONE hop', () => {
    const chain = renderAt('/apps/x/system/objects');

    expect(chain).toEqual(['/apps/x/system/objects', '/apps/x/metadata/object']);
    expect(screen.getByTestId('canonical-list')).toHaveTextContent('"type":"object"');
    expectNoAliasAnywhere(chain);
  });

  it('the app prefix is preserved, not just stripped to the root', () => {
    // `prefix` is cut with a regex off `location.pathname`; a mistake there is
    // invisible in the single-segment cases above.
    const chain = renderAt('/apps/my-app/system/metadata/datasource');

    expect(chain).toEqual([
      '/apps/my-app/system/metadata/datasource',
      '/apps/my-app/metadata/datasource',
    ]);
    expectNoAliasAnywhere(chain);
  });

  it('MEASUREMENT: the endpoint is byte-identical to what the old two-hop produced', () => {
    // Equivalence, not improvement: `LegacyMetadataRedirect` dropped
    // `location.search` on its resource arm and the host never forwarded the
    // incoming query either, so the old chain also arrived with a bare path.
    // Preserving query/hash would be a real behaviour change and is NOT part of
    // this issue — pinned here so a future reader can see the omission was
    // measured rather than overlooked.
    const chain = renderAt('/apps/x/system/metadata/object?keep=me#frag');

    expect(chain[chain.length - 1]).toBe('/apps/x/metadata/object');
    expect(chain).toHaveLength(2);
  });
});
