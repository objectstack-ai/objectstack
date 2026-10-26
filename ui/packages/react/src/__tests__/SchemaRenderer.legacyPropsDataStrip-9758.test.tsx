/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9758 — the objectui#9571 `data` strip reaches the LEGACY `props`
 * alias bag too.
 *
 * ## The carrier this closes
 *
 * objectui#9571 removed the authored `data` key from `componentProps` — the
 * node's own non-metadata keys — on a block whose published `data` row is the
 * `ViewData` OBJECT arm. But `createElement` spreads the legacy `props` alias
 * bag AFTER that strip, so an author who spelled the same key
 * `props: { data: [...] }` still took the prop seat, and `ObjectGrid`
 * (`passedData`), `ObjectMap` (`dataProp`) and `ObjectGantt` still lifted it
 * with an unconditional `Array.isArray` at higher priority than the shared
 * ladder. Same defect, one alias over.
 *
 * Maintainer ruling, decision batch #167 item 2, letter 剥, 「其他同意」: the
 * strip applies to the alias bag as well — the same arm predicate, the same dev
 * diagnostic. ⛔ No validator refusal (whether the alias exists at all is
 * objectui#4795's pending question ②, human-held), and ⛔ no change to what the
 * alias otherwise carries.
 *
 * ## The probe keeps all three arms, and that is what makes it a reading
 *
 * Row 1 drives all three spellings of the same key through ONE instrument:
 * top-level `data`, canonical `properties: { data }`, legacy `props: { data }`.
 * The first two are the same-subject controls — they were already absent before
 * this card, so a probe that reported the third as absent while silently
 * breaking would read identically to a broken probe. All three are asserted in
 * one object so a failure names WHICH spelling moved.
 *
 * ## Why a stub and not a real block
 *
 * The question this file owns is what `SchemaRenderer` HANDS OVER. A real grid
 * answers a different one (did rows appear) through a fetch effect, an adapter
 * and a dozen unrelated decisions; the plugin packages own that half. The real
 * plugins are not importable here in any case — they depend on this package.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry, recordSourceDataArmForType } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { DROPPED_PROPS_BAG_PREFIX } from '../utils/propsBagDiagnostic';

/** Rows an author put in the metadata. */
const AUTHORED = [{ id: 'a1', name: 'Authored row' }];
/** Rows a HOST pre-fetched and handed down — the carrier the ruling protects. */
const HOSTED = [{ id: 'h1', name: 'Host row' }];

/**
 * The last props bag `SchemaRenderer` handed the component. A container whose
 * PROPERTY is written, not an outer `let` reassigned: `react-hooks/globals`
 * refuses the reassignment form during render, and this capture is the whole
 * point of the probe.
 */
const captured: { props: Record<string, unknown> | null } = { props: null };

const Probe = (props: Record<string, unknown>) => {
  captured.props = props;
  return <div data-testid="probe" />;
};

/** Render one node and hand back the exact bag the component received. */
function seenFor(schema: object, hostProps: Record<string, unknown> = {}): Record<string, unknown> {
  captured.props = null;
  render(<SchemaRenderer schema={schema as never} {...hostProps} />);
  if (captured.props === null) throw new Error('probe never rendered — check the registry key');
  return captured.props;
}

/**
 * Registry keys on the object arm. ⛔ Not re-derived here — these are
 * `recordSourceDataArmForType`'s rows, kept honest by the registry-derived pins
 * in `plugin-grid`, `plugin-map`, `plugin-gantt` and `plugin-tree`; row 14
 * re-reads them through the predicate itself so this file cannot drift from
 * the table. The tree spellings joined the object arm with objectui#8348, when
 * `ComponentPropsMap['object-tree']` began to declare the `ViewData` union
 * (`view:tree` / `tree` left with objectui#10859 batch 8's retirement of the alias).
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
] as const;
const ARRAY_ARM_TYPES = ['object-calendar', 'view:calendar', 'calendar'] as const;

const ALL_PROBE_TYPES = [...OBJECT_ARM_TYPES, ...ARRAY_ARM_TYPES];

describe('SchemaRenderer — the legacy `props` alias loses the `data` prop seat on the object arm (objectui#9758)', () => {
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
    '1. %s: all THREE authoring spellings of the same key lose the prop seat — one probe, three arms',
    (type) => {
      const topLevel = seenFor({ type, id: `top-${type}`, data: AUTHORED });
      const canonical = seenFor({ type, id: `can-${type}`, properties: { data: AUTHORED } });
      const legacy = seenFor({ type, id: `leg-${type}`, props: { data: AUTHORED } });

      // Asserted as one labelled object so the failure diff NAMES the spelling
      // that moved, instead of reporting a bare `true !== false`.
      expect({
        'top-level `data`': 'data' in topLevel,
        'canonical `properties: { data }`': 'data' in canonical,
        'legacy `props: { data }`': 'data' in legacy,
      }).toEqual({
        'top-level `data`': false,
        'canonical `properties: { data }`': false,
        'legacy `props: { data }`': false,
      });
    },
  );

  it('2. the alias still CARRIES what the author wrote — only the prop seat is refused', () => {
    // 「⛔ no change to what the alias otherwise carries」. The bag is still on
    // the node the component receives; what this card removes is the React prop
    // the object-arm blocks lift with `Array.isArray` ahead of the ladder.
    const seen = seenFor({ type: 'object-grid', id: 'carries', props: { data: AUTHORED } });

    expect('data' in seen).toBe(false);
    expect((seen as { schema: { props: { data: unknown } } }).schema.props.data).toEqual(AUTHORED);
  });

  it('3. only `data` leaves the alias bag — every other key it declares still arrives', () => {
    const seen = seenFor({
      type: 'object-grid',
      id: 'siblings',
      props: { data: AUTHORED, title: 'Kept', density: 'compact' },
    });

    expect('data' in seen).toBe(false);
    expect([seen.title, seen.density]).toEqual(['Kept', 'compact']);
  });

  it('4. the DECLARED object form loses the alias seat too — the ruling is about the KEY, not about arrays', () => {
    const seen = seenFor({
      type: 'object-grid',
      id: 'declared-alias',
      props: { data: { provider: 'value', items: AUTHORED } },
    });

    expect('data' in seen).toBe(false);
  });

  it.each([...ARRAY_ARM_TYPES])(
    '5. ⛔ CONTROL: %s is NOT on the object arm, so its aliased `data` keeps the prop seat verbatim',
    (type) => {
      const seen = seenFor({ type, id: `c-${type}`, props: { data: AUTHORED } });

      expect(seen.data).toEqual(AUTHORED);
    },
  );

  it('6. ⛔ MUST NOT CHANGE: a HOST `data` React prop still arrives, even beside an aliased authored one', () => {
    // Option B — gating the PROP on the arm — was refused on objectui#9571
    // precisely to keep this path: `...props` is spread LAST, after both bags.
    const seen = seenFor(
      { type: 'object-grid', id: 'hosted-alias', props: { data: AUTHORED } },
      { data: HOSTED },
    );

    expect(seen.data).toEqual(HOSTED);
  });

  it('7. ⛔ MUST NOT CHANGE: a node whose alias declares no `data` gets a byte-identical props bag', () => {
    // The `in` test comes first in the strip, so no copy is allocated and no
    // key moves. Asserted as the FULL key set rather than as "`data` absent",
    // which would also pass on a renderer that had dropped something else.
    const seen = seenFor({
      type: 'object-grid',
      id: 'plain-alias',
      objectName: 'account',
      props: { title: 'Kept', density: 'compact' },
    });

    expect(Object.keys(seen).sort()).toEqual(
      [
        'className',
        'data-obj-id',
        'data-obj-type',
        'density',
        'disabled',
        'id',
        'objectName',
        'props',
        'schema',
        'title',
      ].sort(),
    );
  });

  it('8. objectui#5123 precedence is untouched — both spellings co-present, both seats refused', () => {
    // `propsWithoutCanonicalKeys` already subtracts a key BOTH bags declare, so
    // the canonical value is the one that would have been spread; this card
    // then refuses that one too. One key, one answer, and it is "absent".
    const seen = seenFor({
      type: 'object-grid',
      id: 'both-bags',
      properties: { data: AUTHORED },
      props: { data: HOSTED },
    });

    expect('data' in seen).toBe(false);
  });

  it('9. the author is TOLD — the same dev warning fires for the ALIAS carrier', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'object-map', id: 'warned-alias', props: { data: AUTHORED } });

    const message = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('NOT passed to the component'));
    expect(message).toBeDefined();
    expect(message).toContain('object-map');
    expect(message).toContain('ViewData');
    expect(message).toContain('provider');
  });

  it('10. …and it stays silent for the alias carrier on the array arm', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'object-calendar', id: 'quiet-alias', props: { data: AUTHORED } });

    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('NOT passed to the component')),
    ).toEqual([]);
  });

  it('11. the objectui#6708 dropped-bag notice stops naming `data` here — its own sentence would be false', () => {
    // ORDERING, pinned because it is a decision and not an accident. The #6708
    // message says the key "is spread as React props on the created element"
    // and tells the author to "write them under `properties` instead". After
    // this card BOTH sentences are false for `data` on this arm: it is no
    // longer spread, and `properties: { data }` loses the seat as well. So the
    // strip runs BEFORE that diagnostic reads the outgoing bag, and the author
    // gets the one accurate line (row 9) instead of two, one of them wrong.
    //
    // ⚠️ The contrast with its objectui#4795 neighbour is deliberate, not an
    // inconsistency: that scan reports an unevaluated `${…}` still in front of
    // a user, which stays TRUE after the strip, so it deliberately reads the
    // wider bag. This one's subject stops being true.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'object-grid', id: 'six708-data', props: { data: AUTHORED } });

    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith(DROPPED_PROPS_BAG_PREFIX)),
    ).toEqual([]);
  });

  it('12. …but it still names every OTHER key the alias drops, on the same node', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'object-grid', id: 'six708-mixed', props: { data: AUTHORED, title: 'Kept' } });

    const message = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.startsWith(DROPPED_PROPS_BAG_PREFIX));
    expect(message).toBeDefined();
    expect(message).toContain('`title`');
    expect(message).not.toContain('`data`');
  });

  it('13. a degenerate alias bag is NOT reinterpreted by the strip', () => {
    // objectui#6752: a non-object `props` contributes no keys at all. The strip
    // must not turn that into a shape question — `'data' in {}` is simply
    // false, and the nine index keys stay refused for the reason they already
    // were.
    const seen = seenFor({ type: 'object-grid', id: 'degenerate', props: 'not-a-bag' });

    expect('data' in seen).toBe(false);
    expect('0' in seen).toBe(false);
  });

  it('14. the reading itself: each spelling this file drives answers the arm its ladder call site passes', () => {
    for (const type of OBJECT_ARM_TYPES) expect(recordSourceDataArmForType(type)).toBe('view-data');
    for (const type of ARRAY_ARM_TYPES) expect(recordSourceDataArmForType(type)).toBe('array');
  });
});
