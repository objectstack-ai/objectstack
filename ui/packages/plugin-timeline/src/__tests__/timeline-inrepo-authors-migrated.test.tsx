/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The in-repo authors of the gantt axis are migrated off the retired
 * `timeScale` alias (objectui#6355).
 *
 * The ruling retires the alias in one PR, migration included, so this repo must
 * not keep authoring the spelling it just made unauthorable. Three writers
 * existed on `origin/main`:
 *
 *   1. the schema-catalog fixture `gantt-style-timeline.json` — pinned in
 *      `@object-ui/types`'
 *      `__tests__/timeline-catalog-fixture-migrated.test.ts`, which is where
 *      node types and the Zod validator are both available (this package's test
 *      tsconfig carries no node types);
 *   2. the registration's own `examples.gantt` block (`../renderer`);
 *   3. `ObjectTimeline`, which COMPOSES a schema for `TimelineRenderer` and
 *      wrote the resolved axis under the alias. That one is invisible to a
 *      grep of authored metadata — no author ever sees that object — and it is
 *      the one that would have silently reverted every object-bound gantt to
 *      the `month` default the moment the fallback read went. It is pinned in
 *      `timeline-object-scale-composition.test.tsx`.
 *
 * The point of pinning 1 and 2 is not that the string changed. It is that these
 * documents still RESOLVE to the bucket they declare. A migration that renamed
 * the key but left the value unreachable would look identical in a diff and
 * would render a `month` axis for a document that says `month` — green for the
 * wrong reason. So each assertion below goes through `resolveTimelineScale`,
 * the real read path, and the fixture is additionally parsed by the published
 * validator that now REFUSES the old spelling.
 */
import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { TimelineSchema } from '@object-ui/types/zod';
import { resolveTimelineScale } from '../renderer';
// Importing the package entry performs the registration, exactly as a host does.
import '../index';

describe('in-repo gantt authors use the canonical `scale` (objectui#6355)', () => {
  it("the registration's own `examples.gantt` authors `scale`, and it resolves", () => {
    // Read back from the registry rather than restated here, so this cannot
    // drift from the declaration it is pinning.
    const meta = ComponentRegistry.getMeta('plugin-timeline:timeline');
    const gantt = (meta?.examples as Record<string, Record<string, unknown>> | undefined)?.gantt;

    expect(gantt, 'the registration no longer publishes a `gantt` example').toBeDefined();
    expect(gantt!.variant).toBe('gantt');
    expect(gantt!.timeScale, "the registration's gantt example still authors the RETIRED alias").toBeUndefined();
    expect(gantt!.scale).toBe('month');
    expect(resolveTimelineScale(gantt!)).toBe('month');

    const parsed = TimelineSchema.safeParse({ type: 'timeline', ...gantt });
    expect(parsed.success ? null : parsed.error.issues).toBe(null);
  });

  it('the designer no longer offers the retired alias as an input', () => {
    const meta = ComponentRegistry.getMeta('plugin-timeline:timeline');
    const inputs = (meta?.inputs ?? []) as Array<{ name?: string }>;
    const names = inputs.map((i) => i.name);

    expect(names, 'the deprecated `timeScale` control is still offered').not.toContain('timeScale');
    expect(names, 'the canonical `scale` control must remain').toContain('scale');
  });
});
