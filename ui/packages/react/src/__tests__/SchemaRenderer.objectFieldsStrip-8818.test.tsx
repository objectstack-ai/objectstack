/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8818 — an AUTHORED `objectFields` never reaches a component prop.
 *
 * ## The ruling this pins
 *
 * Decision batch #70 (objectui#7742, PR objectui#8799) ruled that `objectFields`
 * — the object's field catalogue, which the predicate layer reads to decide how
 * a conditional-formatting rule compares a relation field — is a RUNTIME React
 * prop a host injects, never authorable metadata. That PR moved the key off the
 * `kanban` arm's `schema` bag, but the renderer's fixed metadata strip list did
 * not name it, so a node that authored `objectFields` still had it spread as a
 * React prop onto whatever component its type resolved to. The class-one
 * ruling on objectui#8818 (letter a, ratified) completes batch #70: the key
 * joins the strip list, so no authored value can take the prop seat.
 *
 * ## Three spellings, one instrument
 *
 * An author can put a key on a node three ways, and every one of them reached
 * the spread before this card:
 *
 *   - top level — `{ type, objectFields }` — spread through `componentProps`;
 *   - canonical `properties: { objectFields }` — hoisted onto the node by the
 *     evaluation memo, then spread through `componentProps`;
 *   - legacy `props: { objectFields }` — NOT hoisted; spread as its own bag
 *     after `componentProps`, so the destructure alone does not cover it (the
 *     carrier objectui#9758 found one key over, for `data`).
 *
 * Each row drives all three through the same probe and asserts them as one
 * labelled object, so a failure names the spelling that moved.
 *
 * ## The controls that make a zero a reading
 *
 * An absence on a probe that silently stopped capturing reads identically to a
 * strip that works. So every absence row is paired with a lit leg on the SAME
 * probe: a sibling key authored the same three ways still arrives (row 2), and
 * a HOST-passed `objectFields` React prop still arrives (rows 3 and 4) — that is
 * the only legitimate producer's channel, and `...props` is spread last.
 *
 * ## Why a stub and not the kanban board
 *
 * The question this file owns is what `SchemaRenderer` HANDS OVER, for any
 * type key. No registered renderer reads `objectFields` today (the census on
 * objectui#8818's PR); the board that does is mounted by `ObjectKanban` as a
 * host with the prop passed directly, and its behavioural pin lives in
 * `plugin-kanban`. The plugins are not importable here — they depend on this
 * package.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
import { DROPPED_PROPS_BAG_PREFIX } from '../utils/propsBagDiagnostic';

/** A catalogue an AUTHOR wrote into the metadata — the value the ruling refuses. */
const AUTHORED = { owner: { type: 'text', label: 'Authored catalogue' } };
/** The catalogue a HOST fetched and passes as a React prop — the ruled channel. */
const HOSTED = { owner: { type: 'lookup', reference: 'user' } };

/**
 * The registered component. A mock records the props bag of every call, so the
 * probe reads what `SchemaRenderer` handed over without writing to module state
 * during render (which `react-hooks/immutability` refuses).
 */
const Probe = vi.fn((_props: Record<string, unknown>) => <div data-testid="probe" />);

/** Render one node and hand back the exact bag the component received. */
function seenFor(schema: object, hostProps: Record<string, unknown> = {}): Record<string, unknown> {
  Probe.mockClear();
  render(<SchemaRenderer schema={schema as never} {...hostProps} />);
  const last = Probe.mock.lastCall;
  if (last === undefined) throw new Error('probe never rendered — check the registry key');
  return last[0];
}

/** The three ways an author can put one key on a node. */
function threeSpellings(type: string, key: string, value: unknown) {
  return {
    topLevel: { type, id: `top-${type}`, [key]: value },
    canonical: { type, id: `can-${type}`, properties: { [key]: value } },
    legacy: { type, id: `leg-${type}`, props: { [key]: value } },
  };
}

/**
 * Type keys the probe is registered under. A plain type, plus the object-arm
 * `object-grid` — whose `data` strip (objectui#9571 / objectui#9758) runs on the
 * same two bags, so it is the key where a second strip could disturb the
 * first — plus `object-kanban`, the one plugin whose board reads the catalogue.
 */
const PROBE_TYPES = ['probe-8818', 'object-grid', 'object-kanban'] as const;

describe('SchemaRenderer — an authored `objectFields` never reaches a component prop (objectui#8818, batch #70)', () => {
  beforeEach(() => {
    Probe.mockClear();
    for (const type of PROBE_TYPES) ComponentRegistry.register(type, Probe as never);
  });

  afterEach(() => {
    for (const type of PROBE_TYPES) ComponentRegistry.unregister?.(type);
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(PROBE_TYPES)(
    '1. %s: all THREE authoring spellings of `objectFields` lose the prop seat',
    (type) => {
      const s = threeSpellings(type, 'objectFields', AUTHORED);

      expect({
        'top-level `objectFields`': 'objectFields' in seenFor(s.topLevel),
        'canonical `properties: { objectFields }`': 'objectFields' in seenFor(s.canonical),
        'legacy `props: { objectFields }`': 'objectFields' in seenFor(s.legacy),
      }).toEqual({
        'top-level `objectFields`': false,
        'canonical `properties: { objectFields }`': false,
        'legacy `props: { objectFields }`': false,
      });
    },
  );

  it.each(PROBE_TYPES)(
    '2. ⛔ CONTROL: %s: a sibling key authored the same three ways still arrives — the probe is live',
    (type) => {
      const s = threeSpellings(type, 'title', 'Kept');

      expect({
        'top-level `title`': seenFor(s.topLevel).title,
        'canonical `properties: { title }`': seenFor(s.canonical).title,
        'legacy `props: { title }`': seenFor(s.legacy).title,
      }).toEqual({
        'top-level `title`': 'Kept',
        'canonical `properties: { title }`': 'Kept',
        'legacy `props: { title }`': 'Kept',
      });
    },
  );

  it.each(PROBE_TYPES)(
    '3. ⛔ MUST NOT CHANGE: %s: a HOST-passed `objectFields` React prop still arrives',
    (type) => {
      const seen = seenFor({ type, id: `host-${type}` }, { objectFields: HOSTED });

      expect(seen.objectFields).toBe(HOSTED);
    },
  );

  it.each(PROBE_TYPES)(
    '4. ⛔ MUST NOT CHANGE: %s: the host prop wins beside an authored value in every spelling',
    (type) => {
      const s = threeSpellings(type, 'objectFields', AUTHORED);

      expect({
        'top-level `objectFields`': seenFor(s.topLevel, { objectFields: HOSTED }).objectFields,
        'canonical `properties: { objectFields }`': seenFor(s.canonical, { objectFields: HOSTED }).objectFields,
        'legacy `props: { objectFields }`': seenFor(s.legacy, { objectFields: HOSTED }).objectFields,
      }).toEqual({
        'top-level `objectFields`': HOSTED,
        'canonical `properties: { objectFields }`': HOSTED,
        'legacy `props: { objectFields }`': HOSTED,
      });
    },
  );

  it('5. only `objectFields` leaves the alias bag — every other key it declares still arrives', () => {
    const seen = seenFor({
      type: 'probe-8818',
      id: 'siblings',
      props: { objectFields: AUTHORED, title: 'Kept', density: 'compact' },
    });

    expect('objectFields' in seen).toBe(false);
    expect([seen.title, seen.density]).toEqual(['Kept', 'compact']);
  });

  it('6. on the object arm, stripping `objectFields` from the alias bag is not reported as a refused `data`', () => {
    // The objectui#9758 `data` diagnostic decides by IDENTITY — it fires when
    // the alias bag that leaves its strip is not the bag that entered it. The
    // `objectFields` strip therefore runs BEFORE that comparison; run after it,
    // it would make every object-arm node with an aliased `objectFields` warn
    // about a `data` key the author never wrote.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'object-grid', id: 'no-data', props: { objectFields: AUTHORED } });

    expect(
      warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('NOT passed to the component')),
    ).toEqual([]);
  });

  it('7. the objectui#6708 dropped-bag notice stops naming `objectFields` — its own sentence would be false', () => {
    // That notice tells the author the key "is spread as React props on the
    // created element". After this card that is false for `objectFields`, so it
    // must not name the key — while still naming every key it does drop.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seenFor({ type: 'probe-8818', id: 'six708-mixed', props: { objectFields: AUTHORED, title: 'Kept' } });

    const message = warn.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.startsWith(DROPPED_PROPS_BAG_PREFIX));
    expect(message).toBeDefined();
    expect(message).toContain('`title`');
    expect(message).not.toContain('`objectFields`');
  });

  it('8. ⛔ MUST NOT CHANGE: a node that authors no `objectFields` gets the same props bag as before', () => {
    // Asserted as the FULL key set rather than as "`objectFields` absent",
    // which would also pass on a renderer that had dropped something else.
    const seen = seenFor({
      type: 'probe-8818',
      id: 'plain',
      title: 'Kept',
      props: { density: 'compact' },
    });

    expect(Object.keys(seen).sort()).toEqual(
      ['className', 'data-obj-id', 'data-obj-type', 'density', 'disabled', 'id', 'props', 'schema', 'title'].sort(),
    );
  });
});
