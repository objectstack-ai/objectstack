/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { MenubarSchema, MenuItem } from '@object-ui/types';
import { Menubar, MenubarMenu, MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarSub, MenubarSubTrigger, MenubarSubContent, MenubarShortcut } from '../../ui/menubar';
// `icon` on a menu item is an authored lucide NAME, declared on `MenuItem`
// (the type `MenubarMenu.items` shares with `dropdown-menu` and
// `context-menu`). This renderer never referenced the key, so an author
// following the documented shape got no glyph and no error (objectui#6326).
//
// Routed through the RECORD surface (`icons` from 'lucide-react'), as the two
// twins were repaired (objectui#5930, objectui#6278): a retired spelling
// renders NOTHING rather than a word. The dynamic surface (`LazyIcon`) is
// deliberately NOT used: it degrades an unknown name to the `Database` glyph,
// trading a no-icon failure for a WRONG-icon one (objectui#5622, #5633).
import { resolveIcon } from '../action/resolve-icon';

// Draws one level of `MenuItem`s and recurses into `children`: the type is
// recursive (`children?: MenuItem[]`) and the docs call it "drawn as a nested
// submenu", but this renderer used to walk exactly one level, drawing a
// submenu child that carried its own `children` as a plain leaf and dropping
// them (objectui#6326). Deliberately local to this file — the three menu
// renderers are not consolidated here (objectui#6327 holds that question).
const renderMenubarItems = (items: MenuItem[] | undefined) =>
  items?.map((item, i) => {
    // The declared divider spelling (objectui#6523); narrowing on
    // `item.separator` is what makes `item.label` below type-check.
    if (item.separator) return <MenubarSeparator key={i} />;
    // Resolved once per item and read by BOTH arms below. Repairing only the
    // leaf would be a narrower version of the same bug (objectui#5930).
    const Icon = resolveIcon(item.icon);
    if (item.children) {
      return (
        <MenubarSub key={i}>
          <MenubarSubTrigger>
            {Icon && <Icon className="mr-2 h-4 w-4" />}
            {item.label}
          </MenubarSubTrigger>
          <MenubarSubContent>{renderMenubarItems(item.children)}</MenubarSubContent>
        </MenubarSub>
      );
    }
    return (
      <MenubarItem
        key={i}
        disabled={item.disabled}
        // Fires the DECLARED `onClick` (objectui#6346 rider — menubar
        // previously wired no item handler at all, neither spelling).
        onSelect={() => item.onClick?.()}
      >
        {Icon && <Icon className="mr-2 h-4 w-4" />}
        {item.label}
        {/* Parity, not new capability (objectui#6523 rider): the declared
            `shortcut` string already had working runtime in dropdown-menu and
            context-menu; menubar read it nowhere. */}
        {item.shortcut && <MenubarShortcut>{item.shortcut}</MenubarShortcut>}
      </MenubarItem>
    );
  });

ComponentRegistry.register('menubar', 
  ({ schema, ...props }: { schema: MenubarSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...menubarProps
    } = props;
    
    return (
      <Menubar 
        className={schema.className} 
        {...menubarProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        {schema.menus?.map((menu, idx) => (
          <MenubarMenu key={idx}>
            <MenubarTrigger>{menu.label}</MenubarTrigger>
            <MenubarContent>{renderMenubarItems(menu.items)}</MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
    );
  },
  {
    namespace: 'ui',
    label: 'Menubar',
    inputs: [
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      menus: [
        {
          label: 'File',
          items: [
            { label: 'New' },
            { label: 'Open' },
            { separator: true },
            { label: 'Exit' }
          ]
        }
      ]
    }
  }
);
