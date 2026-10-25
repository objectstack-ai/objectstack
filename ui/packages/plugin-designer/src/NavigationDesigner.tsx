/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * NavigationDesigner Component
 *
 * Drag-and-drop tree builder for NavigationItem[] with support for
 * recursive groups, quick add buttons, type badges, and live preview.
 * Aligned with @objectstack/spec NavigationItem schema.
 *
 * A row's and a preview entry's text is the runtime's own
 * `resolveNavItemLabel` (`@object-ui/layout`, objectui#11196), so an entry
 * with NO `label` shows the text it inherits, never a blank. The spec's rule:
 * absent ⇒ the CURRENT label of what the entry opens. This designer is handed
 * bare items and no metadata, so it names a target by the rule's machine-name
 * rung (`pageName`, `dashboardName`, `objectName`, …, else the entry's `id`),
 * as the console's renderer does for a host that supplies no target resolver.
 * The inline rename edits the AUTHORED label; the inherited text is its
 * placeholder, never its value.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { KeyedI18nLabel, NavigationItem, NavigationItemType } from '@object-ui/types';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  GripVertical,
  LayoutDashboard,
  Link,
  Minus,
  FileText,
  BarChart3,
  MousePointerClick,
  Pencil,
  Plus,
  Puzzle,
  Trash2,
  Upload,
  Database,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { resolveKeyedI18nLabel } from '@object-ui/react';
import { resolveNavItemLabel } from '@object-ui/layout';
import { useDesignerTranslation } from './hooks/useDesignerTranslation';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Types
// ============================================================================

export interface NavigationDesignerProps {
  /** Navigation items to edit */
  items: NavigationItem[];
  /** Callback when items change */
  onChange: (items: NavigationItem[]) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** Show live preview sidebar */
  showPreview?: boolean;
  /** CSS class */
  className?: string;
  /** Callback to export navigation schema */
  onExport?: (items: NavigationItem[]) => void;
  /** Callback to import navigation schema */
  onImport?: (items: NavigationItem[]) => void;
}

// ============================================================================
// Constants
// ============================================================================

let ndCounter = 0;

function createId(prefix: string): string {
  ndCounter += 1;
  return `${prefix}_${Date.now()}_${ndCounter}`;
}

/**
 * A new navigation item of `type`. A separator carries only `type` and `id`:
 * the spec's separator branch declares no `label`, and the save door refuses
 * one (objectui#10867). Every other type gets the label `labelFor` names.
 */
function newNavItem(
  type: NavigationItemType,
  id: string,
  labelFor: (type: Exclude<NavigationItemType, 'separator'>) => string,
): NavigationItem {
  if (type === 'separator') return { id, type };
  return {
    id,
    type,
    label: labelFor(type),
    ...(type === 'group' ? { children: [] } : {}),
    ...(type === 'url' ? { url: '' } : {}),
  };
}

// Keyed by the spec-derived union, so a nav type the spec adds stops this file
// compiling until it has an entry -- keep it a `Record`, never `Partial` or
// `Record<string, ...>`. (The `| 'doc'` that bridged the pin lag behind
// objectstack#19789 came off at the 17.5.0 pin, which ships `doc` — objectui#11197.)
const NAV_TYPE_META: Record<NavigationItemType, { labelKey: string; color: string; Icon: React.FC<{ className?: string }> }> = {
  object: { labelKey: 'appDesigner.navTypeObject', color: 'bg-green-100 text-green-700', Icon: Database },
  dashboard: { labelKey: 'appDesigner.navTypeDashboard', color: 'bg-amber-100 text-amber-700', Icon: LayoutDashboard },
  page: { labelKey: 'appDesigner.navTypePage', color: 'bg-teal-100 text-teal-700', Icon: FileText },
  report: { labelKey: 'appDesigner.navTypeReport', color: 'bg-rose-100 text-rose-700', Icon: BarChart3 },
  url: { labelKey: 'appDesigner.navTypeUrl', color: 'bg-sky-100 text-sky-700', Icon: Link },
  component: { labelKey: 'appDesigner.navTypeComponent', color: 'bg-indigo-100 text-indigo-700', Icon: Puzzle },
  group: { labelKey: 'appDesigner.navTypeGroup', color: 'bg-purple-100 text-purple-700', Icon: FolderOpen },
  separator: { labelKey: 'appDesigner.navTypeSeparator', color: 'bg-gray-100 text-gray-600', Icon: Minus },
  action: { labelKey: 'appDesigner.navTypeAction', color: 'bg-orange-100 text-orange-700', Icon: MousePointerClick },
  doc: { labelKey: 'appDesigner.navTypeDoc', color: 'bg-blue-100 text-blue-700', Icon: BookOpen },
};

const QUICK_ADD_TYPES: Array<{ type: NavigationItemType; labelKey: string }> = [
  { type: 'object', labelKey: 'appDesigner.navObjectPage' },
  { type: 'dashboard', labelKey: 'appDesigner.navDashboard' },
  { type: 'page', labelKey: 'appDesigner.navPage' },
  { type: 'report', labelKey: 'appDesigner.navReport' },
  { type: 'group', labelKey: 'appDesigner.navGroup' },
  { type: 'url', labelKey: 'appDesigner.navUrl' },
  { type: 'separator', labelKey: 'appDesigner.navSeparator' },
];

// ============================================================================
// Navigation Item Row (recursive)
// ============================================================================

/**
 * The text the inline rename starts from: the AUTHORED label when it is a
 * string, or objectui's keyed reference read as `resolveKeyedI18nLabel` reads
 * it. A label written as an inline locale map (`{ en, 'zh-CN' }`) is not one
 * string, so the draft starts empty — exactly what the keyed read answered for
 * a map (it carries no `defaultValue` / `key`). objectui#11299 typed the label
 * as the spec's `I18nLabel`, which is what made the map case visible here; the
 * behaviour is unchanged.
 */
function labelDraftOf(label: unknown): string {
  if (typeof label === 'string') return label;
  if (typeof label === 'object' && label !== null && ('key' in label || 'defaultValue' in label)) {
    return resolveKeyedI18nLabel(label as KeyedI18nLabel) ?? '';
  }
  return '';
}

interface NavItemRowProps {
  item: NavigationItem;
  depth: number;
  index: number;
  total: number;
  readOnly: boolean;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onUpdateIcon: (id: string, icon: string) => void;
  onToggleVisible: (id: string) => void;
  onAddChild: (parentId: string, type: NavigationItemType) => void;
  expandedIds: Set<string>;
  t: (key: string) => string;
}

function NavItemRow({
  item,
  depth,
  index,
  total,
  readOnly,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleExpand,
  onUpdateLabel,
  onUpdateIcon,
  onToggleVisible,
  onAddChild,
  expandedIds,
  t,
}: NavItemRowProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(labelDraftOf(item.label));
  const [editingIcon, setEditingIcon] = useState(false);
  const [iconDraft, setIconDraft] = useState(item.icon || '');
  const meta = NAV_TYPE_META[item.type];
  const hasChildren = item.type === 'group' && item.children && item.children.length > 0;
  const isExpanded = expandedIds.has(item.id);
  const isHidden = item.visible === false;

  const handleLabelCommit = () => {
    if (labelDraft.trim()) {
      onUpdateLabel(item.id, labelDraft.trim());
    } else {
      setLabelDraft(labelDraftOf(item.label));
    }
    setEditingLabel(false);
  };

  const handleIconCommit = () => {
    onUpdateIcon(item.id, iconDraft.trim());
    setEditingIcon(false);
  };

  return (
    <>
      <li
        data-testid={`nav-designer-item-${item.id}`}
        className={cn(
          'flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 transition-colors hover:bg-gray-50',
          isHidden && 'opacity-50',
        )}
        style={{ marginLeft: depth * 20 }}
      >
        {/* Drag handle */}
        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-gray-300" />

        {/* Expand/collapse for groups */}
        {item.type === 'group' ? (
          <button
            type="button"
            onClick={() => onToggleExpand(item.id)}
            className="rounded p-0.5 text-gray-400 hover:text-gray-600"
            aria-label={isExpanded ? t('appDesigner.navCollapseGroup') : t('appDesigner.navExpandGroup')}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Icon + edit */}
        {editingIcon && !readOnly ? (
          <input
            type="text"
            value={iconDraft}
            onChange={(e) => setIconDraft(e.target.value)}
            onBlur={handleIconCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleIconCommit();
              if (e.key === 'Escape') {
                setIconDraft(item.icon || '');
                setEditingIcon(false);
              }
            }}
            autoFocus
            placeholder={t('appDesigner.navIconPlaceholder')}
            data-testid={`nav-designer-icon-input-${item.id}`}
            className="w-24 rounded border border-blue-300 px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <span className="flex items-center gap-0.5">
            <meta.Icon className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            {!readOnly && item.type !== 'separator' && (
              <button
                type="button"
                onClick={() => {
                  setIconDraft(item.icon || '');
                  setEditingIcon(true);
                }}
                className="rounded p-0.5 text-gray-300 hover:text-blue-500"
                aria-label={t('appDesigner.navEditIcon')}
                data-testid={`nav-designer-edit-icon-${item.id}`}
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        )}

        {/* Label */}
        {item.type === 'separator' ? (
          <span className="flex-1 text-xs italic text-gray-400">{t('appDesigner.separatorLabel')}</span>
        ) : editingLabel && !readOnly ? (
          <input
            type="text"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={handleLabelCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelCommit();
              if (e.key === 'Escape') {
                setLabelDraft(labelDraftOf(item.label));
                setEditingLabel(false);
              }
            }}
            autoFocus
            placeholder={resolveNavItemLabel(item)}
            data-testid={`nav-designer-label-input-${item.id}`}
            className="flex-1 rounded border border-blue-300 px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
          />
        ) : (
          <span
            className={cn(
              'flex-1 truncate text-sm text-gray-800',
              !readOnly && 'cursor-text'
            )}
            onDoubleClick={() => {
              if (!readOnly) {
                setLabelDraft(labelDraftOf(item.label));
                setEditingLabel(true);
              }
            }}
          >
            {resolveNavItemLabel(item)}
          </span>
        )}

        {/* Type badge */}
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium',
            meta.color
          )}
        >
          {t(meta.labelKey)}
        </span>

        {/* Hidden badge */}
        {isHidden && (
          <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" data-testid={`nav-designer-hidden-badge-${item.id}`}>
            {t('appDesigner.navHidden')}
          </span>
        )}

        {/* Visibility toggle */}
        {!readOnly && item.type !== 'separator' && (
          <button
            type="button"
            onClick={() => onToggleVisible(item.id)}
            className="rounded p-0.5 text-gray-400 hover:text-gray-700"
            aria-label={t('appDesigner.navToggleVisible')}
            data-testid={`nav-designer-toggle-visible-${item.id}`}
          >
            {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}

        {/* Add child (groups only) */}
        {item.type === 'group' && !readOnly && (
          <button
            type="button"
            onClick={() => onAddChild(item.id, 'page')}
            className="rounded p-0.5 text-gray-400 hover:text-blue-500"
            aria-label={t('appDesigner.navAddChild')}
            data-testid={`nav-designer-add-child-${item.id}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Reorder */}
        <button
          type="button"
          onClick={() => onMoveUp(item.id)}
          disabled={readOnly || index === 0}
          className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          aria-label={t('appDesigner.navMoveUp')}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(item.id)}
          disabled={readOnly || index === total - 1}
          className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
          aria-label={t('appDesigner.navMoveDown')}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>

        {/* Remove */}
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={readOnly}
          className="rounded p-0.5 text-gray-400 hover:text-red-500 disabled:opacity-30"
          aria-label={t('appDesigner.navRemove')}
          data-testid={`nav-designer-remove-${item.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </li>

      {/* Render children recursively */}
      {item.type === 'group' && isExpanded && item.children && (
        <>
          {item.children.map((child, ci) => (
            <NavItemRow
              key={child.id}
              item={child}
              depth={depth + 1}
              index={ci}
              total={item.children!.length}
              readOnly={readOnly}
              onRemove={onRemove}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onToggleExpand={onToggleExpand}
              onUpdateLabel={onUpdateLabel}
              onUpdateIcon={onUpdateIcon}
              onToggleVisible={onToggleVisible}
              onAddChild={onAddChild}
              expandedIds={expandedIds}
              t={t}
            />
          ))}
        </>
      )}
    </>
  );
}

// ============================================================================
// Navigation Preview
// ============================================================================

function NavigationPreview({ items, t }: { items: NavigationItem[]; t: (key: string) => string }) {
  return (
    <div
      data-testid="nav-designer-preview"
      className="w-56 shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3"
    >
      <h4 className="mb-2 text-xs font-semibold uppercase text-gray-500">{t('appDesigner.navLivePreview')}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{t('appDesigner.navNoPreviewItems')}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <PreviewItem key={item.id} item={item} depth={0} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PreviewItem({ item, depth }: { item: NavigationItem; depth: number }) {
  const meta = NAV_TYPE_META[item.type];

  if (item.type === 'separator') {
    return <li className="my-1 border-t border-gray-200" style={{ marginLeft: depth * 12 }} />;
  }

  return (
    <>
      <li
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
        style={{ marginLeft: depth * 12 }}
      >
        <meta.Icon className="h-3 w-3 text-gray-400" />
        <span className="truncate">{resolveNavItemLabel(item)}</span>
      </li>
      {item.type === 'group' && item.children?.map((child) => (
        <PreviewItem key={child.id} item={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function NavigationDesigner({
  items,
  onChange,
  readOnly = false,
  showPreview = true,
  className,
  onExport,
  onImport,
}: NavigationDesignerProps) {
  const { t } = useDesignerTranslation();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.type === 'group').map((i) => i.id))
  );

  // ---- Helpers for deep tree operations ----
  const removeItem = useCallback(
    (id: string) => {
      function filterDeep(list: NavigationItem[]): NavigationItem[] {
        return list
          .filter((item) => item.id !== id)
          .map((item) =>
            item.children
              ? { ...item, children: filterDeep(item.children) }
              : item
          );
      }
      onChange(filterDeep(items));
    },
    [items, onChange]
  );

  const moveItem = useCallback(
    (id: string, direction: 'up' | 'down') => {
      function reorder(list: NavigationItem[]): NavigationItem[] {
        const idx = list.findIndex((item) => item.id === id);
        if (idx >= 0) {
          const target = direction === 'up' ? idx - 1 : idx + 1;
          if (target >= 0 && target < list.length) {
            const copy = [...list];
            [copy[idx], copy[target]] = [copy[target], copy[idx]];
            return copy;
          }
          return list;
        }
        return list.map((item) =>
          item.children
            ? { ...item, children: reorder(item.children) }
            : item
        );
      }
      onChange(reorder(items));
    },
    [items, onChange]
  );

  const updateLabel = useCallback(
    (id: string, label: string) => {
      function update(list: NavigationItem[]): NavigationItem[] {
        return list.map((item) => {
          // A separator carries no label, icon or visibility (objectui#10867).
          if (item.id === id && item.type !== 'separator') return { ...item, label };
          if (item.children) return { ...item, children: update(item.children) };
          return item;
        });
      }
      onChange(update(items));
    },
    [items, onChange]
  );

  const updateIcon = useCallback(
    (id: string, icon: string) => {
      function update(list: NavigationItem[]): NavigationItem[] {
        return list.map((item) => {
          if (item.id === id && item.type !== 'separator') return { ...item, icon: icon || undefined };
          if (item.children) return { ...item, children: update(item.children) };
          return item;
        });
      }
      onChange(update(items));
    },
    [items, onChange]
  );

  const toggleVisible = useCallback(
    (id: string) => {
      function update(list: NavigationItem[]): NavigationItem[] {
        return list.map((item) => {
          if (item.id === id && item.type !== 'separator') {
            return { ...item, visible: item.visible === false ? true : false };
          }
          if (item.children) return { ...item, children: update(item.children) };
          return item;
        });
      }
      onChange(update(items));
    },
    [items, onChange]
  );

  const addChild = useCallback(
    (parentId: string, type: NavigationItemType) => {
      const newItem = newNavItem(type, createId(type), (entryType) => `New ${t(NAV_TYPE_META[entryType].labelKey)}`);

      function insertChild(list: NavigationItem[]): NavigationItem[] {
        return list.map((item) => {
          if (item.id === parentId && item.type === 'group') {
            return { ...item, children: [...(item.children || []), newItem] };
          }
          if (item.children) {
            return { ...item, children: insertChild(item.children) };
          }
          return item;
        });
      }
      onChange(insertChild(items));
      setExpandedIds((prev) => new Set(prev).add(parentId));
    },
    [items, onChange]
  );

  const addTopLevel = useCallback(
    (type: NavigationItemType) => {
      const newItem = newNavItem(type, createId(type), (entryType) => `New ${t(NAV_TYPE_META[entryType].labelKey)}`);
      onChange([...items, newItem]);
    },
    [items, onChange, t]
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(items);
    } else {
      const json = JSON.stringify(items, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'navigation-schema.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [items, onExport]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string);
          if (Array.isArray(parsed)) {
            if (onImport) {
              onImport(parsed);
            } else {
              onChange(parsed);
            }
          }
        } catch {
          // invalid JSON — silently ignore
        }
      };
      reader.readAsText(file);
      // Reset so the same file can be re-imported
      if (importInputRef.current) importInputRef.current.value = '';
    },
    [onChange, onImport]
  );

  return (
    <div
      data-testid="navigation-designer"
      className={cn('flex flex-col gap-4 sm:flex-row', className)}
    >
      {/* Editor */}
      <div className="flex-1 space-y-3">
        {/* Toolbar: quick add + export/import */}
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_ADD_TYPES.map(({ type, labelKey }) => {
            const { Icon, color } = NAV_TYPE_META[type];
            return (
              <button
                key={type}
                type="button"
                data-testid={`nav-designer-add-${type}`}
                onClick={() => addTopLevel(type)}
                disabled={readOnly}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50'
                )}
              >
                <Plus className="h-3 w-3" />
                {t(labelKey)}
              </button>
            );
          })}

          <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />

          {/* Export */}
          <button
            type="button"
            data-testid="nav-designer-export"
            onClick={handleExport}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50"
          >
            <Download className="h-3 w-3" />
            {t('appDesigner.navExportSchema')}
          </button>

          {/* Import */}
          <label
            data-testid="nav-designer-import"
            className={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-gray-50',
              readOnly && 'cursor-not-allowed opacity-50'
            )}
          >
            <Upload className="h-3 w-3" />
            {t('appDesigner.navImportSchema')}
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
              disabled={readOnly}
              data-testid="nav-designer-import-input"
            />
          </label>
        </div>

        {/* Item tree */}
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            {t('appDesigner.navNoItems')}
          </div>
        ) : (
          <ul className="space-y-1" data-testid="nav-designer-tree">
            {items.map((item, idx) => (
              <NavItemRow
                key={item.id}
                item={item}
                depth={0}
                index={idx}
                total={items.length}
                readOnly={readOnly}
                onRemove={removeItem}
                onMoveUp={(id) => moveItem(id, 'up')}
                onMoveDown={(id) => moveItem(id, 'down')}
                onToggleExpand={toggleExpand}
                onUpdateLabel={updateLabel}
                onUpdateIcon={updateIcon}
                onToggleVisible={toggleVisible}
                onAddChild={addChild}
                expandedIds={expandedIds}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Preview */}
      {showPreview && <NavigationPreview items={items} t={t} />}
    </div>
  );
}

export default NavigationDesigner;
