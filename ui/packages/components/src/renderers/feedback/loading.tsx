/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { LoadingSchema } from '@object-ui/types';
import { Spinner } from '../../custom';
import { cn } from '../../lib/utils';

ComponentRegistry.register('loading', 
  ({ schema, className, ...props }: { schema: LoadingSchema; className?: string; [key: string]: any }) => {
    const size = schema.size || 'md';
    const fullscreen = schema.fullscreen || false;
    
    const loadingContent = (
      <div className={cn('flex flex-col items-center justify-center gap-2', className)}>
        <Spinner 
          className={cn(
            size === 'sm' && 'h-4 w-4',
            size === 'md' && 'h-8 w-8',
            size === 'lg' && 'h-12 w-12',
            size === ('xl' as any) && 'h-16 w-16'
          )}
        />
        {/* The message is the DECLARED `label` (`LoadingSchema.label`, "Loading
            text/message", on both faces). The renderer used to read an
            undeclared `text` here and leave `label` inert; no producer authors
            either spelling, so the read moved to the declared one and `text`
            is retired, with no alias (objectui#11347). */}
        {schema.label && (
          <p className="text-sm text-muted-foreground">{schema.label}</p>
        )}
      </div>
    );

    if (fullscreen) {
      return (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          {...props}
        >
          {loadingContent}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center p-8" {...props}>
        {loadingContent}
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Loading',
    inputs: [
      { name: 'label', type: 'string' },
      { 
        name: 'size', 
        type: 'enum', 
        enum: ['sm', 'md', 'lg', 'xl']      },
      { 
        name: 'fullscreen', 
        type: 'boolean'      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      label: 'Loading...',
      size: 'md',
      fullscreen: false
    }
  }
);
