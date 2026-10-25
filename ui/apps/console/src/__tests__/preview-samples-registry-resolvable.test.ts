/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `preview-samples.ts` page blocks ↔ `ComponentRegistry` resolvability
 * (objectui#3446).
 *
 * ## Why the spec guard is not enough
 *
 * `preview-samples-spec-valid.test.ts` already asks whether a sample would
 * survive being published. It cannot ask this question, and the gap is by
 * design rather than by oversight: `PageComponentSchema.type` is
 *
 *   z.union([ PageComponentType, z.string() ])
 *
 * — the enum OR any string, so that a page may host a block a plugin
 * registered outside the spec's own catalog. A misspelt or invented block type
 * is therefore perfectly valid metadata. `{ type: 'heading' }` parsed clean
 * through every spec release while resolving to nothing: `heading` has never
 * been registered in this repo (the nearest real things are `element:text`
 * with a heading `variant` such as `h2` (`heading` until 17.7.0 retired it), and the `ui/typography`
 * primitives, which never go through the registry at all). Both `heading`
 * nodes in the `page` sample fell through to the ComponentRegistry fallback,
 * so the gallery's page card — the worked example of a composed page — showed
 * two fallback boxes where its title and its section heading should have been.
 *
 * The samples are not fixtures. They are what an author (increasingly, a model
 * generating metadata) reads as "a page looks like this", so a block type that
 * resolves to nothing is a broken example that propagates. This test is the
 * missing half of that feedback loop: the spec guard pins the SHAPE, this one
 * pins that every type in the shape names something that can actually render.
 *
 * ## What resolvable means here
 *
 * `has(type) || hasLazy(type)` — a loaded registration or a pending
 * `registerLazy` stub. Both are legitimate: a lazily registered tag is a full
 * member of the contract and only differs by when its chunk is imported
 * (objectui#2953). `getConfig` would be the wrong probe for the same reason —
 * it is deliberately loaded-only.
 *
 * Registrations are read from the two module graphs the console actually boots
 * from (`@object-ui/components` + `../register-plugins`), the same posture as
 * `public-contract.test.ts` and `public-block-binding-reach.test.tsx`: a
 * hand-copied list of known types would agree with itself and prove nothing.
 *
 * ## Scope, stated so a pass is not over-read
 *
 * Resolvable is not the same as CORRECT. This asserts that a type names a real
 * renderer, not that the renderer reads the props the sample hands it — a
 * node can resolve and still render blank if its config sits under the wrong
 * key. That is a separate question, and the spec guard is what covers it from
 * the other side (the canonical bag is `properties`; `props` is rejected by
 * name under ADR-0089 D3a).
 *
 * Dashboard `widgets[]` are deliberately NOT walked. Those types are component
 * types too, but half of them (`metric`, `pivot`, …) are
 * registered only by `preview-gallery.tsx`'s own `registerLazy` block, and
 * that module mounts React at import time so a test cannot import it. Walking
 * them against this bootstrap would report unresolved types that resolve
 * perfectly well in the gallery, and re-declaring the gallery's list here
 * would be exactly the self-agreeing copy described above. The walk covers
 * page-component trees, which is where the objectui#3446 defect lived; the
 * dashboard sample is separately ledgered as KNOWN_STALE in the spec guard.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
// The two graphs whose registrations this reads — the layout/content
// primitives and the console's own plugin layer, from the module main.tsx
// boots from.
import '@object-ui/components';
import '../register-plugins';
import { SAMPLES } from '../preview-samples';

/** One component node found by the walk, with the path that located it. */
interface FoundNode {
  /** e.g. `page.regions[0].components[1]` */
  path: string;
  type: string;
}

/**
 * Child keys a component node may carry its subtree under. Mirrors the
 * candidate list the runtime containers themselves walk
 * (`packages/components/src/renderers/layout/containers.tsx` —
 * `children` / `properties.children` / `properties.items` / `body` / `items`),
 * plus `components`, the key the page spec uses inside a region. Kept in sync
 * with the runtime deliberately: a subtree the renderer descends into but this
 * walk does not is precisely where an unresolvable type would hide.
 */
const CHILD_KEYS = ['components', 'children', 'body', 'items'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Push every component node under `value`, depth-first, into `out`. */
function walkNodes(value: unknown, path: string, out: FoundNode[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkNodes(item, `${path}[${i}]`, out));
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.type === 'string') out.push({ path, type: value.type });

  const properties = isRecord(value.properties) ? value.properties : undefined;
  for (const key of CHILD_KEYS) {
    if (value[key] !== undefined) walkNodes(value[key], `${path}.${key}`, out);
    if (properties?.[key] !== undefined) {
      walkNodes(properties[key], `${path}.properties.${key}`, out);
    }
  }
}

/**
 * Every page-component node across every sample, found via `regions[]`. Generic
 * over samples rather than reaching for `SAMPLES.page`, so a sample that grows
 * regions tomorrow is covered without anyone remembering to add it here.
 */
function collectPageComponents(samples: Record<string, unknown>): FoundNode[] {
  const out: FoundNode[] = [];
  for (const [sampleType, sample] of Object.entries(samples)) {
    if (!isRecord(sample) || !Array.isArray(sample.regions)) continue;
    sample.regions.forEach((region: unknown, i: number) => {
      if (!isRecord(region)) return;
      walkNodes(region.components, `${sampleType}.regions[${i}].components`, out);
    });
  }
  return out;
}

const resolvable = (type: string): boolean =>
  ComponentRegistry.has(type) || ComponentRegistry.hasLazy(type);

describe('preview-samples page blocks resolve in the ComponentRegistry', () => {
  const found = collectPageComponents(SAMPLES);

  it('every page-component type names a registered renderer', () => {
    const unresolved = found
      .filter((node) => !resolvable(node.type))
      .map((node) => `${node.path}: "${node.type}"`);
    expect(unresolved).toEqual([]);
  });

  /**
   * Anti-vacuity guard #1 — coverage. An empty walk would pass the assertion
   * above without checking anything, which is the failure mode this whole file
   * exists to end. Asserting the sample keys the walk reached (rather than a
   * count) also makes a sample that silently loses its regions visible.
   */
  it('the walk actually reaches the samples that compose regions', () => {
    const reached = [...new Set(found.map((n) => n.path.split('.')[0]))].sort();
    expect(reached).toContain('page');
    expect(found.length).toBeGreaterThan(0);
  });

  /**
   * Anti-vacuity guard #2 — teeth. The assertion is only worth its green if the
   * walk descends into nested subtrees; a walk that stopped at the first level
   * would report `[]` for a page whose unresolvable block sits inside a card.
   * Probed with a synthetic draft rather than by mutating SAMPLES, so this
   * stays true regardless of what the real samples happen to contain.
   */
  it('reports an unresolvable type nested inside a container block', () => {
    const synthetic = {
      probe: {
        regions: [
          {
            name: 'main',
            components: [
              {
                type: 'page:card',
                properties: {
                  children: [{ type: 'no_such_block_type_3446' }],
                },
              },
            ],
          },
        ],
      },
    };
    const unresolved = collectPageComponents(synthetic)
      .filter((node) => !resolvable(node.type))
      .map((node) => `${node.path}: "${node.type}"`);
    expect(unresolved).toEqual([
      'probe.regions[0].components[0].properties.children[0]: "no_such_block_type_3446"',
    ]);
  });
});
