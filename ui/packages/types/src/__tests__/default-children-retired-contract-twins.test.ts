/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the register-meta key `defaultChildren` (objectui#5051,
 * ADR-0049 enforce-or-remove; maintainer ruling of 2026-08-19 adopted option B,
 * "retire the key everywhere").
 *
 * The key was declared in four places, produced in eleven, and read in NONE.
 * The designer drag-and-drop path builds a dropped node from its twin key only
 * (`PageDesigner.tsx`, `props: paletteItem?.defaultProps ?? {}`), with no
 * `children:` line — so a palette item that declared `defaultChildren` dropped
 * an empty node and the declaration never materialised. This package holds two
 * of the four declaration twins plus the runtime one:
 *
 *  1. `ComponentMetaSchema` (`zod/base.zod.ts`) — the runtime validator.
 *  2. `ComponentMeta` (`base.ts`) — the published `.d.ts` autocomplete surface,
 *     i.e. what a plugin author (or an AI author) copies from.
 *  3. `ComponentMeta` (`plugin-scope.ts`) — its plugin-facing twin, which spelt
 *     the same key `any[]`.
 *
 * The Registry twin (`@object-ui/core`) is pinned in that package instead, so
 * this suite does not have to import its own dependent.
 *
 * ⚠️ UPDATED by objectui#5893: item 3 is no longer a separate declaration.
 * `plugin-scope.ts` now RE-EXPORTS `base.ts`' `ComponentMeta` (the objectui#4580
 * convergence, following objectui#5671's execution for `ComponentInput`), so
 * the third case below no longer exercises a second declaration — it exercises
 * a second published SPELLING of the first, which is a real consumer-facing
 * fact only for as long as the deprecated `PluginComponentMeta` alias exists.
 * It is deliberately kept rather than deleted: while the alias is published, an
 * author can still reach the type by that name, and the pin costs one
 * `@ts-expect-error`. Drop it together with the alias in objectui#5674's
 * stage 2. Whether the declaration stays single is pinned separately and by
 * identity, in `component-meta-single-declaration.test.ts` — a member-set
 * assertion cannot see a structural copy, which is the defect this file was
 * paying for.
 *
 * Two kinds of assertion, deliberately different because the surfaces differ:
 *
 * The Zod half is NOT a refusal. Measured on zod 4.4.3, a `z.object` STRIPS
 * unknown keys rather than rejecting them, and `ComponentMetaSchema` is a plain
 * `z.object` with no `.strict()`. So the honest pin is that the key is silently
 * DROPPED from the parse output — which is precisely the behaviour the ruling's
 * confidence-gap note called out for external authors who already declare it.
 * Asserting a rejection here would pin a verdict this validator never emits.
 *
 * That "absent from the output" assertion is worthless on its own — a schema
 * that stripped EVERYTHING would satisfy it — so each case carries its own
 * positive control: a surviving sibling key asserted PRESENT in the same parse
 * output, through the same call.
 *
 * The two TS halves erase at runtime, so they are pinned with
 * `@ts-expect-error`, which is real enforcement only because
 * `packages/types/tsconfig.test.json` is chained from this package's
 * `type-check` script (#3009).
 */

import { describe, it, expect } from 'vitest';
import { ComponentMetaSchema } from '../zod/base.zod.js';
import type { ComponentMeta } from '../base.js';
import type { ComponentMeta as PluginScopeComponentMeta } from '../plugin-scope.js';

/** The retired key, and the twin the designer actually reads. */
const RETIRED = 'defaultChildren';
const SURVIVOR = 'defaultProps';

describe('ComponentMetaSchema — the runtime twin no longer carries the retired key', () => {
  it('drops an authored `defaultChildren` from the parse output, while carrying its surviving twin through the same parse', () => {
    const result = ComponentMetaSchema.safeParse({
      label: 'Inline Container',
      defaultProps: { className: 'px-1.5' },
      defaultChildren: [{ type: 'text', content: 'Inline text' }],
    });

    // Not a refusal: the schema strips, so an author who still declares the key
    // keeps a VALID meta. The retirement is that the key stops travelling.
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).not.toHaveProperty(RETIRED);

    // Positive control, same parse, same call: the schema is still capable of
    // carrying a key through. Without this, a schema that dropped every key
    // would pass the assertion above.
    expect(result.data).toHaveProperty(SURVIVOR);
    expect(result.data.defaultProps).toEqual({ className: 'px-1.5' });
  });

  it('shrank by exactly one member — the sibling meta vocabulary still round-trips', () => {
    // Guards the removal from over-reaching: a hand-edited schema that dropped
    // a neighbour would otherwise pass every assertion above.
    const result = ComponentMetaSchema.safeParse({
      label: 'Sidebar',
      icon: 'panel-left',
      category: 'Navigation',
      defaultProps: { collapsible: 'icon' },
      examples: { basic: {} },
      isContainer: true,
      resizable: true,
      tags: ['navigation'],
      description: 'A sidebar',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const key of [
      'label',
      'icon',
      'category',
      'defaultProps',
      'examples',
      'isContainer',
      'resizable',
      'tags',
      'description',
    ]) {
      expect(result.data).toHaveProperty(key);
    }
  });
});

describe('the published TS twins no longer offer the retired key', () => {
  it('`ComponentMeta` (base.ts) rejects it at compile time', () => {
    const legal: ComponentMeta = { label: 'Span', defaultProps: { className: 'px-1' } };
    expect(legal.defaultProps).toEqual({ className: 'px-1' });

    const retired: ComponentMeta = {
      label: 'Span',
      // @ts-expect-error `defaultChildren` was retired by objectui#5051 — it had
      // no consumer, so the declared default children never materialised on drop.
      defaultChildren: [{ type: 'text', content: 'Inline text' }],
    };
    // Referenced so the binding is not merely unused — the `@ts-expect-error`
    // above is the actual assertion, enforced by `tsconfig.test.json`.
    expect(retired.label).toBe('Span');
  });

  it('`ComponentMeta` (plugin-scope.ts) rejects it at compile time', () => {
    const legal: PluginScopeComponentMeta = { label: 'Span', defaultProps: { className: 'px-1' } };
    expect(legal.defaultProps).toEqual({ className: 'px-1' });

    const retired: PluginScopeComponentMeta = {
      label: 'Span',
      // @ts-expect-error `defaultChildren` was retired by objectui#5051; the
      // plugin-facing twin spelt it `any[]` and was retired in lockstep. Since
      // objectui#5893 this spelling re-exports `base.ts`' declaration, so the
      // error above is the SAME one the case above pins, reached by the second
      // published name.
      defaultChildren: [{ type: 'text', content: 'Inline text' }],
    };
    expect(retired.label).toBe('Span');
  });
});
