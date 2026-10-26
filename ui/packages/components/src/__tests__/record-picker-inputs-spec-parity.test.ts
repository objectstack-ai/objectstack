/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker` — the published authoring surface stays in parity with
 * `@objectstack/spec` `ElementRecordPickerProps` for its query keys
 * (objectui#3830, objectui#11880, objectui#12030).
 *
 * The picker reads its query from the node-level `dataSource` binding only
 * (objectui#11880; objectstack#11509, ruled A-narrow). Through 17.x the spec
 * still declared the flat `object` / `filter` / `sort` / `limit` on the row, so
 * the registration kept publishing all four with descriptions saying they were
 * NOT READ, and this file pinned that parity. `@objectstack/spec` 18 retired the
 * four as tombstones (objectui#12030), and the registration stopped publishing
 * them in the same change. This file now pins that state:
 *
 *   - the spec refuses each of the four BY NAME, on a bag it otherwise accepts;
 *   - the registration publishes none of them, and still publishes the
 *     display-only keys the renderer reads;
 *   - a JSX page that writes the retired `filter` gets `unknown-prop` from the
 *     compiler, whose whitelist `renderers/layout/page.tsx` builds from these
 *     same `inputs` — the harm objectui#3830 described, now pointed the other
 *     way on purpose: the key is refused upstream, so nothing should teach it.
 *
 * `element:record_picker` is deliberately NOT in `PUBLIC_BLOCKS` ("record
 * picking is a field widget, not a page block"), so it never reaches
 * `sdui.manifest.json`; its `inputs` matter through that JSX-page whitelist.
 *
 * Expectations are derived from the spec at runtime, not restated.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';
import { ElementRecordPickerPropsSchema } from '@objectstack/spec/ui';
// Module scope, not a hook: the cold transform is billed to the import phase,
// which has no test/hook timeout (AGENTS.md §测试纪律, objectui#3010).
import '../renderers';

type ShapeCarrier = { shape?: unknown; _def?: { shape?: unknown } };

/** Resolve the props object's `.shape` through both spellings, lazy or plain. */
function specTopLevelKeys(): string[] {
  const carrier = ElementRecordPickerPropsSchema as unknown as ShapeCarrier;
  const shape = carrier.shape ?? carrier._def?.shape;
  const resolved = typeof shape === 'function' ? (shape as () => object)() : shape;
  return resolved && typeof resolved === 'object' ? Object.keys(resolved) : [];
}

const TYPE = 'element:record_picker';
const config = () => ComponentRegistry.getConfig(TYPE);
const inputs = () => config()?.inputs ?? [];
const inputNames = () => inputs().map((i) => i.name);

/** The flat query keys `@objectstack/spec` 18 retired on this row (objectui#12030). */
const RETIRED_QUERY_KEYS = ['object', 'filter', 'sort', 'limit'] as const;

/** A value for each retired key that its pre-18 member accepted. */
const RETIRED_VALUES: Record<(typeof RETIRED_QUERY_KEYS)[number], unknown> = {
  object: 'account',
  filter: [{ field: 'status', operator: 'equals', value: 'open' }],
  sort: [{ field: 'name', order: 'asc' }],
  limit: 10,
};

/** A bag the spec accepts: display-only keys, no query. */
const BASE = { labelField: 'name', valueField: 'id' };

describe('element:record_picker — registry inputs vs @objectstack/spec', () => {
  it('is registered with a non-empty `inputs` surface', () => {
    expect(config()).toBeDefined();
    expect(inputNames().length).toBeGreaterThan(0);
  });

  it('resolves a non-empty spec key set', () => {
    // Guards the probe, not the subject: a Zod internals change would return `[]`
    // here and make every assertion below vacuously agreeable.
    expect(specTopLevelKeys().length).toBeGreaterThan(0);
  });

  it('the spec refuses each flat query key BY NAME, on a bag it otherwise accepts', () => {
    // The accept leg first: without it every refusal below is a schema that
    // refuses everything rather than a reading of these four keys.
    expect(ElementRecordPickerPropsSchema.safeParse(BASE).success).toBe(true);
    for (const key of RETIRED_QUERY_KEYS) {
      // Still a KEY of the row — a tombstone, not a deletion — which is what
      // makes the refusal name it rather than read as an unknown key.
      expect(specTopLevelKeys(), key).toContain(key);
      const result = ElementRecordPickerPropsSchema.safeParse({ ...BASE, [key]: RETIRED_VALUES[key] });
      expect(result.success, key).toBe(false);
      const paths = result.error?.issues.map((i) => i.path.join('.')) ?? [];
      expect(paths, key).toContain(key);
    }
  });

  it('publishes none of the retired query keys, and still publishes the display keys it reads', () => {
    for (const key of RETIRED_QUERY_KEYS) {
      expect(inputNames(), `\`${key}\` is published again — the spec refuses it`).not.toContain(key);
    }
    // Control: the same read finds the keys that ARE published, so the absence
    // above is a reading and not an empty registration.
    for (const key of ['labelField', 'valueField', 'placeholder', 'label', 'emptyText']) {
      expect(inputNames()).toContain(key);
    }
  });

  it('a JSX page writing the retired `filter` gets `unknown-prop` from the compiler', () => {
    // The manifest is assembled the way `renderers/layout/page.tsx` assembles
    // the JSX-page compiler's whitelist — `getKnownTypes()` mapped through each
    // type's registered meta — so this runs against the LIVE registration, not a
    // hand-written fixture that could agree with itself.
    const manifest = manifestFromConfigs(
      ComponentRegistry.getKnownTypes().map((t) => {
        const meta = ComponentRegistry.getMeta(t);
        return { type: t, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
      }) as unknown as Parameters<typeof manifestFromConfigs>[0],
    );

    const r = compile(
      `<${TYPE} labelField="name" filter={[{"field":"status","operator":"equals","value":"open"}]} />`,
      manifest,
    );
    const unknownProps = r.diagnostics
      .filter((d) => d.code === 'unknown-prop')
      .map((d) => d.message);
    expect(unknownProps.join(' | ')).toMatch(/filter/);
    // Control on the same compile: a published key draws no `unknown-prop`, so
    // the diagnostic above is about `filter` and not a tag the manifest lost.
    expect(unknownProps.join(' | ')).not.toMatch(/labelField/);
  });
});
