/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6939, the `object-map` + `object-gantt` group — the MAP half of the
 * render pin. `ObjectMapSchema` used to require `objectName`, a key this
 * renderer reads THIRD (`getDataConfig` below in `ObjectMap.tsx`: `data`, then
 * `staticData`, then `objectName`), so the three `staticData`-only catalog
 * entries drew correctly and were refused by `safeValidateSchema`. The repair
 * makes `objectName` optional behind a refinement; the validator-side contract
 * is pinned in `packages/types/src/__tests__/objectql-record-source-
 * refinement-6939.test.ts`, and the gantt tiles in `examples/schema-catalog/
 * test/objectql-record-source-render-identity-6939.test.tsx`.
 *
 * ## Why this half lives HERE and not beside the catalog
 *
 * `object-map` mounts maplibre, which wants WebGL2 and a live tile host; the
 * gallery pin excludes these three tiles for that reason and every test in
 * this package stands `react-map-gl/maplibre` in. That stand-in only takes
 * effect from a package that RESOLVES the specifier: measured from
 * `examples/schema-catalog`, the identical `vi.mock` is inert — the real
 * maplibre mounts and the tile is the error boundary (`Cannot read properties
 * of undefined (reading 'destroy')`). The `aria-label="Map"` control below is
 * what proves the stand-in is live for every reading in this file.
 *
 * ## Why the render half is the discriminating half
 *
 * From objectui#6318's triage: a "correction" that renders identically proves
 * the SCHEMA was wrong, not the fixture. So the repair has to clear the mirror
 * image of that bar — the validator's verdict must change and the renderer's
 * output must NOT. `PRE_REPAIR` was measured on `origin/main` at `d88e20f55`,
 * BEFORE the mirror was touched, through THIS file's harness: a
 * `SchemaRendererProvider`-wrapped bare `SchemaRenderer` (the provider is
 * load-bearing — `ObjectMap` calls `useSchemaContext`), `Date` frozen. The
 * docs-gallery harness gives different absolute counts for the same tile;
 * identity within ONE harness is the claim that discriminates.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaRenderer, SchemaRendererProvider, toRenderableSchema } from '@object-ui/react';
import { safeValidateSchema } from '@object-ui/types/zod';
import './index';
import './__tests__/webgl2Available';

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => <div aria-label="Map">{props.children}</div>,
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children, longitude, latitude }: any) => (
    <div data-testid="map-marker" data-lat={latitude} data-lng={longitude}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const NAMES = ['event-venue-finder', 'real-time-delivery-tracking', 'store-locator-map'] as const;

/**
 * Each entry as its author writes it: since objectui#10859 batch 5 an authored
 * `object-map` takes its props in the spec's `properties` bag, which
 * `SchemaRenderer` hoists onto the node before `ObjectMap` reads it — so the
 * PRE_REPAIR readings below, taken on the flat spelling, hold for the bag too.
 */
function catalogEntry(name: string): {
  type: 'object-map';
  properties: { staticData: Record<string, unknown>[]; map: { titleField: string } };
} {
  const file = path.join(REPO_ROOT, 'examples/schema-catalog/src/schemas/plugin-map', `${name}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Measured on `origin/main` @ `d88e20f55` through `measure()` below, mirror
 * untouched. The text is the geolocate control's glyph followed by one marker
 * glyph per authored row; the tag list is the DOM in document order.
 */
const PIN = '\u{1F4CD}'; // the marker glyph ObjectMap draws per record
const COMPASS = '\u{1F9ED}'; // the geolocate control's glyph
const SHELL = ['DIV', 'DIV', 'INPUT', 'DIV', 'DIV', 'DIV', 'BUTTON', 'SPAN', 'DIV', 'DIV', 'DIV'];
const PRE_REPAIR: Record<(typeof NAMES)[number], { elements: number; text: string; tags: string[]; markers: number }> = {
  'event-venue-finder': { elements: 16, text: COMPASS + PIN.repeat(4), tags: [...SHELL, 'DIV', 'DIV', 'DIV', 'DIV', 'DIV'], markers: 4 },
  'real-time-delivery-tracking': { elements: 14, text: COMPASS + PIN.repeat(3), tags: [...SHELL, 'DIV', 'DIV', 'DIV'], markers: 3 },
  'store-locator-map': { elements: 14, text: COMPASS + PIN.repeat(3), tags: [...SHELL, 'DIV', 'DIV', 'DIV'], markers: 3 },
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
});
afterAll(() => vi.useRealTimers());

/** Render one entry through the provider-wrapped bare renderer and measure what it drew. */
async function measure(schema: unknown) {
  const { container, unmount } = render(
    // No host DataSource: every entry authors `staticData`, which the
    // renderer wraps into its own in-memory ValueDataSource. The provider
    // itself is load-bearing (`useSchemaContext`).
    <SchemaRendererProvider dataSource={undefined}>
      <SchemaRenderer schema={toRenderableSchema(schema as never) as never} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(container.textContent ?? '').not.toContain('Loading map...'));
  const nodes = Array.from(container.querySelectorAll('*'));
  const out = {
    elements: nodes.length,
    text: container.textContent ?? '',
    tags: nodes.map((el) => el.tagName),
    markers: container.querySelectorAll('[data-testid="map-marker"]').length,
    standInLive: Boolean(container.querySelector('[aria-label="Map"]')),
  };
  unmount();
  return out;
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('objectui#6939 — the three map entries the mirror refused now validate', () => {
  it.each(NAMES)('%s validates under safeValidateSchema', (name) => {
    const doc = catalogEntry(name);
    // The control that makes the case discriminating: the entry authors NO
    // `objectName` and DOES author `staticData`. Each reported `: Invalid
    // input` (the union's own top-level issue) before this card.
    expect('objectName' in doc.properties).toBe(false);
    expect(Array.isArray(doc.properties.staticData)).toBe(true);
    expect(reasons(doc)).toEqual([]);
  });
});

describe('objectui#6939 — and the repair moved the validator, not the renderer', () => {
  it.each(NAMES)('%s renders exactly what it rendered before', async (name) => {
    const after = await measure(catalogEntry(name));
    const before = PRE_REPAIR[name];
    expect(after.elements).toBe(before.elements);
    expect(after.text).toBe(before.text);
    expect(after.tags).toEqual(before.tags);
    expect(after.markers).toBe(before.markers);
  });

  it.each(NAMES)('%s anti-vacuity: one marker per AUTHORED row, drawn on the live stand-in', async (name) => {
    // An entry that renders nothing — or the error boundary — satisfies
    // "identical" trivially. One marker per `staticData` row proves the rows
    // reached the map through the source the mirror ignored, and the
    // stand-in's own label proves the reading is of `ObjectMap`, not of
    // maplibre failing to mount.
    const doc = catalogEntry(name);
    const m = await measure(doc);
    expect(m.standInLive).toBe(true);
    expect(m.text).not.toContain('failed to render');
    expect(m.markers).toBe(doc.properties.staticData.length);
    expect(m.markers).toBeGreaterThan(0);
  });
});
