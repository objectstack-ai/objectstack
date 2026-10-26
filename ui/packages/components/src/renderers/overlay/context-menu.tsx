/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ContextMenuSchema, MenuItem } from '@object-ui/types';
import { 
  ContextMenu, 
  ContextMenuTrigger, 
  ContextMenuContent, 
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuShortcut
} from '../../ui';
import { renderChildren } from '../../lib/utils';
// Same-package sibling import, the path `renderers/complex/data-table.tsx`
// already uses. `icon` on a menu item is an authored lucide NAME. The twin
// `dropdown-menu.tsx` rendered it into a text node; THIS renderer never
// referenced the key at all, so the catalog fixture
// `basic-context-menu.json` shipped four live names — `copy`, `scissors`,
// `clipboard`, `trash` — that drew NOTHING (objectui#6278).
//
// Routed through the RECORD surface (`icons` from 'lucide-react'), which is
// what `action:*` and `ui:button` next door resolve against, so a retired
// spelling renders NOTHING rather than a word. The dynamic surface
// (`LazyIcon`) is deliberately NOT used: it degrades an unknown name to the
// `Database` glyph, trading a no-icon failure for a WRONG-icon one, recorded
// as ruled out for authored icon fields by objectui#5622 and #5633 and
// re-affirmed for this exact shape by objectui#5930.
import { resolveIcon } from '../action/resolve-icon';

// Reuse helper for recursive menu items if I could share it, but for now
// duplicate concise logic. `items` is the DECLARED `MenuItem[]` (objectui#6346
// tightened this from `any[]`, which is what let a renderer that read an
// undeclared spelling type-check in the first place).
const renderContextMenuItems = (items: MenuItem[] | undefined) => {
  if (!items) return null;
  return items.map((item, i) => {
    // The declared divider spelling (objectui#6523) — `context-menu` used to
    // branch on an undeclared `item.type === 'separator'` instead, which is
    // now a tombstoned key on `MenuItem` (`type?: never`) rather than a
    // second accepted dialect. `item.separator` narrows `item` to the
    // command arm for the remainder of this iteration.
    if (item.separator) return <ContextMenuSeparator key={i} />;
    // Resolved once per item and read by BOTH arms below. The submenu-trigger
    // arm carries the identical defect; repairing only the leaf would be a
    // narrower version of the same bug (objectui#5930, objectui#6278).
    const Icon = resolveIcon(item.icon);
    if (item.children) {
        return (
            <ContextMenuSub key={i}>
                <ContextMenuSubTrigger>
                    {Icon && <Icon className="mr-2 h-4 w-4" />}
                    {item.label}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                    {renderContextMenuItems(item.children)}
                </ContextMenuSubContent>
            </ContextMenuSub>
        )
    }

    return (
      // `onSelect` is Radix's callback prop name on `ContextMenuItem`; it
      // fires the DECLARED `item.onClick` (objectui#6346 — this renderer used
      // to read an undeclared `item.onSelect` on the schema item instead, so
      // an authored `onClick` validated, published, and never fired).
      <ContextMenuItem key={i} disabled={item.disabled} onSelect={() => item.onClick?.()}>
        {Icon && <Icon className="mr-2 h-4 w-4" />}
        {item.label}
        {item.shortcut && <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>}
      </ContextMenuItem>
    );
  });
};

ComponentRegistry.register('context-menu', 
  ({ schema, className, ...props }: { schema: ContextMenuSchema; className?: string; [key: string]: any }) => {
    // Determine classes
    const triggerClass = schema.triggerClassName || className || (schema.className as string) || "h-[120px] w-full sm:h-[150px] sm:w-[300px] border border-dashed text-sm flex items-center justify-center";
    const contentClass = schema.contentClassName;

    return (
    <ContextMenu modal={schema.modal} {...props}>
      <ContextMenuTrigger asChild>
          {/* Usually a Right Click area */}
          <div className={triggerClass}>
             {renderChildren(schema.trigger || { type: 'text', content: "Right click here" })}
          </div>
      </ContextMenuTrigger>
      <ContextMenuContent className={contentClass}>
         {renderContextMenuItems(schema.items)}
      </ContextMenuContent>
    </ContextMenu>
  )},
  {
    namespace: 'ui',
    label: 'Context Menu',
    inputs: [
      { 
        name: 'trigger', 
        type: 'slot', 
      },
      { name: 'triggerClassName', type: 'string' },
      {
        name: 'items',
        type: 'array',
        description: 'Recursive structure: a command item { label, icon, shortcut, disabled, onClick, children } or a divider { separator: true }. `icon` is a kebab-case Lucide icon name resolved against lucide\'s runtime `icons` record; an unknown or retired spelling renders no glyph.'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      items: [
        { label: 'Action 1' },
        { label: 'Action 2' },
        { separator: true },
        { label: 'Action 3' }
      ],
      trigger: [{ type: 'text', content: 'Right click here' }]
    }
  }
);
