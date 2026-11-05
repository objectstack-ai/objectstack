// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Interfaces pillar's navigation rail: the app's nav tree, its contributed
 * rows and off-nav sections, the two rail contexts and the kind icons, moved
 * out of `StudioDesignSurface.tsx` unchanged by objectstack#29988 (slice 3 of
 * the move-only split).
 */

import * as React from 'react';
import { StudioRailGroup, StudioRailRow } from './StudioRail.js';
import { Badge, Popover, PopoverContent, PopoverTrigger, Separator, cn } from '@object-ui/components';
import {
  FileText,
  Database,
  LayoutDashboard,
  BarChart3,
  Table2,
  Folder,
  Compass,
  Link as LinkIcon,
  Puzzle,
  BookOpen,
  MousePointer2,
  Minus,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { listViewTargetOf } from './ObjectListViewInspector.js';
import type { PackageSurface } from './packageSurfaces.js';
import { resolveSurface, isSameSurface, type NavNode, type Surface } from './navSurface.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { inMenuOrder, navPayloadOf } from '../metadata-admin/previews/AppNavCanvas.js';
import { navEntryLabelText } from '../metadata-admin/previews/navItemLabel.js';
import { useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import { isNavEntryType } from '../metadata-admin/inspectors/nav-target.js';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import { getIcon } from '../../utils/getIcon.js';
import {
  ContributedRailRow,
  RailCustomizationMark,
  contributedItemTitle,
  useOpenContributor,
  type RailCustomizations,
} from './StudioRailCustomizations.js';
import { CustomizationMark } from './CustomizationMark.js';
import {
  NO_SERVED_CONTRIBUTED_NAV,
  servedEntryOf,
  type NavContributionPlacement,
  type ServedContributedNav,
  type TopLevelContributedNav,
} from './contributionRows.js';

const KIND_ICON: Record<string, LucideIcon> = {
  group: Folder,
  page: FileText,
  object: Database,
  dashboard: LayoutDashboard,
  report: BarChart3,
  view: Table2,
  action: MousePointer2,
  // objectui#11790 — the types the nav editor can now add. A url / component /
  // doc row opens no design surface (`resolveSurface`), so it renders disabled,
  // under its own glyph rather than the generic compass.
  url: LinkIcon,
  component: Puzzle,
  doc: BookOpen,
  separator: Minus,
};
export const navIcon = (type?: string): LucideIcon => KIND_ICON[type ?? ''] ?? Compass;

/**
 * The kind tag a nav entry carries at the right of its rail row, and the kind
 * an entry is named by in the header chip and the inspector's eyebrow
 * (objectui#12455). A type the console also names as a metadata type (object,
 * page, dashboard, report) is translated by that one helper, so the rail, the
 * breadcrumb and the canvas caption say the same word; an `object` entry bound
 * to a named view reads "View"; the types that open no design surface (url,
 * action, component, doc) and the two structural ones are named from the
 * Studio's own table. `''` for an entry with no type the spec declares.
 */
export function navKindName(node: Pick<NavNode, 'type' | 'viewName'>, locale: string): string {
  const type = node.type ?? '';
  if (type === 'object' && typeof node.viewName === 'string' && node.viewName) {
    return t('engine.studio.if.kind.view', locale);
  }
  if (type === 'object' || type === 'page' || type === 'dashboard' || type === 'report') {
    return translateMetadataType(type, locale);
  }
  if (isNavEntryType(type)) return t(`engine.studio.if.kind.${type}`, locale);
  return '';
}

/**
 * Whether `nodes` hold, at any depth, the entry that opens `active` — so a
 * group the sidebar would collapse opens when the open leaf is inside it.
 */
function navTreeHoldsActive(
  nodes: NavNode[] | undefined,
  active: Surface | null,
  locale: string,
  targetLabel: NavTargetLabelResolver,
): boolean {
  if (!active || !nodes) return false;
  return nodes.some((node) => {
    if (Array.isArray(node.children) && node.children.length) {
      return navTreeHoldsActive(node.children, active, locale, targetLabel);
    }
    const surface = resolveSurface(node, locale, targetLabel);
    return !!surface && isSameSurface(active, surface);
  });
}

/**
 * One group header and its children (objectui#12455). Open or closed as the
 * running app's sidebar opens it (`NavigationRenderer` in `@object-ui/layout`):
 * always open when the open leaf is inside it, else the spec's `expanded` when
 * the author set it, else open — however many children it holds
 * (objectui#13336). Collapsible by its
 * header, as the sidebar's is. A group with nothing in it says so in its place
 * instead of drawing a bare header.
 */
function NavTreeGroup({
  node,
  labelText,
  active,
  onPick,
  objectIcons,
  depth,
}: {
  node: NavNode;
  labelText: string;
  active: Surface | null;
  onPick: (s: Surface) => void;
  objectIcons?: Record<string, string | undefined>;
  depth: number;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const targetLabel = useNavTargetLabel();
  const children = node.children ?? [];
  // objectstack#29786 — a declared group (`type: 'group'`) also holds the
  // entries other packages contribute to it; a group with only those is no
  // longer empty.
  const placement = React.useContext(InterfacesNavContributionsContext);
  const contributed = node.type === 'group' && typeof node.id === 'string' ? (placement.byGroup.get(node.id) ?? []) : [];
  const holdsActive = navTreeHoldsActive(children, active, locale, targetLabel);
  const [open, setOpen] = React.useState(() => {
    if (holdsActive) return true;
    if (typeof node.expanded === 'boolean') return node.expanded;
    return true;
  });
  // A leaf opened from elsewhere (a deep link, a create) inside a closed
  // group opens the group, as the sidebar does for the route it is on.
  // Adjusted while rendering, on the change, so no effect re-renders it.
  const [heldActive, setHeldActive] = React.useState(holdsActive);
  if (holdsActive !== heldActive) {
    setHeldActive(holdsActive);
    if (holdsActive) setOpen(true);
  }
  return (
    <StudioRailGroup label={labelText} collapsed={!open} onToggle={() => setOpen((v) => !v)}>
      {children.length === 0 && contributed.length === 0 ? (
        <p className="flex h-7 items-center pl-[22px] text-xs text-muted-foreground">
          {t('engine.studio.if.emptyGroup', locale)}
        </p>
      ) : (
        <>
          {children.length > 0 && (
            <NavTree nodes={children} active={active} onPick={onPick} objectIcons={objectIcons} depth={depth + 1} />
          )}
          {/* objectstack#29786 — what other packages add to this group, after
              the group's own entries, as the served navigation appends them. */}
          <ContributedNavRows rows={contributed.map((entry) => ({ entry, undeclaredGroup: null }))} indent />
        </>
      )}
    </StudioRailGroup>
  );
}

/**
 * Recursive App-navigation tree: groups, separators and typed leaves.
 *
 * objectui#12455 (epic objectui#12446, decision 5) — the rail shows the app's
 * navigation as the shipped sidebar renders it: the same order, the same
 * groups (collapsible, opened as the sidebar opens them, see `NavTreeGroup`),
 * the same icons. Each leaf is one 32 px row: its icon, its label, and its
 * kind as a tag at the right (`navKindName`). The internal `type · name` pair
 * lives on the row's tooltip (objectui#7254), which is also its accessible
 * description; the visible text is what an author reads.
 *
 * objectui#11791 — the rail draws a `separator` and a leaf's `badge` /
 * `badgeVariant` with the decisions the running app's sidebar makes
 * (`NavigationRenderer` in `@object-ui/layout`, which `UnifiedSidebar` mounts),
 * so the design surface agrees with the app it designs. Mirrored, not
 * imported: the sidebar draws both inline in its row renderer, and its rows
 * are `SidebarMenu` items this rail does not use. The pin that holds the two
 * together renders both: the `StudioDesignSurface.railSeparatorBadge-11791`
 * block of `StudioDesignSurface.railLabels.test.tsx`.
 */
/**
 * objectstack#28572 — the Interfaces rail's customization marks, read by its
 * tree rows and its off-nav rows alike (`railCustomizationsOf`); `null` on a
 * package with nothing to mark.
 */
export const InterfacesRailMarksContext = React.createContext<RailCustomizations | null>(null);

/**
 * objectstack#29786 — where the open app's contributed nav entries go
 * (`placeNavContributions`), read by the tree's groups and its top level.
 * Empty on a package with none.
 */
export const InterfacesNavContributionsContext = React.createContext<NavContributionPlacement>({ byGroup: new Map(), top: [] });

/**
 * objectstack#29851 — the open app's served entries its published layer does
 * not hold, by id (`servedContributedNavOf`): what a contributed row reads
 * its label from. Empty for a never-published app.
 */
export const InterfacesServedContributedNavContext = React.createContext<ServedContributedNav>(NO_SERVED_CONTRIBUTED_NAV);

/**
 * objectstack#29786 — contributed nav entries as rail rows: greyed, with the
 * contributing package, and opening that package's Interfaces pillar. Not
 * nav entries of this app: never in its edit buffer, never dragged, renamed
 * or deleted here.
 */
export function ContributedNavRows({
  rows,
  indent = false,
}: {
  rows: readonly TopLevelContributedNav[];
  indent?: boolean;
}): React.ReactElement | null {
  const locale = useMetadataLocale();
  const openContributor = useOpenContributor();
  const served = React.useContext(InterfacesServedContributedNavContext);
  // objectstack#29851 — the label-less entry inherits as the live sidebar's does.
  const targetLabel = useNavTargetLabel();
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map(({ entry, undeclaredGroup }) => (
        <ContributedRailRow
          key={`${entry.packageId}:${entry.name}`}
          item={entry}
          label={contributedNavLabel(servedEntryOf(served, entry), locale, targetLabel)}
          indent={indent}
          icon={<Puzzle className="h-4 w-4 shrink-0" />}
          title={contributedItemTitle(entry, locale, undeclaredGroup)}
          onOpen={() => openContributor(`/studio/${encodeURIComponent(entry.packageId)}/interfaces`)}
          locale={locale}
        />
      ))}
    </>
  );
}

/**
 * objectstack#29851 — the text the live app shows for a contributed entry: the
 * served entry read with the rail's own resolver, or `undefined` when no served
 * entry is known for it (the row then keeps its id).
 */
function contributedNavLabel(
  node: Record<string, unknown> | undefined,
  locale: string,
  targetLabel: NavTargetLabelResolver,
): string | undefined {
  if (!node) return undefined;
  const text = navEntryLabelText(node as NavNode, locale, targetLabel).trim();
  return text || undefined;
}

export function NavTree({
  nodes,
  active,
  onPick,
  objectIcons,
  depth = 0,
}: {
  nodes: NavNode[];
  active: Surface | null;
  onPick: (s: Surface) => void;
  /** object name → its metadata icon, so object nav items show their own glyph. */
  objectIcons?: Record<string, string | undefined>;
  /** Nesting depth: a row under a group header is indented one step. */
  depth?: number;
}): React.ReactElement {
  const locale = useMetadataLocale();
  // What a label-less row inherits is asked of the console's own resolver, so
  // the rail names it as the console's sidebar does (objectui#11196).
  const targetLabel = useNavTargetLabel();
  const railMarks = React.useContext(InterfacesRailMarksContext);
  // objectstack#26979 — a level is listed in the order the running menu draws
  // it, through the canvas's `inMenuOrder` (the menu's `byNavOrder` rule). `i`
  // stays the entry's position in the authored array, which the canvas numbers
  // an untitled entry by too.
  const ordered = inMenuOrder(nodes);
  return (
    <>
      {ordered.map(([node, i]) => {
        // objectui#11158 — the spec types a nav item's `label` as `I18nLabel`,
        // so a locale map rendered raw threw ("Objects are not valid as a
        // React child") and took the whole rail down. Every read below goes
        // through the family's one helper, in the designer locale.
        // objectui#11196 — an ABSENT label shows the text the entry inherits:
        // the runtime's own rule, never a second copy of it.
        // objectui#11791 — a `separator` is a rule between rows, not an entry.
        // The sidebar's decision, mirrored: a decorative `Separator`
        // (`role="none"`), so it is no row to click, no stop for the keyboard,
        // and nothing a screen reader announces. The spec's separator carries
        // `type`, `id` and `order` only, so there is no label or badge to draw.
        if (node.type === 'separator') {
          return <Separator key={node.id ?? i} className="my-2" />;
        }
        const labelText = navEntryLabelText(node, locale, targetLabel);
        if (node.type === 'group' || (Array.isArray(node.children) && node.children.length)) {
          return (
            <NavTreeGroup
              key={node.id ?? i}
              node={node}
              labelText={labelText}
              active={active}
              onPick={onPick}
              objectIcons={objectIcons}
              depth={depth}
            />
          );
        }
        // The same resolver names the Surface a click opens, so the caption,
        // the breadcrumb and the copilot chip read what this row reads.
        const surface = resolveSurface(node, locale, targetLabel);
        // objectui#11862 — an entry that names no target yet ("Add nav item"
        // left unbound, which the editor keeps showing in its place) inherits
        // only its minted `id`. It reads as the editor's untitled wording
        // instead, never `nav_item_N`. "No target" is the save's own rule
        // (`navPayloadOf` leaves exactly these entries out), and an authored
        // label still renders verbatim.
        const untitled = node.label === undefined && navPayloadOf([node]).length === 0;
        // objectui#7254 — a nav item with no declared label used to render an
        // EMPTY row. It shows what it inherits (objectui#11196): its target's
        // current label, else the target's internal name, which is the
        // fallback #7254 chose. `surface?.name` stays for a label that is
        // present but resolves to nothing (an empty map).
        const rowText = untitled ? tFormat('engine.appNav.item', locale, { n: i + 1 }) : labelText || surface?.name || '';
        // Icon precedence: the nav item's own `icon`, then an object surface's
        // own metadata icon, then the type-generic fallback.
        const objIcon = surface?.type === 'object' ? objectIcons?.[surface.name] : undefined;
        const Icon: React.ElementType = node.icon ? getIcon(node.icon) : objIcon ? getIcon(objIcon) : navIcon(node.type);
        // objectui#11774 — the ENTRY is active, not every entry of its target:
        // compared by nav id when both carry one (see `isSameSurface`).
        const isActive = !!surface && !!active && isSameSurface(active, surface);
        const kind = navKindName(node, locale);
        return (
          <StudioRailRow
            key={node.id ?? i}
            onClick={() => surface && onPick(surface)}
            disabled={!surface}
            active={isActive}
            indent={depth > 0}
            // objectui#11862 — the label is what the row says; the machine
            // name is the secondary information, on the tooltip with the type.
            title={surface ? `${surface.type} · ${surface.name}` : rowText || undefined}
            className="disabled:opacity-40"
            icon={<Icon className="h-4 w-4 shrink-0" />}
            trailing={
              <>
                {/* objectui#11791 — the spec's `badge` / `badgeVariant`, drawn
                    when the sidebar row draws them (a present `badge`, a count
                    `0` included) with the same `Badge` and the same variant: an
                    absent `badgeVariant` is `Badge`'s own default, which is the
                    sidebar's. On every leaf, a disabled one too; never on a
                    group heading, where the sidebar draws none. Before the kind
                    tag, so the pill sits beside the text it qualifies. */}
                {node.badge != null && (
                  <Badge variant={node.badgeVariant} className="shrink-0 px-1.5 py-0 text-[10px]">
                    {node.badge}
                  </Badge>
                )}
                {kind && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                    {kind}
                  </span>
                )}
                {surface && <RailCustomizationMark row={surface} marks={railMarks} locale={locale} />}
              </>
            }
          >
            {rowText}
          </StudioRailRow>
        );
      })}
    </>
  );
}

/**
 * objectstack#26889 — the item types the Interfaces pillar lists under the
 * navigation tree, in the order of their sections: the three a nav entry can
 * open by name, in the "+" menu's order, then views, which a package ships by
 * the dozen and so sit last.
 */
export const OFF_NAV_TYPES = ['page', 'dashboard', 'report', 'view'] as const;
export type OffNavType = (typeof OFF_NAV_TYPES)[number];

/** An item's identity in {@link navOpenedItems}' set. Not a cache key. */
export const itemKeyOf = (type: string, name: string): string => `${type}:${name}`;

/**
 * The `type:name` of every item a nav entry in `nodes` opens, at any depth —
 * what the sections under the tree leave out, so no item is listed twice. The
 * binding is the tree's own (`resolveSurface`): a page / dashboard / report
 * entry opens the item it names, and an `object` entry with a `viewName` opens
 * that view, under the name its view item carries (`<object>.<viewName>`, the
 * spelling the entry's list-view panel edits, `listViewTargetOf`). A plain
 * `object` entry opens its object, so the object's views stay listed.
 */
export function navOpenedItems(nodes: readonly NavNode[], locale: string): Set<string> {
  const opened = new Set<string>();
  const walk = (list: readonly NavNode[]) => {
    for (const node of list) {
      if (Array.isArray(node.children) && node.children.length) {
        walk(node.children);
        continue;
      }
      const surface = resolveSurface(node, locale);
      if (!surface) continue;
      opened.add(itemKeyOf(surface.type, surface.name));
      if (surface.type === 'object' && typeof node.viewName === 'string' && node.viewName) {
        opened.add(itemKeyOf('view', listViewTargetOf(surface.name, node.viewName, {}).viewId));
      }
    }
  };
  walk(nodes);
  return opened;
}

/**
 * objectstack#30046 — whether the 视图 group leaves `item` out: a list view
 * whose object a nav entry opens (`opened`, {@link navOpenedItems}), which the
 * entry's header dropdown reaches. A form view, a list view of an object no
 * entry opens, and a view whose family or object is unknown stay listed, as
 * does a view a read-only base's pair adds (`addedIn`), which opens at that
 * pair.
 */
export function offNavViewReachedByEntry(
  item: Pick<PackageSurface, 'object' | 'viewKind'> & { addedIn?: string },
  opened: ReadonlySet<string>,
): boolean {
  return item.viewKind === 'list' && !!item.object && !item.addedIn && opened.has(itemKeyOf('object', item.object));
}

/**
 * objectstack#30046 — the 视图 group's heading, saying what it holds once
 * the list views the dropdowns reach are gone: form views, list views (of
 * objects no entry opens), or both.
 */
export function offNavViewHeading(items: ReadonlyArray<Pick<PackageSurface, 'viewKind'>>, locale: string): string {
  const forms = items.filter((item) => item.viewKind === 'form').length;
  if (forms === 0) return t('engine.studio.if.offNav.view', locale);
  return t(forms === items.length ? 'engine.studio.if.offNav.viewForms' : 'engine.studio.if.offNav.viewMixed', locale);
}

/**
 * objectstack#30046 — what a 视图 row reads: the view's label, else, for a
 * form view, its object's name and the word for a form ("Lead form"; a named
 * form adds its key), never the item name (`crm_lead.form`). `objectLabel` is
 * the object's name as the Studio shows it. A list view without a label keeps
 * its item name, as before.
 */
export function offNavViewLabel(item: PackageSurface, objectLabel: string, locale: string): string {
  const own = item.label && item.label !== item.name ? item.label : '';
  if (own || item.viewKind !== 'form') return own || item.name;
  const form = tFormat('engine.studio.if.offNav.formName', locale, { object: objectLabel });
  const prefix = item.object ? `${item.object}.` : '';
  const key = prefix && item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name;
  return key === 'form' ? form : `${form} · ${key}`;
}

/**
 * objectstack#26889 — the package's pages, dashboards, reports and views that
 * no nav entry opens (`navOpenedItems`), one collapsible section per type,
 * under the navigation tree. A package with no app lists everything it ships
 * here, under its "no app yet" notice. A row opens its item in the pillar's
 * canvas and inspector as a tree row does, so a read-only package shows it
 * read-only. Listing writes nothing: no nav entry is added for a row.
 */
export function OffNavSections({
  sections,
  active,
  activeViewId = null,
  onPick,
  onlyCustomized = false,
}: {
  /**
   * objectstack#30046 — a section may name itself (`label`): the 视图 group
   * says what it holds. Without one, the type's own heading.
   */
  sections: ReadonlyArray<{ type: OffNavType; label?: string; items: ReadonlyArray<PackageSurface & { addedIn?: string }> }>;
  active: Surface | null;
  /**
   * objectstack#30046 — the list view the open object page shows, when that
   * page was opened from here (an object no entry opens): its row is the
   * active one, as a tree row is for its entry.
   */
  activeViewId?: string | null;
  onPick: (s: Surface) => void;
  /** objectstack#28572 — "only customizations" is on: the sections list the marked items, and head nothing. */
  onlyCustomized?: boolean;
}): React.ReactElement | null {
  const locale = useMetadataLocale();
  const shown = sections.filter((s) => s.items.length > 0);
  if (shown.length === 0) return null;
  return (
    <div data-testid="if-off-nav" className={onlyCustomized ? 'pt-1' : 'mt-3 border-t pt-2'}>
      {!onlyCustomized && (
        <p className="px-2 pb-1 text-[11px] text-muted-foreground">{t('engine.studio.if.offNav.heading', locale)}</p>
      )}
      {shown.map((s) => (
        <OffNavSection
          key={s.type}
          type={s.type}
          label={s.label}
          items={s.items}
          active={active}
          activeViewId={activeViewId}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

/** One type's section: its rows, open until the author closes it. */
function OffNavSection({
  type,
  label,
  items,
  active,
  activeViewId,
  onPick,
}: {
  type: OffNavType;
  label?: string;
  items: ReadonlyArray<PackageSurface & { addedIn?: string }>;
  active: Surface | null;
  activeViewId: string | null;
  onPick: (s: Surface) => void;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const railMarks = React.useContext(InterfacesRailMarksContext);
  const [open, setOpen] = React.useState(true);
  const Icon = navIcon(type);
  return (
    <StudioRailGroup
      testId={`if-off-nav-${type}`}
      label={label ?? t(`engine.studio.if.offNav.${type}`, locale)}
      count={items.length}
      collapsed={!open}
      onToggle={() => setOpen((v) => !v)}
    >
      {items.map((item) => {
        // objectstack#28572 — an item the pair adds opens at that pair.
        const surface: Surface = {
          type: item.type,
          name: item.name,
          label: item.label,
          ...(item.addedIn ? { addedIn: item.addedIn } : {}),
        };
        return (
          <StudioRailRow
            key={item.name}
            onClick={() => onPick(surface)}
            active={(!!active && isSameSurface(active, surface)) || (type === 'view' && item.name === activeViewId)}
            indent
            // The label is what the row says; the machine name rides on the
            // tooltip with the type, as on a tree row (objectui#11862).
            title={`${item.type} · ${item.name}`}
            icon={<Icon className="h-4 w-4 shrink-0" />}
            trailing={<RailCustomizationMark row={surface} marks={railMarks} locale={locale} />}
          >
            {item.label || item.name}
          </StudioRailRow>
        );
      })}
    </StudioRailGroup>
  );
}

/**
 * objectstack#30059 (ADR-0146 D2, D3) — the Interfaces rail's mark for an app
 * whose navigation a read-only base's pair overrides. The override is the
 * app's, a whole copy, never one entry's, so the mark sits beside the rail's
 * heading rather than on a row: the compact "customized" glyph every rail row
 * carries ({@link CustomizationMark}), never a text label.
 *
 * Pressing it opens a small popover that says what the app overrides and the
 * version it was taken from and, for an override the pair holds
 * (`onRestore`), offers "Restore package original". That button only asks:
 * the host opens its confirmation (`StudioRestoreOriginalDialog`), as the item
 * header's override mark does (`StudioOverrideChip`).
 *
 * Drawn from a served declaration (`useServedOverride`), ⛔ never a
 * computation: no diff against the base's navigation.
 */
export function InterfacesNavOverrideMark({
  baseLabel,
  pairId,
  basedOn,
  locale,
  onRestore,
  restoreDisabled = false,
}: {
  baseLabel: string;
  /** The pair, named in the mark's tooltip; empty while it is not known. */
  pairId: string;
  basedOn: string;
  locale: string;
  /** Opens the host's Restore confirmation; omitted, the popover states the facts alone. */
  onRestore?: () => void;
  restoreDisabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="if-nav-override-mark"
          className="inline-flex shrink-0 items-center rounded-[5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CustomizationMark kind="customized" baseName={baseLabel} pairId={pairId || undefined} locale={locale} compact />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-xs" data-testid="if-nav-override-popover">
        <p className="text-sm font-medium text-foreground">
          {tFormat('engine.studio.customize.overrides', locale, { package: baseLabel })}
        </p>
        <p className="mt-1.5 text-muted-foreground" data-testid="if-nav-override-facts">
          {tFormat('engine.studio.customize.overridesTitle', locale, { package: baseLabel, basedOn })}
        </p>
        {onRestore && (
          <button
            type="button"
            data-testid="if-nav-override-restore"
            disabled={restoreDisabled}
            onClick={() => {
              setOpen(false);
              onRestore();
            }}
            className={cn(
              'mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('engine.studio.customize.restore', locale)}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
