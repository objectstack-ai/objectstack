/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { TreeViewSchema, TreeNode } from '@object-ui/types';
import { ChevronRight, ChevronDown, Folder, File, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/utils';
import { useDataScope } from '@object-ui/react';
import { createSafeTranslation } from '@object-ui/i18n';

const useSafeTreeTranslation = createSafeTranslation(
  {
    'common.expand': 'Expand',
    'common.collapse': 'Collapse',
  },
  'common.expand',
);

const TreeNodeComponent = ({ 
  node, 
  onNodeClick
}: { 
  node: TreeNode; 
  onNodeClick?: (node: TreeNode) => void;
}) => {
  const { t } = useSafeTreeTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const nodeBody = (
    <>
      {node.icon === 'folder' || hasChildren ? (
        isOpen ?
          <FolderOpen className="h-4 w-4 mr-2 text-primary" /> :
          <Folder className="h-4 w-4 mr-2 text-muted-foreground group-hover:text-primary transition-colors" />
      ) : (
        <File className="h-4 w-4 mr-2 text-muted-foreground group-hover:text-primary transition-colors" />
      )}

      <span className={cn(
          "text-sm transition-colors",
          isOpen ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"
      )}>
          {node.label}
      </span>
    </>
  );

  return (
    <div className="relative">
      {/* objectui#13461 — the row is a container, not a click target: the
          expand toggle and (when the host passes `onNodeClick`) the node itself
          are each a real button, so both are reachable by keyboard. The node
          used to be a clickable `div` around the toggle's `button`. */}
      <div
        className={cn(
          'group flex items-center py-1.5 px-2 rounded-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isOpen && hasChildren && 'bg-accent/50' 
        )}
      >
        {hasChildren ? (
          <button type="button"
            onClick={handleToggle}
            aria-expanded={isOpen}
            aria-label={isOpen ? t('common.collapse') : t('common.expand')}
            className="mr-2 p-0.5 h-5 w-5 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground transition-colors"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="mr-2 w-5 flex justify-center">
             <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
          </span>
        )}
        
        {onNodeClick ? (
          <button
            type="button"
            onClick={() => onNodeClick(node)}
            className="flex min-w-0 flex-1 cursor-pointer items-center rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {nodeBody}
          </button>
        ) : (
          nodeBody
        )}
      </div>

      {hasChildren && isOpen && (
        <div className="relative ml-[11px] pl-3 border-l border-border animate-in slide-in-from-left-2 fade-in duration-200">
          {node.children!.map((child) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              onNodeClick={onNodeClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

ComponentRegistry.register('tree-view',
  ({ schema, className, ...props }: { schema: TreeViewSchema; className?: string; [key: string]: any }) => {
    const handleNodeClick = (node: TreeNode) => {
      if (schema.onNodeClick) {
        schema.onNodeClick(node);
      }
    };

    // Support data binding
    const boundData = useDataScope(schema.bind);
    const rawNodes = boundData || schema.nodes || [];
    const nodes = Array.isArray(rawNodes) ? rawNodes : [];

    return (
      <div className={cn(
          'relative border rounded-lg p-3 bg-card text-card-foreground',
          className
        )} 
        {...props}
      >
        {schema.title && (
          <div className="flex items-center gap-2 mb-3 pb-2 border-b">
            <h3 className="text-sm font-semibold">{schema.title}</h3>
          </div>
        )}
        <div className="space-y-1">
          {nodes.map((node: TreeNode) => (
            <TreeNodeComponent
              key={node.id}
              node={node}
              // A node is a button only when the host supplied a handler for it.
              onNodeClick={schema.onNodeClick ? handleNodeClick : undefined}
            />
          ))}
        </div>
      </div>
    );
  },
  {
    namespace: 'ui',
    label: 'Tree View',
    inputs: [
      { name: 'title', type: 'string' },
      { 
        name: 'nodes', 
        type: 'array', 
        description: 'Array of { id, label, icon, children, data }'
      },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      title: 'File Explorer',
      nodes: [
        {
          id: '1',
          label: 'Documents',
          icon: 'folder',
          children: [
            { id: '1-1', label: 'Resume.pdf', icon: 'file' },
            { id: '1-2', label: 'Cover Letter.docx', icon: 'file' }
          ]
        },
        {
          id: '2',
          label: 'Photos',
          icon: 'folder',
          children: [
            { id: '2-1', label: 'Vacation', icon: 'folder', children: [
              { id: '2-1-1', label: 'Beach.jpg', icon: 'file' }
            ]},
            { id: '2-2', label: 'Family.jpg', icon: 'file' }
          ]
        },
        {
          id: '3',
          label: 'README.md',
          icon: 'file'
        }
      ]
    }
  }
);
