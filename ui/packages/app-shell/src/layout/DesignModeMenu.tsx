// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's menu while the design mode is on (objectstack#36363): the
 * sidebar draws this in place of the menu, with the edits the card asks for
 * and nothing else.
 *
 * - Under each group, and under the top level, a row 「Add menu item」. It
 *   first puts a dashed row 「Choose a menu item…」 where the entry will go,
 *   then opens the picker: a search box over the kinds of existing thing an
 *   entry opens (objects, views, dashboards, reports, pages, a link); a kind
 *   lists those that exist and are not in the menu yet, and the one picked
 *   takes the dashed row's place.
 * - On each entry, on hover or focus, a 「⋮」 menu: move up, move down, move
 *   to a group, add an item before or after it, rename and icon, remove from
 *   the menu. Removing takes the entry off the menu only; what it opened is
 *   kept, and the picker offers it again.
 * - An entry can be dragged to another place, in its group or another one.
 *
 * A name is changed only in the app's source language (objectstack#36363,
 * ruling (4)): the stored labels are the app's own, and a translation is
 * written elsewhere. The rename's name field is open when the session
 * language is the deployment's default (`GET /i18n/locales`, the server
 * stating no source language of its own yet, objectstack#36504) and the
 * entry's shown label is its stored one; else it is closed and says why.
 * The icon, adding and moving are open in every language.
 *
 * An entry another package puts into the menu (its manifest's
 * `navigationContributions`, appended when the app is served) is not in the
 * app's stored menu, so it is not moved, renamed or removed here: its
 * 「⋮」 says it is changed in that package, and it is not dragged. Adding an
 * item before or after it stays open; no other entry is moved past it (a
 * move up, a move down or a drop onto it), since its place is that package's.
 *
 * In the picker's 「Dashboards」, the first row is 「New dashboard…」
 * (objectstack#36364): it asks for a name, and on 「Create」 the dashboard is
 * created, empty, where the menu is saved, its entry takes the dashed row's
 * place, and the mode saves at once, every other staged change with it
 * (`saveAppMenuWithNewItem`); then the mode is left and the new dashboard
 * opens for editing (`dashboardEditArrival`). 「Cancel」 writes nothing.
 *
 * Every edit is staged with the mode (`useDesignModeChange`), under one key
 * for the app's menu: the mode's 「Save」 writes it (`saveAppMenu`), its
 * 「Cancel」 drops it. The menu drawn is the staged one, so it survives a page
 * change. Groups are not added, removed or renamed here, and nothing about
 * who sees an entry is changed: both stay in Studio.
 *
 * Loaded only while the mode is on (`UnifiedSidebar` lazy-loads it): it
 * brings the metadata client and the package doors the menu's write needs.
 *
 * @module
 */

import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Link2,
  MoreVertical,
  Plus,
  Search,
  Table2,
  BarChart3,
  Database,
} from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
  Label,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  cn,
} from '@object-ui/components';
import {
  resolveHref,
  resolveNavItemIcon,
  resolveNavItemLabel,
  resolveNavKindIcon,
  type NavTargetIconResolver,
  type NavTargetLabelResolver,
} from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { getIcon } from '../utils/getIcon.js';
import { useMetadataClient } from '../views/metadata-admin/useMetadata.js';
import {
  fetchListedPackageManifests,
  listedCustomizationPairOf,
} from '../views/studio-design/packages-io.js';
import { useDesignModeChange } from './designMode.js';
import {
  MENU_TARGET_KINDS,
  canMoveBy,
  entryFor,
  entryOf,
  groupsOf,
  insertEntry,
  isGroup,
  menuTargets,
  moveBy,
  moveEntry,
  newEntryId,
  patchEntry,
  placeOf,
  removeEntry,
  siblingsAt,
  storedEntriesById,
  targetKeyFor,
  withEntryIds,
  type Menu,
  type MenuEntry,
  type MenuTargetKind,
} from './designModeMenu.js';
import {
  consoleAppMenuDoors,
  fetchDefaultLocale,
  isSameLanguage,
  readStoredMenu,
  saveAppMenu,
} from './designModeMenuSave.js';
import { freeItemName, isNewMenuItemKind, saveAppMenuWithNewItem, type NewMenuItemKind } from './designModeMenuCreate.js';
import { dashboardEditArrival } from './designModeArrival.js';

/**
 * The group label's icon-mode hiding, as the sidebar's own labels declare it
 * (objectui#12795): invisible, so it leaves focus and the accessibility tree
 * when the rail collapses to icons.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';

/** The key the app's menu is staged under. */
const APP_MENU_CHANGE_KEY = 'app-menu';

/** Where the next picked entry goes. */
interface AddAt {
  readonly parentId: string | null;
  readonly index: number;
}

/** The drop zone at the end of a group (`null`: the top level). */
const endZoneId = (parentId: string | null) => `design-menu-end:${parentId ?? ''}`;
const parentOfEndZone = (id: string): string | null | undefined => {
  if (!id.startsWith('design-menu-end:')) return undefined;
  const rest = id.slice('design-menu-end:'.length);
  return rest === '' ? null : rest;
};

export interface DesignModeMenuProps {
  /** The app on screen: its name, its served `navigation` and its package. */
  readonly app: { readonly name: string; readonly navigation?: unknown; readonly _packageId?: unknown };
  readonly basePath: string;
  readonly resolveTargetLabel?: NavTargetLabelResolver;
  readonly resolveTargetIcon?: NavTargetIconResolver;
}

export default function DesignModeMenu({ app, basePath, resolveTargetLabel, resolveTargetIcon }: DesignModeMenuProps) {
  const { t, language } = useObjectTranslation();
  const change = useDesignModeChange<Menu>(APP_MENU_CHANGE_KEY);
  const client = useMetadataClient();
  const packageId = typeof app._packageId === 'string' ? app._packageId : '';
  const served = React.useMemo(
    () => withEntryIds(Array.isArray(app.navigation) ? (app.navigation as Menu) : []),
    [app.navigation],
  );
  const menu = change.value ?? served;

  const texts = React.useMemo(
    () => ({
      notListed: t('designMode.menu.notListed', {
        defaultValue: "This app's package is not listed, so its menu cannot be saved.",
      }),
      pendingDraft: t('designMode.menu.pendingDraft', {
        defaultValue: 'This app has unpublished changes in Studio. Publish or discard them there, then save again.',
      }),
      noVersion: t('designMode.menu.noVersion', {
        defaultValue: "This app's package states no version, so its menu cannot be customized.",
      }),
      notWritable: t('designMode.menu.notWritable', {
        defaultValue: "This app's customization package cannot be written, so its menu cannot be saved.",
      }),
    }),
    [t],
  );
  const appName = app.name;
  const commit = React.useCallback(
    (navigation: Menu) =>
      saveAppMenu({ appName, packageId, served, navigation }, texts, consoleAppMenuDoors(client as never)),
    [appName, packageId, served, texts, client],
  );
  const stage = change.stage;
  const update = React.useCallback((next: Menu) => stage(next, commit), [stage, commit]);

  const [addAt, setAddAt] = React.useState<AddAt | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);

  // The stored menu and the deployment's default language, for the rename's
  // source-language rule; both `undefined` while read.
  const [storedMenu, setStoredMenu] = React.useState<Menu | null | undefined>(undefined);
  const [defaultLocale, setDefaultLocale] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    void readStoredMenu(appName, packageId, client as never).then((nav) => !cancelled && setStoredMenu(nav));
    void fetchDefaultLocale().then((code) => !cancelled && setDefaultLocale(code));
    return () => {
      cancelled = true;
    };
  }, [appName, packageId, client]);
  const storedById = React.useMemo(
    () => (storedMenu ? storedEntriesById(served, storedMenu) : null),
    [served, storedMenu],
  );
  /** Whether the entry `id` is another package's (served, and not in the stored menu). */
  const contributed = (id: string): boolean => !!storedById && !storedById.has(id) && !!entryOf(served, id);
  /** Whether the entry beside `id`, `by` places away in its group, is another package's. */
  const besideContributed = (id: string, by: -1 | 1): boolean => {
    const place = placeOf(menu, id);
    const beside = place ? (siblingsAt(menu, place.parentId) ?? [])[place.index + by] : undefined;
    return typeof beside?.id === 'string' && contributed(beside.id);
  };
  /**
   * Where the group `parentId` of `list` ends for the app's own entries: before
   * the run of other packages' entries that closes it (its length when none).
   * Contributions are appended to a group when the app is served, so an own
   * entry put at or past that run is stored, and served, before it; the editor
   * puts it there too, so it shows where everyone will see it.
   */
  const ownEndOf = (list: Menu, parentId: string | null): number => {
    const siblings = siblingsAt(list, parentId) ?? [];
    let end = siblings.length;
    while (end > 0 && typeof siblings[end - 1]?.id === 'string' && contributed(String(siblings[end - 1].id))) end -= 1;
    return end;
  };
  /** The entry `id` moved to the own end of the group `parentId`. */
  const moveToOwnEnd = (id: string, parentId: string | null): Menu =>
    moveEntry(menu, id, parentId, ownEndOf(removeEntry(menu, id), parentId));

  const labelOf = React.useCallback(
    (entry: MenuEntry) =>
      resolveNavItemLabel(entry as unknown as NavigationItem, t as never, resolveTargetLabel, language) ||
      String(entry.id ?? ''),
    [t, resolveTargetLabel, language],
  );
  const groups = React.useMemo(() => groupsOf(menu), [menu]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const leafIds = React.useMemo(() => {
    const out: string[] = [];
    const walk = (entries: Menu) => {
      for (const entry of entries) {
        if (isGroup(entry)) walk((entry.children as Menu) ?? []);
        else if (entry.type !== 'separator' && typeof entry.id === 'string') out.push(entry.id);
      }
    };
    walk(menu);
    return out;
  }, [menu]);

  // The click that ends a pointer drag lands on the dragged entry's link when
  // the drop moved nothing (a drop refused on another package's entry, say):
  // it is not a click, so it opens nothing. dnd-kit stops that click's
  // propagation in the document's capture phase but leaves its default (a full
  // navigation), so the default is cancelled before it, on the window.
  const lastDragEnd = React.useRef(0);
  const dragging = React.useRef(false);
  const onDragStart = () => {
    dragging.current = true;
  };
  const endDrag = () => {
    dragging.current = false;
    lastDragEnd.current = Date.now();
  };
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const justDragged = dragging.current || Date.now() - lastDragEnd.current < 300;
      if (justDragged && event.target instanceof Element && event.target.closest('[data-design-menu-link]')) event.preventDefault();
    };
    // The drag's end is stamped from the pointer itself too: dnd-kit reports a
    // drag's end only after its start has rendered, so a flick released before
    // that would leave the flag set and every link of the editor shut. A new
    // press starts over.
    const onPress = () => {
      dragging.current = false;
    };
    const onRelease = () => {
      if (!dragging.current) return;
      dragging.current = false;
      lastDragEnd.current = Date.now();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('pointercancel', onRelease, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('pointercancel', onRelease, true);
    };
  }, []);

  const onDragEnd = (event: DragEndEvent) => {
    endDrag();
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === id) return;
    const endParent = parentOfEndZone(overId);
    if (endParent !== undefined) {
      update(moveToOwnEnd(id, endParent));
      return;
    }
    const from = placeOf(menu, id);
    const to = placeOf(menu, overId);
    if (!from || !to || contributed(overId)) return;
    // `to.index` read after the entry leaves: below its old place in the same
    // group it lands after the entry dropped on, elsewhere before it.
    update(moveEntry(menu, id, to.parentId, to.index));
  };

  const startAdd = (at: AddAt) => {
    setAddAt({ parentId: at.parentId, index: Math.min(at.index, ownEndOf(menu, at.parentId)) });
  };
  const pick = (entry: MenuEntry) => {
    if (!addAt) return;
    update(insertEntry(menu, addAt.parentId, addAt.index, entry));
    setAddAt(null);
  };

  // objectstack#36364 — a new dashboard, in the held place: created, put in
  // the menu and saved with every other staged change in one act, then opened
  // for editing. Resolves `false` when nothing was saved (the mode has said
  // why); the held place and the picker stay, for another try or a cancel.
  const navigate = useNavigate();
  const saveWith = change.saveWith;
  const createItem = async (kind: NewMenuItemKind, label: string, taken: readonly string[]): Promise<boolean> => {
    if (!addAt) return false;
    let name: string;
    try {
      name = await freeItemName(kind, label, taken, client as never);
    } catch (err) {
      toast.error(
        t('designMode.saveFailed', {
          defaultValue: 'Some changes were not saved: {{reason}}',
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return false;
    }
    const entry = entryFor(kind, name, newEntryId([...menu, ...(storedMenu ?? [])]));
    const item = { kind, name, label };
    const itemTexts = {
      ...texts,
      itemPendingDraft: t('designMode.menu.newItemPendingDraft', {
        defaultValue: 'A draft with this name is already pending. Try again.',
      }),
      itemLeft: t('designMode.menu.newItemLeft', {
        defaultValue: 'The new dashboard "{{name}}" could not be removed again; remove it in Studio.',
        name: label,
      }),
    };
    const saved = await saveWith(insertEntry(menu, addAt.parentId, addAt.index, entry), (navigation) =>
      saveAppMenuWithNewItem(
        { appName, packageId, served, navigation, item },
        itemTexts,
        consoleAppMenuDoors(client as never),
      ),
    );
    if (!saved) return false;
    setAddAt(null);
    navigate(resolveHref(entry as unknown as NavigationItem, basePath).href, { state: dashboardEditArrival(name) });
    return true;
  };

  const renderLeaf = (entry: MenuEntry, depth: number) => {
    const id = String(entry.id);
    const place = placeOf(menu, id);
    return (
      <MenuLeaf
        key={id}
        id={id}
        depth={depth}
        entry={entry}
        label={labelOf(entry)}
        basePath={basePath}
        resolveTargetIcon={resolveTargetIcon}
        fixed={contributed(id)}
        actions={
          <EntryActions
            label={labelOf(entry)}
            fixed={contributed(id)}
            canUp={canMoveBy(menu, id, -1) && !besideContributed(id, -1)}
            canDown={canMoveBy(menu, id, 1) && !besideContributed(id, 1)}
            groups={groups
              .filter((g) => g.id !== place?.parentId)
              .map((g) => ({ id: g.id, label: labelOf(g.entry), depth: g.depth }))}
            atTopLevel={place?.parentId === null}
            onUp={() => update(moveBy(menu, id, -1))}
            onDown={() => update(moveBy(menu, id, 1))}
            onMoveTo={(groupId) => update(moveToOwnEnd(id, groupId))}
            onAddBefore={() => place && startAdd({ parentId: place.parentId, index: place.index })}
            onAddAfter={() => place && startAdd({ parentId: place.parentId, index: place.index + 1 })}
            onRename={() => setRenaming(id)}
            onRemove={() => update(removeEntry(menu, id))}
          />
        }
      />
    );
  };

  const renderEntries = (entries: Menu, parentId: string | null, depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    entries.forEach((entry, index) => {
      if (addAt && addAt.parentId === parentId && addAt.index === index) rows.push(<Placeholder key="placeholder" depth={depth} />);
      if (isGroup(entry)) {
        const gid = String(entry.id);
        rows.push(
          <li key={gid} className="list-none" data-testid={`design-menu-group-${gid}`}>
            <div
              className="flex h-7 items-center gap-1 px-2 text-xs font-medium text-sidebar-foreground/70"
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            >
              <ChevronRight className="h-3 w-3 rotate-90" aria-hidden="true" />
              <span className="truncate">{labelOf(entry)}</span>
            </div>
            <ul className="flex flex-col gap-0.5">{renderEntries((entry.children as Menu) ?? [], gid, depth + 1)}</ul>
          </li>,
        );
      } else if (entry.type === 'separator') {
        rows.push(<li key={String(entry.id)} role="separator" className="mx-2 my-1 list-none border-t border-sidebar-border" />);
      } else {
        rows.push(renderLeaf(entry, depth));
      }
    });
    if (addAt && addAt.parentId === parentId && addAt.index >= entries.length) rows.push(<Placeholder key="placeholder" depth={depth} />);
    rows.push(
      <AddRow
        key="add"
        parentId={parentId}
        depth={depth}
        label={t('designMode.menu.addItem', { defaultValue: 'Add menu item' })}
        onAdd={() => startAdd({ parentId, index: entries.length })}
      />,
    );
    return rows;
  };

  const renamed = renaming ? entryOf(menu, renaming) : null;
  /** Whether the entry `id`'s name may be changed here (ruling (4)). */
  const nameOpen = (id: string): boolean => {
    if (!defaultLocale || !isSameLanguage(language, defaultLocale)) return false;
    const shown = entryOf(served, id);
    if (!shown) return true; // added in this session: its name is the editor's own
    const stored = storedById?.get(id);
    return !!stored && labelOf(shown) === labelOf(stored);
  };

  return (
    <SidebarGroup data-testid="design-mode-menu">
      <SidebarGroupLabel className={HIDDEN_ICON_LABEL_NOT_FOCUSABLE}>{t('designMode.menu.title', { defaultValue: 'Menu' })}</SidebarGroupLabel>
      <SidebarGroupContent>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={endDrag}
        >
          <SortableContext items={leafIds} strategy={verticalListSortingStrategy}>
            <SidebarMenu>{renderEntries(menu, null, 0)}</SidebarMenu>
          </SortableContext>
        </DndContext>
      </SidebarGroupContent>
      {addAt && (
        <MenuItemPicker
          packageId={packageId}
          inMenu={menuTargets(menu)}
          onClose={() => setAddAt(null)}
          onPick={(kind, name, link) => pick(entryFor(kind, name, newEntryId([...menu, ...(storedMenu ?? [])]), link))}
          onCreate={createItem}
          language={language}
        />
      )}
      {renamed && (
        <RenameDialog
          label={labelOf(renamed)}
          icon={typeof renamed.icon === 'string' ? renamed.icon : ''}
          nameLocked={!nameOpen(String(renamed.id))}
          onClose={() => setRenaming(null)}
          onDone={(label, icon) => {
            // A name left as it was stays inherited (or as authored); a cleared one inherits again.
            const patch: Record<string, unknown> = { icon: icon || undefined };
            if (nameOpen(String(renamed.id)) && label !== labelOf(renamed)) patch.label = label || undefined;
            update(patchEntry(menu, String(renamed.id), patch));
            setRenaming(null);
          }}
        />
      )}
    </SidebarGroup>
  );
}

function indent(depth: number): React.CSSProperties | undefined {
  return depth > 0 ? { paddingLeft: `${depth * 0.75}rem` } : undefined;
}

function MenuLeaf({
  id,
  depth,
  entry,
  label,
  basePath,
  resolveTargetIcon,
  fixed,
  actions,
}: {
  id: string;
  depth: number;
  entry: MenuEntry;
  label: string;
  basePath: string;
  resolveTargetIcon?: NavTargetIconResolver;
  /** Another package's entry: not dragged. */
  fixed: boolean;
  actions: React.ReactNode;
}) {
  const sortable = useSortable({ id, disabled: fixed });
  const item = entry as unknown as NavigationItem;
  const iconName =
    item.type === 'object' && item.objectName
      ? resolveNavItemIcon(item, resolveTargetIcon)
      : resolveNavKindIcon(item) ?? resolveNavItemIcon(item);
  const icon = React.createElement(getIcon(iconName), { className: 'h-4 w-4' });
  const { href, external } = resolveHref(item, basePath);
  // The editor's drag is dnd-kit's alone: the browser's own drag of the link
  // is off too. `data-design-menu-link` marks the link whose post-drag click
  // the editor cancels.
  const link = {
    draggable: false,
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
    'data-design-menu-link': '',
    ...sortable.attributes,
    ...sortable.listeners,
  };
  return (
    <SidebarMenuItem
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, ...indent(depth) }}
      className={cn(sortable.isDragging && 'z-10 opacity-70')}
      data-testid={`design-menu-entry-${id}`}
    >
      <SidebarMenuButton asChild tooltip={label} className={fixed ? undefined : 'cursor-grab'}>
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer" {...link}>
            {icon}
            <span>{label}</span>
          </a>
        ) : (
          <Link to={href} {...link}>
            {icon}
            <span>{label}</span>
          </Link>
        )}
      </SidebarMenuButton>
      {actions}
    </SidebarMenuItem>
  );
}

function Placeholder({ depth }: { depth: number }) {
  const { t } = useObjectTranslation();
  return (
    <li className="list-none" style={indent(depth)} data-testid="design-menu-placeholder">
      <div className="mx-0.5 flex h-8 items-center rounded-md border border-dashed border-sidebar-border px-2 text-sm text-sidebar-foreground/60">
        {t('designMode.menu.placeholder', { defaultValue: 'Choose a menu item…' })}
      </div>
    </li>
  );
}

function AddRow({ parentId, depth, label, onAdd }: { parentId: string | null; depth: number; label: string; onAdd: () => void }) {
  const drop = useDroppable({ id: endZoneId(parentId) });
  return (
    <SidebarMenuItem ref={drop.setNodeRef} style={indent(depth)} className={cn(drop.isOver && 'rounded-md bg-sidebar-accent/50')}>
      <SidebarMenuButton
        type="button"
        onClick={onAdd}
        className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
        data-testid={`design-menu-add-${parentId ?? 'top'}`}
      >
        <Plus className="h-4 w-4" />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function EntryActions({
  label,
  fixed,
  canUp,
  canDown,
  groups,
  atTopLevel,
  onUp,
  onDown,
  onMoveTo,
  onAddBefore,
  onAddAfter,
  onRename,
  onRemove,
}: {
  label: string;
  /** Another package's entry: only adding beside it is open. */
  fixed: boolean;
  canUp: boolean;
  canDown: boolean;
  groups: Array<{ id: string; label: string; depth: number }>;
  atTopLevel: boolean;
  onUp: () => void;
  onDown: () => void;
  onMoveTo: (groupId: string | null) => void;
  onAddBefore: () => void;
  onAddAfter: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const { t } = useObjectTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          showOnHover
          aria-label={t('designMode.menu.actions', { defaultValue: 'Actions for {{name}}', name: label })}
          data-testid="design-menu-actions"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start">
        {fixed && (
          <>
            <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground" data-testid="design-menu-contributed">
              {t('designMode.menu.contributed', { defaultValue: 'Another package adds this item. It is moved, renamed or removed there.' })}
            </p>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={fixed || !canUp} onSelect={onUp}>
          {t('designMode.menu.moveUp', { defaultValue: 'Move up' })}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={fixed || !canDown} onSelect={onDown}>
          {t('designMode.menu.moveDown', { defaultValue: 'Move down' })}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={fixed || (groups.length === 0 && atTopLevel)}>
            {t('designMode.menu.moveToGroup', { defaultValue: 'Move to group' })}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {!atTopLevel && (
              <DropdownMenuItem onSelect={() => onMoveTo(null)}>
                {t('designMode.menu.topLevel', { defaultValue: 'Top level' })}
              </DropdownMenuItem>
            )}
            {groups.map((g) => (
              <DropdownMenuItem key={g.id} onSelect={() => onMoveTo(g.id)} style={indent(g.depth)}>
                {g.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddBefore}>
          {t('designMode.menu.addBefore', { defaultValue: 'Add an item before' })}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAddAfter}>
          {t('designMode.menu.addAfter', { defaultValue: 'Add an item after' })}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={fixed} onSelect={onRename}>
          {t('designMode.menu.rename', { defaultValue: 'Rename and icon' })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={fixed} onSelect={onRemove} className="text-destructive focus:text-destructive">
          {t('designMode.menu.remove', { defaultValue: 'Remove from menu' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The metadata type each picked kind lists (a link lists nothing). */
const KIND_METADATA: Record<Exclude<MenuTargetKind, 'url'>, string> = {
  object: 'object',
  view: 'view',
  dashboard: 'dashboard',
  report: 'report',
  page: 'page',
};

const KIND_ICON: Record<MenuTargetKind, React.ComponentType<{ className?: string }>> = {
  object: Database,
  view: Table2,
  dashboard: LayoutDashboard,
  report: BarChart3,
  page: FileText,
  url: Link2,
};

interface TargetRow {
  readonly kind: MenuTargetKind;
  readonly name: string;
  readonly label: string;
}

/**
 * The existing things of every kind, of the app's package and of its paired
 * customization package when there is one, by name. A failed read is an
 * empty list for that kind: the picker says there is nothing to add.
 */
function useTargetRows(packageId: string, language: string): { rows: TargetRow[]; loading: boolean } {
  const client = useMetadataClient();
  const [state, setState] = React.useState<{ rows: TargetRow[]; loading: boolean }>({ rows: [], loading: true });
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let packages = packageId ? [packageId] : [];
      try {
        const pair = packageId ? listedCustomizationPairOf(await fetchListedPackageManifests(), packageId) : null;
        if (pair) packages = [...packages, pair];
      } catch {
        /* the base's rows alone */
      }
      const rows: TargetRow[] = [];
      for (const kind of Object.keys(KIND_METADATA) as Array<Exclude<MenuTargetKind, 'url'>>) {
        const seen = new Set<string>();
        for (const pkg of packages) {
          let listed: Array<Record<string, unknown>>;
          try {
            listed = ((await client.list(KIND_METADATA[kind], { packageId: pkg })) ?? []) as Array<Record<string, unknown>>;
          } catch {
            listed = [];
          }
          for (const row of listed) {
            const name = typeof row?.name === 'string' ? row.name : '';
            if (!name || seen.has(name)) continue;
            // A record page needs a record to open: no menu entry can pass one.
            if (kind === 'page' && row.type === 'record') continue;
            seen.add(name);
            const label = resolveI18nLabel(row.label as never, language) || name;
            rows.push({ kind, name, label });
          }
        }
      }
      if (!cancelled) setState({ rows, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, packageId, language]);
  return state;
}

function MenuItemPicker({
  packageId,
  inMenu,
  onClose,
  onPick,
  onCreate,
  language,
}: {
  packageId: string;
  inMenu: ReadonlySet<string>;
  onClose: () => void;
  onPick: (kind: MenuTargetKind, name: string, link?: { label: string; url: string }) => void;
  /** Create a new `kind` named `label`; `taken` is every name of that kind the picker lists. */
  onCreate: (kind: NewMenuItemKind, label: string, taken: readonly string[]) => Promise<boolean>;
  language: string;
}) {
  const { t } = useObjectTranslation();
  const { rows, loading } = useTargetRows(packageId, language);
  const [kind, setKind] = React.useState<MenuTargetKind | null>(null);
  const [query, setQuery] = React.useState('');
  const [link, setLink] = React.useState({ label: '', url: '' });
  /** The kind being named for creation (objectstack#36364), `null` while picking. */
  const [naming, setNaming] = React.useState<NewMenuItemKind | null>(null);
  if (naming !== null) {
    return (
      <NewItemDialog
        kind={naming}
        onCancel={onClose}
        onCreate={(label) =>
          onCreate(naming, label, rows.filter((row) => row.kind === naming).map((row) => row.name))
        }
      />
    );
  }
  // Each key written whole, so the i18n call-site gate sees every one.
  const newTexts: Record<NewMenuItemKind, string> = {
    dashboard: t('designMode.menu.newDashboard', { defaultValue: 'New dashboard…' }),
  };
  // Each key written whole, so the i18n call-site gate sees every one.
  const kindTexts: Record<MenuTargetKind, string> = {
    object: t('designMode.menu.kind.object', { defaultValue: 'Objects' }),
    view: t('designMode.menu.kind.view', { defaultValue: 'Views' }),
    dashboard: t('designMode.menu.kind.dashboard', { defaultValue: 'Dashboards' }),
    report: t('designMode.menu.kind.report', { defaultValue: 'Reports' }),
    page: t('designMode.menu.kind.page', { defaultValue: 'Pages' }),
    url: t('designMode.menu.kind.url', { defaultValue: 'Link' }),
  };
  const kindText = (k: MenuTargetKind) => kindTexts[k];
  const q = query.trim().toLowerCase();
  const offered = rows.filter(
    (row) =>
      !inMenu.has(targetKeyFor(row.kind, row.name)) &&
      (kind === null || row.kind === kind) &&
      (!q || row.label.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)),
  );
  const title = t('designMode.menu.pickerTitle', { defaultValue: 'Add menu item' });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="design-menu-picker">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {kind !== 'url' && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('designMode.menu.search', { defaultValue: 'Search…' })}
              aria-label={t('designMode.menu.search', { defaultValue: 'Search…' })}
              className="pl-8"
              data-testid="design-menu-picker-search"
            />
          </div>
        )}
        {kind !== null && (
          <Button type="button" variant="ghost" size="sm" className="w-fit gap-1 px-1" onClick={() => setKind(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {kindText(kind)}
          </Button>
        )}
        {kind === 'url' ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.label.trim() && link.url.trim()) onPick('url', link.url.trim(), { label: link.label.trim(), url: link.url.trim() });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="design-menu-link-label">{t('designMode.menu.linkLabel', { defaultValue: 'Label' })}</Label>
              <Input id="design-menu-link-label" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="design-menu-link-url">{t('designMode.menu.linkUrl', { defaultValue: 'URL' })}</Label>
              <Input id="design-menu-link-url" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!link.label.trim() || !link.url.trim()}>
                {t('designMode.menu.add', { defaultValue: 'Add' })}
              </Button>
            </DialogFooter>
          </form>
        ) : kind === null && !q ? (
          <ul className="flex flex-col" data-testid="design-menu-picker-kinds">
            {MENU_TARGET_KINDS.map((k) => {
              const Icon = KIND_ICON[k];
              return (
                <li key={k}>
                  <button
                    type="button"
                    onClick={() => setKind(k)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{kindText(k)}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="flex max-h-72 flex-col overflow-y-auto" data-testid="design-menu-picker-rows">
            {kind !== null && isNewMenuItemKind(kind) && (
              <li>
                <button
                  type="button"
                  onClick={() => setNaming(kind)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
                  data-testid={`design-menu-picker-new-${kind}`}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{newTexts[kind]}</span>
                </button>
              </li>
            )}
            {loading ? (
              <li className="px-2 py-2 text-sm text-muted-foreground">{t('designMode.menu.loading', { defaultValue: 'Loading…' })}</li>
            ) : offered.length === 0 ? (
              <li className="px-2 py-2 text-sm text-muted-foreground">
                {t('designMode.menu.none', { defaultValue: 'Nothing to add here' })}
              </li>
            ) : (
              offered.map((row) => {
                const Icon = KIND_ICON[row.kind];
                return (
                  <li key={`${row.kind}:${row.name}`}>
                    <button
                      type="button"
                      onClick={() => onPick(row.kind, row.name)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{row.label}</span>
                      {kind === null && <span className="shrink-0 text-xs text-muted-foreground">{kindText(row.kind)}</span>}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The name step of 「New dashboard…」 (objectstack#36364): a name, and
 * 「Create」 or 「Cancel」. 「Cancel」 (and closing the dialog) writes nothing;
 * 「Create」 waits on `onCreate`, and stays open with the name when it fails.
 */
function NewItemDialog({
  kind,
  onCancel,
  onCreate,
}: {
  kind: NewMenuItemKind;
  onCancel: () => void;
  onCreate: (label: string) => Promise<boolean>;
}) {
  const { t } = useObjectTranslation();
  const [label, setLabel] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  // Each key written whole, so the i18n call-site gate sees every one.
  const titles: Record<NewMenuItemKind, string> = {
    dashboard: t('designMode.menu.newDashboardTitle', { defaultValue: 'New dashboard' }),
  };
  const submit = async () => {
    const name = label.trim();
    if (!name || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onCreate(name);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busyRef.current && onCancel()}>
      <DialogContent className="sm:max-w-sm" data-testid={`design-menu-new-${kind}`}>
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-menu-new-name">{t('designMode.menu.name', { defaultValue: 'Name' })}</Label>
            <Input
              id="design-menu-new-name"
              autoFocus
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
              aria-describedby="design-menu-new-hint"
              data-testid="design-menu-new-name"
            />
            <p id="design-menu-new-hint" className="text-xs text-muted-foreground">
              {t('designMode.menu.newItemSavesAll', {
                defaultValue: 'Creating it saves your other design changes too, then opens it for editing.',
              })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy} data-testid="design-menu-new-cancel">
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={busy || !label.trim()} data-testid="design-menu-new-create">
              {busy
                ? t('designMode.menu.creating', { defaultValue: 'Creating…' })
                : t('designMode.menu.create', { defaultValue: 'Create' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  label,
  icon,
  nameLocked,
  onClose,
  onDone,
}: {
  label: string;
  icon: string;
  /** The name is shown, not changed: the session is not in the app's source language. */
  nameLocked: boolean;
  onClose: () => void;
  onDone: (label: string, icon: string) => void;
}) {
  const { t } = useObjectTranslation();
  const [name, setName] = React.useState(label);
  const [iconName, setIconName] = React.useState(icon);
  const preview = React.createElement(getIcon(iconName || undefined), { className: 'h-4 w-4' });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm" data-testid="design-menu-rename">
        <DialogHeader>
          <DialogTitle>{t('designMode.menu.rename', { defaultValue: 'Rename and icon' })}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onDone(name.trim(), iconName.trim());
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-menu-rename-label">{t('designMode.menu.name', { defaultValue: 'Name' })}</Label>
            <Input
              id="design-menu-rename-label"
              autoFocus={!nameLocked}
              disabled={nameLocked}
              aria-describedby={nameLocked ? 'design-menu-rename-label-hint' : undefined}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {nameLocked && (
              <p id="design-menu-rename-label-hint" className="text-xs text-muted-foreground" data-testid="design-menu-rename-source-only">
                {t('designMode.menu.renameSourceOnly', { defaultValue: "Menu names are changed in the app's source language" })}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="design-menu-rename-icon">{t('designMode.menu.icon', { defaultValue: 'Icon' })}</Label>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border">
                {preview}
              </span>
              <Input id="design-menu-rename-icon" autoFocus={nameLocked} value={iconName} onChange={(e) => setIconName(e.target.value)} placeholder="briefcase" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('designMode.menu.iconHint', { defaultValue: 'A Lucide icon name, such as "briefcase".' })}
            </p>
          </div>
          <DialogFooter>
            <Button type="submit">{t('designMode.menu.done', { defaultValue: 'Done' })}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

