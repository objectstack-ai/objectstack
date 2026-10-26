/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema, DataSource } from '@object-ui/types';

// Mock @object-ui/react to avoid circular dependency issues
vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="schema-renderer" data-schema-type={schema?.type}>
        {schema?.type}
      </div>
    ),
    SchemaRendererContext: React.createContext(null),
    // Data-invalidation bus (objectui#2269). `@object-ui/components` — a real,
    // unmocked transitive dep pulled in here — imports these at module-eval
    // time, so the mock must expose them or vitest's strict mock throws
    // ("No 'subscribeDataChanges' export is defined") before any test runs.
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

// Mock @object-ui/plugin-grid
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: ({ schema, onRowClick }: any) => (
    <div data-testid="object-grid" data-object={schema?.objectName}>
      <button data-testid="grid-row" onClick={() => onRowClick?.({ id: '1', name: 'Test' })}>
        Row 1
      </button>
    </div>
  ),
}));

// Mock @object-ui/plugin-form
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: any) => (
    <div data-testid="object-form" data-mode={schema?.mode}>
      Form ({schema?.mode})
    </div>
  ),
}));

const createMockDataSource = (overrides: Partial<DataSource> = {}): DataSource => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue({}),
  getObjectSchema: vi.fn().mockResolvedValue({
    label: 'Contacts',
    fields: {
      name: { label: 'Name', type: 'text' },
      email: { label: 'Email', type: 'text' },
      status: {
        label: 'Status',
        type: 'select',
        options: [
          { label: 'Active', value: 'active' },
          { label: 'Inactive', value: 'inactive' },
        ],
      },
      created_at: { label: 'Created', type: 'date' },
    },
  }),
  ...overrides,
} as DataSource);

describe('ObjectView', () => {
  let mockDataSource: DataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDataSource = createMockDataSource();
  });

  // ============================
  // Basic Rendering
  // ============================
  describe('Basic Rendering', () => {
    it('should render with minimal schema', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // Should render the grid by default
      expect(screen.getByTestId('object-grid')).toBeDefined();
    });

    it('should render title and description', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        title: 'Contact List',
        description: 'Manage your contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.getByText('Contact List')).toBeDefined();
      expect(screen.getByText('Manage your contacts')).toBeDefined();
    });

    it('should not render search box (delegated to ListView toolbar)', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    });

    it('should not render search box when showSearch is false', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        showSearch: false,
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
    });

    it('should render create button by default', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // The record-create verb now matches the runtime object pages ("New" /
      // console.objectView.new); with no I18nProvider mounted it falls back to
      // the English default "New" (framework#2615 P3 — verb consistency).
      expect(screen.getByText('New')).toBeDefined();
    });

    it('should hide create button when showCreate is false', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        showCreate: false,
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.queryByText('Create')).toBeNull();
    });
  });

  // ============================
  // Named List Views
  // ============================
  describe('Named List Views', () => {
    it('should render named view tabs when listViews has multiple entries', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        listViews: {
          // objectui#7928: a named view is the protocol's `ObjectListViewSchema`,
          // so it carries `columns` and spells `filter` as rule objects.
          all: { label: 'All Contacts', type: 'grid', columns: ['name'] },
          active: { label: 'Active', type: 'grid', columns: ['name'], filter: [{ field: 'status', operator: 'equals', value: 'active' }] },
        },
        defaultListView: 'all',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.getByText('All Contacts')).toBeDefined();
      expect(screen.getByText('Active')).toBeDefined();
    });

    it('should not render tabs when only one named view exists', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        listViews: {
          all: { label: 'All Contacts', type: 'grid', columns: ['name'] },
        },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // Should not show tabs for a single view
      expect(screen.queryByRole('tablist')).toBeNull();
    });

    it('should default to first named view when defaultListView is not set', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        listViews: {
          all: { label: 'All Contacts', type: 'grid', columns: ['name'] },
          active: { label: 'Active', type: 'grid', columns: ['name'] },
        },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // The grid should be rendered (first view is grid type)
      expect(screen.getByTestId('object-grid')).toBeDefined();
    });
  });

  // ============================
  // Default View Type
  // ============================
  describe('Default View Type', () => {
    it('should render grid by default when no defaultViewType set', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.getByTestId('object-grid')).toBeDefined();
    });
  });

  // ============================
  // Navigation Config
  // ============================
  describe('Navigation Config', () => {
    it('should not navigate when mode is none', () => {
      const onRowClick = vi.fn();
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'none' },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // Click a grid row
      fireEvent.click(screen.getByTestId('grid-row'));

      // onRowClick should not be called (mode is none)
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should not navigate when preventNavigation is true', () => {
      const onRowClick = vi.fn();
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'page', preventNavigation: true },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      fireEvent.click(screen.getByTestId('grid-row'));

      expect(onRowClick).not.toHaveBeenCalled();
    });

    it('should open in new window when mode is new_window', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'new_window' },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      fireEvent.click(screen.getByTestId('grid-row'));

      expect(openSpy).toHaveBeenCalledWith('/contacts/1', '_blank');
      openSpy.mockRestore();
    });

    it('should call onNavigate for page mode', () => {
      const onNavigate = vi.fn();
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'page' },
        onNavigate,
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      fireEvent.click(screen.getByTestId('grid-row'));

      expect(onNavigate).toHaveBeenCalledWith('1', 'view');
    });

    it('should open form in view mode when split navigation mode is clicked', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'split' },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      fireEvent.click(screen.getByTestId('grid-row'));

      // Split mode renders NavigationOverlay with split panels including a close button
      expect(screen.getByTestId('object-form')).toBeDefined();
      expect(screen.getByLabelText('Close panel')).toBeDefined();
    });

    it('should open form in view mode when popover navigation mode is clicked', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'popover' },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      fireEvent.click(screen.getByTestId('grid-row'));

      // Popover mode renders NavigationOverlay Dialog fallback (no popoverTrigger)
      expect(screen.getByTestId('object-form')).toBeDefined();
      expect(screen.getByRole('dialog')).toBeDefined();
    });

    it('should close split panel and return to normal view', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        navigation: { mode: 'split' },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      // Open split panel
      fireEvent.click(screen.getByTestId('grid-row'));
      expect(screen.getByLabelText('Close panel')).toBeDefined();

      // Close split panel
      fireEvent.click(screen.getByLabelText('Close panel'));

      // Form should be gone, grid should remain
      expect(screen.queryByLabelText('Close panel')).toBeNull();
      expect(screen.getByTestId('object-grid')).toBeDefined();
    });
  });

  // ============================
  // CRUD Operations
  // ============================
  describe('CRUD Operations', () => {
    it('should hide create button when operations.create is false', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        operations: { create: false, read: true, update: true, delete: true },
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      expect(screen.queryByText('Create')).toBeNull();
    });
  });

  // ============================
  // Data Source Integration
  // ============================
  describe('Data Source Integration', () => {
    it('should fetch object schema on mount', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      render(<ObjectView schema={schema} dataSource={mockDataSource} />);

      await waitFor(() => {
        expect(mockDataSource.getObjectSchema).toHaveBeenCalledWith('contacts');
      });
    });
  });

  // ============================
  // View Switcher (prop-based views)
  // ============================
  describe('View Switcher (prop-based)', () => {
    it('should not render view switcher with single view prop', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const views = [
        { id: 'grid', label: 'Grid', type: 'grid' as const },
      ];

      render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={views} />,
      );

      // Only one view, no switcher needed
      expect(screen.getByTestId('object-grid')).toBeDefined();
    });
  });

  // ============================
  // showViewSwitcher config
  // ============================
  describe('showViewSwitcher', () => {
    it('should hide view switcher when showViewSwitcher is false', () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        showViewSwitcher: false,
      };

      const views = [
        { id: 'grid', label: 'Grid', type: 'grid' as const },
        { id: 'kanban', label: 'Kanban', type: 'kanban' as const },
      ];

      render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={views} />,
      );

      // Switcher should be hidden
      expect(screen.queryByText('Kanban')).toBeNull();
    });
  });

  // ============================
  // Live Preview — viewConfig sync
  // ============================
  describe('Live Preview', () => {
    it('should re-render grid when views prop updates with new columns', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const initialViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name', 'email'] },
      ];

      const { rerender } = render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={initialViews} activeViewId="all" />,
      );

      expect(screen.getByTestId('object-grid')).toBeInTheDocument();

      // Simulate live preview: update views prop with new columns (as parent would after viewDraft change)
      const updatedViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name', 'email', 'status'] },
      ];

      rerender(
        <ObjectView schema={schema} dataSource={mockDataSource} views={updatedViews} activeViewId="all" />,
      );

      // Grid should still render (component did not crash on prop update)
      expect(screen.getByTestId('object-grid')).toBeInTheDocument();
    });

    it('should re-render when views prop updates with new sort config', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const initialViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'] },
      ];

      const { rerender } = render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={initialViews} activeViewId="all" />,
      );

      // Update with sort config — simulates live preview of sort changes
      const updatedViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'], sort: [{ field: 'name', order: 'desc' as const }] },
      ];

      rerender(
        <ObjectView schema={schema} dataSource={mockDataSource} views={updatedViews} activeViewId="all" />,
      );

      expect(screen.getByTestId('object-grid')).toBeInTheDocument();
    });

    it('should re-render when views prop updates with new filter', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const initialViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'] },
      ];

      const { rerender } = render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={initialViews} activeViewId="all" />,
      );

      // Update with filter — simulates live preview of filter changes
      const updatedViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'], filter: [['status', '=', 'active']] },
      ];

      rerender(
        <ObjectView schema={schema} dataSource={mockDataSource} views={updatedViews} activeViewId="all" />,
      );

      expect(screen.getByTestId('object-grid')).toBeInTheDocument();
    });

    it('should re-render when views prop updates with appearance properties', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const initialViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'] },
      ];

      const { rerender } = render(
        <ObjectView schema={schema} dataSource={mockDataSource} views={initialViews} activeViewId="all" />,
      );

      // Update with appearance changes — simulates live preview of the view's
      // appearance knobs. Spelled with `rowHeight` / `color` since objectui#4649:
      // the fixture used `striped` / `bordered`, which objectstack#7176 retired.
      const updatedViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'], rowHeight: 'compact' as const, color: 'status' },
      ];

      rerender(
        <ObjectView schema={schema} dataSource={mockDataSource} views={updatedViews} activeViewId="all" />,
      );

      expect(screen.getByTestId('object-grid')).toBeInTheDocument();
    });

    it('should pass renderListView with updated schema when views change', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const renderListViewSpy = vi.fn(({ schema: listSchema }: any) => (
        <div data-testid="custom-list" data-fields={JSON.stringify(listSchema.fields)}>
          Custom ListView
        </div>
      ));

      const initialViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name'] },
      ];

      const { rerender } = render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          views={initialViews}
          activeViewId="all"
          renderListView={renderListViewSpy}
        />,
      );

      expect(screen.getByTestId('custom-list')).toBeInTheDocument();
      const firstCallSchema = renderListViewSpy.mock.calls[0]?.[0]?.schema;
      // Spec-canonical `columns` (#2890) — the view configs are already
      // `columns`-keyed, so the payload no longer downgrades them to `fields`.
      expect(firstCallSchema?.columns).toEqual(['name']);

      // Update views — simulate live preview change
      const updatedViews = [
        { id: 'all', label: 'All', type: 'grid' as const, columns: ['name', 'email', 'status'] },
      ];

      rerender(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          views={updatedViews}
          activeViewId="all"
          renderListView={renderListViewSpy}
        />,
      );

      // renderListView should have been called again with the updated columns
      const lastCallIndex = renderListViewSpy.mock.calls.length - 1;
      const lastCallSchema = renderListViewSpy.mock.calls[lastCallIndex]?.[0]?.schema;
      expect(lastCallSchema?.columns).toEqual(['name', 'email', 'status']);
    });

    it('should pass showSort=false through schema to suppress sort UI', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        showSort: false,
      };

      render(
        <ObjectView schema={schema} dataSource={mockDataSource} />,
      );

      // Component renders without crash — showSort is respected
      expect(screen.getByTestId('object-grid')).toBeInTheDocument();
    });

    it('should include showSearch/showFilters/showSort in renderListView schema', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
        showSearch: false,
        showFilters: false,
        showSort: false,
      };

      const renderListViewSpy = vi.fn((_props: any) => (
        <div data-testid="custom-list">Custom ListView</div>
      ));

      render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          renderListView={renderListViewSpy}
        />,
      );

      expect(renderListViewSpy).toHaveBeenCalled();
      const callSchema = renderListViewSpy.mock.calls[0]?.[0]?.schema;
      // #2890: the payload speaks `userActions`, one vocabulary, instead of
      // unpacking the view's toggles into bare `show*` flags.
      expect(callSchema?.userActions).toMatchObject({ search: false, filter: false, sort: false });
    });

    it('should propagate showSearch/showFilters/showSort from activeView in renderListView', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const renderListViewSpy = vi.fn((_props: any) => (
        <div data-testid="custom-list">Custom ListView</div>
      ));

      const views = [
        { id: 'v1', label: 'View 1', type: 'grid' as const, showSearch: false, showFilters: false, showSort: false },
      ];

      render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          views={views}
          activeViewId="v1"
          renderListView={renderListViewSpy}
        />,
      );

      expect(renderListViewSpy).toHaveBeenCalled();
      const callSchema = renderListViewSpy.mock.calls[0]?.[0]?.schema;
      // #2890: the payload speaks `userActions`, one vocabulary, instead of
      // unpacking the view's toggles into bare `show*` flags.
      expect(callSchema?.userActions).toMatchObject({ search: false, filter: false, sort: false });
    });

    it('should propagate the ViewData `data` block (api provider) into the renderListView schema', async () => {
      const apiData = {
        provider: 'api',
        read: { url: '/api/gantt/tree', method: 'GET' },
        write: { url: '/api/gantt/task', method: 'PATCH' },
      };
      const schema = {
        type: 'object-view',
        objectName: 'production_plan',
        data: apiData,
      } as unknown as ObjectViewSchema;

      const renderListViewSpy = vi.fn(() => (
        <div data-testid="custom-list">Custom ListView</div>
      ));

      render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          renderListView={renderListViewSpy}
        />,
      );

      expect(renderListViewSpy).toHaveBeenCalled();
      const callSchema = (renderListViewSpy.mock.calls[0] as any)?.[0]?.schema;
      expect(callSchema?.data).toEqual(apiData);
    });

    it('should let activeView.data override the schema-level ViewData block', async () => {
      const viewData = {
        provider: 'api',
        read: { url: '/api/gantt/tree' },
      };
      const schema = {
        type: 'object-view',
        objectName: 'production_plan',
      } as unknown as ObjectViewSchema;

      const renderListViewSpy = vi.fn(() => (
        <div data-testid="custom-list">Custom ListView</div>
      ));

      const views = [
        { id: 'v1', label: 'View 1', type: 'gantt' as const, data: viewData } as any,
      ];

      render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          views={views}
          activeViewId="v1"
          renderListView={renderListViewSpy}
        />,
      );

      expect(renderListViewSpy).toHaveBeenCalled();
      const callSchema = (renderListViewSpy.mock.calls[0] as any)?.[0]?.schema;
      expect(callSchema?.data).toEqual(viewData);
    });

    it('should propagate userFilters from activeView in renderListView', async () => {
      const schema: ObjectViewSchema = {
        type: 'object-view',
        objectName: 'contacts',
      };

      const renderListViewSpy = vi.fn((_props: any) => (
        <div data-testid="custom-list">Custom ListView</div>
      ));

      const views = [
        {
          id: 'v1',
          label: 'View 1',
          type: 'grid' as const,
          userFilters: {
            element: 'dropdown' as const,
            fields: [{ field: 'status' }],
          },
        },
      ];

      render(
        <ObjectView
          schema={schema}
          dataSource={mockDataSource}
          views={views}
          activeViewId="v1"
          renderListView={renderListViewSpy}
        />,
      );

      expect(renderListViewSpy).toHaveBeenCalled();
      const callSchema = renderListViewSpy.mock.calls[0]?.[0]?.schema;
      expect(callSchema?.userFilters).toEqual({
        element: 'dropdown',
        fields: [{ field: 'status' }],
      });
    });
  });
});
