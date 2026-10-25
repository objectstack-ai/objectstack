/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectManager Component
 *
 * Enterprise-grade visual designer for managing object definitions.
 * Uses standard ObjectGrid for the list view and ModalForm for create/edit.
 * Supports CRUD operations, property editing, relationship display,
 * search, and read-only mode.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { ObjectDefinition } from '@object-ui/types';
import type { ObjectGridSchema, ListColumn } from '@object-ui/types';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { ModalForm } from '@object-ui/plugin-form';
import type { ModalFormSchema } from '@object-ui/plugin-form';
import { ValueDataSource } from '@object-ui/core';
import { Database } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDesignerTranslation } from './hooks/useDesignerTranslation';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { ConfirmDialog } from './components/ConfirmDialog';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Types
// ============================================================================

export interface ObjectManagerProps {
  /** List of object definitions */
  objects: ObjectDefinition[];
  /** Callback when objects change */
  onObjectsChange?: (objects: ObjectDefinition[]) => void;
  /** Callback when an object is selected for field editing */
  onSelectObject?: (object: ObjectDefinition) => void;
  /** Whether to show system objects */
  showSystemObjects?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** CSS class */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const OBJECT_GROUPS = [
  'Custom Objects',
  'System Objects',
  'Integration',
  'Analytics',
];

const ICON_OPTIONS = [
  'Box', 'Database', 'Users', 'FileText', 'Settings',
  'ShoppingCart', 'Calendar', 'Mail', 'Briefcase', 'Building',
  'Globe', 'Heart', 'Star', 'Tag', 'Bookmark',
  'Folder', 'Archive', 'Package', 'Truck', 'CreditCard',
];

// ============================================================================
// Main Component
// ============================================================================

export function ObjectManager({
  objects,
  onObjectsChange,
  onSelectObject,
  showSystemObjects = true,
  readOnly = false,
  className,
}: ObjectManagerProps) {
  const { t } = useDesignerTranslation();
  const confirmDialog = useConfirmDialog();

  const [formOpen, setFormOpen] = useState(false);
  const [editingObject, setEditingObject] = useState<ObjectDefinition | null>(null);

  // Filter system objects if needed
  const displayObjects = useMemo(() => {
    if (!showSystemObjects) {
      return objects.filter((o) => !o.isSystem);
    }
    return objects;
  }, [objects, showSystemObjects]);

  // Create ValueDataSource for ObjectGrid
  const dataSource = useMemo(
    () => new ValueDataSource({ items: displayObjects }),
    [displayObjects]
  );

  // Grid schema
  const gridColumns: ListColumn[] = useMemo(() => [
    { field: 'name', label: t('appDesigner.objectManager.objectName'), width: 160 },
    { field: 'label', label: t('appDesigner.objectManager.objectLabel'), width: 160 },
    { field: 'group', label: t('appDesigner.objectManager.group'), width: 130 },
    { field: 'fieldCount', label: 'Fields', width: 80 },
  ], [t]);

  const gridSchema = useMemo<ObjectGridSchema>(() => ({
    type: 'object-grid',
    objectName: 'object_definition',
    columns: gridColumns,
    searchableFields: ['name', 'label', 'description'],
    showSearch: true,
    operations: readOnly ? undefined : { create: true, update: true, delete: true },
  }), [gridColumns, readOnly]);

  // Handlers
  // Note: ObjectGrid applies $select using column fields, which strips `id`.
  // Use `name` (always in columns) as the lookup key instead of `id`.
  const handleRowClick = useCallback((record: Record<string, unknown>) => {
    const obj = objects.find((o) => o.name === record.name);
    if (obj) onSelectObject?.(obj);
  }, [objects, onSelectObject]);

  const handleEdit = useCallback((record: Record<string, unknown>) => {
    const obj = objects.find((o) => o.name === record.name);
    if (obj) {
      setEditingObject(obj);
      setFormOpen(true);
    }
  }, [objects]);

  /**
   * [objectui#9219] What THIS row may be asked to do — the per-row narrowing
   * objectui#8674 added to `ObjectGrid`, applied to the sibling component the
   * same defect lived in.
   *
   * `operations` and the `onDelete` wiring below are grid-level and identical
   * for every row, so the refusal for a system object used to live in
   * `handleDelete` and fire AFTER the entry had been drawn and clicked: no
   * dialog, no toast, no console message. `readOnly` was honest in the same
   * component (the callback is withheld, so nothing is drawn); `isSystem` drew
   * the entry and swallowed the click, and system objects are on screen by
   * DEFAULT (`showSystemObjects` defaults to true), so that row is reachable
   * without the caller doing anything unusual.
   *
   * `delete` only. `isSystem` disables `name` in the edit form; it has never
   * meant "this row is untouchable", and withholding Edit here would be a
   * capability regression wearing a bug fix's clothes.
   *
   * An unresolvable row is withheld for the same reason and not as a
   * defensive flourish: `handleDelete` returns early when the lookup misses,
   * so offering delete for such a row would reproduce this very defect.
   */
  const rowOperations = useCallback((record: Record<string, unknown>) => {
    const obj = objects.find((o) => o.name === record.name);
    return { delete: !!obj && !obj.isSystem };
  }, [objects]);

  const handleDelete = useCallback(async (record: Record<string, unknown>) => {
    const obj = objects.find((o) => o.name === record.name);
    // Unreachable through the grid now that `rowOperations` withholds the
    // action for exactly these two cases — kept because this callback is a
    // published prop value and nothing stops a future caller invoking it
    // directly. It must never become the ONLY refusal again.
    if (!obj || obj.isSystem) return;
    const confirmed = await confirmDialog.confirm(
      t('appDesigner.objectManager.deleteConfirmTitle'),
      t('appDesigner.objectManager.deleteConfirmMessage')
    );
    if (confirmed) {
      onObjectsChange?.(objects.filter((o) => o.id !== obj.id));
    }
  }, [objects, onObjectsChange, confirmDialog, t]);

  const handleAddObject = useCallback(() => {
    setEditingObject(null);
    setFormOpen(true);
  }, []);

  const handleFormSuccess = useCallback((data: Record<string, unknown>) => {
    if (editingObject) {
      // Update existing object
      const updated: ObjectDefinition = {
        ...editingObject,
        name: String(data.name || editingObject.name),
        label: String(data.label || editingObject.label),
        pluralLabel: data.pluralLabel ? String(data.pluralLabel) : undefined,
        description: data.description ? String(data.description) : undefined,
        icon: data.icon ? String(data.icon) : undefined,
        group: data.group ? String(data.group) : undefined,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : undefined,
      };
      onObjectsChange?.(objects.map((o) => (o.id === editingObject.id ? updated : o)));
    } else {
      // Create new object
      const newObj: ObjectDefinition = {
        id: `obj_${Date.now()}`,
        name: String(data.name || `new_object_${objects.length + 1}`),
        label: String(data.label || `New Object ${objects.length + 1}`),
        pluralLabel: data.pluralLabel ? String(data.pluralLabel) : undefined,
        description: data.description ? String(data.description) : undefined,
        icon: data.icon ? String(data.icon) : undefined,
        group: data.group ? String(data.group) : undefined,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : undefined,
        isSystem: false,
        fieldCount: 0,
      };
      onObjectsChange?.([...objects, newObj]);
    }
    setFormOpen(false);
    setEditingObject(null);
  }, [editingObject, objects, onObjectsChange]);

  const handleFormClose = useCallback((open: boolean) => {
    if (!open) {
      setFormOpen(false);
      setEditingObject(null);
    }
  }, []);

  // ModalForm schema
  const formSchema = useMemo<ModalFormSchema>(() => ({
    type: 'object-form',
    formType: 'modal',
    objectName: 'object_definition',
    mode: editingObject ? 'edit' : 'create',
    title: editingObject
      ? `${t('common.edit')} — ${editingObject.label}`
      : t('appDesigner.objectManager.addObject'),
    open: formOpen,
    onOpenChange: handleFormClose,
    modalSize: 'lg',
    customFields: [
      { name: 'name', label: t('appDesigner.objectManager.objectName'), type: 'text', required: true, placeholder: 'api_name', disabled: readOnly || (editingObject?.isSystem ?? false) },
      { name: 'label', label: t('appDesigner.objectManager.objectLabel'), type: 'text', required: true, placeholder: 'Display Name', disabled: readOnly },
      { name: 'pluralLabel', label: t('appDesigner.objectManager.pluralLabel'), type: 'text', placeholder: 'Display Names', disabled: readOnly },
      { name: 'description', label: t('appDesigner.appDescription'), type: 'textarea', disabled: readOnly },
      { name: 'icon', label: t('appDesigner.objectManager.icon'), type: 'select', options: ICON_OPTIONS.map((i) => ({ label: i, value: i })), disabled: readOnly },
      { name: 'group', label: t('appDesigner.objectManager.group'), type: 'select', options: OBJECT_GROUPS.map((g) => ({ label: g, value: g })), disabled: readOnly },
      { name: 'sortOrder', label: t('appDesigner.objectManager.sortOrder'), type: 'number', disabled: readOnly },
    ],
    initialValues: editingObject
      ? {
          name: editingObject.name,
          label: editingObject.label,
          pluralLabel: editingObject.pluralLabel || '',
          description: editingObject.description || '',
          icon: editingObject.icon || '',
          group: editingObject.group || '',
          sortOrder: editingObject.sortOrder ?? 0,
        }
      : {},
    onSuccess: handleFormSuccess,
    onCancel: () => handleFormClose(false),
    readOnly,
  }), [editingObject, formOpen, handleFormClose, handleFormSuccess, readOnly, t]);

  return (
    <div
      data-testid="object-manager"
      className={cn('w-full space-y-3', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {t('appDesigner.objectManager.title')}
          </h2>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {displayObjects.length}
          </span>
        </div>
      </div>

      {/* ObjectGrid for the list */}
      <ObjectGrid
        schema={gridSchema}
        dataSource={dataSource}
        onRowClick={handleRowClick}
        onEdit={readOnly ? undefined : handleEdit}
        onDelete={readOnly ? undefined : handleDelete}
        rowOperations={rowOperations}
        onAddRecord={readOnly ? undefined : handleAddObject}
      />

      {/* ModalForm for create / edit */}
      {formOpen && <ModalForm schema={formSchema} />}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={confirmDialog.onConfirm}
        onCancel={confirmDialog.onCancel}
        destructive
      />
    </div>
  );
}

export default ObjectManager;
