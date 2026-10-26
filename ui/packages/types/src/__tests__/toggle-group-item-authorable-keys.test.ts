/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ToggleGroupItem` declares only keys a renderer actually reads (objectui#4632).
 *
 * The interface used to declare `icon?: string` and `disabled?: boolean` while
 * `packages/components/src/renderers/disclosure/toggle-group.tsx` read NEITHER —
 * an author who declared either got a correctly rendered toggle group with the
 * key silently dropped. Nothing went red, which is what made it durable: the
 * schema catalog (the corpus AI authoring tools retrieve from) was teaching
 * `icon` on all three items of `components-disclosure-toggle-group/with-labels`.
 *
 * The two keys were settled in opposite directions, by measurement:
 *
 *   `icon` — RETIRED. Zero measured pull: across this repo the only site
 *   authoring it was that single catalog entry, no application code and no
 *   example app declared it, and no renderer resolved it. Under the platform's
 *   declared=enforced doctrine a slot nobody pulls on is removed rather than
 *   speculatively implemented.
 *
 *   `disabled` — WIRED. Item-level `disabled` is an established live convention
 *   in this codebase: `tabs`, `select`, `dropdown-menu`, `menubar` and
 *   `context-menu` all forward it. `toggle-group` was the lone outlier, and the
 *   underlying Radix item supports it natively, so honoring it needed no new
 *   mechanism (and no edit to the synced `ui/` primitive).
 *
 * This file pins BOTH directions on the declaration surfaces — the TypeScript
 * interface and the Zod mirror, which are two separate hand-maintained
 * declarations of one contract (`zod/disclosure.zod.ts` was not named in the
 * finding; it declared `icon` too). The behavior half — that a disabled item
 * actually renders disabled — is pinned in
 * `packages/components/src/__tests__/toggle-group-item-disabled.test.tsx`.
 *
 * The `@ts-expect-error` below is REAL enforcement here, not decoration: this
 * package type-checks its tests through `tsconfig.test.json` (`type-check` =
 * `tsc --noEmit && tsc -p tsconfig.examples.json && tsc -p tsconfig.test.json`),
 * so re-adding `icon?` to the interface fails the build on the unused directive.
 */

import { describe, it, expect } from 'vitest';
import type { ToggleGroupItem } from '../disclosure';
import { ToggleGroupItemSchema } from '../zod/disclosure.zod';

describe('ToggleGroupItem: `icon` is retired from the authoring surface (objectui#4632)', () => {
  it('does not declare `icon` on the TypeScript interface', () => {
    const item: ToggleGroupItem = {
      value: 'list',
      label: 'List',
      // @ts-expect-error `icon` is retired — no renderer ever read it, and
      // excess-property checking on this literal is what makes the retirement
      // reach authors writing TypeScript.
      icon: 'list',
    };

    // Runtime shape is unaffected by the type-level assertion above; the
    // assertion that matters is that the file compiles only while `icon` is
    // absent from the interface.
    expect(item.value).toBe('list');
  });

  it('drops `icon` when parsing through the Zod mirror', () => {
    // `z.object` is non-strict, so an authored `icon` is not an error — it is
    // simply not part of the declared surface any more, and parse output is the
    // observable statement of what that surface contains.
    const parsed = ToggleGroupItemSchema.parse({
      value: 'list',
      label: 'List',
      icon: 'list',
    });

    expect(parsed).toEqual({ value: 'list', label: 'List' });
    expect('icon' in parsed).toBe(false);
  });

  it('keeps `icon` out of the Zod schema shape', () => {
    expect(Object.keys(ToggleGroupItemSchema.shape).sort()).toEqual([
      'disabled',
      'label',
      'value',
    ]);
  });
});

describe('ToggleGroupItem: `disabled` stays declared, now that it is honored (objectui#4632)', () => {
  it('declares `disabled` on the TypeScript interface as an optional boolean', () => {
    const item: ToggleGroupItem = { value: 'table', label: 'Table', disabled: true };
    expect(item.disabled).toBe(true);

    const withoutDisabled: ToggleGroupItem = { value: 'grid', label: 'Grid' };
    expect(withoutDisabled.disabled).toBeUndefined();
  });

  it('preserves `disabled` through the Zod mirror', () => {
    expect(
      ToggleGroupItemSchema.parse({ value: 'table', label: 'Table', disabled: true }),
    ).toEqual({ value: 'table', label: 'Table', disabled: true });
  });

  it('rejects a non-boolean `disabled`', () => {
    expect(
      ToggleGroupItemSchema.safeParse({ value: 'table', label: 'Table', disabled: 'yes' })
        .success,
    ).toBe(false);
  });
});
