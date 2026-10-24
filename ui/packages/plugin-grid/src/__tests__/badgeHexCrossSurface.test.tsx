/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5183 — one option, one colour, whatever surface renders it.
 *
 * objectui#5141 taught the DESKTOP CELL (`SelectCellRenderer`) to render an
 * author-declared hex as declared, via `getBadgeHexAppearance`, instead of
 * quantizing it onto one of nine palette families. The grid's other two badge
 * surfaces kept calling `getBadgeColorClasses`, which returns a class string
 * and therefore cannot carry a runtime colour at all. The result was worse
 * than the bug it replaced: the same option in the same object rendered one
 * colour in a grid cell and a different one in the group header above it.
 *
 * ── Why the assertion is CROSS-SURFACE rather than per-site ───────────────
 * Four independent per-site tests would each have passed against a site that
 * quantizes, as long as it quantized consistently with itself. What broke is
 * agreement BETWEEN surfaces, so that is what is pinned here: the same option
 * is rendered through all three of the grid's badge surfaces and the resolved
 * custom properties must be byte-identical across them.
 *
 * ── Why every lookup is SCOPED to one surface ────────────────────────────
 * Load-bearing, and measured: a grouped grid renders the group pill AND the
 * leaf table's desktop cells, and both carry the option's label as their whole
 * text content. An unscoped "find the element labelled Emerald that declares
 * `--os-badge-bg`" therefore reads whichever comes first in document order —
 * so with the fix reverted the group-header case still went GREEN off the
 * CELL's variables, asserting nothing about the header. Each surface is
 * addressed by its own selector below, and the two single-surface renders
 * assert that no group pill exists to be confused with.
 *
 * ── Why these two hexes ──────────────────────────────────────────────────
 * `#2ecc71` and `#1e8449` are the pair from #5141's report. Their hues differ
 * by 0.1°, so `hexToPaletteName` buckets BOTH into the `green` family — under
 * the old class-only path every surface agreed by rendering them identically,
 * which is agreement without fidelity. The last case pins that they stay
 * distinguishable, so "the surfaces agree" can never be satisfied by
 * quantizing every surface back to one family.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/** The reported pair: same palette family, visibly different colours. */
const EMERALD = '#2ecc71';
const FOREST = '#1e8449';

const OPTIONS = [
  { value: 'emerald', label: 'Emerald', color: EMERALD },
  { value: 'forest', label: 'Forest', color: FOREST },
];

const ROWS = [
  { id: 'r1', name: 'Row one', stage: 'emerald' },
  { id: 'r2', name: 'Row two', stage: 'forest' },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    // objectui#10881: a grouped grid that fetches its own rows groups only
    // over a data source that answers the group header query; a find-only one
    // is refused. One header row per stage, as the server would count them.
    queryGroupHeaders: vi.fn(async () => [
      { stage: 'emerald', count: 1 },
      { stage: 'forest', count: 1 },
    ]),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: OPTIONS },
      },
    })),
  } as any;
}

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setMobileWidth() {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: ORIGINAL_INNER_WIDTH });
  cleanup();
});

/**
 * The declared colours ride CSS custom properties (the className that reads
 * them is a build-time-static Tailwind string, identical on every surface —
 * so the class alone proves nothing and the STYLE is the whole payload).
 */
const BADGE_VARS = ['--os-badge-bg', '--os-badge-fg', '--os-badge-border'] as const;

type BadgeVars = Record<string, string>;

/** Custom properties declared by the labelled element within `candidates`. */
function badgeVarsAmong(candidates: HTMLElement[], label: string): BadgeVars | undefined {
  const carrier = candidates.find(
    (el) =>
      el.textContent?.trim() === label &&
      el.style.getPropertyValue('--os-badge-bg').trim() !== '',
  );
  if (!carrier) return undefined;
  const out: BadgeVars = {};
  for (const name of BADGE_VARS) out[name] = carrier.style.getPropertyValue(name).trim();
  return out;
}

/** Group-header pills only — never the cells in the group's leaf table. */
const groupPills = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('.group-label'));

/** Everything styled on a render that has no group pills at all. */
const styledNodes = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[style]'));

function gridSchema(extra: Record<string, unknown> = {}) {
  return {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'stage', label: 'Stage', type: 'select' },
    ],
    pagination: { pageSize: 50 },
    ...extra,
  } as any;
}

function renderGrid(schema: any) {
  const ds = makeDataSource();
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Surface 1 — the desktop cell (`SelectCellRenderer`, fixed by #5141). */
async function desktopCellVars(label: string): Promise<BadgeVars | undefined> {
  const { container } = renderGrid(gridSchema());
  await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  // Ungrouped: nothing here can be a group pill, so the lookup is unambiguous.
  expect(groupPills(container)).toHaveLength(0);
  return badgeVarsAmong(styledNodes(container), label);
}

/** Surface 2 — the group-header pill (`resolveGroupHeader` -> `GroupRow`). */
async function groupHeaderVars(label: string): Promise<BadgeVars | undefined> {
  const { container } = renderGrid(gridSchema({ grouping: { fields: [{ field: 'stage' }] } }));
  await waitFor(() => expect(groupPills(container).length).toBeGreaterThan(0));
  return badgeVarsAmong(groupPills(container), label);
}

/** Surface 3 — the compact card / mobile stage badge. */
async function mobileCardVars(label: string): Promise<BadgeVars | undefined> {
  setMobileWidth();
  const { container } = renderGrid(gridSchema());
  await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  expect(groupPills(container)).toHaveLength(0);
  return badgeVarsAmong(styledNodes(container), label);
}

describe('objectui#5183 — a declared hex renders the same on every grid surface', () => {
  it('group header agrees with the desktop cell under it', async () => {
    const cell = await desktopCellVars('Emerald');
    cleanup();
    const header = await groupHeaderVars('Emerald');

    // Both surfaces resolved SOMETHING — a missing style is the pre-fix state
    // (class-only), and `toEqual(undefined)` on both sides would otherwise
    // read as agreement.
    expect(cell?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(header?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(header).toEqual(cell);
  });

  it('compact card badge agrees with the desktop cell', async () => {
    const cell = await desktopCellVars('Emerald');
    cleanup();
    const card = await mobileCardVars('Emerald');

    expect(cell?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(card?.['--os-badge-bg']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(card).toEqual(cell);
  });

  it('two same-family hexes stay distinguishable in the group headers', async () => {
    const { container } = renderGrid(gridSchema({ grouping: { fields: [{ field: 'stage' }] } }));
    await waitFor(() => expect(groupPills(container).length).toBeGreaterThan(1));
    const pills = groupPills(container);
    const emerald = badgeVarsAmong(pills, 'Emerald');
    const forest = badgeVarsAmong(pills, 'Forest');
    expect(emerald?.['--os-badge-bg']).toBeTruthy();
    expect(forest?.['--os-badge-bg']).toBeTruthy();
    expect(emerald!['--os-badge-bg']).not.toBe(forest!['--os-badge-bg']);
  });
});
