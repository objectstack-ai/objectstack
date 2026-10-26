/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry, toDomProps } from '@object-ui/core';
import type { HeaderBarSchema, BreadcrumbItem as BreadcrumbItemType } from '@object-ui/types';
import { resolveKeyedI18nLabel, SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import {
  SidebarTrigger,
  Separator,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Input,
} from '../../ui';
import { ChevronDown, Search } from 'lucide-react';
// `crumbs` is typed `BreadcrumbItem[]` — the SAME declaration `ui:breadcrumb`'s
// `items` uses — and `BreadcrumbItem.icon` is not merely declared but DESCRIBED
// in the zod mirror (`icon: z.string().optional().describe('Breadcrumb icon')`),
// so an authoring surface that reads `describe` can already offer the key. This
// renderer read `label`, `siblings` and `href` and nothing else, so after
// objectui#5931 repaired the breadcrumb side one declared key behaved
// DIFFERENTLY on its two consumers — a glyph there, nothing here (objectui#6645).
//
// ⛔ Through the SHARED `resolveIcon`, never a local normaliser. objectui#5993
// is the lesson: a local copy is the same algorithm under a different function,
// and the alias later added there to absorb a lucide retirement reached every
// `action:*` site EXCEPT `ui:button`. Routing here means the RECORD surface —
// an unknown or RETIRED spelling renders NOTHING, never `LazyIcon`'s `Database`
// fallback (ruled out for authored icon fields by objectui#5622 / #5633).
import { resolveIcon } from '../action/resolve-icon';
import { cn } from '../../lib/utils';

// The header's own chrome classes. The authored `BaseSchema.className` is merged
// AFTER them through `cn()` (tailwind-merge), so a utility the author writes that
// conflicts with one of these replaces it — `h-20` drops `h-14` — and every other
// authored class is added (objectui#10397). Before that the root was this string
// alone, and an authored `className` rendered byte-identical to its absence.
//
// A conflict is per VARIANT: `h-20` replaces `h-14` and leaves `sm:h-16` in
// place, so an author who wants one height at every width writes `h-20 sm:h-20`.
//
// `schema.className` is the one channel read. `SchemaRenderer` hands a node's
// className to the component twice, on `schema` and as the `className` prop,
// with the same value (its `responsiveStyles` scope class included), so that a
// renderer honours ONE of them. tailwind-merge does not collapse a repeated
// non-Tailwind class, so reading both would print every custom class twice.
// The prop is therefore taken off the pass-through below by name and left
// unread: `className` is on `toDomProps`' whitelist, so it would otherwise
// ride the spread as a second copy of the same channel.
const HEADER_BAR_CLASS = 'flex h-14 sm:h-16 shrink-0 items-center gap-2 border-b px-3 sm:px-4';

/**
 * What `SchemaRenderer` hands the registered component: the node on `schema`,
 * and beside it the node's own keys, the resolved ARIA (`aria-label` from
 * `ariaLabel`), `data-obj-id` / `data-obj-type`, a conditional `data-testid`
 * (from `testId`), `style` and `id` as props.
 */
type HeaderBarRendererProps = {
  schema: HeaderBarSchema;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
};

function BreadcrumbLabel({ crumb, isLast }: { crumb: BreadcrumbItemType; isLast: boolean }) {
  const label = resolveKeyedI18nLabel(crumb.label) ?? '';

  if (crumb.siblings && crumb.siblings.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1">
          {isLast ? (
            <span className="font-semibold">{label}</span>
          ) : (
            <span>{label}</span>
          )}
          <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {crumb.siblings.map((sibling, i) => (
            <DropdownMenuItem key={i} asChild>
              <a href={sibling.href}>{sibling.label}</a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (isLast) {
    return <BreadcrumbPage>{label}</BreadcrumbPage>;
  }
  return <BreadcrumbLink href={crumb.href || '#'}>{label}</BreadcrumbLink>;
}

// The root's DOM channels take the converged route (objectui#10496): the
// props `SchemaRenderer` hands this renderer go through `toDomProps`, the SDUI
// whitelist in `@object-ui/core` (`id`, `role`, the open `aria-*` / `data-*`
// families, …), and `style` is forwarded BY NAME, as `grid.tsx`, `box.tsx` and
// the other converged renderers do (the objectui#4435 route). Until then this
// was a function of `schema` alone, so an authored `ariaLabel` never named the
// banner landmark and `style`, `id`, `testId` and `data-obj-*` never reached
// the element. The keys this renderer consumes off `schema` (`crumbs`,
// `search`, `actions`, `rightContent`) and any key an author invents stay off
// the DOM, because the whitelist drops them.
ComponentRegistry.register('header-bar',
  ({ schema, className: _classNameProp, style, ...hostProps }: HeaderBarRendererProps) => (
    <header
      {...toDomProps(hostProps)}
      className={cn(HEADER_BAR_CLASS, schema.className)}
      style={style}
    >
      <SidebarTrigger />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <Breadcrumb>
        <BreadcrumbList>
          {schema.crumbs?.map((crumb: BreadcrumbItemType, idx: number) => {
            // Resolved ONCE per crumb and rendered ABOVE `BreadcrumbLabel`, so
            // all THREE of its arms — the siblings dropdown, the last crumb's
            // `BreadcrumbPage` and every earlier `BreadcrumbLink` — carry the
            // glyph by construction. Repairing inside that helper would have had
            // to touch each arm, and missing one is "a narrower version of the
            // same bug" (objectui#5930). Resolved HERE rather than in a
            // `CrumbIcon` helper for the same reason `breadcrumb.tsx` resolves
            // inline: a component value produced during render and rendered from
            // a nested component is what `react-hooks/static-components`
            // refuses, and this is the shape the sibling renderer already uses.
            const Icon = resolveIcon(crumb.icon);
            return (
              <React.Fragment key={idx}>
                <BreadcrumbItem>
                  {Icon && <Icon className="h-4 w-4" />}
                  <BreadcrumbLabel crumb={crumb} isLast={idx === schema.crumbs!.length - 1} />
                </BreadcrumbItem>
                {idx < schema.crumbs!.length - 1 && <BreadcrumbSeparator />}
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        {schema.search?.enabled && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder={schema.search.placeholder}
              className="pl-8 w-[200px] lg:w-[300px]"
            />
            {schema.search.shortcut && (
              <kbd className="pointer-events-none absolute right-2 top-2 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                {schema.search.shortcut}
              </kbd>
            )}
          </div>
        )}
        {schema.actions?.map((action, idx) => (
          <SchemaRenderer key={idx} schema={toRenderableSchema(action)} />
        ))}
        {/* The numeric-falsy JSX trap. `HeaderBarSchema.rightContent` is
            declared `SchemaNode` on both published faces — the interface in
            `@object-ui/types` and its zod mirror, whose node union carries a
            `z.number()` arm — so `0` is an AUTHORABLE value here. The `&&`
            chain this replaced evaluated to the number `0` itself, and React
            renders numbers, so `{ type: 'header-bar', rightContent: 0 }`
            painted a stray "0" beside the header chrome. A ternary yields
            `null` instead. Byte-for-byte the shape objectui#8331 measured and
            settled one slot over on `DataTableSchema.emptyAction`; ⛔ not a
            second shape for the same trap.

            ⚠️ `false` and `''` were ALREADY correct — React ignores `false` as
            a child and `''` paints nothing — so neither can tell the two
            worlds apart. Only the falsy NUMBERS discriminate: `0`, `-0`, and
            `NaN`, which painted the three characters "NaN".

            The TRUTHINESS leg stays; ⛔ it is not swapped for a nullish one.
            Both land on the same rendering today — since objectui#8908
            `toRenderableSchema` maps a falsy primitive onto nothing rather
            than onto its `String` form — so the choice is about which rule
            this slot STATES, and truthiness is the rule that makes the slot's
            answer independent of the bridge. That independence is exactly what
            kept the sibling slot out of the defect while the bridge was wrong,
            and objectui#8331 kept the leg for that reason rather than letting
            it vanish as tidying.

            ⛔ Do not narrow the declaration to close this: objectui#7105 ruled
            node slots RELAX THE RENDERER. A `typeof === 'object'` test here
            would silently drop a bare string, which this slot renders as its
            own text.

            Pinned in `header-bar-right-content-numeric-falsy.test.tsx`. */}
        {schema.rightContent ? (
          <SchemaRenderer schema={toRenderableSchema(schema.rightContent)} />
        ) : null}
      </div>
    </header>
  ),
  {
    namespace: 'ui',
    label: 'Header Bar',
    inputs: [
       { name: 'crumbs', type: 'array' },
       { name: 'search', type: 'object' },
       { name: 'actions', type: 'array' },
       { name: 'rightContent', type: 'object' },
    ],
    defaultProps: {
      crumbs: [
        { label: 'Home', href: '#' },
        { label: 'Current Page' }
      ]
    }
  }
);
