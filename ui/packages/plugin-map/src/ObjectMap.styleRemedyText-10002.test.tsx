/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10002 — the REMEDY half of `warnOnTopLevelStyleUrl`, tied to the
 * spelling the runtime actually reads.
 *
 * That warning is read at the moment the author is ALREADY being corrected, so
 * a remedy it names has to be one the runtime honours; objectui#9031 ruled that
 * for a sibling sink. It named `map: { mapStyle }` — a key
 * `ObjectMapConfigSchema` does not declare, so neither view flattener's
 * whitelist carries it and `getMapConfig` never reads it. An author who obeyed
 * the correction wrote metadata that was dropped a second time, with no second
 * diagnostic.
 *
 * ⛔ WHAT THIS FILE DELIBERATELY IS NOT: a snapshot of the sentence. A string
 * assertion is how the old remedy stayed green while being false — nothing
 * executed it. So the remedy is not compared against a literal here. It is
 * PARSED out of the warning the component really emits, and every key it
 * prescribes inside a `map` block is then WRITTEN into a `map` block and
 * measured end to end:
 *
 *   - through the declared block on a directly authored node, and
 *   - through the real `ListView` flatten, the producer a view author goes
 *     through, into the real `ObjectMap`.
 *
 * ⇒ the two cannot drift apart. Re-spell the remedy and the render measures the
 * new key; change what `getMapConfig` (or either flattener's whitelist) reads,
 * and the remedy that was true stops arriving. Either way this goes red.
 *
 * `@object-ui/plugin-list` is already a devDependency of this package for the
 * same reason `ObjectMap.listViewMapConfigReach.test.tsx` uses it: dev-only,
 * acyclic, and the only home that can mock `react-map-gl` while driving the
 * real producer.
 */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import { ObjectMap } from './ObjectMap';
import './__tests__/webgl2Available';

let capturedProps: any = null;

vi.mock('react-map-gl/maplibre', () => ({
  default: (props: any) => {
    capturedProps = props;
    return <div aria-label="Map">{props.children}</div>;
  },
  Map: ({ children }: any) => <div aria-label="Map">{children}</div>,
  NavigationControl: () => <div data-testid="nav-control" />,
  Marker: ({ children }: any) => <div data-testid="map-marker">{children}</div>,
  Popup: ({ children }: any) => <div data-testid="map-popup">{children}</div>,
}));

// The real renderer, under the tag `ListView`'s `case 'map'` emits.
ComponentRegistry.register('object-map', ObjectMap as any, {
  namespace: 'test',
  label: 'Object Map',
  category: 'view',
});

/** The public demo tiles: what a DROPPED style leaves behind. */
const DEMO_STYLE = 'https://demotiles.maplibre.org/style.json';
const REMEDY_URL = 'https://remedy.example.com/style.json';

const records = [
  { id: '1', title: 'Install rooftop unit', location: { lat: 47.6062, lng: -122.3321 } },
];
const DECLARED_MAP = { locationField: 'location', titleField: 'title' };

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  capturedProps = null;
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

async function renderMap(schema: any) {
  // Several renders per test here, and RTL only auto-cleans BETWEEN tests: a
  // second mount would otherwise leave two `Map` nodes in the document and the
  // label queries below would throw rather than measure.
  cleanup();
  capturedProps = null;
  render(<ObjectMap schema={schema} />);
  await waitFor(() => expect(screen.queryByText('Loading map...')).toBeNull());
  await waitFor(() => expect(capturedProps).not.toBeNull());
}

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue(records),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'showcase_task',
    fields: { title: { type: 'text' }, location: { type: 'location' } },
  }),
});

/** Mount a `map` list view — the real producer — and settle the map. */
async function renderListViewMap(view: Record<string, unknown>) {
  cleanup();
  capturedProps = null;
  const dataSource = makeDataSource() as any;
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView
        schema={
          {
            type: 'list-view',
            objectName: 'showcase_task',
            viewType: 'map',
            columns: ['title'],
            ...view,
          } as never
        }
        dataSource={dataSource}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(screen.queryByLabelText('Map')).not.toBeNull());
  await waitFor(() => expect(capturedProps).not.toBeNull());
}

/**
 * The warning itself, emitted by a real render — not a copy of its text.
 *
 * A DISTINCT dropped URL per call, deliberately: the warning is memoised once
 * per `type::objectName::url` for the life of the module (`warnedTopLevelStyleUrls`,
 * so a re-render does not flood the console), and that memo is shared by every
 * test in this file. Reusing one URL makes the second reader see NO warning —
 * an empty read that looks exactly like a deleted diagnostic.
 */
let droppedUrlSeq = 0;
async function remedyMessage(): Promise<string> {
  const dropped = `https://dropped-${(droppedUrlSeq += 1)}.example.com/style.json`;
  await renderMap({
    type: 'map',
    style: dropped,
    map: DECLARED_MAP,
    data: { provider: 'value', items: records },
  });
  const messages = (warnSpy.mock.calls as unknown[][])
    .map((args): string => String(args[0]))
    .filter((msg: string) => msg.includes('objectui#5017'));
  expect(messages).toHaveLength(1);
  return messages[0];
}

/**
 * The keys the remedy tells the author to write INSIDE a `map` block, read out
 * of the sentence itself: every `map: { KEY` it spells, however many times and
 * whichever path (node or view) it is talking about.
 */
function keysPrescribedInsideMapBlock(message: string): string[] {
  const found = [...message.matchAll(/map:\s*\{\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  return [...new Set(found)];
}

/** Does `map: { KEY: url }` on a directly authored node reach MapGL? */
async function arrivesThroughDeclaredBlock(key: string): Promise<boolean> {
  await renderMap({
    type: 'map',
    map: { ...DECLARED_MAP, [key]: REMEDY_URL },
    data: { provider: 'value', items: records },
  });
  return capturedProps.mapStyle === REMEDY_URL;
}

/** Does `map: { KEY: url }` on a LIST VIEW reach MapGL through the flatten? */
async function arrivesThroughListView(key: string): Promise<boolean> {
  await renderListViewMap({ map: { ...DECLARED_MAP, [key]: REMEDY_URL } });
  return capturedProps.mapStyle === REMEDY_URL;
}

describe('warnOnTopLevelStyleUrl — the remedy it prescribes is one the runtime reads (objectui#10002)', () => {
  it('prescribes at least one key inside a `map` block', async () => {
    // CONTROL for the two measurements below: a remedy that stopped naming any
    // key at all would satisfy a "every prescribed key works" assertion
    // vacuously. This is the leg that makes the zero readable.
    const prescribed = keysPrescribedInsideMapBlock(await remedyMessage());
    expect(prescribed.length).toBeGreaterThan(0);
  });

  it('every key it prescribes inside `map` is carried on a directly authored node', async () => {
    const prescribed = keysPrescribedInsideMapBlock(await remedyMessage());
    const carried: Record<string, boolean> = {};
    for (const key of prescribed) carried[key] = await arrivesThroughDeclaredBlock(key);

    expect(carried).toEqual(Object.fromEntries(prescribed.map((key) => [key, true])));
  });

  it('every key it prescribes inside `map` is carried by the real ListView flatten', async () => {
    const prescribed = keysPrescribedInsideMapBlock(await remedyMessage());
    const carried: Record<string, boolean> = {};
    for (const key of prescribed) carried[key] = await arrivesThroughListView(key);

    expect(carried).toEqual(Object.fromEntries(prescribed.map((key) => [key, true])));
  });

  it('DISCRIMINATES: `map: { mapStyle }` — the old remedy — is dropped on both paths', async () => {
    // Without this leg the two assertions above could pass on a measurement
    // that says "true" for every key. `mapStyle` is not a member of
    // `ObjectMapConfigSchema`, so the block never carries it: neither
    // flattener whitelists it and `getMapConfig` reads `schema.map?.style`.
    expect(await arrivesThroughDeclaredBlock('mapStyle')).toBe(false);
    expect(capturedProps.mapStyle).toBe(DEMO_STYLE);

    expect(await arrivesThroughListView('mapStyle')).toBe(false);
    expect(capturedProps.mapStyle).toBe(DEMO_STYLE);
  });

  it('the declared `style` IS carried end to end, through both paths', async () => {
    // The positive half of the same measurement, stated directly so the file
    // still says what the right answer is when the remedy is unreadable.
    expect(await arrivesThroughDeclaredBlock('style')).toBe(true);
    expect(await arrivesThroughListView('style')).toBe(true);
  });
});
