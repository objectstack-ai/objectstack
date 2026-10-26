/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Example: Dashboard Layout
 * 
 * This example demonstrates a complete dashboard layout with
 * sidebar, header, and data table.
 */

import type { FlexBlockNode, SidebarSchema, HeaderBarSchema, CardSchema, DataTableSchema } from '../src/index';

// An authored `flex` node takes its props, the child list included, in its
// `properties` bag (objectui#11276). `FlexBlockNode` is that node, its bag
// closed (objectui#11468), and each entry of the bag's child list is typed as
// a node (objectui#11564). The nested `flex` node is checked with
// `satisfies FlexBlockNode`: that was needed while a `flex` entry also matched
// the post-hoist `FlexSchema`, whose `BaseSchema` index signature admitted any
// `properties`. objectui#8347 removed the signature, so the entry is judged as
// `FlexBlockNode` either way; the annotation stays as documentation.
export const dashboardSchema: FlexBlockNode = {
  type: 'flex',
  className: 'h-screen',
  properties: {
    direction: 'col',
    children: [
      // Header
      {
        type: 'header-bar',
        crumbs: [{ label: 'Object UI Dashboard' }],
        actions: [
          {
            type: 'button',
            label: 'Profile',
            variant: 'ghost',
            icon: 'User'
          }
        ]
      } as HeaderBarSchema,

      // Main content with sidebar
      {
        type: 'flex',
        className: 'flex-1',
        properties: {
          direction: 'row',
          children: [
            // Sidebar: it draws what it composes through `children`; an app's
            // navigation lives in the app's metadata, not on this node.
            {
              type: 'sidebar',
              collapsible: true,
              children: [
                { type: 'button', label: 'Dashboard', variant: 'ghost', icon: 'Home' },
                { type: 'button', label: 'Users', variant: 'ghost', icon: 'Users' },
                { type: 'button', label: 'Settings', variant: 'ghost', icon: 'Settings' }
              ]
            } as SidebarSchema,

            // Main content area
            {
              type: 'container',
              className: 'flex-1 p-6',
              children: [
                {
                  type: 'card',
                  title: 'User Management',
                  description: 'Manage your users and permissions',
                  children: {
                    type: 'data-table',
                    columns: [
                      { header: 'ID', accessorKey: 'id', width: '80px' },
                      { header: 'Name', accessorKey: 'name' },
                      { header: 'Email', accessorKey: 'email' },
                      { header: 'Role', accessorKey: 'role' },
                      { header: 'Status', accessorKey: 'status' }
                    ],
                    data: [
                      { id: 1, name: 'John Doe', email: 'john@example.com', role: 'Admin', status: 'Active' },
                      { id: 2, name: 'Jane Smith', email: 'jane@example.com', role: 'User', status: 'Active' },
                      { id: 3, name: 'Bob Johnson', email: 'bob@example.com', role: 'User', status: 'Inactive' }
                    ],
                    pagination: true,
                    pageSize: 10,
                    searchable: true,
                    selectable: true,
                    sortable: true,
                    exportable: true,
                    rowActions: true,
                    onRowEdit: (row) => console.log('Edit:', row),
                    onRowDelete: (row) => console.log('Delete:', row)
                  } as DataTableSchema
                } as CardSchema
              ]
            }
          ]
        }
      } satisfies FlexBlockNode
    ]
  }
};
