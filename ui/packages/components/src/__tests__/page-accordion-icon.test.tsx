/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:accordion` honors item-level `icon` (objectui#4721).
 *
 * The local `PageAccordionItem` interface (`renderers/layout/containers.tsx`)
 * has always declared `icon?: string`, but `PageAccordionRenderer` read only
 * `label`/`collapsed`/`children` — an authored icon reached the trigger and
 * was silently dropped. Same defect *shape* as objectui#4632/#4652
 * (`AccordionItem.icon`/`.disabled`), a different component: `page:accordion`
 * (namespace `page`, a layout container) vs. `ui:accordion` (namespace `ui`,
 * the disclosure primitive `AccordionItemSchema` declares).
 *
 * That sibling case retired `icon` after measuring zero pull anywhere,
 * including the `objectstack` corpus. This one measured the same zero pull
 * in objectui's own catalog/docs/apps — but the `objectstack` sibling
 * checkout tells a different story: `packages/spec/src/ui/component.zod.ts`
 * declares `PageAccordionProps.items[].icon` as `z.string().optional()`,
 * added 2026-08-13 (`6b441a8`), the SAME schema block that goes out of its
 * way to explain why the neighboring `value` key is deliberately NOT
 * declared (an extensive comment citing containers.tsx:793 and objectui#7973)
 * — `icon` carries no such warning. The spec, the more authoritative side of
 * this contract (AGENTS.md #0/#0.1), already treats `icon` as legitimate,
 * undeprecated authorable surface; the renderer was the side out of sync.
 * Per #0.1 ("is this spec-compliant? if so, fix it at the renderer"), the fix
 * is to wire the read, not delete the declaration — deleting it would only
 * widen the objectui/spec gap this defect already is.
 *
 * Follows the `page:tabs` sibling trigger's established icon convention
 * (same file, `mr-1.5 h-3.5 w-3.5 shrink-0 opacity-70` + `aria-hidden`):
 * icon optional, rendered before the label, absent when not declared.
 *
 * `../lib/lazy-icon` is mocked to a plain `<svg>` carrying the resolved name
 * as a data attribute — the same technique `record-alert.test.tsx` uses —
 * so the assertion is about "the renderer forwarded this icon name to
 * LazyIcon", not about `lucide-react/dynamic.mjs`'s own chunk-loading path,
 * which is neither this renderer's contract nor worth the async flakiness
 * budget (AGENTS.md 测试纪律).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import type { PublicBlockNodeOf } from '@object-ui/types';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

vi.mock('../lib/lazy-icon', () => ({
  LazyIcon: ({ name, className }: { name?: string; className?: string }) => (
    <svg data-testid="page-accordion-icon" data-name={name} className={className} />
  ),
}));

const textChild = (content: string) => [{ type: 'element:text', properties: { content } }];

const accordionSchema = (items: any[]): PublicBlockNodeOf<'page:accordion'> => ({ type: 'page:accordion', id: 'acc', properties: { items } });

function renderAccordion(items: any[]) {
  return render(<SchemaRenderer schema={accordionSchema(items)} />);
}

afterEach(() => cleanup());

describe('page:accordion item icon (objectui#4721)', () => {
  it('renders the declared Lucide icon name for the panel that authors it', () => {
    const { getAllByTestId } = renderAccordion([
      { label: 'Details', icon: 'user', children: textChild('DETAILS BODY') },
      { label: 'Notes', children: textChild('NOTES BODY') },
    ]);

    const icons = getAllByTestId('page-accordion-icon');
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute('data-name')).toBe('user');
  });

  it('renders no icon element for a panel that does not declare one (positive control)', () => {
    const { getAllByTestId } = renderAccordion([
      { label: 'Alpha', icon: 'settings', children: textChild('ALPHA BODY') },
      { label: 'Beta', children: textChild('BETA BODY') },
      { label: 'Gamma', icon: 'star', children: textChild('GAMMA BODY') },
    ]);

    // Exactly the two panels that declared an icon get one — proves the icon
    // is forwarded per-item, not accordion-wide.
    const icons = getAllByTestId('page-accordion-icon');
    expect(icons.map((el) => el.getAttribute('data-name'))).toEqual(['settings', 'star']);
  });

  it('still renders every panel label alongside its icon', () => {
    const { getByText } = renderAccordion([
      { label: 'Details', icon: 'user', children: textChild('DETAILS BODY') },
      { label: 'Notes', children: textChild('NOTES BODY') },
    ]);

    expect(getByText('Details')).toBeInTheDocument();
    expect(getByText('Notes')).toBeInTheDocument();
  });

  it('renders no icon element at all when no panel declares one', () => {
    const { queryByTestId } = renderAccordion([
      { label: 'Details', children: textChild('DETAILS BODY') },
      { label: 'Notes', children: textChild('NOTES BODY') },
    ]);

    expect(queryByTestId('page-accordion-icon')).toBeNull();
  });
});
