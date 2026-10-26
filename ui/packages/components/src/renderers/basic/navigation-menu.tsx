/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { NavigationMenuSchema } from '@object-ui/types';
import { NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuTrigger, NavigationMenuContent, NavigationMenuLink } from '../../ui/navigation-menu';
import { cn } from '../../lib/utils';

ComponentRegistry.register('navigation-menu', 
  ({ schema, ...props }: { schema: NavigationMenuSchema; [key: string]: any }) => {
    const { 
        'data-obj-id': dataObjId, 
        'data-obj-type': dataObjType,
        style,
        ...navigationMenuProps
    } = props;
    
    return (
      <NavigationMenu 
        className={schema.className} 
        {...navigationMenuProps}
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
      >
        <NavigationMenuList>
          {schema.items?.map((item, idx) => (
            <NavigationMenuItem key={idx}>
              {item.children ? (
                <>
                  <NavigationMenuTrigger>{item.label}</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <ul className="grid w-full gap-3 p-4 sm:w-[400px] md:w-[500px] md:grid-cols-2 lg:w-[600px]">
                      {item.children.map((child, childIdx) => (
                        <li key={childIdx}>
                          <NavigationMenuLink asChild>
                            <a
                              className={cn(
                                "block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                              )}
                              href={child.href}
                            >
                              <div className="text-sm font-medium leading-none">{child.label}</div>
                              {child.description && (
                                <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">
                                  {child.description}
                                </p>
                              )}
                            </a>
                          </NavigationMenuLink>
                        </li>
                      ))}
                    </ul>
                  </NavigationMenuContent>
                </>
              ) : (
                <NavigationMenuLink href={item.href}>{item.label}</NavigationMenuLink>
              )}
            </NavigationMenuItem>
          ))}
        </NavigationMenuList>
      </NavigationMenu>
    );
  },
  {
    namespace: 'ui',
    label: 'Navigation Menu',
    inputs: [
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      items: [
        { label: 'Home', href: '/' },
        { label: 'About', href: '/about' }
      ]
    }
  }
);
