/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { StatisticSchema } from '@object-ui/types';
import { cn } from '../../lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getLazyIcon } from '../../lib/lazy-icon';

// Helper to resolve icon — uses the shared lazy resolver so each icon ships
// as its own micro-chunk instead of the full lucide-react namespace.
const getIcon = (name: string) => (name ? getLazyIcon(name) : null);

const StatisticRenderer = ({ schema }: { schema: StatisticSchema }) => {
  const Icon = schema.icon ? getIcon(schema.icon) : null;
  
  return (
    <div className={cn(
        "group relative flex flex-col p-4 sm:p-5 md:p-6 rounded-xl border bg-card text-card-foreground shadow-sm",
        schema.className
    )}>
      {/* Label & Header Icon */}
      <div className="flex items-center justify-between mb-2">
          {schema.label && (
            <p className="text-sm font-medium text-muted-foreground">
            {schema.label}
            </p>
          )}
          {/* Dynamic icon resolution from Lucide, not component creation during render */}
          {/* eslint-disable-next-line */}
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>

      {/* Value Area */}
      <div className="flex items-baseline gap-2">
        <h3 className="text-2xl font-bold tracking-tight">
          {schema.value}
        </h3>
      </div>
        
      {/* Footer / Trend */}
      {(schema.trend || schema.description) && (
            <div className="mt-1 flex items-center text-xs text-muted-foreground">
                 {schema.trend === 'up' && <TrendingUp className="mr-1 h-3 w-3 text-emerald-500" />}
                 {schema.trend === 'down' && <TrendingDown className="mr-1 h-3 w-3 text-rose-500" />}
                 {schema.trend === 'neutral' && <Minus className="mr-1 h-3 w-3" />}
                 <span className={cn(
                     schema.trend === 'up' && "text-emerald-500 font-medium",
                     schema.trend === 'down' && "text-rose-500 font-medium",
                 )}>
                    {schema.description}
                 </span>
            </div>
      )}
    </div>
  );
};

ComponentRegistry.register('statistic', StatisticRenderer, {
  namespace: 'ui',
  label: 'Statistic',
  category: 'data-display',
  icon: 'Activity',
  inputs: [
    { name: 'label', type: 'string' },
    { name: 'value', type: 'string' },
    { name: 'description', type: 'string' },
    { 
      name: 'trend', 
      type: 'enum', 
      enum: [
        { label: 'Up', value: 'up' },
        { label: 'Down', value: 'down' },
        { label: 'Neutral', value: 'neutral' }
      ]    }
  ],
  defaultProps: {
    label: 'Total Revenue',
    value: '$45,231.89',
    trend: 'up',
    description: '+20.1% from last month'
  }
});
