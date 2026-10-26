/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { Suspense } from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { Skeleton } from '@object-ui/components';

// Export types for external use
export type { MarkdownSchema } from './types';
export { extractToc, type TocItem } from './toc';
export { Mermaid } from './Mermaid';

// 🚀 Lazy load the implementation file
// This ensures react-markdown is only loaded when the component is actually rendered
const LazyMarkdown = React.lazy(() => import('./MarkdownImpl'));

export interface MarkdownRendererProps {
  schema: {
    type: string;
    id?: string;
    className?: string;
    content?: string;
  };
}

/**
 * MarkdownRenderer - The public API for the markdown component
 * This wrapper handles lazy loading internally using React.Suspense
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ schema }) => {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[200px]" />}>
      <LazyMarkdown
        content={schema.content || ''}
        className={schema.className}
      />
    </Suspense>
  );
};

// Register the component with the ComponentRegistry
ComponentRegistry.register(
  'markdown',
  MarkdownRenderer,
  {
    namespace: 'plugin-markdown',
    label: 'Markdown',
    category: 'plugin',
    inputs: [
      { 
        name: 'content', 
        type: 'string', 
        required: true
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      content: '# Hello World\n\nThis is a **markdown** component with *formatting* support.\n\n- Item 1\n- Item 2\n- Item 3',
    }
  }
);

// Standard Export Protocol - for manual integration
export const markdownComponents = {
  'markdown': MarkdownRenderer,
};
