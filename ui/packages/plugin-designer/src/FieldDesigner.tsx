/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FieldDesigner Component
 *
 * Enterprise-grade visual designer for configuring object fields.
 * Uses standard ObjectGrid for the list view and a right-side DrawerForm for
 * create/edit with basic / type-specific / advanced sections.
 */

import React, { useState, useCallback, useMemo } from 'react';
import type { DesignerFieldDefinition, DesignerFieldType } from '@object-ui/types';
import type { ObjectGridSchema, ListColumn } from '@object-ui/types';
import { ObjectGrid } from '@object-ui/plugin-grid';
import { DrawerForm } from '@object-ui/plugin-form';
import type { DrawerFormSchema } from '@object-ui/plugin-form';
import { ValueDataSource } from '@object-ui/core';
import { CHOICE_TYPES_REQUIRING_OPTIONS } from '@object-ui/data-objectstack';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import {
  Columns3,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  ListOrdered,
  Link2,
  AtSign,
  Phone,
  Globe,
  FileText,
  Image,
  Palette,
  Code,
  MapPin,
  Star,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
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

export interface FieldDesignerProps {
  /** Object name this designer belongs to */
  objectName: string;
  /** List of field definitions */
  fields: DesignerFieldDefinition[];
  /** Callback when fields change */
  onFieldsChange?: (fields: DesignerFieldDefinition[]) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** CSS class */
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const FIELD_TYPE_META: Record<DesignerFieldType, { label: string; Icon: React.FC<{ className?: string }> }> = {
  text: { label: 'Text', Icon: Type },
  textarea: { label: 'Text Area', Icon: FileText },
  number: { label: 'Number', Icon: Hash },
  boolean: { label: 'Checkbox', Icon: ToggleLeft },
  date: { label: 'Date', Icon: Calendar },
  datetime: { label: 'Date/Time', Icon: Calendar },
  time: { label: 'Time', Icon: Calendar },
  select: { label: 'Picklist', Icon: ListOrdered },
  email: { label: 'Email', Icon: AtSign },
  phone: { label: 'Phone', Icon: Phone },
  url: { label: 'URL', Icon: Globe },
  password: { label: 'Password', Icon: Lock },
  currency: { label: 'Currency', Icon: Hash },
  percent: { label: 'Percent', Icon: Hash },
  lookup: { label: 'Lookup', Icon: Link2 },
  formula: { label: 'Formula', Icon: Code },
  autonumber: { label: 'Auto Number', Icon: Hash },
  file: { label: 'File', Icon: FileText },
  image: { label: 'Image', Icon: Image },
  markdown: { label: 'Markdown', Icon: FileText },
  html: { label: 'Rich Text', Icon: FileText },
  color: { label: 'Color', Icon: Palette },
  code: { label: 'Code', Icon: Code },
  location: { label: 'Location', Icon: MapPin },
  address: { label: 'Address', Icon: MapPin },
  rating: { label: 'Rating', Icon: Star },
  slider: { label: 'Slider', Icon: SlidersHorizontal },
};

type FieldTypeCategory = 'text' | 'number' | 'date' | 'choice' | 'relation' | 'advanced';

/**
 * Category partition of the designer vocabulary, driving the type filter and
 * the drawer's type `<select>`. Exported (with {@link CATEGORY_ORDER}) so
 * `fieldTypeCategories.test.ts` can assert it stays a complete partition of
 * `DESIGNER_FIELD_TYPES` — a type added to the vocabulary but left out here
 * would otherwise silently vanish from those pickers (objectui#3017).
 */
export const FIELD_TYPE_CATEGORIES: Record<FieldTypeCategory, DesignerFieldType[]> = {
  text: ['text', 'textarea', 'email', 'phone', 'url', 'password', 'markdown', 'html'],
  number: ['number', 'currency', 'percent', 'autonumber', 'rating', 'slider'],
  date: ['date', 'datetime', 'time'],
  choice: ['boolean', 'select'],
  relation: ['lookup'],
  advanced: ['formula', 'file', 'image', 'color', 'code', 'location', 'address'],
};

export const CATEGORY_ORDER: FieldTypeCategory[] = ['text', 'number', 'date', 'choice', 'relation', 'advanced'];

/**
 * Whether the drawer's type `<select>` offers `type` for the field being
 * created or edited (objectui#11253).
 *
 * A choice type (`select`, and any other member of the write guard's
 * `CHOICE_TYPES_REQUIRING_OPTIONS`) needs at least one option, and this drawer
 * has no options editor. Offered, it could only produce a field the object write
 * guard holds client-side, on a page that saves every change at once; so it is
 * not offered until the drawer can author options. The one exception is the
 * field's OWN stored type: an existing picklist keeps its type in the drawer, so
 * editing its label or flags shows what it is and writes it back unchanged (its
 * options ride along untouched). The top-of-page type FILTER is a list filter,
 * not a creation path, and keeps every type.
 */
function drawerOffersType(type: DesignerFieldType, editingType?: DesignerFieldType): boolean {
  return !CHOICE_TYPES_REQUIRING_OPTIONS.includes(type) || type === editingType;
}

/** One category of the type filter: its heading and the types under it. */
interface TypeFilterGroup {
  category: FieldTypeCategory;
  label: string;
  options: ReadonlyArray<{ value: DesignerFieldType; label: string }>;
}

/**
 * objectui#11865 — the list's type filter, drawn with the shared `Select`, the
 * control the rest of the designer picks with. It used to be a browser-native
 * `<select>`, one `<optgroup>` per category. What a pick does is unchanged:
 * `onPick` receives the picked option's own value (`''` for "All types", else
 * the type), the string the native control's `change` carried.
 *
 * - Items carry their option's INDEX, not its value: "All types" is index 0,
 *   and its value is `''`, which `SelectItem` refuses.
 * - Each category is a `SelectGroup` headed by a `SelectLabel`, where the
 *   native control had an `<optgroup>`.
 * - The filter is component state that only a pick sets, so it always holds
 *   one of the options; there is no outside value to show.
 * - It stays enabled in read-only mode, as the native control did: it filters
 *   the list and writes nothing.
 */
function TypeFilterPicker({
  value,
  allLabel,
  groups,
  onPick,
}: {
  value: DesignerFieldType | '';
  allLabel: string;
  groups: ReadonlyArray<TypeFilterGroup>;
  onPick: (value: DesignerFieldType | '') => void;
}) {
  const options: ReadonlyArray<{ value: DesignerFieldType | ''; label: string }> = [
    { value: '', label: allLabel },
    ...groups.flatMap((g) => g.options),
  ];
  return (
    <Select
      value={String(options.findIndex((o) => o.value === value))}
      onValueChange={(token) => {
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger
        data-testid="field-designer-type-filter"
        className="h-auto w-auto gap-1 px-2 py-1 text-xs"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="0">{allLabel}</SelectItem>
        {groups.map((g) => (
          <SelectGroup key={g.category}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.options.map((o) => (
              <SelectItem key={o.value} value={String(options.indexOf(o))}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}


// ============================================================================
// Main Component
// ============================================================================

export function FieldDesigner({
  objectName,
  fields,
  onFieldsChange,
  readOnly = false,
  className,
}: FieldDesignerProps) {
  const { t } = useDesignerTranslation();
  const confirmDialog = useConfirmDialog();

  const [formOpen, setFormOpen] = useState(false);
  const [editingField, setEditingField] = useState<DesignerFieldDefinition | null>(null);
  const [typeFilter, setTypeFilter] = useState<DesignerFieldType | ''>('');

  // Pre-filter fields by type (external filter before ObjectGrid)
  const filteredFields = useMemo(() => {
    if (!typeFilter) return fields;
    return fields.filter((f) => f.type === typeFilter);
  }, [fields, typeFilter]);

  // Create ValueDataSource for ObjectGrid
  const dataSource = useMemo(
    () => new ValueDataSource({ items: filteredFields }),
    [filteredFields]
  );

  // Grid schema
  const gridColumns: ListColumn[] = useMemo(() => [
    { field: 'name', label: t('appDesigner.fieldDesigner.fieldName'), width: 140 },
    { field: 'label', label: t('appDesigner.fieldDesigner.fieldLabel'), width: 160 },
    { field: 'type', label: t('appDesigner.fieldDesigner.fieldType'), width: 100 },
    { field: 'required', label: t('appDesigner.fieldDesigner.required'), width: 80 },
    { field: 'unique', label: t('appDesigner.fieldDesigner.unique'), width: 80 },
    { field: 'group', label: t('appDesigner.fieldDesigner.fieldGroup'), width: 120 },
  ], [t]);

  const gridSchema = useMemo<ObjectGridSchema>(() => ({
    type: 'object-grid',
    objectName: 'field_definition',
    columns: gridColumns,
    searchableFields: ['name', 'label', 'description'],
    showSearch: true,
    operations: readOnly ? undefined : { create: true, update: true, delete: true },
  }), [gridColumns, readOnly]);

  // Handlers
  // Note: ObjectGrid applies $select using column fields, which strips `id`.
  // Use `name` (always in columns) as the lookup key instead of `id`.
  const handleEdit = useCallback((record: Record<string, unknown>) => {
    const field = fields.find((f) => f.name === record.name);
    if (field) {
      setEditingField(field);
      setFormOpen(true);
    }
  }, [fields]);

  /**
   * [objectui#8674] Which generic row operations THIS row may be offered.
   *
   * The delete refusal used to live only inside {@link handleDelete}, which
   * runs after the click: `ObjectGrid` takes ONE grid-level `onDelete` and drew
   * the row action for every row, so a system field showed a delete button that
   * answered a click with nothing at all — no dialog, no toast, no console
   * message. `readOnly` was already honest (the callback is withheld, so no
   * button is drawn); `isSystem` was not. This is the same refusal, moved to
   * where it can withhold the affordance instead of swallowing its click.
   *
   * `isSystem` is the spelling the drawer form already uses to disable `name`
   * and `type` on a system field — the one concept, "this field's structure is
   * not the designer's to change", not a second one.
   *
   * An unresolvable row is withheld too, for the same reason and not as a
   * defensive flourish: `handleDelete` returns early when the lookup misses, so
   * offering delete for such a row would reproduce the exact defect this card
   * is about.
   */
  const rowOperations = useCallback((record: Record<string, unknown>) => {
    const field = fields.find((f) => f.name === record.name);
    return { delete: !!field && !field.isSystem };
  }, [fields]);

  const handleDelete = useCallback(async (record: Record<string, unknown>) => {
    const field = fields.find((f) => f.name === record.name);
    // Unreachable through the grid now that `rowOperations` withholds the
    // action for exactly these two cases — kept because this callback is a
    // published prop value and nothing stops a future caller invoking it
    // directly. It must never become the ONLY refusal again.
    if (!field || field.isSystem) return;
    const confirmed = await confirmDialog.confirm(
      t('appDesigner.fieldDesigner.deleteConfirmTitle'),
      t('appDesigner.fieldDesigner.deleteConfirmMessage')
    );
    if (confirmed) {
      onFieldsChange?.(fields.filter((f) => f.id !== field.id));
    }
  }, [fields, onFieldsChange, confirmDialog, t]);

  const handleAddField = useCallback(() => {
    setEditingField(null);
    setFormOpen(true);
  }, []);

  const handleFormSuccess = useCallback((data: Record<string, unknown>) => {
    if (editingField) {
      // Update existing field
      const updated: DesignerFieldDefinition = {
        ...editingField,
        name: String(data.name || editingField.name),
        label: String(data.label || editingField.label),
        type: (data.type as DesignerFieldType) || editingField.type,
        group: data.group ? String(data.group) : undefined,
        description: data.description ? String(data.description) : undefined,
        required: data.required === true,
        unique: data.unique === true,
        readonly: data.readonly === true,
        hidden: data.hidden === true,
        externalId: data.externalId === true,
        trackHistory: data.trackHistory === true,
        defaultValue: data.defaultValue ? String(data.defaultValue) : undefined,
        placeholder: data.placeholder ? String(data.placeholder) : undefined,
        referenceTo: data.referenceTo ? String(data.referenceTo) : undefined,
      };
      onFieldsChange?.(fields.map((f) => (f.id === editingField.id ? updated : f)));
    } else {
      // Create new field
      const newField: DesignerFieldDefinition = {
        id: `fld_${Date.now()}`,
        name: String(data.name || `new_field_${fields.length + 1}`),
        label: String(data.label || `New Field ${fields.length + 1}`),
        type: (data.type as DesignerFieldType) || 'text',
        group: data.group ? String(data.group) : undefined,
        description: data.description ? String(data.description) : undefined,
        required: data.required === true,
        unique: data.unique === true,
        readonly: data.readonly === true,
        hidden: data.hidden === true,
        externalId: data.externalId === true,
        trackHistory: data.trackHistory === true,
        defaultValue: data.defaultValue ? String(data.defaultValue) : undefined,
        placeholder: data.placeholder ? String(data.placeholder) : undefined,
        referenceTo: data.referenceTo ? String(data.referenceTo) : undefined,
        isSystem: false,
      };
      onFieldsChange?.([...fields, newField]);
    }
    setFormOpen(false);
    setEditingField(null);
  }, [editingField, fields, onFieldsChange]);

  const handleFormClose = useCallback((open: boolean) => {
    if (!open) {
      setFormOpen(false);
      setEditingField(null);
    }
  }, []);

  // Grouped type options for the <select> used inside the Drawer.
  // The top-of-page type filter also uses these groupings (see `TypeFilterPicker`).
  const typeOptionsByCategory = useMemo(
    () => CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: t(`appDesigner.fieldDesigner.typeCategory.${cat}`),
      options: FIELD_TYPE_CATEGORIES[cat].map((ft) => ({
        label: FIELD_TYPE_META[ft].label,
        value: ft,
      })),
    })),
    [t],
  );

  // Flatten for the <select> widget inside the drawer (which only takes `options`).
  // Visually grouped via inserting separator-like labels is not supported by shadcn Select.
  // For now we flatten and rely on the top filter for category-based filtering.
  // objectui#11253 — minus the choice types this drawer cannot give options to.
  const flatTypeOptions = useMemo(
    () =>
      typeOptionsByCategory
        .flatMap((g) => g.options)
        .filter((o) => drawerOffersType(o.value, editingField?.type)),
    [typeOptionsByCategory, editingField],
  );

  // DrawerForm schema — right-side panel with Basic / Type-specific / Advanced sections
  const drawerSchema = useMemo<DrawerFormSchema>(() => ({
    type: 'object-form',
    formType: 'drawer',
    objectName: 'field_definition',
    mode: editingField ? 'edit' : 'create',
    title: editingField
      ? `${t('common.edit')} — ${editingField.label}`
      : t('appDesigner.fieldDesigner.addField'),
    open: formOpen,
    onOpenChange: handleFormClose,
    drawerSide: 'right',
    drawerWidth: '480px',
    sections: [
      {
        name: 'basic',
        label: t('appDesigner.fieldDesigner.basicSection'),
        fields: [
          { name: 'name', label: t('appDesigner.fieldDesigner.fieldName'), type: 'text', required: true, placeholder: 'api_name', disabled: readOnly || (editingField?.isSystem ?? false) },
          { name: 'label', label: t('appDesigner.fieldDesigner.fieldLabel'), type: 'text', required: true, placeholder: 'Display Label', disabled: readOnly },
          { name: 'type', label: t('appDesigner.fieldDesigner.fieldType'), type: 'select', required: true, options: flatTypeOptions, disabled: readOnly || (editingField?.isSystem ?? false) },
          { name: 'required', label: t('appDesigner.fieldDesigner.required'), type: 'boolean', disabled: readOnly },
          { name: 'unique', label: t('appDesigner.fieldDesigner.unique'), type: 'boolean', disabled: readOnly },
          { name: 'description', label: t('appDesigner.fieldDesigner.description'), type: 'textarea', disabled: readOnly },
        ],
      },
      {
        name: 'typeSpecific',
        label: t('appDesigner.fieldDesigner.typeSpecificSection'),
        fields: [
          { name: 'referenceTo', label: t('appDesigner.fieldDesigner.referenceTo'), type: 'text', placeholder: 'Referenced object', disabled: readOnly, visibleWhen: "record.type == 'lookup'" },
          // No `formula` control (objectui#6043). It wrote a key the spec
          // refuses BY NAME — `FieldSchema` spells a formula field's expression
          // `expression` — so typing in this box made
          // `PUT /api/v1/meta/object/:name` fail 422 `INVALID_METADATA` and
          // blocked every later save of the object.
          //
          // Renaming the key was considered and REFUSED. `FieldSchema` does not
          // parse CEL at the key level (measured on 17.2.0: it accepts
          // `expression: '!!!not cel at all!!!'`), and this control's own
          // placeholder was `e.g. price * quantity` — bare field refs, which
          // formulas' `record` scope evaluates to null silently. A rename would
          // have traded a loud 422 for a silent wrong answer.
          //
          // Making it loud instead needs the CEL engine: lint, autocomplete and
          // `returnType` inference. That is `CelPredicateField`, which lives in
          // `@object-ui/app-shell` — and app-shell DEPENDS on this package, so
          // it cannot be imported back without a cycle. Formula expressions are
          // therefore authored in metadata-admin's `ObjectFieldInspector`,
          // where they are checked against the real `@objectstack/formula`
          // engine. The field TYPE `formula` is a valid spec `FieldType` and
          // stays in the palette above; only this unvalidatable box is gone.
          { name: 'defaultValue', label: t('appDesigner.fieldDesigner.defaultValue'), type: 'text', placeholder: 'Default value', disabled: readOnly },
          { name: 'placeholder', label: t('appDesigner.fieldDesigner.placeholder'), type: 'text', placeholder: 'Placeholder text', disabled: readOnly },
          { name: 'group', label: t('appDesigner.fieldDesigner.fieldGroup'), type: 'text', placeholder: 'Field Group', disabled: readOnly },
        ],
      },
      {
        name: 'advanced',
        label: t('appDesigner.fieldDesigner.advancedSection'),
        collapsible: true,
        collapsed: true,
        fields: [
          // No `indexed` control (objectui#4644): the spec has no field-level
          // index flag — `FieldSchema.safeParse` rejects `indexed` by name, so
          // ticking it only ever produced a 422 on save. Object-level
          // `indexes[]` is the real surface.
          { name: 'externalId', label: t('appDesigner.fieldDesigner.externalId'), type: 'boolean', disabled: readOnly },
          { name: 'trackHistory', label: t('appDesigner.fieldDesigner.trackHistory'), type: 'boolean', disabled: readOnly },
          { name: 'readonly', label: t('appDesigner.fieldDesigner.readOnly'), type: 'boolean', disabled: readOnly },
          { name: 'hidden', label: t('appDesigner.fieldDesigner.hidden'), type: 'boolean', disabled: readOnly },
        ],
      },
    ],
    initialValues: editingField
      ? {
          name: editingField.name,
          label: editingField.label,
          type: editingField.type,
          group: editingField.group || '',
          description: editingField.description || '',
          required: editingField.required || false,
          unique: editingField.unique || false,
          readonly: editingField.readonly || false,
          hidden: editingField.hidden || false,
          externalId: editingField.externalId || false,
          trackHistory: editingField.trackHistory || false,
          defaultValue: editingField.defaultValue != null ? String(editingField.defaultValue) : '',
          placeholder: editingField.placeholder || '',
          referenceTo: editingField.referenceTo || '',
        }
      : { type: 'text', required: false, unique: false },
    onSuccess: handleFormSuccess,
    onCancel: () => handleFormClose(false),
    readOnly,
  }), [editingField, formOpen, handleFormClose, handleFormSuccess, flatTypeOptions, readOnly, t]);

  return (
    <div
      data-testid="field-designer"
      className={cn('w-full space-y-3', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Columns3 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">
            {t('appDesigner.fieldDesigner.title')}
          </h2>
          {objectName && (
            <span className="text-xs text-muted-foreground">— {objectName}</span>
          )}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {filteredFields.length}
          </span>
        </div>
        {/* Type filter — grouped by 6 categories (Airtable-style) */}
        <TypeFilterPicker
          value={typeFilter}
          allLabel={t('appDesigner.fieldDesigner.allTypes')}
          groups={typeOptionsByCategory}
          onPick={setTypeFilter}
        />
      </div>

      {/* ObjectGrid for the field list */}
      <ObjectGrid
        schema={gridSchema}
        dataSource={dataSource}
        onEdit={readOnly ? undefined : handleEdit}
        onDelete={readOnly ? undefined : handleDelete}
        rowOperations={rowOperations}
        onAddRecord={readOnly ? undefined : handleAddField}
      />

      {/* DrawerForm for create / edit — right-side panel keeps the field list visible */}
      {formOpen && <DrawerForm schema={drawerSchema} />}

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

export default FieldDesigner;
