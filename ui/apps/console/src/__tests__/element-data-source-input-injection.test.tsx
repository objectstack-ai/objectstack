/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The `dataSource` input is EMITTED at the gate-wrapping seam — the mechanism,
 * pinned once, over the whole registration graph (objectui#6678).
 *
 * ## What is being pinned, and what deliberately is not
 *
 * `PageComponentSchema.dataSource` is read by `ElementDataSourceGate` on behalf
 * of every object-bound block that wraps itself in it, and was declared by none
 * of them — so the html tier reported the one spelling that resolves a saved
 * view with the same `unknown-prop` warning it gives the spellings that do
 * nothing. The maintainer ruling of 2026-08-29 took option B **in the injection
 * form**: emitted mechanically at the wrapping seam, from the same place that
 * reads the key. Nine hand-kept copies across nine packages is what that ruling
 * refused, because copies drift and the tenth block forgets.
 *
 * So this file pins the MECHANISM, not a list of blocks. It never names which
 * blocks are gate-wrapped; it derives that set from the live graph and asserts a
 * property that holds of the whole set. A block added, moved between packages or
 * renamed tomorrow moves this test with it — which is the only way a pin on
 * "no drift" can itself be drift-free. Eleven packages are covered without one
 * of them appearing in this file.
 *
 * ## Why it lives here
 *
 * The claim is *package-agnostic*, so it needs the full registration graph — the
 * same pair `dev/manifest-dump.tsx` builds the published artifacts from, which
 * `public-contract.test.ts` and `registry-inputs-spec-parity.test.ts` next door
 * already read for the same reason. A hand-assembled list would agree with
 * itself and prove nothing.
 *
 * ## The three legs, and why none of them is redundant
 *
 *  1. **Wrapping is established INDEPENDENTLY of the declaration.** A test that
 *     read the marker and then asserted the injection keyed on that marker would
 *     be checking one line against itself. So gate-wrapping is detected by
 *     RENDERING each candidate against an unresolvable saved view and looking
 *     for the gate's own DOM signature — a `data-testid` only the gate emits.
 *     That is evidence from the render path, which is the only place it exists.
 *  2. **Every wrapping registration declares the key** — the injection reached
 *     it, whichever package it came from.
 *  3. **Nothing else declares it.** The control direction, and the reason option
 *     A was refused: a fix that published `dataSource` on blocks that never read
 *     it makes the diagnostic lie the other way instead of not at all.
 *
 * Plus the consumers: the key must reach the three artifacts `inputs` feeds —
 * `sdui.manifest.json`, `sdui-intrinsics.d.ts` (the JSX authoring types) and
 * `sdui-blocks.md`. Asserted through the generators themselves rather than in
 * prose, because "codegen and the designer see it" is exactly the claim that
 * cannot be taken on trust: it was false for this key for the whole life of the
 * defect.
 *
 * The `unknown-prop` half of the story — an author's actual experience, over the
 * real page path — is pinned next to the block that reports it, in
 * `packages/plugin-list/src/__tests__/htmlTierDataSourceInputDeclaration-6678.test.tsx`.
 *
 * The static half of "cannot forget" — a file that starts wrapping the gate
 * without reaching the seam — is `scripts/check-element-data-source-declaration.mjs`.
 * That gate and this one are complementary: it reads sources and cannot see the
 * registry, this reads the registry and cannot see an unmarked wrapper's source.
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import {
  generateBlockList,
  generateDts,
  manifestFromConfigs,
} from '@object-ui/sdui-parser';

// The two graphs whose registrations this reads — the layout/content primitives
// and the console's own plugin layer, from the module main.tsx boots from. Same
// posture as `public-contract.test.ts`: the REAL registration list.
import '@object-ui/components';
import '../register-plugins';

const KEY = 'dataSource';
const PROBE_OBJECT = 'probe_object__c';
/** A view name no adapter below serves, so the gate resolves it to `missing`. */
const ABSENT_VIEW = 'no_such_saved_view__probe';

/**
 * The gate's own DOM signatures. Each is emitted by one of the three panels
 * `ElementDataSourceGate` renders instead of the block, and by nothing else in
 * the repo — which is what makes them usable as "this renderer wraps the gate"
 * without asking the renderer.
 */
const GATE_TESTID = /-(datasource-error|no-data-source|resolving-view)$/;

/** An adapter that can answer "what saved views does this object have?" — with none. */
const viewCapableAdapter = {
  find: async () => ({ data: [], total: 0 }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  count: async () => 0,
  getObjectSchema: async (name: string) => ({ name, fields: {}, listViews: {} }),
  getObjects: async () => [],
  listViews: async () => [],
  onMutation: () => () => {},
} as any;

interface Config {
  type: string;
  namespace?: string;
  component?: unknown;
  inputs?: Array<{ name: string }>;
  lazy?: boolean;
}

/**
 * Every registration, de-duplicated by the namespaced type. The registry stores
 * a bare-name alias pointing at the same entry, so reading `getAllConfigs()`
 * raw would count several blocks twice and let a bare alias stand in for its
 * namespaced original.
 */
const configs = (): Config[] => {
  const byType = new Map<string, Config>();
  for (const c of ComponentRegistry.getAllConfigs() as Config[]) {
    if (!byType.has(c.type)) byType.set(c.type, c);
  }
  return [...byType.values()];
};

const declaresKey = (c: Config) => (c.inputs ?? []).some((i) => i?.name === KEY);

/**
 * Does rendering this registration produce one of the gate's panels?
 *
 * The probe names an object and a saved view that does not exist. A renderer
 * that wraps the gate reports that (or reports the missing adapter, or is still
 * resolving) through a panel with a `data-testid` no other component emits. A
 * renderer that does not wrap the gate has no path to any of them, whatever else
 * it does with the props.
 *
 * A renderer that THROWS is reported as such rather than silently counted as
 * "not wrapping" — a swallowed exception here would quietly shrink the
 * population this file's whole claim is quantified over.
 */
function wrapsGate(c: Config): { wraps: boolean; threw?: string } {
  const Component = c.component as React.ComponentType<any> | undefined;
  if (typeof Component !== 'function' && typeof Component !== 'object') return { wraps: false };
  const schema = {
    type: c.type,
    objectName: PROBE_OBJECT,
    [KEY]: { object: PROBE_OBJECT, view: ABSENT_VIEW },
  };
  try {
    const { container } = render(
      <SchemaRendererProvider dataSource={viewCapableAdapter}>
        {React.createElement(Component as any, { schema, ...schema })}
      </SchemaRendererProvider>,
    );
    const wraps = Array.from(container.querySelectorAll('[data-testid]')).some((el) =>
      GATE_TESTID.test(el.getAttribute('data-testid') || ''),
    );
    return { wraps };
  } catch (e) {
    return { wraps: false, threw: e instanceof Error ? e.message : String(e) };
  } finally {
    cleanup();
  }
}

describe('the `dataSource` declaration is emitted at the gate-wrapping seam (#6678)', () => {
  const all = configs().filter((c) => !c.lazy);
  const declaring = all.filter(declaresKey);

  it('is declared by a non-trivial set of registrations, spanning several packages', () => {
    // Anti-vacuity, in both dimensions. Every assertion below is quantified over
    // one of these sets, and each would pass trivially over an empty one — which
    // is the exact shape of "the injection silently stopped running".
    expect(declaring.length).toBeGreaterThan(1);
    const namespaces = new Set(declaring.map((c) => c.namespace).filter(Boolean));
    expect(namespaces.size).toBeGreaterThan(1);
  });

  it('every registration that renders the gate declares the key — from one mechanism, in any package', () => {
    // Candidates: everything that either declares the key or could plausibly
    // wrap the gate. Kept WIDER than the declaring set on purpose — a block that
    // started wrapping the gate without reaching the seam is exactly the drift
    // this pin exists to catch, and it is invisible to a probe that only looks
    // at blocks already declaring the key.
    const threw: string[] = [];
    const wrapping: string[] = [];
    for (const c of all) {
      const verdict = wrapsGate(c);
      if (verdict.threw) threw.push(`${c.type}: ${verdict.threw}`);
      if (verdict.wraps) wrapping.push(c.type);
    }

    // The probe must actually be able to SEE a gate — a detector that matches
    // nothing would report "every wrapper declares the key" over an empty set.
    expect(wrapping.length).toBeGreaterThan(1);

    const undeclared = wrapping.filter((t) => !declaring.some((c) => c.type === t));
    expect(
      undeclared,
      'These registrations render ElementDataSourceGate but publish no `dataSource` input. '
        + 'Wrap the registered renderer in `elementDataSourceBlock(...)` from @object-ui/core — '
        + 'do NOT hand-write the input.',
    ).toEqual([]);

    // Renderers that could not be probed are recorded, not hidden: a growing
    // list here shrinks what the assertion above actually covers.
    expect(threw.length, `renderers that threw during the probe:\n${threw.join('\n')}`)
      .toBeLessThan(all.length);
  });

  it('does NOT declare the key on blocks that never read it — the direction option A would have broken', () => {
    // `flex` and `card` are the two the ruling names. They do not wrap the gate,
    // so an author who writes `dataSource` on them must still be told; adding
    // the key to `sdui-parser`'s `BASE_PROPS` would have silenced both.
    for (const type of ['flex', 'card']) {
      const found = all.find((c) => c.type === type || c.type.endsWith(`:${type}`));
      expect(found, `expected a registration for "${type}"`).toBeTruthy();
      expect(declaresKey(found as Config)).toBe(false);
    }
  });
});

describe('the emitted input reaches the artifacts `inputs` feeds (#6678)', () => {
  // "Codegen and the designer see the input" is the half of the ruling that
  // cannot be taken on trust — it was false for this key for the whole life of
  // the defect. Asserted through the generators the repo publishes with, not in
  // prose.
  const all = configs().filter((c) => !c.lazy);
  const sample = all.find(declaresKey);

  it('has at least one declaring block to project', () => {
    expect(sample).toBeTruthy();
  });

  it('reaches the SDUI manifest — the save gate and the parser whitelist', () => {
    const manifest = manifestFromConfigs(all as never);
    const entry = manifest.components[(sample as Config).type];
    expect(entry.inputs.map((i) => i.name)).toContain(KEY);
    // The binding marker survives the projection: it is what makes the key read
    // as naming an OBJECT rather than an opaque blob.
    expect(entry.inputs.find((i) => i.name === KEY)?.binding).toBe('object');
  });

  it('reaches the generated JSX authoring types — `sdui-intrinsics.d.ts`', () => {
    const manifest = manifestFromConfigs(all as never);
    const dts = generateDts(manifest);
    expect(dts).toContain(`${KEY}?:`);
  });

  it('reaches the published block list — `sdui-blocks.md`', () => {
    const manifest = manifestFromConfigs(all as never);
    expect(generateBlockList(manifest)).toContain(KEY);
  });
});
