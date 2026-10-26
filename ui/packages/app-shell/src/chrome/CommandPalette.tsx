/**
 * CommandPalette
 *
 * A ⌘+K (Ctrl+K) command palette for quick navigation across apps, objects,
 * dashboards, pages, reports, and global actions.
 *
 * Uses Shadcn's Command (cmdk) component — keyboard-accessible. The palette
 * matches its navigation entries and built-in commands itself, on word
 * prefixes and contiguous substrings (`matchesPaletteQuery`, objectui#11812),
 * and renders only those that match; record hits come from the server search,
 * already ranked. So cmdk's own filter and sort stay off (`shouldFilter`
 * false, objectui#13387): what is rendered is what shows, in render order.
 *
 * Two scopes (objectui#11863). Inside an app (`scope` omitted) it searches that
 * app. On `/studio` (`scope="studio"`), a frame outside every app, it has no
 * app-scoped group and no full-search command, whose links all start with
 * `/apps/APP`; it lists the Studio's packages, objects and flows instead, each
 * opening its Studio page.
 *
 * A failure inside the palette closes it and leaves the console mounted; the
 * next open draws a fresh palette (objectui#13387).
 */

import { useEffect, useState, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Command,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@object-ui/components';
import {
  LayoutDashboard,
  FileText,
  BarChart3,
  Moon,
  Sun,
  Monitor,
  Search,
  Boxes,
  Database,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useRecordSearch } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useTheme } from './ThemeProvider.js';
import { useNavVisibility } from '../hooks/useNavMemberGates.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveKeyedI18nLabel, getRecordDisplayName, appRouteSegment } from '../utils/index.js';
import { getIcon } from '../utils/getIcon.js';
import { useRecentItems } from '../context/RecentItemsProvider.js';
import { useRecentItemLabel } from '../hooks/useRecentItemLabel.js';
import { recentItemObject } from '../console/home/recentItemTypeLabel.js';
import type { RecentItem } from '../context/RecentItemsProvider.js';
import { useCommandPalette } from '../context/CommandPaletteProvider.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { confirmUnsavedLeave } from './unsavedEdits.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { resolveHref, resolveNavItemLabel } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { findByName, useNavTargetLabel } from '../hooks/useNavTargetLabel.js';
import { useAuth } from '@object-ui/auth';
import { matchesPaletteQuery } from './paletteMatch.js';
import { fetchPackages, type PkgEntry } from '../views/studio-design/packages-io.js';
import { isPackageLessItem, studioOrgScopePath } from '../views/studio-design/studioScope.js';
import { DESIGNER_SURFACE_PARAM, formatSurfaceParam } from '../views/metadata-admin/nav-selection.js';
import { flattenNavigation, useAppReportEntries } from '../views/appReportIndex.js';

/** The palette of the active app: the frame `ConsoleLayout` draws for `/apps/APP`. */
interface AppCommandPaletteProps {
  /** Omitted inside an app; `'studio'` is the other scope. */
  scope?: undefined;
  apps: any[];
  activeApp: any;
  objects: any[];
  onAppChange: (name: string) => void;
  /**
   * Optional data source used to power record search across objects. When
   * omitted, the palette behaves exactly as before — nav items only.
   */
  dataSource?: any;
}

/**
 * The palette on `/studio`, a frame outside every app (objectui#11863). It
 * takes no app props: there is no active app to search, switch from, or build
 * a `/apps/APP` link for. It lists the packages Studio opens, their objects and
 * their flows, plus the organization's package-less flows.
 */
interface StudioCommandPaletteProps {
  scope: 'studio';
}

type CommandPaletteProps = AppCommandPaletteProps | StudioCommandPaletteProps;

/**
 * What the app half of the palette reads in the `studio` scope: no app, so no
 * navigation entry, no app to switch to, no object to search records of, and
 * no data source (record search stays off).
 */
const NO_APP: Omit<AppCommandPaletteProps, 'scope'> = {
  apps: [],
  activeApp: null,
  objects: [],
  onAppChange: () => {},
  dataSource: undefined,
};

/**
 * The palette, behind its own error boundary (objectui#13387). It is mounted in
 * the console's frame, beside the routes, so an error thrown inside it (a
 * render, or a layout effect of the cmdk list) reached no boundary below the
 * root and unmounted the whole console. Now the boundary catches and reports
 * it, the palette closes and draws nothing, and the console stays. The next
 * open remounts a fresh palette; a failed one is not re-rendered while it is
 * closed, so a palette that throws even when closed cannot loop.
 */
export function CommandPalette(props: CommandPaletteProps) {
  const { open, setOpen } = useCommandPalette();
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (open && failed) {
      setFailed(false);
      setGeneration((n) => n + 1);
    }
  }, [open, failed]);

  return (
    <ErrorBoundary
      key={generation}
      fallback={() => null}
      onError={() => {
        setFailed(true);
        setOpen(false);
      }}
    >
      <CommandPaletteBody {...props} />
    </ErrorBoundary>
  );
}

function CommandPaletteBody(props: CommandPaletteProps) {
  const inStudio = props.scope === 'studio';
  const { apps, activeApp, objects, onAppChange, dataSource } = inStudio ? NO_APP : props;
  const { open, setOpen } = useCommandPalette();
  const [inputValue, setInputValue] = useState('');
  const navigate = useNavigate();
  const { appName } = useParams();
  const { setTheme } = useTheme();
  // The shell's one navigation `visible` evaluator, the sidebar's and
  // `nav:menu`'s: an entry that declares an API `dataSource` reads its bound
  // value as `data`, and is hidden until that read answers (objectui#13029).
  const evalVis = useNavVisibility(activeApp);
  const { t, language } = useObjectTranslation();
  // A nav entry's text, the way the sidebar and `nav:menu` name it: an entry
  // with NO `label` shows its target's current label, else its target's machine
  // name (objectui#9868 — `NavigationSyncEffect` writes such entries). A present
  // label renders as authored — an inline locale map in the viewer's `language`,
  // the locale the sidebar passes (objectui#11299).
  const targetLabel = useNavTargetLabel();
  const navLabel = (item: NavigationItem) =>
    resolveNavItemLabel(item, t, targetLabel, language);

  // The ⌘K / Ctrl+K accelerator and the open-state source of truth now live in
  // CommandPaletteProvider so the keyboard shortcut, the header button, and the
  // ?palette=1 deep-link all drive the SAME idempotent open path (ADR-0054 C1/C3).

  // Reset query when the palette closes so reopening doesn't show stale state.
  useEffect(() => {
    if (!open) setInputValue('');
  }, [open]);

  const baseUrl = `/apps/${appName || appRouteSegment(activeApp)}`;
  const { user, activeOrganization } = useAuth();
  const templateContext = useMemo(
    () => ({ currentUserId: user?.id ?? null, currentOrgId: activeOrganization?.id ?? null }),
    [user?.id, activeOrganization?.id],
  );

  // Close, then run. A plain function, not a memo: it must call THIS render's
  // `setOpen`, which reads the URL as it is now. Memoised with no dependencies
  // it kept the first render's, which saw the URL before `?palette=1` was
  // written, so a non-navigating command (Dark Theme) left the palette open;
  // after a deep-linked open, it sent the user back to the page the palette
  // first rendered on (objectui#12683). Every caller is an inline handler
  // built per render, so a memo bought nothing.
  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };
  // A command that leaves the page closes the palette, then asks first while
  // the page holds unsaved edits (objectui#13253): it navigates from a
  // palette item, which no page's link guard sees. Cancel keeps the page and
  // its edits; OK, or a clean page, goes at once.
  const leaveTo = (to: string) => runCommand(() => confirmUnsavedLeave(() => navigate(to)));

  // Extract navigation items from active app, filtering by visibility expressions
  const navItems = flattenNavigation(activeApp?.navigation || []).filter(
    (item) => evalVis(item.visible ?? item.visibleOn, item)
  );

  // The entries the palette shows for the query: a navigation entry or app by
  // its label and its machine name, a built-in command by its value. They are
  // matched here, on word prefixes and contiguous substrings, and only the
  // matches are rendered, so cmdk's default subsequence scorer (it found
  // "Field Zoo" for `zzzz`) no longer decides what shows (objectui#11812).
  const matches = (...terms: Array<string | undefined>) => matchesPaletteQuery(inputValue, terms);
  const navOfType = (type: string, nameKey: string) =>
    navItems.filter((item) => item.type === type && matches(navLabel(item), item[nameKey]));
  const objectItems = navOfType('object', 'objectName');
  const dashboardItems = navOfType('dashboard', 'dashboardName');
  const pageItems = navOfType('page', 'pageName');
  const reportItems = navOfType('report', 'reportName');
  // objectui#13020 — the app's reports beyond its navigation: the ones it
  // ships that this member may open, the list the app's report index shows.
  // Read only while the palette is open inside an app; a report a navigation
  // entry already names is offered through that entry, once.
  const navReportNames = new Set(
    navItems.filter((item) => item.type === 'report').map((item) => item.reportName as string),
  );
  const appReports = useAppReportEntries(activeApp, open && !inStudio).entries.filter(
    (entry) => !navReportNames.has(entry.name) && matches(entry.label, entry.name),
  );
  const switchableApps = apps.filter((a) => a.active !== false);
  const appItems =
    switchableApps.length > 1
      ? switchableApps.filter((app) => matches(resolveKeyedI18nLabel(app.label, t), app.name))
      : [];
  const themeCommands = THEME_COMMANDS.filter((command) => matches(command.value));
  const themeLabel = {
    light: t('console.commandPalette.lightTheme'),
    dark: t('console.commandPalette.darkTheme'),
    system: t('console.commandPalette.systemTheme'),
  };
  // The full-search page lives under an app (`/apps/APP/search`), so the
  // `studio` scope, which has none, offers no such command (objectui#11863).
  const showFullSearch = !inStudio && matches(FULL_SEARCH_VALUE);

  // objectui#11863 — the Studio's packages, objects and flows, read only while
  // the palette is open in the `studio` scope, matched like the entries above.
  const studio = useStudioPaletteEntries(open && inStudio);
  const studioMatches = (entry: StudioPaletteEntry) => matches(entry.label, entry.name);
  const studioPackages = studio.packages.filter(studioMatches);
  const studioObjects = studio.objects.filter(studioMatches);
  const studioFlows = studio.flows.filter(studioMatches);

  // Whitelist of object names visible in this app's nav — used as the search
  // scope so we don't fan out to every object in the tenant.
  const searchableObjectNames = useMemo(
    () =>
      navItems
        .filter((i) => i.type === 'object' && typeof i.objectName === 'string')
        .map((i) => i.objectName as string),
    // navItems is rebuilt every render (filtered list); use a stable signature.
    [activeApp?.name, navItems.map((i) => i.objectName || '').join('|')],
  );

  // A hit is labelled from the row as the viewer may read it: the hook removes
  // the fields this policy denies before the resolver reads it (objectui#10500).
  const perms = usePermissions();
  const { results: recordHits, isSearching } = useRecordSearch({
    query: inputValue,
    objects,
    dataSource,
    objectNames: searchableObjectNames,
    enabled: open && Boolean(dataSource),
    getDisplayName: getRecordDisplayName,
    fieldReadPolicy: perms,
  });

  // Cloud-synced (sys_user_preference) recently-visited records,
  // surfaced in the empty state so the palette is useful before the
  // user types anything. Filtered down to record-type entries so we
  // don't double up with the per-app nav above.
  const { recentItems } = useRecentItems();
  // The one way a recent entry is labelled (objectui#11678); for a record it
  // is the title the entry was visited under.
  const recentLabel = useRecentItemLabel();
  const recentRecords = useMemo(
    () => recentItems.filter((it) => it.type === 'record').slice(0, 5),
    [recentItems],
  );
  const showRecentRecords = open && inputValue.trim().length === 0 && recentRecords.length > 0;

  /**
   * What a recent row draws beside its title (objectui#12852), so two entries
   * that share a title — an organisation and its environment — are never drawn
   * alike: its object's label on the right and its object's icon on the left,
   * as Home's "Recently accessed" row draws them (objectui#12604).
   *
   * The object is the one `recentItemObject` reads off the address the record
   * was stored under, `/apps/APP/OBJECT/record/ID`; nothing else on the entry
   * names it. Its label is the object's current one in the viewer's language
   * (`useNavTargetLabel`), else its machine name; its icon is the object's
   * declared one, else the record kind's glyph. An entry stored under any other
   * address names no object, so its row shows no type and keeps the neutral
   * glyph — ⛔ never a type guessed from the title.
   *
   * `objects` is read inside the function, never at render: the metadata
   * cache loads the object list when it is first read, and a closed palette
   * reads nothing (objectui#11863).
   */
  const metadata = useMetadata();
  const recentContext = (item: RecentItem): { type?: string; icon?: string } => {
    const objectName = recentItemObject(item);
    if (!objectName) return {};
    const def = findByName(metadata.objects, objectName) as { icon?: unknown } | undefined;
    return {
      type: targetLabel({ kind: 'object', objectName }) ?? objectName,
      icon: typeof def?.icon === 'string' && def.icon !== '' ? def.icon : undefined,
    };
  };

  // Index object defs by name so group headings can resolve the object's
  // localized label (labels may be `{ key, defaultValue }` i18n objects, which
  // the hook's plain-string `objectLabel` can't carry).
  const objectsByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const obj of objects || []) {
      if (typeof obj?.name === 'string') map.set(obj.name, obj);
    }
    return map;
  }, [objects]);

  // Group the (server-ranked) record hits by object so the palette lists them
  // under per-object headings — issue objectstack-ai/objectstack#3371 asks for record hits "grouped by
  // object". The object with the top-ranked hit leads (first-seen order), and
  // within each group the server's relevance order is preserved.
  const recordGroups = useMemo(() => {
    const order: string[] = [];
    const byObject = new Map<
      string,
      { objectLabel: string; icon?: string; hits: typeof recordHits }
    >();
    for (const hit of recordHits) {
      let group = byObject.get(hit.objectName);
      if (!group) {
        // Prefer the i18n-resolved object label; fall back to the hit's plain
        // label (already objectName when the def had no string label).
        const objDef = objectsByName.get(hit.objectName);
        const label = resolveKeyedI18nLabel(objDef?.label, t) || hit.objectLabel;
        group = { objectLabel: label, icon: hit.icon, hits: [] };
        byObject.set(hit.objectName, group);
        order.push(hit.objectName);
      }
      group.hits.push(hit);
    }
    return order.map((name) => {
      const group = byObject.get(name)!;
      return { objectName: name, ...group };
    });
  }, [recordHits, objectsByName, t]);

  return (
    <PaletteDialog
      open={open}
      onOpenChange={setOpen}
      // Accessible name/description (rendered visually-hidden as the required
      // Radix DialogTitle/Description) — gives the dialog a stable ARIA name (C4).
      title={t('console.commandPalette.title', { defaultValue: 'Command palette' })}
      description={t('console.commandPalette.placeholder')}
      contentProps={{
        // Stable locator so the overlay is addressable by an automated driver
        // without relying on i18n-fragile visible text (C4).
        'data-testid': 'overlay:command-palette',
      }}
    >
      <CommandInput
        placeholder={t('console.commandPalette.placeholder')}
        value={inputValue}
        onValueChange={setInputValue}
      />
      <CommandList>
        <CommandEmpty>
          {isSearching || studio.loading ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse"
              />
              {t('console.commandPalette.searching', { defaultValue: 'Searching…' })}
            </span>
          ) : (
            t('console.commandPalette.noResults')
          )}
        </CommandEmpty>

        {/* Recently visited records (cloud-synced via sys_user_preference).
            Only renders when the input is empty so search results don't
            compete with this fallback list. */}
        {showRecentRecords && (
          <CommandGroup
            heading={t('console.commandPalette.recentRecords', { defaultValue: 'Recently viewed' })}
          >
            {recentRecords.map((item) => {
              const { type, icon } = recentContext(item);
              const Icon = icon ? getIcon(icon) : FileText;
              return (
                <CommandItem
                  key={`recent:${item.id}`}
                  value={`recent ${recentLabel(item)} ${item.id}`}
                  onSelect={() => leaveTo(item.href)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span className="truncate">{recentLabel(item)}</span>
                  {type && (
                    <span
                      data-testid="palette-recent-type"
                      className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground"
                    >
                      {type}
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {/* Record search hits from the platform's global search
            (/api/v1/search), grouped by object (issue objectstack-ai/objectstack#3371). The searching
            pulse rides the first group's heading so it stays visible while a
            refined query is in flight over an existing result set. */}
        {recordGroups.map((group, groupIndex) => {
          const Icon = getIcon(group.icon);
          return (
            <CommandGroup
              key={`records:${group.objectName}`}
              heading={
                <span className="inline-flex items-center gap-2">
                  {group.objectLabel}
                  {isSearching && groupIndex === 0 && (
                    <span
                      aria-hidden
                      className="inline-block h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse"
                    />
                  )}
                </span>
              }
            >
              {group.hits.map((hit) => (
                <CommandItem
                  key={`${hit.objectName}:${hit.recordId}`}
                  // Stable across queries: cmdk filters nothing here
                  // (`shouldFilter` false), it only selects by the value.
                  value={`record ${hit.display} ${hit.objectLabel} ${hit.objectName} ${hit.recordId}`}
                  onSelect={() => leaveTo(`${baseUrl}/${hit.objectName}/record/${hit.recordId}`)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span className="truncate">{hit.display}</span>
                  {hit.subtitle && (
                    <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">
                      {hit.subtitle}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {/* Object Navigation */}
        {objectItems.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.objects')}>
            {objectItems
              .map(item => {
                const Icon = getIcon(item.icon);
                return (
                  <CommandItem
                    key={item.id}
                    value={`object ${navLabel(item)} ${item.objectName}`}
                    onSelect={() => leaveTo(resolveHref(item, baseUrl, templateContext).href)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{navLabel(item)}</span>
                  </CommandItem>
                );
              })}
          </CommandGroup>
        )}

        {/* Dashboards */}
        {dashboardItems.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.dashboards')}>
            {dashboardItems
              .map(item => (
                <CommandItem
                  key={item.id}
                  value={`dashboard ${navLabel(item)} ${item.dashboardName}`}
                  onSelect={() => leaveTo(resolveHref(item, baseUrl, templateContext).href)}
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />
                  <span>{navLabel(item)}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {/* Pages */}
        {pageItems.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.pages')}>
            {pageItems
              .map(item => (
                <CommandItem
                  key={item.id}
                  value={`page ${navLabel(item)} ${item.pageName}`}
                  onSelect={() => leaveTo(resolveHref(item, baseUrl, templateContext).href)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span>{navLabel(item)}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        )}

        {/* Reports */}
        {(reportItems.length > 0 || appReports.length > 0) && (
          <CommandGroup heading={t('console.commandPalette.reports')}>
            {reportItems
              .map(item => (
                <CommandItem
                  key={item.id}
                  value={`report ${navLabel(item)} ${item.reportName}`}
                  onSelect={() => leaveTo(resolveHref(item, baseUrl, templateContext).href)}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  <span>{navLabel(item)}</span>
                </CommandItem>
              ))}
            {appReports.map((entry) => (
              <CommandItem
                key={`app-report:${entry.name}`}
                value={`report ${entry.label} ${entry.name}`}
                onSelect={() => leaveTo(`${baseUrl}/report/${encodeURIComponent(entry.name)}`)}
              >
                <BarChart3 className="mr-2 h-4 w-4" />
                <span>{entry.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Studio (objectui#11863): packages, objects and flows, `studio` scope only */}
        {studioPackages.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.packages')}>
            {studioPackages.map((entry) => (
              <StudioPaletteItem
                key={entry.key}
                kind="studio-package"
                entry={entry}
                Icon={Boxes}
                onOpen={() => leaveTo(entry.href)}
              />
            ))}
          </CommandGroup>
        )}
        {studioObjects.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.objects')}>
            {studioObjects.map((entry) => (
              <StudioPaletteItem
                key={entry.key}
                kind="studio-object"
                entry={entry}
                Icon={Database}
                onOpen={() => leaveTo(entry.href)}
              />
            ))}
          </CommandGroup>
        )}
        {studioFlows.length > 0 && (
          <CommandGroup heading={t('console.commandPalette.flows')}>
            {studioFlows.map((entry) => (
              <StudioPaletteItem
                key={entry.key}
                kind="studio-flow"
                entry={entry}
                Icon={Workflow}
                onOpen={() => leaveTo(entry.href)}
              />
            ))}
          </CommandGroup>
        )}

        {/* App Switching */}
        {appItems.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('console.commandPalette.switchApp')}>
              {appItems
                .map(app => {
                  const Icon = getIcon(app.icon);
                  return (
                    <CommandItem
                      key={app.name}
                      value={`app ${resolveKeyedI18nLabel(app.label, t)} ${app.name}`}
                      onSelect={() => runCommand(() => confirmUnsavedLeave(() => onAppChange(appRouteSegment(app) ?? app.name)))}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{resolveKeyedI18nLabel(app.label, t)}</span>
                      {app.name === activeApp?.name && (
                        <span className="ml-auto text-xs text-muted-foreground">{t('console.commandPalette.current')}</span>
                      )}
                    </CommandItem>
                  );
                })}
            </CommandGroup>
          </>
        )}

        {/* Theme */}
        {themeCommands.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('console.commandPalette.preferences')}>
              {themeCommands.map(({ value, theme, Icon }) => (
                <CommandItem key={value} value={value} onSelect={() => runCommand(() => setTheme(theme))}>
                  <Icon className="mr-2 h-4 w-4" />
                  <span>{themeLabel[theme]}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Full Search Page */}
        {showFullSearch && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('console.commandPalette.actions')}>
              {/* Manual "Create App" deprecated — AI-first builder is the path. */}
              <CommandItem
                value={FULL_SEARCH_VALUE}
                onSelect={() => leaveTo(`${baseUrl}/search`)}
              >
                <Search className="mr-2 h-4 w-4" />
                <span>{t('console.commandPalette.openFullSearch')}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </PaletteDialog>
  );
}

/**
 * `CommandDialog`'s frame with cmdk's own filter off (objectui#13387).
 * `CommandDialog` passes no props to its cmdk root, so the frame is composed
 * here from the same parts and classes.
 *
 * With its filter on, cmdk re-sorts whenever an item's value changes, walking
 * the group ids its last filter saw. A new query that dropped an object's
 * record group left that id behind: the sort read the unmounted group, threw
 * inside a layout effect, and the throw unmounted the console. With the filter
 * off cmdk neither filters nor sorts; the palette already decides both.
 */
function PaletteDialog({
  open,
  onOpenChange,
  title,
  description,
  contentProps,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  contentProps: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 shadow-lg" {...contentProps}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command shouldFilter={false} className={PALETTE_COMMAND_CLASS}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** The cmdk root's classes, as `CommandDialog` draws them. */
const PALETTE_COMMAND_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5';

/** The theme commands, matched by their value (objectui#11812). */
const THEME_COMMANDS = [
  { value: 'theme light', theme: 'light', Icon: Sun },
  { value: 'theme dark', theme: 'dark', Icon: Moon },
  { value: 'theme system', theme: 'system', Icon: Monitor },
] as const;

/** The full-search command's value, which it is matched by (objectui#11812). */
const FULL_SEARCH_VALUE = 'search all results full page';

/** One Studio entry the `studio` scope lists (objectui#11863). */
interface StudioPaletteEntry {
  /** Unique within its group, and part of its cmdk `value`. */
  key: string;
  /** What the entry shows: a package's name, an object's or a flow's label. */
  label: string;
  /** Its machine name, matched like the label. */
  name: string;
  /** The Studio page it opens. */
  href: string;
  /** The name of the package it belongs to; absent on a package and on a package-less flow. */
  packageName?: string;
}

/** The fields of a served object or flow the Studio groups read. */
interface StudioServedItem {
  name?: unknown;
  label?: Parameters<typeof resolveKeyedI18nLabel>[0];
  /** The owning package's machine id (the spec's `MetadataProtectionFields`). */
  _packageId?: unknown;
}

interface StudioPaletteEntries {
  packages: StudioPaletteEntry[];
  objects: StudioPaletteEntry[];
  flows: StudioPaletteEntry[];
  /** Some list has not answered yet. */
  loading: boolean;
}

const NO_STUDIO_ENTRIES: StudioPaletteEntries = { packages: [], objects: [], flows: [], loading: false };

/**
 * A Studio pillar opened on one item, through the pillar's `?surface=` deep
 * link: the shape `studioOrgScopePath` builds for the package-less scope, under
 * a package. An object opens in the Data pillar and a flow in Automations,
 * the pillars `StudioDesignSurface` routes those surface types to.
 */
function studioSurfacePath(packageId: string, pillar: 'data' | 'automations', surface: { type: string; name: string }): string {
  return `/studio/${encodeURIComponent(packageId)}/${pillar}?${DESIGNER_SURFACE_PARAM}=${encodeURIComponent(formatSurfaceParam(surface))}`;
}

/**
 * The Studio's packages, objects and flows, as the `studio` scope lists them
 * (objectui#11863). Nothing is read until `enabled` (the palette is open in that
 * scope). The package list is read again each time it opens; until that read
 * answers, the previous answer is shown.
 *
 * - **Packages** come from `fetchPackages`, the list the Studio landing and its
 *   package switcher read; kernel packages are already left out there. Each
 *   opens its Data pillar, as a landing card does.
 * - **Objects** come from the metadata cache (`useMetadata().objects`), each
 *   listed under the package it declares (`_packageId`) and opened in that
 *   package's Data pillar. One whose package is not in the list has no Studio
 *   page to open, and is left out.
 * - **Flows** come from the same cache's `flow` list, the unscoped read that
 *   carries every package's flows (the read the package-less scope narrows,
 *   see `loadPackageLessSurfaces`). A packaged flow opens in its package's
 *   Automations pillar; a flow that belongs to no package opens in the
 *   package-less scope (objectui#11553).
 *
 * The published items only: an item that is still a draft is not in either
 * cache list. Until the package list answers nothing is listed, so no entry
 * is drawn without its package. If that read fails, the packaged entries are
 * left out; the landing behind the palette shows the same read's error.
 */
function useStudioPaletteEntries(enabled: boolean): StudioPaletteEntries {
  const metadata = useMetadata();
  const { t } = useObjectTranslation();
  const [packages, setPackages] = useState<PkgEntry[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchPackages().then(
      (list) => {
        if (!cancelled) setPackages(list);
      },
      () => {
        if (!cancelled) setPackages([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return NO_STUDIO_ENTRIES;

  // Read only while open: each read starts that type's fetch when it has not
  // been loaded yet, and the provider re-renders this palette when it answers.
  const objectItems: StudioServedItem[] = metadata.objects;
  const flowItems: StudioServedItem[] = metadata.getItemsByType('flow');
  const typeLoading = (type: string) => {
    const status = metadata.getTypeStatus?.(type);
    return status === 'idle' || status === 'loading';
  };
  const loading = packages === null || typeLoading('object') || typeLoading('flow');
  if (packages === null) return { ...NO_STUDIO_ENTRIES, loading };

  const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const ownPackage = (item: StudioServedItem): PkgEntry | undefined =>
    typeof item._packageId === 'string' ? byId.get(item._packageId) : undefined;
  const named = (item: StudioServedItem): item is StudioServedItem & { name: string } =>
    typeof item.name === 'string' && item.name !== '';

  const objects: StudioPaletteEntry[] = [];
  for (const item of objectItems) {
    const pkg = ownPackage(item);
    if (!pkg || !named(item)) continue;
    objects.push({
      key: `${pkg.id}:${item.name}`,
      label: resolveKeyedI18nLabel(item.label, t) || item.name,
      name: item.name,
      href: studioSurfacePath(pkg.id, 'data', { type: 'object', name: item.name }),
      packageName: pkg.name,
    });
  }

  const flows: StudioPaletteEntry[] = [];
  for (const item of flowItems) {
    if (!named(item)) continue;
    const label = resolveKeyedI18nLabel(item.label, t) || item.name;
    if (isPackageLessItem(item)) {
      flows.push({
        key: `~org:${item.name}`,
        label,
        name: item.name,
        href: studioOrgScopePath({ type: 'flow', name: item.name }),
      });
      continue;
    }
    const pkg = ownPackage(item);
    if (!pkg) continue;
    flows.push({
      key: `${pkg.id}:${item.name}`,
      label,
      name: item.name,
      href: studioSurfacePath(pkg.id, 'automations', { type: 'flow', name: item.name }),
      packageName: pkg.name,
    });
  }

  return {
    packages: packages.map((pkg) => ({
      key: pkg.id,
      label: pkg.name,
      name: pkg.id,
      href: `/studio/${encodeURIComponent(pkg.id)}/data`,
    })),
    objects,
    flows,
    loading,
  };
}

/** One Studio entry: its icon, its label, and the package it belongs to on the right. */
function StudioPaletteItem({
  kind,
  entry,
  Icon,
  onOpen,
}: {
  kind: 'studio-package' | 'studio-object' | 'studio-flow';
  entry: StudioPaletteEntry;
  Icon: LucideIcon;
  onOpen: () => void;
}) {
  return (
    <CommandItem value={`${kind} ${entry.label} ${entry.name} ${entry.key}`} onSelect={onOpen}>
      <Icon className="mr-2 h-4 w-4" />
      <span className="truncate">{entry.label}</span>
      {entry.packageName && (
        <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">{entry.packageName}</span>
      )}
    </CommandItem>
  );
}
