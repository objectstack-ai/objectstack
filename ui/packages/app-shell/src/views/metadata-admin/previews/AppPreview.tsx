// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppPreview — visual summary of an App metadata record's nav and
 * landing page, since rendering a full nested AppShell inside the
 * admin would be confusing (nav-within-nav).
 *
 * Shows:
 *   • App label/icon + the landing nav item (the first reachable entry)
 *   • Top-level navigation items as a clickable list — each link opens
 *     the runtime app in a new tab so authors can test the configured
 *     nav without leaving the editor.
 *
 * READING THE NAV (rewritten in objectui#3275). `AppSchema.navigation` is
 * a DISCRIMINATED UNION on `type` and every branch is `.strict()`. This
 * file used to ignore that: it inferred a "kind" from `it.object` /
 * `it.dashboard` and took a route from `it.path ?? it.href ?? it.route ??
 * it.url`. Not one of `path` / `href` / `route` / `object` / `dashboard`
 * is a key in any branch — the spec rejects them by name — while the keys
 * that ARE declared (`objectName`, `pageName`, `dashboardName`, `url`)
 * were never read. The result was exactly inverted: a spec-valid app
 * rendered every entry as an unlabelled generic item with no target,
 * and only an unsaveable one looked complete.
 *
 * An app does not route by hand-written path; it names the metadata
 * record to open and the SHELL derives the URL. So the route column now
 * comes from `resolveHref` — the shell's own nav → URL mapping, which
 * `NavigationRenderer` documents as the single source of truth and which
 * `useNavPins` / `SearchResultsPage` already share. A link shown here is
 * therefore the link the user will actually follow, `recordId` /
 * `filters` / `componentRef` semantics included.
 *
 * If the App schema doesn't follow the expected shape we degrade to
 * a "no preview" hint rather than throw.
 *
 * AREAS (objectui#11027). `AppSchema.areas` partitions a large app's
 * navigation into business domains, and each area carries a `label` and an
 * optional `description`, both the spec's `I18nLabel`. The preview lists the
 * areas with each label and, when one is authored, its description beneath
 * it, resolved in the designer `locale` through the spec's own
 * `resolveI18nLabel`. An area with no `description` shows none: nothing is
 * invented in its place.
 */

import * as React from 'react';
import {
  BookOpen,
  Compass,
  ExternalLink,
  Folder,
  LayoutDashboard,
  FileText,
  Database,
  BarChart3,
  Link as LinkIcon,
  Minus,
  MousePointerClick,
  Puzzle,
} from 'lucide-react';
import { resolveHref, type NavTargetLabelResolver } from '@object-ui/layout';
import type { NavigationItemType } from '@object-ui/types';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { useNavTargetLabel } from '../../../hooks/useNavTargetLabel.js';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { t as tr } from '../i18n.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { AppNavCanvas } from './AppNavCanvas.js';
import { withNodes } from './row-nodes.js';
import { navEntryLabelText, navItemLabelText } from './navItemLabel.js';

/**
 * The members of the spec's navigation union — the spec-derived
 * `NavigationItemType`, not a hand list. A hand list of nine missed `doc` when
 * the spec added it (objectui#11197), so a label-less `doc` entry was DROPPED
 * from this preview and a labelled one drew with no kind and no link. Keyed as
 * a `Record`, a member the spec adds or drops stops this file compiling until
 * it is handled here.
 */
type NavKind = NavigationItemType;

const NAV_KIND_SET: Record<NavKind, true> = {
  object: true, dashboard: true, page: true, url: true, report: true,
  action: true, component: true, doc: true, group: true, separator: true,
};
const NAV_KINDS: readonly string[] = Object.keys(NAV_KIND_SET);

interface NavItem {
  id?: string;
  label: string;
  /** The discriminator, verbatim — never inferred. */
  kind?: NavKind;
  /** The metadata record this entry names (`objectName`, `pageName`, …). */
  target?: string;
  /** Route the shell will navigate to, from `resolveHref`. */
  href?: string;
  external?: boolean;
  children?: NavItem[];
}

/**
 * The target a nav item names, read from the key its own branch declares.
 * Returns undefined for branches that name nothing (`group`, `separator`).
 */
function navTarget(it: Record<string, unknown>, kind?: NavKind): string | undefined {
  switch (kind) {
    case 'object':
      return typeof it.objectName === 'string' ? it.objectName : undefined;
    case 'dashboard':
      return typeof it.dashboardName === 'string' ? it.dashboardName : undefined;
    case 'page':
      return typeof it.pageName === 'string' ? it.pageName : undefined;
    case 'report':
      return typeof it.reportName === 'string' ? it.reportName : undefined;
    case 'url':
      return typeof it.url === 'string' ? it.url : undefined;
    case 'component':
      return typeof it.componentRef === 'string' ? it.componentRef : undefined;
    case 'action': {
      const def = it.actionDef as Record<string, unknown> | undefined;
      return def && typeof def.actionName === 'string' ? def.actionName : undefined;
    }
    case 'doc':
      // The page it opens, else the book.
      if (typeof it.doc === 'string') return it.doc;
      return typeof it.book === 'string' ? it.book : undefined;
    default:
      return undefined;
  }
}

/**
 * Every nav label is `I18nLabel` (a plain string or an inline locale map), so
 * it resolves through `resolveI18nLabel` in the designer `locale` and never
 * through a `typeof === 'string'` test or `String()` (objectui#11100): a map
 * label would read as no label, or as `[object Object]`. A label only decides
 * an entry's text, never whether the entry exists: an entry that names a
 * record or holds children is kept.
 *
 * An entry with NO label shows the text it inherits, through the runtime's own
 * rule and the console's own `targetLabel` resolver (`navEntryLabelText`,
 * objectui#11196): its target's current label, else the target's machine
 * name, else its `id` — what the console's sidebar draws for it. `unnamed`
 * (`engine.appPreview.unnamed`, in the preview's locale — objectui#10862) is
 * left for what that rule cannot name: a label that is present but resolves
 * to nothing, and an entry with no target and no `id`, which the spec refuses.
 */
function normalizeNav(
  raw: unknown,
  appName: string,
  unnamed: string,
  locale: string | undefined,
  targetLabel: NavTargetLabelResolver,
): NavItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it: any): NavItem | null => {
      if (!it || typeof it !== 'object') return null;
      const kind: NavKind | undefined =
        typeof it.type === 'string' && NAV_KINDS.includes(it.type) ? (it.type as NavKind) : undefined;
      if (kind === 'separator') {
        return { id: typeof it.id === 'string' ? it.id : undefined, label: '', kind };
      }
      const target = navTarget(it, kind);
      // Existence reads the AUTHORED label, as it always has: inheriting text
      // never turns an entry with nothing to open into one worth listing.
      if (!navItemLabelText(it.label, locale).trim() && !it.children && !target) return null;
      const label = navEntryLabelText(it, locale, targetLabel).trim();
      // Delegate to the shell's own mapping so the preview cannot invent a
      // route the runtime would not produce. Needs a `type`, so an item
      // missing the discriminator gets no link — which is the truth.
      let href: string | undefined;
      let external = false;
      if (kind && appName) {
        try {
          const r = resolveHref(it, `/apps/${encodeURIComponent(appName)}`);
          if (r.href && r.href !== '#') {
            href = r.href;
            external = r.external;
          }
        } catch {
          href = undefined;
        }
      }
      const children = Array.isArray(it.children)
        ? normalizeNav(it.children, appName, unnamed, locale, targetLabel)
        : undefined;
      return { id: typeof it.id === 'string' ? it.id : undefined, label: label || unnamed, kind, target, href, external, children };
    })
    .filter((x): x is NavItem => x !== null);
}

/** One entry of `AppSchema.areas`, its display text resolved for the designer locale. */
interface AreaRow {
  id?: string;
  label?: string;
  description?: string;
}

type I18nText = Parameters<typeof resolveI18nLabel>[0];

/**
 * The app's navigation areas, in authored order. `label` and `description`
 * are `I18nLabel`: a plain string or an inline locale map, so each goes
 * through `resolveI18nLabel` and never through `String()` (a map would read
 * `[object Object]`). An unauthored or empty value stays `undefined`, which
 * renders nothing.
 */
function readAreas(raw: unknown, locale: string | undefined): AreaRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: AreaRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const area = entry as Record<string, unknown>;
    rows.push({
      id: typeof area.id === 'string' && area.id ? area.id : undefined,
      label: resolveI18nLabel(area.label as I18nText, locale) || undefined,
      description: resolveI18nLabel(area.description as I18nText, locale) || undefined,
    });
  }
  return rows;
}

function kindIcon(kind?: NavKind) {
  switch (kind) {
    case 'object':
      return Database;
    case 'page':
      return FileText;
    case 'dashboard':
      return LayoutDashboard;
    case 'report':
      return BarChart3;
    case 'url':
      return LinkIcon;
    case 'group':
      return Folder;
    case 'action':
      return MousePointerClick;
    case 'component':
      return Puzzle;
    case 'doc':
      return BookOpen;
    case 'separator':
      return Minus;
    default:
      return Compass;
  }
}

/**
 * The entry the app opens on: depth-first, the first item that addresses
 * something inside the app. Mirrors `findFirstRoute` / `resolveLandingRoute`
 * in `console/AppContent.tsx` — `group` recurses, and `url` / `separator` /
 * `action` are skipped because none of them yields an in-app route.
 */
function findFirstLanding(items: NavItem[]): NavItem | undefined {
  for (const it of items) {
    if (it.kind === 'group') {
      const hit = it.children ? findFirstLanding(it.children) : undefined;
      if (hit) return hit;
      continue;
    }
    if (it.kind === 'url' || it.kind === 'separator' || it.kind === 'action') continue;
    // A `doc` entry has an href (the docs portal) but is never a landing: the
    // runtime's `findFirstRoute` lands on object / page / dashboard / report /
    // component only (objectui#11197). A `component` entry lands here as it
    // does there, which the runtime learned in objectui#12113.
    if (it.kind === 'doc') continue;
    if (it.href) return it;
  }
  return undefined;
}

export function AppPreview({ name, draft, editing, selection, onSelectionChange, onPatch, locale }: MetadataPreviewProps) {
  const appName = String((draft as any).name ?? name ?? '');
  // `label` is `I18nLabel` too: resolved in the designer locale, the app's own
  // name only when it authored none (objectui#11100).
  const label = resolveI18nLabel(draft.label as I18nText, locale) ?? appName;
  const unnamed = tr('engine.appPreview.unnamed', locale);
  // What a label-less entry inherits is asked of the console's own resolver, so
  // the preview names it as the sidebar does (objectui#11196).
  const targetLabel = useNavTargetLabel();
  // The landing page is DERIVED, never authored: it is the first navigation
  // item that actually addresses something. The app used to be able to pin it
  // with `homePageId`, but spec 17.0.0 retired that key (objectstack#4667 /
  // objectstack-ai/objectstack#4709) — an ID cross-reference with no referential integrity, which fell
  // back to the first item silently when it dangled. Before that it was
  // `landing`, removed in objectstack#4001. Reading either one back here would
  // show the author a landing page the runtime will not honour.
  const { rootKey, navItems } = React.useMemo<{ rootKey: string | null; navItems: NavItem[] }>(() => {
    const candidates: Array<[string, unknown]> = [
      ['nav', (draft as any).nav],
      ['navigation', (draft as any).navigation],
      ['tabs', (draft as any).tabs],
      ['items', (draft as any).items],
      ['menu', (draft as any).menu],
    ];
    for (const [k, c] of candidates) {
      if (Array.isArray(c) && c.length) {
        return { rootKey: k, navItems: normalizeNav(c, appName, unnamed, locale, targetLabel) };
      }
    }
    return { rootKey: null, navItems: [] };
  }, [draft, appName, unnamed, locale, targetLabel]);

  // Resolve the landing entry the same way `resolveLandingRoute` does in the
  // console shell, so the author sees WHICH entry the app will open on:
  // depth-first, first item that yields a route (`group` recurses; `url`,
  // `separator` and `action` address nothing inside the app).
  const homeItem = React.useMemo(() => findFirstLanding(navItems), [navItems]);

  const areas = readAreas(draft.areas, locale);

  // For Add we need a root key even when empty — default to `navigation`,
  // the only root key the spec (AppSchema) actually accepts; `nav` /
  // `tabs` / `items` are read-back tolerances, not write targets (#2245).
  const addRootKey = rootKey ?? 'navigation';

  const designMode = !!(editing && onSelectionChange);
  const canEdit = designMode && !!onPatch;
  const selectedId = selection && selection.kind === 'nav' ? selection.id : null;
  const onSelect = designMode
    ? (path: string, item: NavItem) => onSelectionChange!({ kind: 'nav', id: path, label: item.label })
    : undefined;

  const baseRuntimeUrl = appName ? `/apps/${encodeURIComponent(appName)}/` : null;

  return (
    <PreviewShell
      hint="app"
      toolbar={
        baseRuntimeUrl && (
          <a
            href={baseRuntimeUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            title={tr('engine.appPreview.openTitle', locale)}
          >
            {tr('engine.appPreview.open', locale)} <ExternalLink className="h-3 w-3" />
          </a>
        )
      }
    >
      <PreviewErrorBoundary>
        <div className="p-3 space-y-3">
          <div className="rounded border bg-muted/30 p-3">
            <div className="text-sm font-medium text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{appName}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {homeItem ? (
                <>
                  {tr('engine.appPreview.homeFirst', locale)}
                  <span className="ml-1.5">→ {homeItem.label}</span>
                </>
              ) : (
                <>{tr('engine.appPreview.homeNone', locale)}</>
              )}
            </div>
          </div>

          {areas.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                {tr('engine.appPreview.areas', locale)}
              </div>
              <ul className="border rounded divide-y">
                {areas.map((area, i) => (
                  <li key={i} className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {area.label && <span className="font-medium text-foreground">{area.label}</span>}
                      {area.id && <span className="font-mono text-[10px] text-muted-foreground">{area.id}</span>}
                    </div>
                    {area.description && <p className="mt-0.5 text-muted-foreground">{area.description}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {designMode ? (
            // Design mode: form-canvas-style nav editor. Replaces the
            // legacy read-only list + Add button.
            <AppNavCanvas
              draft={draft}
              rootKey={addRootKey}
              onPatch={canEdit ? onPatch : undefined}
              selection={selection ?? null}
              onSelectionChange={onSelectionChange}
            />
          ) : navItems.length === 0 ? (
            <PreviewMessage>
              {withNodes(tr('engine.appPreview.empty', locale), { navigation: <code>navigation</code> })}
            </PreviewMessage>
          ) : (
            <div className="border rounded divide-y">
              {navItems.map((item, i) => (
                <NavRow
                  key={i}
                  item={item}
                  depth={0}
                  path={`${rootKey}[${i}]`}
                  onSelect={onSelect}
                  selectedId={selectedId}
                  locale={locale}
                />
              ))}
            </div>
          )}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function NavRow({
  item,
  depth,
  path,
  onSelect,
  selectedId,
  locale,
}: {
  item: NavItem;
  depth: number;
  path: string;
  onSelect?: (path: string, item: NavItem) => void;
  selectedId: string | null;
  locale?: string;
}) {
  const Icon = kindIcon(item.kind);
  const url = item.href;
  const selected = selectedId === path;
  return (
    <>
      <div
        className={`flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent/40 ${onSelect ? 'cursor-pointer' : ''} ${selected ? 'bg-primary/5 ring-1 ring-primary' : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(path, item); } : undefined}
      >
        {/* eslint-disable-next-line react-hooks/static-components -- kindIcon returns a stable icon component from a static registry, not one created during render */}
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{item.label}</span>
        {item.kind ? (
          <span className="text-[10px] uppercase tracking-wider opacity-60">{item.kind}</span>
        ) : (
          <span
            className="text-[10px] uppercase tracking-wider text-amber-700"
            title={tr('engine.appPreview.noTypeTitle', locale)}
          >
            {tr('engine.appPreview.noType', locale)}
          </span>
        )}
        {item.target && (
          <span className="font-mono text-[10px] text-muted-foreground truncate">{item.target}</span>
        )}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto font-mono text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            {url} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {item.children?.map((c, i) => (
        <NavRow
          key={i}
          item={c}
          depth={depth + 1}
          path={`${path}.children[${i}]`}
          onSelect={onSelect}
          selectedId={selectedId}
          locale={locale}
        />
      ))}
    </>
  );
}

