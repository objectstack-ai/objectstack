/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9571 — an authored `data` key takes NO React prop seat on a block
 * whose published `data` row is the OBJECT arm.
 *
 * ## The ruling, and the carrier it closes
 *
 * objectui#8348 Q2-C, decision batch #136 item 3, maintainer 「同意」 on the
 * seat's recommendation. 「8348 以协议为准」 (batch #83) retired the bare-array
 * `data` shorthand at the shared ladder, but `SchemaRenderer` spreads every
 * non-metadata node key as a React prop — so the authored key reached an
 * object-arm block TWICE, and the surviving carrier is the one that wins:
 * `ObjectGrid` (`passedData`), `ObjectMap` (`dataProp`) and `ObjectGantt` all
 * lift a `data` PROP with an unconditional `Array.isArray` at HIGHER priority
 * than the ladder. AGENTS.md #0.1: one key, one honoured spelling — the
 * tolerated second carrier is the defect.
 *
 * ## Why the probe is a stub and not a real block
 *
 * The question this file owns is what `SchemaRenderer` HANDS OVER, and a real
 * grid answers a different one (did rows appear), through a fetch effect, an
 * adapter and a dozen unrelated decisions. The plugin packages own the
 * end-to-end halves (`gridBareArrayDataRefused-8348.test.tsx`,
 * `ObjectMap.schemaDataShorthand.test.tsx`); this file reads the props bag
 * itself, which is the only lens that can tell the two carriers apart. The
 * real plugins are not importable here in any case — they depend on this
 * package, not the other way round.
 *
 * ## The must-NOT-change leg is in this file on purpose
 *
 * ⛔ Option B — gating the PROP on the arm — was REFUSED, because the prop is
 * how a host hands down rows it already fetched. Rows 5 and 6 are that leg: a
 * host's own React `data` prop still arrives, and a node that authors no `data`
 * is handed a byte-identical bag.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';

/** Rows an author put in the metadata. */
const AUTHORED = [{ id: 'a1', name: 'Authored row' }];
/** Rows a HOST pre-fetched and handed down — the other carrier. */
const HOSTED = [{ id: 'h1', name: 'Host row' }];

/**
 * The last props bag `SchemaRenderer` handed the component.
 *
 * A container whose PROPERTY is written, not an outer `let` reassigned:
 * `react-hooks/globals` refuses the reassignment form during render, and it is
 * right to — this capture is the whole point of the probe, so it is spelled the
 * way the rule permits rather than silenced.
 */
const captured: { props: Record<string, unknown> | null } = { props: null };

const Probe = (props: Record<string, unknown>) => {
  captured.props = props;
  return <div data-testid="probe" />;
};

/** The captured bag, read as a plain object. */
const seen = () => captured.props;

/**
 * Every REGISTRY KEY the five ladder blocks are reachable under — one
 * `register()` call produces several, and `SchemaRenderer` looks the arm up
 * with the raw `schema.type`, so each key has to answer. ⛔ Not re-derived here:
 * these are `recordSourceDataArmForType`'s rows, and the registry-derived pins
 * in `plugin-grid`, `plugin-map`, `plugin-gantt` and `plugin-tree` are what keep
 * the rows honest.
 *
 * The tree spellings joined the object arm with objectui#8348 (four then; two
 * since objectui#10859 batch 8 retired the `tree` / `view:tree` alias): they read
 * `'undeclared'` while no published face declared a `data` row for
 * `object-tree`, and `ComponentPropsMap['object-tree']` now declares the
 * `ViewData` union.
 *
 * ⛔ Bare `grid` is deliberately NOT in the object-arm list — it is
 * `@object-ui/components`' LAYOUT grid, which `plugin-grid`'s `skipFallback`
 * leaves alone. Row 12 is that control.
 */
const OBJECT_ARM_TYPES = [
  'object-grid',
  'plugin-grid:object-grid',
  'view:grid',
  'object-map',
  'plugin-map:object-map',
  'object-gantt',
  'plugin-gantt:object-gantt',
  'object-tree',
  'plugin-tree:object-tree',
] as const;
const ARRAY_ARM_TYPES = [
  'object-calendar',
  'plugin-calendar:object-calendar',
  'view:calendar',
  'calendar',
] as const;

const ALL_PROBE_TYPES = [...OBJECT_ARM_TYPES, ...ARRAY_ARM_TYPES];

describe('SchemaRenderer — an authored `data` is refused a prop seat on the object arm (objectui#9571)', () => {
  beforeEach(() => {
    captured.props = null;
    for (const type of ALL_PROBE_TYPES) ComponentRegistry.register(type, Probe as never);
  });

  afterEach(() => {
    for (const type of ALL_PROBE_TYPES) ComponentRegistry.unregister?.(type);
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(OBJECT_ARM_TYPES)(
    '1. %s (object arm): an authored bare array under `data` does NOT reach the component as a prop',
    (type) => {
      render(<SchemaRenderer schema={{ type, id: `n-${type}`, data: AUTHORED } as never} />);

      expect(seen()).not.toBeNull();
      expect('data' in (seen() as object)).toBe(false);
    },
  );

  it.each(OBJECT_ARM_TYPES)(
    '2. %s (object arm): the authored key still reaches the block as `schema.data`, for the ladder to judge',
    (type) => {
      render(<SchemaRenderer schema={{ type, id: `s-${type}`, data: AUTHORED } as never} />);

      expect((seen() as { schema: { data: unknown } }).schema.data).toEqual(AUTHORED);
    },
  );

  it('3. the DECLARED object form loses the prop seat too — the ruling is about the KEY, not about arrays', () => {
    // The ruling reads "stops spreading `data` as a prop", not "stops spreading
    // arrays". Both carriers of the same key collapse to one, so `schema.data`
    // is the single answer for every value shape on this arm — and no
    // behaviour moves, because all three blocks tested the prop with
    // `Array.isArray` and never looked at an object one anyway.
    render(
      <SchemaRenderer
        schema={{ type: 'object-grid', id: 'declared', data: { provider: 'value', items: AUTHORED } } as never}
      />,
    );

    expect('data' in (seen() as object)).toBe(false);
    expect((seen() as { schema: { data: unknown } }).schema.data).toEqual({
      provider: 'value',
      items: AUTHORED,
    });
  });

  it.each([...ARRAY_ARM_TYPES])(
    '4. ⛔ CONTROL: %s is NOT on the object arm, so its authored `data` keeps the prop seat verbatim',
    (type) => {
      render(<SchemaRenderer schema={{ type, id: `c-${type}`, data: AUTHORED } as never} />);

      expect((seen() as { data: unknown }).data).toEqual(AUTHORED);
    },
  );

  it('5. ⛔ MUST NOT CHANGE: a HOST passing `data` as a React prop still delivers it, on the object arm', () => {
    // Option B (gating the prop on the arm) was refused precisely to keep this
    // path. `...props` is spread LAST in `SchemaRenderer`, after the schema
    // keys, so the host's rows win — as they did before this card.
    render(
      <SchemaRenderer
        schema={{ type: 'object-grid', id: 'hosted' } as never}
        data={HOSTED as never}
      />,
    );

    expect((seen() as { data: unknown }).data).toEqual(HOSTED);
  });

  it('6. ⛔ MUST NOT CHANGE: a host prop still wins over an authored key on the object arm', () => {
    render(
      <SchemaRenderer
        schema={{ type: 'object-grid', id: 'both', data: AUTHORED } as never}
        data={HOSTED as never}
      />,
    );

    expect((seen() as { data: unknown }).data).toEqual(HOSTED);
  });

  it('7. ⛔ MUST NOT CHANGE: a node that authors no `data` gets a byte-identical props bag', () => {
    // The `in` test comes first in the strip, so no copy is allocated and no
    // key moves. Asserted as the full key set rather than as "`data` absent",
    // which would also pass on a renderer that had dropped something else.
    render(
      <SchemaRenderer
        schema={{ type: 'object-grid', id: 'plain', objectName: 'account', columns: [] } as never}
      />,
    );

    expect(Object.keys(seen() as object).sort()).toEqual(
      ['className', 'columns', 'data-obj-id', 'data-obj-type', 'disabled', 'id', 'objectName', 'schema'].sort(),
    );
  });

  it('8. the author is TOLD — one dev warning naming the key, the arm and the spelling that works', () => {
    // ⚠️ MEASURED, and it corrects the card's own premise: the ladder emits NO
    // runtime signal of its own. `resolveRecordSourceConfig` falls through
    // silently and `validateSchema` never reads `data` against the block's row,
    // so without this warning the ruling lands as a page that simply stopped
    // drawing — the "author gets a success receipt" shape AGENTS.md #0.1 names.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<SchemaRenderer schema={{ type: 'object-map', id: 'warned', data: AUTHORED } as never} />);

    const message = warn.mock.calls.map((c) => String(c[0])).find((m) => m.includes('object-map'));
    expect(message).toBeDefined();
    expect(message).toContain('SchemaRenderer');
    expect(message).toContain('ViewData');
    expect(message).toContain('provider');
  });

  it('9. …and it does NOT fire for a block on the array arm', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <SchemaRenderer schema={{ type: 'object-calendar', id: 'quiet', data: AUTHORED } as never} />,
    );

    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('NOT passed to the component')),
    ).toEqual([]);
  });

  it('10. the reading itself: each registered spelling answers the arm its own ladder call site passes', () => {
    for (const type of OBJECT_ARM_TYPES) expect(recordSourceDataArmForType(type)).toBe('view-data');
    for (const type of ARRAY_ARM_TYPES) expect(recordSourceDataArmForType(type)).toBe('array');
    // No LISTED type answers `'undeclared'` since objectui#8348 moved the tree;
    // row 11 is where the default is still read, on an unlisted type.
  });

  it('12. ⛔ CONTROL: bare `grid` is the LAYOUT container, and it keeps its `data` prop', () => {
    // The trap the registry-derived pins caught on their first run. `plugin-grid`
    // registers its `view` alias with `skipFallback: true` so the bare key stays
    // with `@object-ui/components`' layout grid — a container that declares no
    // `data` row at all. A row for `grid` in the arm table would strip a key
    // from a block the ruling never reached.
    expect(recordSourceDataArmForType('grid')).toBe('undeclared');

    ComponentRegistry.register('grid', Probe as never);
    try {
      render(<SchemaRenderer schema={{ type: 'grid', id: 'layout', data: AUTHORED } as never} />);
      expect((seen() as { data: unknown }).data).toEqual(AUTHORED);
    } finally {
      ComponentRegistry.unregister?.('grid');
    }
  });

  it('11. an unlisted type answers `undeclared`, which is the NO-CHANGE direction', () => {
    // The default has to be the direction that leaves an unmeasured block
    // exactly as it is — otherwise the table's mere existence re-decides every
    // type nobody has looked at.
    expect(recordSourceDataArmForType('ui:text')).toBe('undeclared');
    expect(recordSourceDataArmForType(undefined)).toBe('undeclared');

    ComponentRegistry.register('probe-unlisted-9571', Probe as never);
    try {
      render(
        <SchemaRenderer schema={{ type: 'probe-unlisted-9571', data: AUTHORED } as never} />,
      );
      expect((seen() as { data: unknown }).data).toEqual(AUTHORED);
    } finally {
      ComponentRegistry.unregister?.('probe-unlisted-9571');
    }
  });
});
