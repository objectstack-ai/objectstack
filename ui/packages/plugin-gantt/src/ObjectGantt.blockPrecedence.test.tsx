/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `gantt` BLOCK is the one spelling `getGanttConfig` reads, and flat
 * top-level config keys are NAMED in a dev-mode warning as not read.
 *
 * ## History
 *
 * `getGanttConfig` used to check the flat spelling FIRST and `return` early, so
 * a node carrying both spellings rendered the flat one and every key inside the
 * authored `gantt` block was discarded with NO diagnostic. objectui#6469
 * inherited the `plugin-map` ruling (maintainer on objectui#5018, 2026-08-17,
 * landed PR #5156): the block won, and the shadowed flat keys were named. The
 * flat spelling stayed as a second branch for a node with no block, because
 * `ObjectView` and `ListView` flattened `options.gantt` onto top-level keys.
 *
 * objectstack#25923 moved both producers to the block and then retired that
 * second branch, once the stored-row census found no stored flat row. So a
 * node that writes its binding flat now reaches the "Gantt configuration
 * required" refusal screen, and the warning names the flat keys on every node
 * that carries them, with a block or without.
 *
 * The pins are RENDERED-VALUES assertions: the two spellings name DIFFERENT
 * record fields, so which one was read is visible in the bars themselves —
 * `BLOCK …` titles spanning January, never `FLAT …` titles spanning March.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectGantt, FLAT_GANTT_CONFIG_KEYS, type KnownGanttConfigKey } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div
      data-testid="gantt-view"
      data-count={tasks.length}
      data-titles={tasks.map((t: any) => t.title).join('|')}
      data-starts={tasks
        .map((t: any) => (t.start instanceof Date ? t.start.toISOString().slice(0, 10) : String(t.start)))
        .join('|')}
    />
  ),
}));

vi.mock('./ResourceWorkload', () => ({
  ResourceWorkload: ({ tasks }: any) => <div data-testid="resource-workload" data-count={tasks.length} />,
}));

/**
 * One record carrying BOTH faces' field names, with values that cannot be
 * confused: the block's fields say "BLOCK"/January, the flat spelling's say
 * "FLAT"/March.
 */
const INLINE = [
  {
    id: '1',
    block_name: 'BLOCK Alpha',
    flat_name: 'FLAT Alpha',
    b_start: '2024-01-01',
    b_end: '2024-01-05',
    f_start: '2024-03-01',
    f_end: '2024-03-05',
  },
];

const BLOCK = { startDateField: 'b_start', endDateField: 'b_end', titleField: 'block_name' };
const FLAT = { startDateField: 'f_start', endDateField: 'f_end', titleField: 'flat_name' };

function bothSpellings(extra: Record<string, any> = {}) {
  return {
    type: 'object-gantt',
    ...FLAT,
    gantt: { ...BLOCK },
    data: { provider: 'value', items: INLINE },
    ...extra,
  } as any;
}

async function rendered(schema: any) {
  const { container } = render(<ObjectGantt schema={schema} />);
  const el = () => container.querySelector('[data-testid="gantt-view"]') as HTMLElement;
  await waitFor(() => expect(el()?.getAttribute('data-count')).toBe('1'));
  return {
    titles: el().getAttribute('data-titles'),
    starts: el().getAttribute('data-starts'),
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/** Every recorded `console.warn` argument list. */
const calls = (): unknown[][] => warn.mock.calls as unknown as unknown[][];
/** …flattened to one searchable string. */
const warnText = () => calls().map((c) => c.map(String).join(' ')).join('\n');
const flatKeyWarnings = () =>
  calls().filter((c) => String(c[0]).includes('top-level keys are NOT READ'));

const REFUSAL = /Gantt configuration required/;

describe('one spelling: the `gantt` block (objectstack#25923)', () => {
  it('renders the BLOCK values when a node carries both spellings', async () => {
    const { titles, starts } = await rendered(bothSpellings({ objectName: 'precedence_a' }));
    expect(titles).toBe('BLOCK Alpha');
    expect(starts).toBe('2024-01-01');
  });

  it('REFUSES a node whose binding is written flat with no `gantt` block', async () => {
    // The retired fallback. This fixture used to render `FLAT Alpha`; with the
    // flat branch gone it carries no binding the chart reads.
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            ...FLAT,
            data: { provider: 'value', items: INLINE },
            objectName: 'flat_only',
          } as any
        }
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
    expect(screen.getByText(REFUSAL).textContent).toContain('gantt block');
    expect(screen.queryByTestId('gantt-view')).toBeNull();
    // …and the dev warning names the keys that were not read.
    const hits = flatKeyWarnings();
    expect(hits).toHaveLength(1);
    for (const key of ['startDateField', 'endDateField', 'titleField']) {
      expect(String(hits[0][0])).toContain(`\`${key}\``);
    }
  });

  it('CONTROL: the same binding moved into the block draws', async () => {
    const { titles, starts } = await rendered({
      type: 'object-gantt',
      gantt: { ...FLAT },
      data: { provider: 'value', items: INLINE },
      objectName: 'flat_moved_into_block',
    } as any);
    expect(titles).toBe('FLAT Alpha');
    expect(starts).toBe('2024-03-01');
    expect(flatKeyWarnings()).toHaveLength(0);
  });
});

describe('flat keys are NAMED, not dropped silently (objectui#6469, objectstack#25923)', () => {
  it('names every flat top-level key in the dev-mode warning', async () => {
    await rendered(
      bothSpellings({ objectName: 'named_keys', colorField: 'flat_color', capacity: 3 }),
    );

    const hits = flatKeyWarnings();
    expect(hits).toHaveLength(1);
    const text = String(hits[0][0]);

    // Each key the node carries flat is asserted BY NAME: a warning that merely
    // says "some keys were ignored" is the silence objectui#6469 ended.
    for (const key of ['startDateField', 'endDateField', 'titleField', 'colorField', 'capacity']) {
      expect(text).toContain(`\`${key}\``);
    }
    // …and it does not invent keys the node never carried.
    expect(text).not.toContain('`progressField`');
    expect(text).not.toContain('`assigneeField`');
    // Node-level keys that are not gantt config are never named.
    expect(text).not.toContain('`objectName`');
    expect(text).not.toContain('`data`');
  });

  it('says where the keys belong', async () => {
    await rendered(bothSpellings({ objectName: 'message_shape' }));
    const text = String(flatKeyWarnings()[0][0]);
    expect(text).toContain('[ObjectGantt]');
    expect(text).toContain('`gantt` block');
    expect(text).toContain('NOT READ');
    expect(text).toContain('objectstack#25923');
  });

  it('names GanttConfig keys hoisted beside a block, with no top-level date pair', async () => {
    await rendered({
      type: 'object-gantt',
      gantt: { ...BLOCK },
      quickFilters: [{ field: 'status' }],
      autoZoomToFilter: true,
      data: { provider: 'value', items: INLINE },
      objectName: 'hoisted_beside_block',
    } as any);

    const hits = flatKeyWarnings();
    expect(hits).toHaveLength(1);
    const text = String(hits[0][0]);
    expect(text).toContain('`quickFilters`');
    expect(text).toContain('`autoZoomToFilter`');
  });

  it('does NOT fire for a block with no flat keys beside it — the ObjectView / ListView product', async () => {
    await rendered({
      type: 'object-gantt',
      gantt: { ...BLOCK },
      data: { provider: 'value', items: INLINE },
      objectName: 'block_only',
    } as any);
    expect(flatKeyWarnings()).toHaveLength(0);
  });

  it('warns ONCE per distinct key set, not once per render', async () => {
    const schema = bothSpellings({ objectName: 'warn_once' });
    await rendered(schema);
    await rendered(schema);
    await rendered(schema);
    expect(flatKeyWarnings()).toHaveLength(1);
  });

  it('still reports an incomplete block through the existing safeParse warning', async () => {
    // The spec's `GanttConfigSchema` REQUIRES startDateField/endDateField/
    // titleField, so an INCOMPLETE block is refused even when flat keys beside
    // it would complete it — merging them in would be the lenient consumer
    // fallback AGENTS.md #0.1 forbids. The author is told twice instead: the
    // config is invalid, AND these flat keys are not read.
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            ...FLAT,
            gantt: { colorField: 'flat_color' },
            data: { provider: 'value', items: INLINE },
            objectName: 'incomplete_block',
          } as any
        }
      />,
    );
    await waitFor(() => expect(warnText()).toContain('Invalid gantt configuration'));
    expect(flatKeyWarnings()).toHaveLength(1);
    expect(String(flatKeyWarnings()[0][0])).toContain('`startDateField`');
  });
});

describe('the named key set cannot drift from `GanttConfig` (objectui#6469)', () => {
  it('covers the spec-modelled half by derivation and the extensions by list', () => {
    // Runtime half: the list is built from `GanttConfigSchema.shape`, so a key
    // added to the spec arrives here without a second edit.
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('startDateField');
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('quickFilters');
    // The ten that used to be named by a second literal here: objectui read them
    // through the schema's `.passthrough()` window, objectstack#15469 closed the
    // window and DECLARED them, and objectui#7845 retired the literal. They must
    // keep arriving — now by the same derivation as the line above, not by list.
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('lockField');
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('timeSegments');
    // The legacy singular alias, named so a node that writes it is told too.
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('dependencyField');
    // No duplicates — the two halves must not overlap.
    expect(new Set(FLAT_GANTT_CONFIG_KEYS).size).toBe(FLAT_GANTT_CONFIG_KEYS.length);
  });
});

/**
 * Compile-time coverage pin (`tsc -p tsconfig.test.json` type-checks this file).
 * `never` exactly while every `GanttConfig` key appears in
 * `FLAT_GANTT_CONFIG_KEYS`, so the warning can name any of them. A `GanttConfig` key that
 * `GanttConfigSchema.shape` does not model makes this line fail to compile,
 * NAMING the missing key. Before objectui#7845 a second literal
 * (`GANTT_CONFIG_EXTENSION_KEYS`) could also satisfy it; the spec now declares
 * those ten, so the shape is the only source that can.
 */
type AssertNever<T extends never> = T;
export type UncoveredGanttConfigKey = AssertNever<
  Exclude<KnownGanttConfigKey, (typeof FLAT_GANTT_CONFIG_KEYS)[number]>
>;
