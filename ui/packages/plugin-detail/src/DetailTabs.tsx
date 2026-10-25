/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent, Badge } from '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import type { DetailViewTab } from '@object-ui/types';

export interface DetailTabsProps {
  tabs: DetailViewTab[];
  data?: any;
  className?: string;
}

export const DetailTabs: React.FC<DetailTabsProps> = ({
  tabs,
  data,
  className,
}) => {
  const [activeTab, setActiveTab] = React.useState(tabs[0]?.key);

  const visibleTabs = tabs.filter(tab => {
    if (typeof tab.visible === 'boolean') return tab.visible;
    if (typeof tab.visible === 'string') {
      // Simple expression evaluation could go here
      return true;
    }
    return true;
  });

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className={className}>
      <TabsList className="w-full justify-start border-b rounded-none bg-transparent p-0">
        {visibleTabs.map((tab) => (
          <TabsTrigger
            key={tab.key}
            value={tab.key}
            className="relative rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            <div className="flex items-center gap-2">
              {tab.icon && <span>{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge && (
                <Badge variant="secondary" className="ml-1">
                  {tab.badge}
                </Badge>
              )}
            </div>
          </TabsTrigger>
        ))}
      </TabsList>

      {visibleTabs.map((tab) => (
        <TabsContent
          key={tab.key}
          value={tab.key}
          className="mt-4 motion-safe:data-[state=active]:animate-in motion-safe:data-[state=active]:fade-in-0 motion-safe:duration-150"
        >
          <React.Suspense fallback={null}>
            {Array.isArray(tab.content) ? (
              <div className="space-y-4">
                {tab.content.map((schema, index) => (
                  <SchemaRenderer key={index} schema={toRenderableSchema(schema)} data={data} />
                ))}
              </div>
            ) : (
              <SchemaRenderer schema={toRenderableSchema(tab.content)} data={data} />
            )}
          </React.Suspense>
        </TabsContent>
      ))}
    </Tabs>
  );
};
