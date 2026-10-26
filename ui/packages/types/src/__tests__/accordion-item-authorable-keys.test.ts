/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AccordionItem` declares only keys a renderer actually reads (objectui#4652).
 *
 * The same defect as objectui#4632 (PR #4651), one interface up in the same
 * file. The interface declared `disabled?: boolean` and `icon?: string` while
 * `packages/components/src/renderers/disclosure/accordion.tsx` read NEITHER —
 * it mapped items to `value`/`title`/`content` only. An author who declared
 * either key got a correctly rendered accordion with the key silently
 * dropped, and nothing went red.
 *
 * Corpus sweep (schema catalog, docs, example apps, this repo's `objectstack`
 * sibling checkout) found **zero** sites authoring either key on an
 * `AccordionItem`. The two keys are still settled in opposite directions,
 * because the deciding signal is measured pull, not catalog authorship count
 * alone:
 *
 *   `icon` — RETIRED. Zero pull and no established convention to lean on
 *   (unlike `disabled` below), so under the platform's declared=enforced
 *   doctrine it is removed rather than speculatively implemented.
 *
 *   `disabled` — WIRED, despite zero catalog pull. Item-level `disabled` is
 *   an established live convention in this codebase — `tabs`, `select`,
 *   `dropdown-menu`, `menubar`, `context-menu` and (as of #4632) `toggle-group`
 *   all forward it. `accordion` was the next outlier, and Radix's
 *   `Accordion.Item` supports `disabled` natively (it forwards a real `disabled`
 *   attribute onto the trigger `<button>`, per `@radix-ui/react-collapsible`'s
 *   `CollapsibleTrigger`), so honoring it needed no new mechanism and no edit
 *   to the synced `ui/accordion.tsx` primitive (AGENTS.md #7).
 *
 * This file pins BOTH directions on the declaration surfaces — the TypeScript
 * interface and the Zod mirror, two separate hand-maintained declarations of
 * one contract. The behavior half — that a disabled item actually renders
 * disabled and cannot be expanded — is pinned in
 * `packages/components/src/__tests__/accordion-item-disabled.test.tsx`.
 *
 * The `@ts-expect-error` below is REAL enforcement here, not decoration: this
 * package type-checks its tests through `tsconfig.test.json` (`type-check` =
 * `tsc --noEmit && tsc -p tsconfig.examples.json && tsc -p tsconfig.test.json`),
 * so re-adding `icon?` to the interface fails the build on the unused directive.
 */

import { describe, it, expect } from 'vitest';
import type { AccordionItem } from '../disclosure';
import { AccordionItemSchema } from '../zod/disclosure.zod';

describe('AccordionItem: `icon` is retired from the authoring surface (objectui#4652)', () => {
  it('does not declare `icon` on the TypeScript interface', () => {
    const item: AccordionItem = {
      value: 'section-1',
      title: 'Section 1',
      content: 'Content for section 1',
      // @ts-expect-error `icon` is retired — zero measured pull and no
      // renderer ever read it, and excess-property checking on this literal
      // is what makes the retirement reach authors writing TypeScript.
      icon: 'chevron',
    };

    // Runtime shape is unaffected by the type-level assertion above; the
    // assertion that matters is that the file compiles only while `icon` is
    // absent from the interface.
    expect(item.value).toBe('section-1');
  });

  it('drops `icon` when parsing through the Zod mirror', () => {
    // `z.object` is non-strict, so an authored `icon` is not an error — it is
    // simply not part of the declared surface any more, and parse output is
    // the observable statement of what that surface contains.
    const parsed = AccordionItemSchema.parse({
      value: 'section-1',
      title: 'Section 1',
      content: 'Content for section 1',
      icon: 'chevron',
    });

    expect(parsed).toEqual({
      value: 'section-1',
      title: 'Section 1',
      content: 'Content for section 1',
    });
    expect('icon' in parsed).toBe(false);
  });

  it('keeps `icon` out of the Zod schema shape', () => {
    expect(Object.keys(AccordionItemSchema.shape).sort()).toEqual([
      'content',
      'disabled',
      'title',
      'value',
    ]);
  });
});

describe('AccordionItem: `disabled` stays declared, now that it is honored (objectui#4652)', () => {
  it('declares `disabled` on the TypeScript interface as an optional boolean', () => {
    const item: AccordionItem = {
      value: 'section-1',
      title: 'Section 1',
      content: 'Content for section 1',
      disabled: true,
    };
    expect(item.disabled).toBe(true);

    const withoutDisabled: AccordionItem = {
      value: 'section-2',
      title: 'Section 2',
      content: 'Content for section 2',
    };
    expect(withoutDisabled.disabled).toBeUndefined();
  });

  it('preserves `disabled` through the Zod mirror', () => {
    expect(
      AccordionItemSchema.parse({
        value: 'section-1',
        title: 'Section 1',
        content: 'Content for section 1',
        disabled: true,
      }),
    ).toEqual({
      value: 'section-1',
      title: 'Section 1',
      content: 'Content for section 1',
      disabled: true,
    });
  });

  it('rejects a non-boolean `disabled`', () => {
    expect(
      AccordionItemSchema.safeParse({
        value: 'section-1',
        title: 'Section 1',
        content: 'Content for section 1',
        disabled: 'yes',
      }).success,
    ).toBe(false);
  });
});
