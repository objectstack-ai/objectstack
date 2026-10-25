/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { BreadcrumbSchema, BreadcrumbItem as BreadcrumbItemType } from '@object-ui/types';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis } from '../../ui/breadcrumb';
import { resolveKeyedI18nLabel } from '@object-ui/react';
// `BreadcrumbItem.icon` is an authored lucide NAME that this renderer never
// read — the catalog fixture literally named `with-icons.json` drew no icons
// at all (objectui#5931).
//
// Routed through the RECORD surface (`icons` from 'lucide-react', reached via
// the shared `resolveIcon`), which is what `ui:button`, `action:*`,
// `ui:dropdown-menu` and `ui:context-menu` resolve against, so an unknown or
// RETIRED spelling renders NOTHING. The dynamic surface (`LazyIcon`) is
// deliberately NOT used: it degrades an unknown name to the `Database` glyph,
// trading a no-icon failure for a WRONG-icon one, recorded as ruled out for
// authored icon fields by objectui#5622 and #5633.
import { resolveIcon } from '../action/resolve-icon';

/**
 * `BreadcrumbSchema` declares FOUR authorable keys and this renderer used to
 * read one of them. `icon` was repaired by objectui#5931; `separator` and
 * `maxItems` are objectui#6646, and the two below are what honour them.
 *
 * ⚠️ The declaration this file consumes is `packages/types/src/navigation.ts`'s
 * `BreadcrumbSchema` — the one `packages/types/src/index.ts` re-exports, and
 * the ONLY one carrying `maxItems`. A SECOND exported interface of the same
 * name lives in `packages/types/src/data-display.ts` (reached only through the
 * `DataDisplaySchema` union) and declares neither `maxItems` nor `icon`.
 * TypeScript warns about neither, so "I changed `BreadcrumbSchema`" is not a
 * statement that identifies a file. Both are recorded in
 * `scripts/__tests__/one-authority-per-exported-name-6273.test.ts`'s
 * `KNOWN_COLLISIONS`.
 */

/** The declared `@default '/'` of `BreadcrumbSchema.separator`. */
const DEFAULT_SEPARATOR = '/';

/** One rendered position in the trail: a crumb, or the elision standing in for several. */
type Slot = { kind: 'item'; item: BreadcrumbItemType } | { kind: 'ellipsis' };

/**
 * Apply `maxItems` — "Maximum items to display before collapsing".
 *
 * The number bounds the count of RENDERED crumbs, so the result is exactly
 * `maxItems` of them (plus the elision marker, which is not a crumb). The FIRST
 * crumb and the LAST `maxItems - 1` survive: a breadcrumb's subject is the
 * current location, so the final crumb is the one thing a collapse must never
 * drop. At `maxItems: 1` there is no room for both ends and the current page is
 * what stays.
 *
 * A `maxItems` that cannot mean a count — absent, non-finite, below 1 — is
 * DECLINED rather than coerced: the alternative is rendering an empty or
 * arbitrarily truncated trail from a value the author most likely mistyped, and
 * silently inventing a trail is worse than ignoring the key.
 */
function collapseTrail(items: BreadcrumbItemType[], maxItems: unknown): Slot[] {
  const all: Slot[] = items.map((item) => ({ kind: 'item', item }));
  if (typeof maxItems !== 'number' || !Number.isFinite(maxItems)) return all;
  const max = Math.floor(maxItems);
  if (max < 1 || items.length <= max) return all;
  const head = Math.min(1, max - 1);
  const tail = max - head;
  return [
    ...items.slice(0, head).map((item): Slot => ({ kind: 'item', item })),
    { kind: 'ellipsis' },
    ...items.slice(items.length - tail).map((item): Slot => ({ kind: 'item', item })),
  ];
}

ComponentRegistry.register('breadcrumb', 
  ({ schema, ...props }: { schema: BreadcrumbSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...breadcrumbProps
    } = props;

    // `??`, not `||`: `''` is a legal `string` and an author who writes it means
    // "no visible separator". A `||` here would silently promote that to `'/'`,
    // which is the same declared-key-does-something-else defect one value over.
    const separator = schema.separator ?? DEFAULT_SEPARATOR;
    const slots = collapseTrail(schema.items ?? [], schema.maxItems);

    return (
      <Breadcrumb 
        className={schema.className} 
        {...breadcrumbProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        <BreadcrumbList>
          {slots.map((slot, idx) => {
            const isLast = idx === slots.length - 1;
            // The separator is authored ONCE and rendered at every position, so
            // a collapsed trail is separated exactly like an uncollapsed one.
            const trailing = !isLast && <BreadcrumbSeparator>{separator}</BreadcrumbSeparator>;

            if (slot.kind === 'ellipsis') {
              return (
                <div key={idx} className="flex items-center">
                  <BreadcrumbItem>
                    <BreadcrumbEllipsis />
                  </BreadcrumbItem>
                  {trailing}
                </div>
              );
            }

            const item = slot.item;
            // Resolved ONCE per item and rendered ABOVE the page/link split, so
            // BOTH arms carry it by construction. Repairing only the leaf arm
            // would be "a narrower version of the same bug" (objectui#5930) —
            // here the last crumb is a `BreadcrumbPage` and every earlier one a
            // `BreadcrumbLink`, and the fixture exercises both.
            const Icon = resolveIcon(item.icon);
            return (
              <div key={idx} className="flex items-center">
                <BreadcrumbItem>
                  {Icon && <Icon className="h-4 w-4" />}
                  {isLast ? (
                    <BreadcrumbPage>{resolveKeyedI18nLabel(item.label) ?? ''}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink href={item.href}>{resolveKeyedI18nLabel(item.label) ?? ''}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {trailing}
              </div>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    );
  },
  {
    namespace: 'ui',
    label: 'Breadcrumb',
    inputs: [
      { name: 'className', type: 'string' },
      { name: 'separator', type: 'string' },
      { name: 'maxItems', type: 'number' }
    ],
    defaultProps: {
      items: [
        { label: 'Home', href: '/' },
        { label: 'Products', href: '/products' },
        { label: 'Product' }
      ]
    }
  }
);
