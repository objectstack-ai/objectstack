/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { TabsSchema } from '@object-ui/types';
import { renderChildren } from '../../lib/utils';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent
} from '../../ui';
import { cn } from '../../lib/utils';
import React from 'react';

const TabsRenderer = ({ schema, className, onChange, value, ...props }: { schema: TabsSchema; className?: string; onChange?: (val: string) => void; value?: string; [key: string]: any }) => {
  // Extract designer-related props
  const { 
      'data-obj-id': dataObjId, 
      'data-obj-type': dataObjType,
      style, 
      ...tabsProps 
  } = props;

  const handleValueChange = (val: string) => {
    if (onChange) {
      onChange(val);
    }
  };

  const isVertical = schema.orientation === 'vertical';

  return (
    <Tabs 
        defaultValue={value === undefined ? schema.defaultValue : undefined} 
        value={value ?? schema.value}
        onValueChange={handleValueChange}
        orientation={schema.orientation || 'horizontal'}
        className={cn(className, isVertical && "flex gap-2")} 
        {...tabsProps}
        // Apply designer props
        {...{ 'data-obj-id': dataObjId, 'data-obj-type': dataObjType, style }}
    >
      <TabsList className={cn(isVertical && "flex-col h-auto items-stretch bg-muted/50 p-1")}>
        {schema.items?.map((item) => (
          <TabsTrigger 
            key={item.value} 
            value={item.value}
            disabled={item.disabled}
            className={cn(isVertical && "justify-start")}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {schema.items?.map((item) => (
        <TabsContent 
          key={item.value} 
          value={item.value}
          className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", isVertical && "mt-0 flex-1")}
        >
          {renderChildren(item.content)}
        </TabsContent>
      ))}
    </Tabs>
  );
};

ComponentRegistry.register('tabs', TabsRenderer,
  {
    namespace: 'ui',
    label: 'Tabs',
    inputs: [
      { name: 'defaultValue', type: 'string', required: true },
      { name: 'className', type: 'string' },
      { 
        name: 'items', 
        type: 'array'      }
    ],
    defaultProps: {
      defaultValue: 'tab1',
      items: [
        { label: 'Tab 1', value: 'tab1', content: [{ type: 'text', content: 'Content for Tab 1' }] },
        { label: 'Tab 2', value: 'tab2', content: [{ type: 'text', content: 'Content for Tab 2' }] },
        { label: 'Tab 3', value: 'tab3', content: [{ type: 'text', content: 'Content for Tab 3' }] }
      ],
      className: 'w-full'
    }
  }
);
