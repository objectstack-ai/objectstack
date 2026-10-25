/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReportDesignerSection, ReportDesignerElement } from '@object-ui/types';
import {
  FileText,
  Plus,
  Trash2,
  Type,
  ImageIcon,
  BarChart3,
  Table2,
  Undo2,
  Redo2,
  Copy,
  Clipboard,
  PanelRightClose,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useConfirmDialog } from './hooks/useConfirmDialog';
import { useMultiSelect } from './hooks/useMultiSelect';
import { useClipboard } from './hooks/useClipboard';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PropertyEditor, type PropertyField } from './components/PropertyEditor';
import { useCollaboration } from './CollaborationProvider';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// i18n-ready label constants
// ---------------------------------------------------------------------------
const LABELS = {
  untitledReport: 'Untitled Report',
  reportCanvas: 'Report canvas',
  properties: 'Properties',
  propertiesPanel: 'Properties panel',
  designerToolbar: 'Report designer toolbar',
  selectElementPrompt: 'Select an element to edit its properties',
  addElementsPrompt: 'Add elements using the buttons above',
  addText: 'Add Text',
  addField: 'Add Field',
  addImage: 'Add Image',
  addChart: 'Add Chart',
  addTable: 'Add Table',
  undo: 'Undo',
  undoShortcut: 'Undo (Ctrl+Z)',
  redo: 'Redo',
  redoShortcut: 'Redo (Ctrl+Shift+Z)',
  copy: 'Copy',
  copyShortcut: 'Copy (Ctrl+C)',
  paste: 'Paste',
  pasteShortcut: 'Paste (Ctrl+V)',
  deleteSelected: 'Delete selected',
  deleteElement: 'Delete element',
  deleteElementsTitle: 'Delete elements',
  deleteElementMessage: (count: number) =>
    `Are you sure you want to delete ${count} element${count > 1 ? 's' : ''}?`,
  collapsePanel: 'Collapse panel',
  expandPanel: 'Expand panel',
  collaborationConnected: 'Connected',
  sectionHeader: 'Report Header',
  sectionPageHeader: 'Page Header',
  sectionGroupHeader: 'Group Header',
  sectionDetail: 'Detail',
  sectionGroupFooter: 'Group Footer',
  sectionPageFooter: 'Page Footer',
  sectionFooter: 'Report Footer',
  elementText: 'Text',
  elementImage: '🖼 Image',
  elementChart: '📊 Chart',
  elementTable: '📋 Table',
  propLabel: 'Label',
  propX: 'X',
  propY: 'Y',
  propWidth: 'Width',
  propHeight: 'Height',
  propText: 'Text',
  propDataBinding: 'Data binding',
  groupBy: 'by',
  pageBreakBefore: 'Page break before',
  groupPosition: 'Position',
  groupSize: 'Size',
  groupContent: 'Content',
  groupGeneral: 'General',
} as const;

export interface ReportDesignerProps {
  /** Report name */
  reportName?: string;
  /** Data source object */
  objectName?: string;
  /** Page size */
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  /** Page orientation */
  orientation?: 'portrait' | 'landscape';
  /** Page margins */
  margins?: { top: number; right: number; bottom: number; left: number };
  /** Report sections */
  sections?: ReportDesignerSection[];
  /** Show toolbar */
  showToolbar?: boolean;
  /** Show property panel */
  showPropertyPanel?: boolean;
  /*
   * There is deliberately no `previewMode` prop (objectui#11434): it was
   * declared here and never read. `ReportDesignerSchema.previewMode` is retired
   * on both faces of `@object-ui/types` in the same change.
   */
  /** Read-only mode */
  readOnly?: boolean;
  /** Callback when sections change */
  onSectionsChange?: (sections: ReportDesignerSection[]) => void;
  /** Custom CSS class */
  className?: string;
}

const PAGE_SIZES = {
  A4: { width: 595, height: 842 },
  A3: { width: 842, height: 1191 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
  Tabloid: { width: 792, height: 1224 },
};

type ElementFormat = NonNullable<ReportDesignerElement['format']>;

/**
 * How an element's `format` is drawn on the canvas (objectui#11434). Every
 * value is the AUTHOR's, so none is written straight into `style`: each is
 * published as a CSS custom property and painted by a STATIC utility, the
 * shape the styling rule's author-declared-colour carve-out prescribes — the
 * stylesheet keeps the rules, and a theme can still override them. The
 * keyword members map onto utilities directly.
 */
function formatPresentation(format: ElementFormat | undefined): { className: string; style: React.CSSProperties } {
  if (!format) return { className: '', style: {} };
  const classes: string[] = [];
  const vars: Record<string, string> = {};
  if (format.fontWeight === 'bold') classes.push('font-bold');
  if (format.fontWeight === 'normal') classes.push('font-normal');
  if (format.fontStyle === 'italic') classes.push('italic');
  if (format.fontStyle === 'normal') classes.push('not-italic');
  if (format.alignment === 'left') classes.push('justify-start text-left');
  if (format.alignment === 'center') classes.push('justify-center text-center');
  if (format.alignment === 'right') classes.push('justify-end text-right');
  if (format.verticalAlignment === 'top') classes.push('items-start');
  if (format.verticalAlignment === 'middle') classes.push('items-center');
  if (format.verticalAlignment === 'bottom') classes.push('items-end');
  if (format.color) {
    classes.push('text-[color:var(--report-el-color)]');
    vars['--report-el-color'] = format.color;
  }
  if (format.backgroundColor) {
    classes.push('bg-[color:var(--report-el-bg)]');
    vars['--report-el-bg'] = format.backgroundColor;
  }
  if (format.fontSize !== undefined) {
    classes.push('text-[length:var(--report-el-font-size)]');
    vars['--report-el-font-size'] = `${format.fontSize}px`;
  }
  if (format.fontFamily) {
    classes.push('font-[family-name:var(--report-el-font-family)]');
    vars['--report-el-font-family'] = format.fontFamily;
  }
  if (format.border) {
    classes.push('[border:var(--report-el-border)]');
    vars['--report-el-border'] = format.border;
  }
  if (format.padding) {
    classes.push('p-[var(--report-el-padding)]');
    vars['--report-el-padding'] = format.padding;
  }
  return { className: classes.join(' '), style: vars as React.CSSProperties };
}

/** The display formats a field element declares, as the canvas draws them beside its binding. */
function displayFormats(format: ElementFormat | undefined): string {
  return [format?.numberFormat, format?.dateFormat].filter(Boolean).join(' · ');
}

const DEFAULT_SECTIONS: ReportDesignerSection[] = [
  { type: 'header', height: 80, elements: [] },
  { type: 'detail', height: 400, elements: [], repeat: true },
  { type: 'footer', height: 60, elements: [] },
];

/**
 * Report designer for creating printable report layouts.
 * Supports sections (header, detail, footer) with drag-and-drop elements. The
 * page draws its four `margins` as a guide; a section draws its `groupField`
 * and a `pageBreakBefore` marker; an element draws its `dataBinding` and its
 * `format` (objectui#11434). A field element reads its binding from
 * `dataBinding` alone: the undeclared `properties.field` it used to read is
 * refused on both faces of `@object-ui/types`.
 */
export function ReportDesigner({
  reportName = LABELS.untitledReport,
  objectName,
  pageSize = 'A4',
  orientation = 'portrait',
  margins = { top: 40, right: 40, bottom: 40, left: 40 },
  sections: initialSections = [],
  showToolbar = true,
  showPropertyPanel = true,
  readOnly = false,
  onSectionsChange,
  className,
}: ReportDesignerProps) {
  // -- Undo / Redo ----------------------------------------------------------
  const history = useUndoRedo<ReportDesignerSection[]>(
    initialSections.length > 0 ? initialSections : DEFAULT_SECTIONS,
  );
  const sections = history.current;

  const pushSections = useCallback(
    (next: ReportDesignerSection[]) => {
      history.push(next);
      onSectionsChange?.(next);
    },
    [history, onSectionsChange],
  );

  // -- Multi-select ---------------------------------------------------------
  const multiSelect = useMultiSelect();

  const selectedId = useMemo(() => {
    const ids = Array.from(multiSelect.selectedIds);
    return ids.length > 0 ? ids[0] : null;
  }, [multiSelect.selectedIds]);

  // -- Clipboard ------------------------------------------------------------
  const clipboard = useClipboard<ReportDesignerElement[]>();

  // -- Confirm dialog -------------------------------------------------------
  const confirmDialog = useConfirmDialog();

  // -- Collaboration (optional) ---------------------------------------------
  const collaboration = useCollaboration();

  const broadcastOp = useCallback(
    (op: { type: 'insert' | 'update' | 'delete' | 'move'; elementId: string; data: Record<string, unknown> }) => {
      if (!collaboration) return;
      collaboration.sendOperation({ ...op, userId: collaboration.currentUserId ?? '' });
    },
    [collaboration],
  );

  // -- Collapsible property panel -------------------------------------------
  const [propertyPanelOpen, setPropertyPanelOpen] = useState(true);

  // -- Drag-and-drop state --------------------------------------------------
  const dragRef = useRef<{
    id: string;
    sectionIndex: number;
    startX: number;
    startY: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // -- Page dimensions ------------------------------------------------------
  const pageDims = PAGE_SIZES[pageSize];
  const pageWidth = orientation === 'landscape' ? pageDims.height : pageDims.width;
  const pageHeight = orientation === 'landscape' ? pageDims.width : pageDims.height;

  // -- Section label helper -------------------------------------------------
  const getSectionLabel = (type: string) => {
    switch (type) {
      case 'header': return LABELS.sectionHeader;
      case 'page-header': return LABELS.sectionPageHeader;
      case 'group-header': return LABELS.sectionGroupHeader;
      case 'detail': return LABELS.sectionDetail;
      case 'group-footer': return LABELS.sectionGroupFooter;
      case 'page-footer': return LABELS.sectionPageFooter;
      case 'footer': return LABELS.sectionFooter;
      default: return type;
    }
  };

  // -- Find selected element data -------------------------------------------
  const selectedElementData = useMemo(
    () =>
      selectedId
        ? sections.flatMap((s) => s.elements).find((e: ReportDesignerElement) => e.id === selectedId)
        : null,
    [selectedId, sections],
  );

  // -- Add element ----------------------------------------------------------
  const handleAddElement = useCallback(
    (sectionIndex: number, elementType: ReportDesignerElement['type']) => {
      if (readOnly) return;
      const newElement: ReportDesignerElement = {
        id: `elem-${Date.now()}`,
        type: elementType,
        position: { x: margins.left, y: 10, width: 200, height: 30 },
        properties: elementType === 'text' ? { text: 'New Text' } : {},
        ...(elementType === 'field' ? { dataBinding: 'field_name' } : {}),
      };
      const updated = sections.map((section, i) =>
        i === sectionIndex
          ? { ...section, elements: [...section.elements, newElement] }
          : section,
      );
      pushSections(updated);
      multiSelect.selectOne(newElement.id);
      broadcastOp({ type: 'insert', elementId: newElement.id, data: { element: newElement } });
    },
    [sections, margins.left, readOnly, pushSections, multiSelect, broadcastOp],
  );

  // -- Delete single element (no confirm) -----------------------------------
  const handleDeleteElement = useCallback(
    (elementId: string) => {
      if (readOnly) return;
      const updated = sections.map((section) => ({
        ...section,
        elements: section.elements.filter((e: ReportDesignerElement) => e.id !== elementId),
      }));
      pushSections(updated);
      if (multiSelect.isSelected(elementId)) multiSelect.clearSelection();
      broadcastOp({ type: 'delete', elementId, data: {} });
    },
    [sections, readOnly, pushSections, multiSelect, broadcastOp],
  );

  // -- Delete selected with confirmation ------------------------------------
  const handleDeleteSelected = useCallback(async () => {
    if (readOnly || multiSelect.count === 0) return;
    const confirmed = await confirmDialog.confirm(
      LABELS.deleteElementsTitle,
      LABELS.deleteElementMessage(multiSelect.count),
    );
    if (!confirmed) return;
    const ids = multiSelect.selectedIds;
    const updated = sections.map((section) => ({
      ...section,
      elements: section.elements.filter((e: ReportDesignerElement) => !ids.has(e.id)),
    }));
    pushSections(updated);
    multiSelect.clearSelection();
    ids.forEach((id) => {
      broadcastOp({ type: 'delete', elementId: id, data: {} });
    });
  }, [readOnly, multiSelect, confirmDialog, sections, pushSections, broadcastOp]);

  // -- Update element property ----------------------------------------------
  const handleUpdateProperty = useCallback(
    (name: string, value: unknown) => {
      if (readOnly || !selectedId) return;
      const updated = sections.map((section) => ({
        ...section,
        elements: section.elements.map((e: ReportDesignerElement) => {
          if (e.id !== selectedId) return e;
          if (name === 'x') return { ...e, position: { ...e.position, x: Number(value) } };
          if (name === 'y') return { ...e, position: { ...e.position, y: Number(value) } };
          if (name === 'width') return { ...e, position: { ...e.position, width: Number(value) } };
          if (name === 'height') return { ...e, position: { ...e.position, height: Number(value) } };
          if (name === 'dataBinding') {
            // A member of the element, not of its `properties` bag; an emptied
            // binding leaves the element unbound.
            const binding = String(value ?? '');
            if (binding !== '') return { ...e, dataBinding: binding };
            const { dataBinding: _cleared, ...unbound } = e;
            return unbound;
          }
          return { ...e, properties: { ...e.properties, [name]: value } };
        }),
      }));
      pushSections(updated);
      broadcastOp({ type: 'update', elementId: selectedId, data: { [name]: value } });
    },
    [readOnly, selectedId, sections, pushSections, broadcastOp],
  );

  // -- Copy / Paste ---------------------------------------------------------
  const handleCopy = useCallback(() => {
    const ids = multiSelect.selectedIds;
    if (ids.size === 0) return;
    const allElements = sections.flatMap((s) => s.elements);
    const selected = allElements.filter((e: ReportDesignerElement) => ids.has(e.id));
    clipboard.copy(selected);
  }, [multiSelect, sections, clipboard]);

  const handlePaste = useCallback(() => {
    if (readOnly) return;
    const items = clipboard.paste();
    if (!items || items.length === 0) return;
    let pasteCounter = 0;
    const pasted = items.map((e) => ({
      ...e,
      id: `elem-${Date.now()}-${++pasteCounter}-${Math.random().toString(36).slice(2, 7)}`,
      position: { ...e.position, x: e.position.x + 20, y: e.position.y + 20 },
    }));
    // Insert into the first section that has elements, or the detail section
    const targetIndex = sections.findIndex((s) => s.type === 'detail');
    const insertIndex = targetIndex >= 0 ? targetIndex : 0;
    const updated = sections.map((section, i) =>
      i === insertIndex
        ? { ...section, elements: [...section.elements, ...pasted] }
        : section,
    );
    pushSections(updated);
    multiSelect.selectMany(pasted.map((p) => p.id));
    pasted.forEach((p) => {
      broadcastOp({ type: 'insert', elementId: p.id, data: { element: p } });
    });
  }, [readOnly, clipboard, sections, pushSections, multiSelect, broadcastOp]);

  // -- Drag-and-drop handlers -----------------------------------------------
  const handleDragStart = useCallback(
    (e: React.DragEvent, element: ReportDesignerElement, sectionIndex: number) => {
      if (readOnly) return;
      dragRef.current = { id: element.id, sectionIndex, startX: e.clientX, startY: e.clientY };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', element.id);
    },
    [readOnly],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetSectionIndex: number) => {
      e.preventDefault();
      const drag = dragRef.current;
      if (!drag || readOnly) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      if (drag.sectionIndex === targetSectionIndex) {
        // Move within the same section
        const updated = sections.map((section, i) => {
          if (i !== targetSectionIndex) return section;
          return {
            ...section,
            elements: section.elements.map((el: ReportDesignerElement) => {
              if (el.id !== drag.id) return el;
              return {
                ...el,
                position: {
                  ...el.position,
                  x: Math.max(0, el.position.x + dx),
                  y: Math.max(0, (typeof el.position.y === 'number' ? el.position.y : 0) + dy),
                },
              };
            }),
          };
        });
        pushSections(updated);
      } else {
        // Move across sections
        let movedElement: ReportDesignerElement | null = null;
        const withRemoved = sections.map((section, i) => {
          if (i !== drag.sectionIndex) return section;
          const elem = section.elements.find((el: ReportDesignerElement) => el.id === drag.id);
          if (elem) {
            movedElement = {
              ...elem,
              position: {
                ...elem.position,
                x: Math.max(0, elem.position.x + dx),
                y: Math.max(0, 10),
              },
            };
          }
          return {
            ...section,
            elements: section.elements.filter((el: ReportDesignerElement) => el.id !== drag.id),
          };
        });
        if (movedElement) {
          const updated = withRemoved.map((section, i) => {
            if (i !== targetSectionIndex) return section;
            return { ...section, elements: [...section.elements, movedElement!] };
          });
          pushSections(updated);
        }
      }
      broadcastOp({ type: 'move', elementId: drag.id, data: {} });
      dragRef.current = null;
    },
    [readOnly, sections, pushSections, broadcastOp],
  );

  // -- Property fields for PropertyEditor -----------------------------------
  const propertyFields = useMemo<PropertyField[]>(() => {
    if (!selectedElementData) return [];
    const fields: PropertyField[] = [
      { name: 'x', label: LABELS.propX, type: 'number' as const, value: selectedElementData.position.x, group: LABELS.groupPosition },
      { name: 'y', label: LABELS.propY, type: 'number' as const, value: selectedElementData.position.y, group: LABELS.groupPosition },
      { name: 'width', label: LABELS.propWidth, type: 'number' as const, value: selectedElementData.position.width, group: LABELS.groupSize },
      { name: 'height', label: LABELS.propHeight, type: 'number' as const, value: selectedElementData.position.height, group: LABELS.groupSize },
    ];
    if (selectedElementData.type === 'text') {
      fields.push({
        name: 'text',
        label: LABELS.propText,
        type: 'text' as const,
        value: selectedElementData.properties.text ?? '',
        group: LABELS.groupContent,
      });
    }
    // Every element type declares `dataBinding`; a field element is unbound
    // without it.
    fields.push({
      name: 'dataBinding',
      label: LABELS.propDataBinding,
      type: 'text' as const,
      value: selectedElementData.dataBinding ?? '',
      group: LABELS.groupContent,
    });
    return fields;
  }, [selectedElementData]);

  // -- Keyboard shortcuts ---------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      const ctrl = e.ctrlKey || e.metaKey;

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && multiSelect.count > 0 && !isInput) {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }
      // Escape
      if (e.key === 'Escape') {
        multiSelect.clearSelection();
        return;
      }
      if (isInput) return;
      // Ctrl+Z – Undo
      if (ctrl && e.key === 'z' && !e.shiftKey && !readOnly) {
        e.preventDefault();
        history.undo();
        return;
      }
      // Ctrl+Shift+Z / Ctrl+Y – Redo
      if (ctrl && ((e.key === 'z' && e.shiftKey) || e.key === 'y') && !readOnly) {
        e.preventDefault();
        history.redo();
        return;
      }
      // Ctrl+C – Copy
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        handleCopy();
        return;
      }
      // Ctrl+V – Paste
      if (ctrl && e.key === 'v' && !readOnly) {
        e.preventDefault();
        handlePaste();
        return;
      }
      // Ctrl+A – Select all
      if (ctrl && e.key === 'a') {
        e.preventDefault();
        const allIds = sections.flatMap((s) => s.elements).map((e: ReportDesignerElement) => e.id);
        multiSelect.selectMany(allIds);
        return;
      }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [multiSelect, handleDeleteSelected, readOnly, history, handleCopy, handlePaste, sections]);

  return (
    <div ref={containerRef} tabIndex={0} className={cn('flex h-full w-full border rounded-lg overflow-hidden bg-background', className)}>
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        {showToolbar && (
          <div role="toolbar" aria-label={LABELS.designerToolbar} className="flex items-center gap-2 p-2 border-b bg-muted/20">
            <FileText className="h-4 w-4" />
            <span className="font-medium text-sm">{reportName}</span>
            {objectName && (
              <span className="text-xs text-muted-foreground">({objectName})</span>
            )}

            {/* Undo / Redo */}
            {!readOnly && (
              <>
                <div className="w-px h-5 bg-border mx-1" />
                <button type="button"
                  className={cn('p-1.5 rounded hover:bg-accent', !history.canUndo && 'opacity-40 pointer-events-none')}
                  title={LABELS.undoShortcut}
                  aria-label={LABELS.undo}
                  disabled={!history.canUndo}
                  onClick={() => history.undo()}
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button type="button"
                  className={cn('p-1.5 rounded hover:bg-accent', !history.canRedo && 'opacity-40 pointer-events-none')}
                  title={LABELS.redoShortcut}
                  aria-label={LABELS.redo}
                  disabled={!history.canRedo}
                  onClick={() => history.redo()}
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}

            {/* Copy / Paste */}
            {!readOnly && (
              <>
                <button type="button"
                  className={cn('p-1.5 rounded hover:bg-accent', multiSelect.count === 0 && 'opacity-40 pointer-events-none')}
                  title={LABELS.copyShortcut}
                  aria-label={LABELS.copy}
                  disabled={multiSelect.count === 0}
                  onClick={handleCopy}
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button type="button"
                  className={cn('p-1.5 rounded hover:bg-accent', !clipboard.hasContent && 'opacity-40 pointer-events-none')}
                  title={LABELS.pasteShortcut}
                  aria-label={LABELS.paste}
                  disabled={!clipboard.hasContent}
                  onClick={handlePaste}
                >
                  <Clipboard className="h-4 w-4" />
                </button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}

            {/* Delete selected */}
            {!readOnly && (
              <button type="button"
                className={cn('p-1.5 rounded hover:bg-accent', multiSelect.count === 0 && 'opacity-40 pointer-events-none')}
                title={LABELS.deleteSelected}
                aria-label={LABELS.deleteSelected}
                disabled={multiSelect.count === 0}
                onClick={handleDeleteSelected}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}

            <div className="flex-1" />

            {/* Collaboration indicator */}
            {collaboration?.isConnected && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                {LABELS.collaborationConnected}
                {collaboration.users.length > 1 && ` (${collaboration.users.length})`}
              </span>
            )}

            <span className="text-xs text-muted-foreground">
              {pageSize} {orientation}
            </span>

            {/* Property panel toggle */}
            {showPropertyPanel && (
              <button type="button"
                className="p-1.5 rounded hover:bg-accent"
                title={propertyPanelOpen ? LABELS.collapsePanel : LABELS.expandPanel}
                aria-label={propertyPanelOpen ? LABELS.collapsePanel : LABELS.expandPanel}
                onClick={() => setPropertyPanelOpen((v) => !v)}
              >
                <PanelRightClose className={cn('h-4 w-4', !propertyPanelOpen && 'rotate-180')} />
              </button>
            )}
          </div>
        )}

        {/* Report Canvas */}
        <div role="region" aria-label={LABELS.reportCanvas} className="flex-1 overflow-auto bg-muted/10 p-4 flex justify-center">
          <div
            className="relative bg-white shadow-lg border"
            style={{
              width: pageWidth,
              minHeight: pageHeight,
            }}
          >
            {/* The page's four margins, drawn as a guide over the sections */}
            <div
              aria-hidden="true"
              data-testid="report-margin-guide"
              className="pointer-events-none absolute border border-dashed border-primary/30 top-[var(--report-margin-top)] right-[var(--report-margin-right)] bottom-[var(--report-margin-bottom)] left-[var(--report-margin-left)]"
              style={{
                '--report-margin-top': `${margins.top}px`,
                '--report-margin-right': `${margins.right}px`,
                '--report-margin-bottom': `${margins.bottom}px`,
                '--report-margin-left': `${margins.left}px`,
              } as React.CSSProperties}
            />
            {sections.map((section, sectionIndex) => (
              <div
                key={`${section.type}-${sectionIndex}`}
                className="relative border-b border-dashed border-gray-300"
                style={{ minHeight: section.height }}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, sectionIndex)}
              >
                {/* A page break before this section */}
                {section.pageBreakBefore && (
                  <div
                    role="separator"
                    aria-label={LABELS.pageBreakBefore}
                    title={LABELS.pageBreakBefore}
                    className="pointer-events-none absolute inset-x-0 top-0 border-t-2 border-dashed border-primary"
                    data-testid={`report-section-page-break-${sectionIndex}`}
                  />
                )}

                {/* Section label */}
                <div className="absolute left-0 top-0 px-2 py-0.5 bg-muted text-xs text-muted-foreground border-r border-b rounded-br">
                  {getSectionLabel(section.type)}
                  {section.groupField && (
                    <span data-testid={`report-section-group-${sectionIndex}`}>
                      {` · ${LABELS.groupBy} ${section.groupField}`}
                    </span>
                  )}
                  {section.repeat && ' ↻'}
                </div>

                {/* Add element buttons */}
                {!readOnly && (
                  <div className="absolute right-1 top-0 flex items-center gap-0.5">
                    <button type="button"
                      onClick={() => handleAddElement(sectionIndex, 'text')}
                      className="p-0.5 rounded hover:bg-accent"
                      title={LABELS.addText}
                      aria-label={LABELS.addText}
                    >
                      <Type className="h-3 w-3" />
                    </button>
                    <button type="button"
                      onClick={() => handleAddElement(sectionIndex, 'field')}
                      className="p-0.5 rounded hover:bg-accent"
                      title={LABELS.addField}
                      aria-label={LABELS.addField}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button type="button"
                      onClick={() => handleAddElement(sectionIndex, 'image')}
                      className="p-0.5 rounded hover:bg-accent"
                      title={LABELS.addImage}
                      aria-label={LABELS.addImage}
                    >
                      <ImageIcon className="h-3 w-3" />
                    </button>
                    <button type="button"
                      onClick={() => handleAddElement(sectionIndex, 'chart')}
                      className="p-0.5 rounded hover:bg-accent"
                      title={LABELS.addChart}
                      aria-label={LABELS.addChart}
                    >
                      <BarChart3 className="h-3 w-3" />
                    </button>
                    <button type="button"
                      onClick={() => handleAddElement(sectionIndex, 'table')}
                      className="p-0.5 rounded hover:bg-accent"
                      title={LABELS.addTable}
                      aria-label={LABELS.addTable}
                    >
                      <Table2 className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {/* Elements */}
                <div className="relative" style={{ minHeight: section.height, paddingTop: 24 }}>
                  {section.elements.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center pt-4">
                      {LABELS.addElementsPrompt}
                    </div>
                  )}
                  {section.elements.map((element: ReportDesignerElement) => {
                    const isSelected = multiSelect.isSelected(element.id);
                    const presentation = formatPresentation(element.format);
                    const formats = displayFormats(element.format);
                    return (
                      <div
                        key={element.id}
                        draggable={!readOnly}
                        onDragStart={(e) => handleDragStart(e, element, sectionIndex)}
                        className={cn(
                          'absolute border rounded px-2 py-1 text-xs cursor-pointer',
                          isSelected
                            ? 'border-primary ring-1 ring-primary/30 bg-primary/5'
                            : 'border-dashed border-gray-400 hover:border-primary/50',
                        )}
                        style={{
                          left: element.position.x,
                          top: (typeof element.position.y === 'number' ? element.position.y : 0) + 24,
                          width: element.position.width,
                          height: element.position.height,
                        }}
                        onClick={(e) => multiSelect.toggle(element.id, e.shiftKey)}
                      >
                        <div
                          className={cn('flex h-full w-full gap-1 text-muted-foreground', presentation.className)}
                          style={presentation.style}
                          data-testid={`report-element-content-${element.id}`}
                        >
                          {element.type === 'text' && (element.properties.text as string ?? LABELS.elementText)}
                          {element.type === 'image' && LABELS.elementImage}
                          {element.type === 'chart' && LABELS.elementChart}
                          {element.type === 'table' && LABELS.elementTable}
                          {(element.type === 'field' || element.dataBinding) && (
                            <span data-testid={`report-element-binding-${element.id}`}>
                              {`{${element.dataBinding ?? 'field'}}`}
                            </span>
                          )}
                          {formats && (
                            <span className="opacity-70" data-testid={`report-element-format-${element.id}`}>
                              {formats}
                            </span>
                          )}
                        </div>
                        {!readOnly && isSelected && (
                          <button type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteElement(element.id);
                            }}
                            className="absolute -top-2 -right-2 p-0.5 rounded-full bg-destructive text-destructive-foreground shadow"
                            aria-label={LABELS.deleteElement}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Property Panel */}
      {showPropertyPanel && (
        <div
          role="region"
          aria-label={LABELS.propertiesPanel}
          className={cn(
            'border-l bg-muted/30 flex flex-col transition-[width] duration-200',
            propertyPanelOpen ? 'w-56' : 'w-0 overflow-hidden',
          )}
        >
          {propertyPanelOpen && (
            selectedId && selectedElementData ? (
              <PropertyEditor
                title={`${LABELS.properties} – ${selectedElementData.type}`}
                fields={propertyFields}
                onChange={handleUpdateProperty}
              />
            ) : (
              <>
                <div className="p-3 border-b font-medium text-sm">{LABELS.properties}</div>
                <div className="flex-1 overflow-y-auto p-3">
                  <div className="text-xs text-muted-foreground text-center py-4">
                    {LABELS.selectElementPrompt}
                  </div>
                </div>
              </>
            )
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={confirmDialog.onCancel}
      />
    </div>
  );
}
