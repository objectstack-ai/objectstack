/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The node-slot declaration ⇔ the renderers, over the live registry, in both
 * directions (objectui#11170).
 *
 * `NODE_SLOT_DECLARATIONS` in `@object-ui/types` says, per registry type,
 * through which keys other than `children` the renderer hands authored nodes
 * back to `SchemaRenderer`. Three walks read it — the `objectui check` gate,
 * core's `validateChildren` and the SDUI parser's manifest — so a row that
 * does not match the renderer is a false refusal (a row the renderer never
 * paints) or a silent under-reach (a read the row misses). This file holds the
 * rows registered by `@object-ui/components` against the renderers themselves:
 *
 *   1. DECLARED ⇒ RENDERED. A node authored at every declared position of
 *      every known key reaches the DOM, rendered through the real
 *      `SchemaRenderer`, in the context the renderer needs (an overlay held
 *      open, a tab selected). The predicate is behavioural for the reason
 *      `container-declaration-ratchet.test.tsx` gives: a source-side spelling
 *      of "does this renderer read `schema.X`" cannot be built here.
 *   2. REGISTERED ⇒ DECLARED. Every `type: 'slot'` input a registration
 *      declares (other than `children`) names a position the declaration
 *      carries for that key — the designer's authoring face and the walks
 *      agree about where nodes go.
 *   3. TWINS AGREE. Every registry key that resolves to the same renderer
 *      answers the same slots, and a row lists only keys the registry stores.
 *   4. THE TIER READS THE PROJECTION. `manifestFromConfigs` handed
 *      `nodeSlotsFor` carries the non-retired positions, `validateTree`
 *      reaches a node under each of them, and its reach equals
 *      `nodeSlotValues`' over the same fixtures — the two walks, one grammar.
 *
 * A reading needs controls that can fail: a key with no row renders its
 * `children` and does NOT render a node under a key the row would have to
 * name, so the probe distinguishes "declared" from "any object anywhere".
 *
 * The plugin-registered rows (`detail`, `report-viewer`, `plugin-timeline:timeline`,
 * `view-switcher`, `dashboard`) are not registered in this package; each
 * plugin's `nodeSlotDeclaration-11170` suite holds them the same way.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
import { inputTypeArms, manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { SchemaElement } from '@object-ui/sdui-parser';
import {
  NODE_SLOT_DECLARATIONS,
  nodeSlotPathSegments,
  nodeSlotValues,
  nodeSlotsFor,
} from '@object-ui/types';

// Module scope, not a hook: this import IS the registration (AGENTS.md
// §测试纪律 — an unbounded module load must not be billed to a bounded window).
import '../index';
import { SidebarProvider } from '../../ui';

const MARK = 'slot-census-11170';
const MARK_NODE = { type: 'text', content: MARK };
const UNKNOWN_TAG = 'nope-11170';

/** Long enough for the slot probes under a loaded CI box. */
const CENSUS_TIMEOUT = 180_000;

/**
 * The context a renderer needs before a slot's content is on the page:
 * `extra` goes on the node, `panel` on each panel element of an `[]` step,
 * `readBody` reads `document.body` for content a portal mounts outside the
 * container. Keyed by BARE type; a namespaced twin shares its entry.
 */
interface Context {
  extra?: Record<string, unknown>;
  panel?: Record<string, unknown>;
  readBody?: boolean;
  /** A provider the renderer mounts under (`header-bar` reads the sidebar context). */
  wrap?: (node: React.ReactNode) => React.ReactElement;
}

const CONTEXTS: Record<string, Context> = {
  'header-bar': { wrap: (node) => <SidebarProvider>{node}</SidebarProvider> },
  tabs: { extra: { defaultValue: 'p' }, panel: { value: 'p', label: 'P' } },
  accordion: { extra: { defaultValue: 'p' }, panel: { value: 'p', title: 'P' } },
  collapsible: { extra: { defaultOpen: true } },
  dialog: { extra: { defaultOpen: true }, readBody: true },
  sheet: { extra: { defaultOpen: true }, readBody: true },
  drawer: { extra: { defaultOpen: true }, readBody: true },
  'alert-dialog': { extra: { defaultOpen: true }, readBody: true },
  popover: { extra: { defaultOpen: true }, readBody: true },
  'hover-card': { extra: { open: true }, readBody: true },
  tooltip: { extra: { open: true }, readBody: true },
  'data-table': { extra: { data: [], columns: [{ key: 'a', title: 'A' }] } },
  'page:tabs': { panel: { value: 'p', label: 'P' } },
  'page:accordion': { panel: { label: 'P', collapsed: false } },
  // A region is named for a slot `default` places: a template-less full page is judged as `default` and refuses any other (objectui#12902).
  ...Object.fromEntries(['page', 'app', 'utility', 'home', 'record'].map((t) => [t, { panel: { name: 'main' } }])),
};

const bareName = (type: string): string => type.slice(type.lastIndexOf(':') + 1);
const contextFor = (type: string): Context => CONTEXTS[type] ?? CONTEXTS[bareName(type)] ?? {};

/**
 * A node of `type` with `terminal` placed at `path`, and nothing else at
 * that position: built from the path's own segments, so the probe cannot
 * drift from the grammar the readers walk.
 */
function placeAt(type: string, path: string, terminal: unknown): Record<string, unknown> {
  const { extra = {}, panel = {} } = contextFor(type);
  const segments = nodeSlotPathSegments(path);
  let value: unknown = terminal;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const { key, each } = segments[i]!;
    if (!each) value = { [key]: value };
    else if (i === segments.length - 1) value = { [key]: [value] };
    else value = { [key]: [{ ...panel, ...(value as Record<string, unknown>) }] };
  }
  return { type, ...extra, ...(value as Record<string, unknown>) };
}

const rendersMark = async (schema: unknown, readBody = false): Promise<boolean> => {
  const type = (schema as { type: string }).type;
  const wrap = contextFor(type).wrap ?? ((node: React.ReactNode) => <>{node}</>);
  const { container, unmount } = render(
    <AdapterCtx.Provider value={null as never}>{wrap(<SchemaRenderer schema={schema as never} />)}</AdapterCtx.Provider>,
  );
  try {
    await waitFor(() => expect(container.textContent).toBeDefined());
    const text = readBody ? document.body.textContent || '' : container.textContent || '';
    return text.includes(MARK);
  } finally {
    unmount();
  }
};

const knownTypes = (): string[] => ComponentRegistry.getKnownTypes().slice().sort();

/** The rows whose keys this package registers — the population this file holds. */
const rowsHere = () => NODE_SLOT_DECLARATIONS.filter((row) => row.types.some((t) => ComponentRegistry.has(t)));

describe('direction 1 — every declared slot renders an authored node (objectui#11170)', () => {
  it(
    'a node placed at each declared position of each key registered here reaches the DOM',
    async () => {
      const rows = rowsHere();
      expect(rows.length, 'no declared row is registered here — the import above stopped registering').toBeGreaterThan(20);
      const missing: string[] = [];
      for (const row of rows) {
        for (const type of row.types) {
          for (const slot of row.slots) {
            const terminal = slot.path.endsWith('[]') ? MARK_NODE : [MARK_NODE];
            const ok = await rendersMark(placeAt(type, slot.path, terminal), contextFor(type).readBody);
            if (!ok) missing.push(`${type} → ${slot.path}`);
          }
        }
      }
      expect(
        missing,
        'declared slot(s) whose renderer never put the authored node on the page — fix the declaration, or add the context the renderer needs to CONTEXTS',
      ).toEqual([]);
    },
    CENSUS_TIMEOUT,
  );

  it('the probe can fail: a key with no row renders `children` and not a node under an undeclared key', async () => {
    expect(nodeSlotsFor('button')).toEqual([]);
    expect(await rendersMark({ type: 'button', children: [MARK_NODE] })).toBe(true);
    expect(await rendersMark({ type: 'button', footer: [MARK_NODE] })).toBe(false);
    // …and a declared slot is decided by the type, not by the key's name:
    // `footer` is `card`'s slot and `tabs`' nothing.
    expect(await rendersMark({ type: 'card', footer: [MARK_NODE] })).toBe(true);
    expect(await rendersMark({ type: 'tabs', items: [], footer: [MARK_NODE] })).toBe(false);
  });
});

describe('direction 2 — every registered `slot` input other than `children` is a declared position', () => {
  it('no registration declares a slot input the declaration does not carry for that key', () => {
    const undeclared: string[] = [];
    let slotInputs = 0;
    for (const type of knownTypes()) {
      for (const input of ComponentRegistry.getMeta(type)?.inputs ?? []) {
        if (input.name === 'children' || !inputTypeArms(input.type).includes('slot')) continue;
        slotInputs += 1;
        if (!nodeSlotsFor(type).some((s) => s.path === input.name)) undeclared.push(`${type}.${input.name}`);
      }
    }
    // Population control: the overlays alone declare more than a dozen.
    expect(slotInputs).toBeGreaterThan(12);
    expect(undeclared, 'slot input(s) the declaration does not carry — add the row, the walks are blind to the key').toEqual([]);
  });
});

describe('direction 3 — twins agree, and a row lists only keys the registry stores', () => {
  it('every key that resolves to one renderer answers one slot list', () => {
    const byRenderer = new Map<unknown, string[]>();
    for (const type of knownTypes()) {
      const renderer = ComponentRegistry.get(type);
      if (!renderer) continue;
      byRenderer.set(renderer, [...(byRenderer.get(renderer) ?? []), type]);
    }
    const disagreements: string[] = [];
    for (const types of byRenderer.values()) {
      const answers = new Set(types.map((t) => JSON.stringify(nodeSlotsFor(t))));
      if (answers.size > 1) disagreements.push(types.join(' / '));
    }
    expect(disagreements, 'registry twins of one renderer answer different slots').toEqual([]);
    // The reading has twins in it: `dialog` and `ui:dialog` are one renderer.
    expect(ComponentRegistry.get('dialog')).toBe(ComponentRegistry.get('ui:dialog'));
  });

  it('a row registered here lists every one of its keys here, and each is a key the registry stores', () => {
    for (const row of rowsHere()) {
      for (const type of row.types) {
        expect(ComponentRegistry.has(type), `\`${type}\` is declared but not registered`).toBe(true);
      }
    }
  });
});

describe('direction 4 — the tier reads the projection, and the two walks agree (objectui#11170)', () => {
  const manifest = () => {
    const configs = ComponentRegistry.getKnownTypes().map((t) => {
      const meta = ComponentRegistry.getMeta(t);
      return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    });
    return manifestFromConfigs(configs as unknown as Parameters<typeof manifestFromConfigs>[0], { slotsFor: nodeSlotsFor });
  };

  it('the projected manifest carries each key’s non-retired positions', () => {
    const m = manifest();
    expect(m.components['dialog']!.slots).toEqual(['trigger', 'content', 'footer']);
    expect(m.components['page:card']!.slots).toEqual(['footer']);
    expect(m.components['button']!.slots).toBeUndefined();
  });

  it(
    '`validateTree` reaches exactly the nodes `nodeSlotValues` finds, at every declared position registered here',
    () => {
      const m = manifest();
      const disagreements: string[] = [];
      for (const row of rowsHere()) {
        for (const type of row.types) {
          for (const slot of row.slots) {
            const unknown = { type: UNKNOWN_TAG };
            const doc = placeAt(type, slot.path, slot.path.endsWith('[]') ? unknown : [unknown, unknown]);
            const found = nodeSlotValues(doc, slot.path).filter((v) => (v.value as { type?: unknown })?.type === UNKNOWN_TAG).length;
            const reached = validateTree(doc as unknown as SchemaElement, m).diagnostics.filter(
              (d) => d.code === 'unknown-component' && d.tag === UNKNOWN_TAG,
            ).length;
            const expected = slot.retired ? 0 : found;
            if (reached !== expected) disagreements.push(`${type} → ${slot.path}: types walk ${found}, tier reached ${reached}`);
          }
        }
      }
      expect(disagreements).toEqual([]);
    },
    CENSUS_TIMEOUT,
  );
});
