/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the fourth declaration twin of the register-meta key
 * `defaultChildren` (objectui#5051, ADR-0049 enforce-or-remove; maintainer
 * ruling of 2026-08-19 adopted option B, "retire the key everywhere").
 *
 * `RegistryComponentMeta` here is the registration surface every `ComponentRegistry.register`
 * call is checked against (it was published as `ComponentMeta` until
 * objectui#6349 gave it its own name), so it is the twin a producer would re-grow the key
 * through: the eleven producers retired alongside it (`sidebar.tsx` x10,
 * `span.tsx`) were all written against THIS type. Its three siblings — the two
 * `ComponentMeta` interfaces and the `ComponentMetaSchema` validator in
 * `@object-ui/types` — are pinned in that package.
 *
 * This is a COMPILE-TIME pin only, and deliberately claims nothing at runtime.
 * The registry does not validate meta: it stores what a caller hands it, so a
 * caller casting through `any` could still park the key on a config object at
 * runtime and no assertion here could see it. `@ts-expect-error` is real
 * enforcement because `packages/core/tsconfig.test.json` is chained from this
 * package's `type-check` script (objectui#3009), which is what CI's Type Check
 * job runs.
 */

import { describe, it, expect } from 'vitest';
import type { RegistryComponentMeta } from '../Registry';

describe('RegistryComponentMeta (core registry) — the retired key is gone from the registration surface', () => {
  it('rejects `defaultChildren` at compile time', () => {
    const retired: RegistryComponentMeta = {
      label: 'Inline Container',
      // @ts-expect-error `defaultChildren` was retired by objectui#5051 — the
      // designer's drop path reads `defaultProps` only, so the declared default
      // children never materialised. Re-declaring it here re-opens the
      // declared-but-unenforced gap ADR-0049 targets.
      defaultChildren: [{ type: 'text', content: 'Inline text' }],
    };
    // Referenced so the binding is not merely unused — the `@ts-expect-error`
    // above is the actual assertion.
    expect(retired.label).toBe('Inline Container');
  });

  it('still offers the twin the designer actually reads', () => {
    // Positive control: the surface is not simply refusing everything. This is
    // the key `PageDesigner` consumes on drop, and it is untouched by #5051.
    const legal: RegistryComponentMeta = {
      label: 'Inline Container',
      defaultProps: { className: 'px-1.5 py-0.5' },
      isContainer: true,
    };
    expect(legal.defaultProps).toEqual({ className: 'px-1.5 py-0.5' });
    expect(legal.isContainer).toBe(true);
  });
});
