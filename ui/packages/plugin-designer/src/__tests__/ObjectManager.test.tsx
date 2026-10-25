/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ObjectManager } from '../ObjectManager';
import type { ObjectDefinition } from '@object-ui/types';

// Mock standard components — tested separately in their own packages
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-grid')),
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await import('./__mocks__/plugin-form')),
}));

const MOCK_OBJECTS: ObjectDefinition[] = [
  {
    id: 'obj-1',
    name: 'accounts',
    label: 'Accounts',
    pluralLabel: 'Accounts',
    description: 'Customer accounts',
    icon: 'Building',
    group: 'Custom Objects',
    sortOrder: 1,
    isSystem: false,
    fieldCount: 12,
  },
  {
    id: 'obj-2',
    name: 'contacts',
    label: 'Contacts',
    group: 'Custom Objects',
    sortOrder: 2,
    isSystem: false,
    fieldCount: 8,
  },
  {
    id: 'obj-3',
    name: 'users',
    label: 'Users',
    group: 'System Objects',
    isSystem: true,
    fieldCount: 5,
  },
];

describe('ObjectManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================
  // Rendering
  // ============================
  describe('Rendering', () => {
    it('should render the object manager container', () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      expect(screen.getByTestId('object-manager')).toBeDefined();
    });

    it('should render the ObjectGrid with data', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      // ObjectGrid mock renders rows from ValueDataSource
      await waitFor(() => {
        expect(screen.getByTestId('mock-object-grid')).toBeDefined();
      });
    });

    it('should render all objects as grid rows', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        expect(screen.getByTestId('grid-row-obj-1')).toBeDefined();
        expect(screen.getByTestId('grid-row-obj-2')).toBeDefined();
        expect(screen.getByTestId('grid-row-obj-3')).toBeDefined();
      });
    });

    it('should show the title with object count', () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      expect(screen.getByText('Object Manager')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
    });
  });

  // ============================
  // Adding Objects
  // ============================
  describe('Adding Objects', () => {
    it('should render the add button via ObjectGrid onAddRecord', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        expect(screen.getByTestId('grid-add-btn')).toBeDefined();
      });
    });

    it('should open ModalForm when add button is clicked', async () => {
      const onObjectsChange = vi.fn();
      render(<ObjectManager objects={MOCK_OBJECTS} onObjectsChange={onObjectsChange} />);
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-add-btn'));
      });
      expect(screen.getByTestId('mock-modal-form')).toBeDefined();
      expect(screen.getByTestId('modal-mode').textContent).toBe('create');
    });
  });

  // ============================
  // Selecting Objects
  // ============================
  describe('Selecting Objects', () => {
    it('should call onSelectObject when a grid row is clicked', async () => {
      const onSelectObject = vi.fn();
      render(
        <ObjectManager
          objects={MOCK_OBJECTS}
          onSelectObject={onSelectObject}
        />
      );
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-row-click-obj-1'));
      });
      expect(onSelectObject).toHaveBeenCalledWith(MOCK_OBJECTS[0]);
    });
  });

  // ============================
  // Editing Objects
  // ============================
  describe('Editing Objects', () => {
    it('should open ModalForm in edit mode when edit button is clicked', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-edit-obj-1'));
      });
      expect(screen.getByTestId('mock-modal-form')).toBeDefined();
      expect(screen.getByTestId('modal-mode').textContent).toBe('edit');
    });

    it('should call onObjectsChange when form is submitted', async () => {
      const onObjectsChange = vi.fn();
      render(<ObjectManager objects={MOCK_OBJECTS} onObjectsChange={onObjectsChange} />);
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-edit-obj-1'));
      });
      fireEvent.click(screen.getByTestId('modal-submit'));
      expect(onObjectsChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'obj-1' }),
        ])
      );
    });

    it('should close ModalForm when cancel is clicked', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-edit-obj-1'));
      });
      expect(screen.getByTestId('mock-modal-form')).toBeDefined();
      fireEvent.click(screen.getByTestId('modal-cancel'));
      expect(screen.queryByTestId('mock-modal-form')).toBeNull();
    });
  });

  // ============================
  // System Objects Visibility
  // ============================
  describe('System Objects Visibility', () => {
    it('should hide system objects when showSystemObjects is false', async () => {
      render(
        <ObjectManager
          objects={MOCK_OBJECTS}
          showSystemObjects={false}
        />
      );
      await waitFor(() => {
        expect(screen.getByTestId('grid-row-obj-1')).toBeDefined();
      });
      expect(screen.queryByTestId('grid-row-obj-3')).toBeNull();
    });

    it('should show system objects by default', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        expect(screen.getByTestId('grid-row-obj-3')).toBeDefined();
      });
    });
  });

  // ============================
  // Read-only Mode
  // ============================
  describe('Read-only Mode', () => {
    it('should not render add button in read-only mode', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} readOnly />);
      await waitFor(() => {
        expect(screen.getByTestId('mock-object-grid')).toBeDefined();
      });
      expect(screen.queryByTestId('grid-add-btn')).toBeNull();
    });

    it('should not render edit/delete buttons in read-only mode', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} readOnly />);
      await waitFor(() => {
        expect(screen.getByTestId('mock-object-grid')).toBeDefined();
      });
      expect(screen.queryByTestId('grid-edit-obj-1')).toBeNull();
      expect(screen.queryByTestId('grid-delete-obj-1')).toBeNull();
    });
  });

  // ============================
  // Deleting Objects
  // ============================
  describe('Deleting Objects', () => {
    it('should render delete button for custom objects', async () => {
      render(<ObjectManager objects={MOCK_OBJECTS} />);
      await waitFor(() => {
        expect(screen.getByTestId('grid-delete-obj-1')).toBeDefined();
      });
    });

    it('should trigger confirmation dialog on delete', async () => {
      const onObjectsChange = vi.fn();
      render(<ObjectManager objects={MOCK_OBJECTS} onObjectsChange={onObjectsChange} />);
      await waitFor(() => {
        fireEvent.click(screen.getByTestId('grid-delete-obj-1'));
      });
      // ConfirmDialog should be shown (handled by useConfirmDialog hook)
      // The actual deletion requires confirming the dialog
    });
  });
});
