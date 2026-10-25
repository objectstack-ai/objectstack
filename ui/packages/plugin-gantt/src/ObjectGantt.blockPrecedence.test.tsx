/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6469 — the `gantt` BLOCK outranks the flat top-level spelling, and
 * the losing face's keys are NAMED in a dev-mode warning.
 *
 * ## What changed and why the pin is written this way
 *
 * `getGanttConfig` used to check the flat spelling FIRST and `return` early, so
 * a node carrying both spellings rendered the flat one and every key inside the
 * authored `gantt` block was discarded with NO diagnostic — not even the
 * `GanttConfigSchema.safeParse` warning, which lived behind that early return.
 * `plugin-map` had the identical two-faces shape ruled the other way (maintainer
 * on objectui#5018, 2026-08-17, landed PR #5156); this card inherits that
 * ruling, so the block wins and the shadowed flat keys are named.
 *
 * The precedence pin below is written as a RENDERED-VALUES assertion rather than
 * a call-level one: the two faces name DIFFERENT record fields, so the direction
 * of the flip is visible in the bars themselves. Before the flip the same
 * fixture rendered `FLAT …` titles spanning March; after it, `BLOCK …` titles
 * spanning January.
 *
 * ## Why the warning cannot spray
 *
 * The flat branch is the HOT path for gantt in practice: `ObjectView`
 * (`case 'gantt'`) and `ListView` (`case 'gantt'`) both FLATTEN `options.gantt`
 * onto top-level keys and emit NO `gantt` key at all, so a hand-authored block
 * reaching this component through either view layer has already been flattened
 * before `getGanttConfig` sees it. The warning is raised only from the block
 * branch, which their output never enters — pinned directly below by the
 * "flatten product" case.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
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
const shadowWarnings = () =>
  calls().filter((c) => String(c[0]).includes('so these top-level keys are'));

describe('precedence: the `gantt` block outranks the flat spelling (objectui#6469)', () => {
  it('renders the BLOCK values when a node carries both spellings', async () => {
    // ⛔ The direction pin. Before the flip this same fixture rendered
    // `FLAT Alpha` / 2024-03-01 — the flat branch returned before the block was
    // ever read. Reverting `getGanttConfig`'s branch order turns this red.
    const { titles, starts } = await rendered(bothSpellings({ objectName: 'precedence_a' }));
    expect(titles).toBe('BLOCK Alpha');
    expect(starts).toBe('2024-01-01');
  });

  it('still reads the flat spelling when there is no `gantt` block — the flatten product is unaffected', async () => {
    const { titles, starts } = await rendered({
      type: 'object-gantt',
      ...FLAT,
      data: { provider: 'value', items: INLINE },
      objectName: 'precedence_b',
    } as any);
    expect(titles).toBe('FLAT Alpha');
    expect(starts).toBe('2024-03-01');
  });
});

describe('the losing face is NAMED, not dropped silently (objectui#6469)', () => {
  it('names every shadowed top-level key in the dev-mode warning', async () => {
    await rendered(
      bothSpellings({ objectName: 'named_keys', colorField: 'flat_color', capacity: 3 }),
    );

    const hits = shadowWarnings();
    expect(hits).toHaveLength(1);
    const text = String(hits[0][0]);

    // The keys this node actually shadows — the three flat `FLAT` keys plus the
    // two extras. Each is asserted BY NAME: a warning that merely says "some
    // keys were ignored" is the silence this card exists to end.
    for (const key of ['startDateField', 'endDateField', 'titleField', 'colorField', 'capacity']) {
      expect(text).toContain(`\`${key}\``);
    }
    // …and it does not invent keys the node never carried.
    expect(text).not.toContain('`progressField`');
    expect(text).not.toContain('`assigneeField`');
    // The node-level keys that are NOT part of the flat gantt-config face must
    // never be named: `objectName` / `data` / `type` are read straight off the
    // schema and are unaffected by which config face wins.
    expect(text).not.toContain('`objectName`');
    expect(text).not.toContain('`data`');
  });

  it('says which face won and how to fix it', async () => {
    await rendered(bothSpellings({ objectName: 'message_shape' }));
    const text = String(shadowWarnings()[0][0]);
    expect(text).toContain('[ObjectGantt]');
    expect(text).toContain('`gantt` block');
    expect(text).toContain('IGNORED');
    expect(text).toContain('objectui#6469');
  });

  it('does NOT fire on the ObjectView / ListView flatten product', async () => {
    // The hot path: flat keys, no `gantt` key. Both flatteners emit exactly
    // this shape, so a warning here would fire on every flattened gantt node in
    // the product.
    await rendered({
      type: 'object-gantt',
      ...FLAT,
      progressField: 'progress',
      dependenciesField: 'deps',
      data: { provider: 'value', items: INLINE },
      objectName: 'flatten_product',
    } as any);
    expect(shadowWarnings()).toHaveLength(0);
  });

  it('names GanttConfig keys hoisted beside a block, with no top-level date pair', async () => {
    // The shape published authoring guidance actually produces: a `gantt` block
    // plus GanttConfig keys hoisted to the top level as if they were node-level
    // options. There is no top-level date pair, so this node took the BLOCK
    // branch before the flip too — the hoisted keys were already inert, just
    // silently. The warning is what changes for it.
    await rendered({
      type: 'object-gantt',
      gantt: { ...BLOCK },
      quickFilters: [{ field: 'status' }],
      autoZoomToFilter: true,
      data: { provider: 'value', items: INLINE },
      objectName: 'hoisted_beside_block',
    } as any);

    const hits = shadowWarnings();
    expect(hits).toHaveLength(1);
    const text = String(hits[0][0]);
    expect(text).toContain('`quickFilters`');
    expect(text).toContain('`autoZoomToFilter`');
  });

  it('does NOT fire for a block with no flat keys beside it', async () => {
    await rendered({
      type: 'object-gantt',
      gantt: { ...BLOCK },
      data: { provider: 'value', items: INLINE },
      objectName: 'block_only',
    } as any);
    expect(shadowWarnings()).toHaveLength(0);
  });

  it('warns ONCE per distinct shadowing, not once per render', async () => {
    const schema = bothSpellings({ objectName: 'warn_once' });
    await rendered(schema);
    await rendered(schema);
    await rendered(schema);
    expect(shadowWarnings()).toHaveLength(1);
  });

  it('still reports an incomplete winning block through the existing safeParse warning', async () => {
    // The gantt-specific consequence of block-wins, stated out loud: the spec's
    // `GanttConfigSchema` REQUIRES startDateField/endDateField/titleField
    // (`ObjectMapConfigSchema`, the map case this ruling is inherited from,
    // requires nothing), so an INCOMPLETE block outranks a complete flat
    // spelling. The block is taken whole — merging the flat keys in would be
    // the lenient consumer fallback AGENTS.md #0.1 forbids — so the author is
    // told twice instead: the config is invalid, AND these flat keys lost.
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
    expect(shadowWarnings()).toHaveLength(1);
    expect(String(shadowWarnings()[0][0])).toContain('`startDateField`');
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
    // The legacy singular alias the flat branch still reads.
    expect(FLAT_GANTT_CONFIG_KEYS).toContain('dependencyField');
    // No duplicates — the two halves must not overlap.
    expect(new Set(FLAT_GANTT_CONFIG_KEYS).size).toBe(FLAT_GANTT_CONFIG_KEYS.length);
  });
});

/**
 * Compile-time coverage pin (`tsc -p tsconfig.test.json` type-checks this file).
 * `never` exactly while every `GanttConfig` key — the one declaration both faces
 * derive from — appears in `FLAT_GANTT_CONFIG_KEYS`. A `GanttConfig` key that
 * `GanttConfigSchema.shape` does not model makes this line fail to compile,
 * NAMING the missing key. Before objectui#7845 a second literal
 * (`GANTT_CONFIG_EXTENSION_KEYS`) could also satisfy it; the spec now declares
 * those ten, so the shape is the only source that can.
 */
type AssertNever<T extends never> = T;
export type UncoveredGanttConfigKey = AssertNever<
  Exclude<KnownGanttConfigKey, (typeof FLAT_GANTT_CONFIG_KEYS)[number]>
>;
