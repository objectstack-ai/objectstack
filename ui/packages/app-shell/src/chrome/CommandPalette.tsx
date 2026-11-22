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
import { useLocation, useNavigate, useParams } from 'react-router-dom';
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
  DIALOG_VIEWPORT_GUTTER,
  ObjectIconTile,
  cn,
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
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useObjectLabel, usePredicateScope, useRecordSearch, type RecordSearchHit } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useTheme } from './ThemeProvider.js';
import { navEntriesShownToMember, useNavMemberGates, type NavMemberGates } from '../hooks/useNavMemberGates.js';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveKeyedI18nLabel, getRecordDisplayName, appRouteSegment } from '../utils/index.js';
import { appAddressSegment, filterActiveApps } from '../utils/appRoute.js';
import { navigationNames } from '../console/appObjectScope.js';
import { getIcon } from '../utils/getIcon.js';
import { AppMark } from '../layout/AppMark.js';
import { useRecentItems } from '../context/RecentItemsProvider.js';
import { useRecentItemLabel } from '../hooks/useRecentItemLabel.js';
import { recentItemObject } from '../console/home/recentItemTypeLabel.js';
import type { RecentItem } from '../context/RecentItemsProvider.js';
import { COMMAND_PALETTE_TESTID, useCommandPalette, useCommandPaletteTypeahead } from '../context/CommandPaletteProvider.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { confirmUnsavedLeave } from './unsavedEdits.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { resolveHref, resolveNavItemLabel } from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';
import { findByName, useNavTargetLabel, type NavTargetLabelOptions } from '../hooks/useNavTargetLabel.js';
import { readObjectsByName } from '../hooks/useObjectPresence.js';
import { useNavTargetColor } from '../hooks/useNavTargetIcon.js';

import { useAuth } from '@object-ui/auth';
import { matchesPaletteQuery } from './paletteMatch.js';
import { fetchPackages, type PkgEntry } from '../views/studio-design/packages-io.js';
import { isPackageLessItem, studioOrgScopePath } from '../views/studio-design/studioScope.js';
import { DESIGNER_SURFACE_PARAM, formatSurfaceParam } from '../views/metadata-admin/nav-selection.js';
import { flattenNavigation, useAppReportEntries } from '../views/appReportIndex.js';
import { useServedApps } from '../hooks/useLauncherApps.js';
import { servedObjectLabel } from '../hooks/servedObjectLabel.js';
import {
  CREATE_AS_MAX,
  paletteCreateHref,
  paletteCreateTargets,
  routeObjectName,
  type PaletteCreateObjectDef,
  type PaletteCreateTarget,
} from './paletteCreate.js';
import { PalettePreviewPane, type PalettePreviewTarget } from './PalettePreviewPane.js';
import { PaletteEnterHint } from './PaletteEnterHint.js';
import { PaletteCurrentPageGroup, paletteCurrentPage } from './PaletteCurrentPage.js';

/** A recent row names its object by name (objectstack#29121). */
const RECENT_ROW_LABELS: NavTargetLabelOptions = { byName: true };

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

/** The keys of an app the record-hit resolution reads: its route keys and navigation trees. */
type PaletteApp = { navigation?: unknown; areas?: unknown } & Record<string, unknown>;

/**
 * Whether `app` lists `objectName` (objectstack#28890): a `type: 'object'`
 * entry naming it, at any depth of its `navigation` or of any
 * `areas[].navigation`, among the entries the member is shown there
 * (`navEntriesShownToMember` under the palette's gates, as
 * `activityObjectRoster` reads every app's navigation). `gates` is `null`
 * only in the `studio` scope, which searches no record.
 */
function appListsObject(app: PaletteApp | null | undefined, objectName: string, gates: NavMemberGates | null): boolean {
  if (!app) return false;
  const areas: unknown[] = Array.isArray(app.areas) ? app.areas : [];
  const trees = [app.navigation, ...areas.map((area) => (area as { navigation?: unknown } | null)?.navigation)];
  const pick = (item: Record<string, unknown>) => (item.type === 'object' ? item.objectName : undefined);
  return trees.some(
    (tree) =>
      Array.isArray(tree) &&
      navigationNames(gates ? navEntriesShownToMember(tree as NavigationItem[], gates) : tree, pick).includes(objectName),
  );
}

/**
 * The app a record hit opens under (objectstack#28890), as the segment of its
 * `/apps/APP` link: the palette's own app when it lists the hit's object;
 * otherwise the first app the user can open (`filterActiveApps`, metadata
 * order) that lists it, addressed by `appAddressSegment`; and the palette's
 * own app again when none does, so `undefined` means "stay here".
 *
 * An app with no object navigation searches every object (the scope below),
 * so its hits named objects it does not list, and each opened under it: the
 * record page drew that app's sidebar and switcher, neither of which reaches
 * the object (cloud's Account app, a component-only app, opened an
 * environment there instead of under the Cloud app that lists it).
 */
function recordHitAppSegment(
  apps: readonly PaletteApp[],
  activeApp: PaletteApp | null | undefined,
  objectName: string,
  gates: NavMemberGates | null,
): string | undefined {
  if (appListsObject(activeApp, objectName, gates)) return undefined;
  const host = filterActiveApps(apps).find((app) => appListsObject(app, objectName, gates));
  return host ? appAddressSegment(apps, host) : undefined;
}

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
      {props.scope === 'studio' ? <CommandPaletteBody {...props} gates={null} /> : <AppCommandPaletteBody {...props} />}
    </ErrorBoundary>
  );
}

/**
 * The app scope's palette, with the member's navigation gates, the sidebar's
 * (objectstack#26892), for the app it lists: inside an app that is the
 * frame's app; on Home, whose expression scope binds none, it is the host app.
 * Built here, not in the body: the `studio` scope has no app, so it asks for
 * no gate and reads nothing until it opens.
 */
function AppCommandPaletteBody(props: AppCommandPaletteProps) {
  const gates = useNavMemberGates(props.activeApp ?? undefined);
  return <CommandPaletteBody {...props} gates={gates} />;
}

/**
 * `gates`: the member's navigation gates in the app scope, `null` in the
 * `studio` scope, which has no navigation and lists no app report.
 */
function CommandPaletteBody(props: CommandPaletteProps & { gates: NavMemberGates | null }) {
  const { gates } = props;
  const inStudio = props.scope === 'studio';
  const { apps, activeApp, objects, onAppChange, dataSource } = inStudio ? NO_APP : props;
  const { open, setOpen } = useCommandPalette();
  const [inputValue, setInputValue] = useState('');
  // The entry the keyboard is on, by its cmdk value (objectstack#36286): the
  // footer says what Enter does to it, and a record hit is previewed beside
  // the results.
  const [selectedValue, setSelectedValue] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { appName } = useParams();
  const { setTheme } = useTheme();
  const { t, language } = useObjectTranslation();
  // A nav entry's text, the way the sidebar and `nav:menu` name it: an entry
  // with NO `label` shows its target's current label, else its target's machine
  // name (objectui#9868 — the console's page and dashboard create sites write
  // such entries through `useNavigationWrites`). A present
  // label renders as authored — an inline locale map in the viewer's `language`,
  // the locale the sidebar passes (objectui#11299).
  const targetLabel = useNavTargetLabel(RECENT_ROW_LABELS);
  const navLabel = (item: NavigationItem) =>
    resolveNavItemLabel(item, t, targetLabel, language);

  // The ⌘K / Ctrl+K accelerator and the open-state source of truth now live in
  // CommandPaletteProvider so the keyboard shortcut, the header button, and the
  // ?palette=1 deep-link all drive the SAME idempotent open path (ADR-0054 C1/C3).

  // Reset query when the palette closes so reopening doesn't show stale state.
  useEffect(() => {
    if (!open) {
      setInputValue('');
      setSelectedValue('');
    }
  }, [open]);
  // What was typed between the shortcut and this input's focus starts the
  // query (objectstack#32627).
  useCommandPaletteTypeahead(open, setInputValue);

  const baseUrl = `/apps/${appName || appRouteSegment(activeApp)}`;
  // A record hit's own base: the app that lists its object (objectstack#28890).
  const recordHitBaseUrl = (objectName: string): string => {
    const segment = recordHitAppSegment(apps, activeApp, objectName, gates);
    return segment ? `/apps/${segment}` : baseUrl;
  };
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

  // The active app's navigation entries as the sidebar shows them to this
  // member (objectstack#26892): `navEntriesShownToMember` under the sidebar's
  // gates, the ones `UnifiedSidebar` draws with (the object-read prune, and per
  // entry its `visible`, through the shell's one evaluator, so an entry that
  // declares an API `dataSource` is hidden until its read answers,
  // objectui#13029; its `requiredPermissions`; its runtime-capability gates),
  // then flattened. Filtering the flattened leaves by their own `visible`
  // alone, as this once did, offered an entry the sidebar hides by
  // `requiredPermissions`, by a runtime-capability gate, or by its group's
  // `visible`, and opened it empty.
  const navItems = gates ? flattenNavigation(navEntriesShownToMember(activeApp?.navigation || [], gates)) : [];

  // The entries the palette shows for the query: a navigation entry or app by
  // its label and its machine name, a built-in command by its label and its
  // value. They are matched here, on word prefixes and contiguous substrings,
  // and only the matches are rendered, so cmdk's default subsequence scorer
  // (it found "Field Zoo" for `zzzz`) no longer decides what shows
  // (objectui#11812).
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
  // entry already names is offered through that entry, once. A `report` entry
  // with no `reportName` is the app's report index (objectstack#27525): it is
  // offered as itself, names no report, and leaves every report to this list.
  const navReportNames = new Set(
    navItems
      .filter((item) => item.type === 'report' && typeof item.reportName === 'string' && item.reportName !== '')
      .map((item) => item.reportName as string),
  );
  const appReports = useAppReportEntries(activeApp, open && !inStudio, gates).entries.filter(
    (entry) => !navReportNames.has(entry.name) && matches(entry.label, entry.name),
  );
  // Every active app, `hidden` ones included, minus an app the user's
  // permission sets hide: the palette offers none that Home's tiles and the
  // switcher withhold for that reason (objectstack#26838).
  const switchableApps = useServedApps(apps.filter((a) => a.active !== false));
  const appItems =
    switchableApps.length > 1
      ? switchableApps.filter((app) => matches(resolveKeyedI18nLabel(app.label, t), app.name))
      : [];
  // A built-in command is found by the words of the label it shows, in the
  // member's language, and by its value (objectstack#33061): matched on the
  // value alone, "Open Full Search Page" was not found by `open` or
  // `full search`, and under a non-English locale no command was found by any
  // word of its label.
  const themeLabel = {
    light: t('console.commandPalette.lightTheme'),
    dark: t('console.commandPalette.darkTheme'),
    system: t('console.commandPalette.systemTheme'),
  };
  const themeCommands = THEME_COMMANDS.filter((command) => matches(themeLabel[command.theme], command.value));
  const fullSearchLabel = t('console.commandPalette.openFullSearch');
  // The full-search page lives under an app (`/apps/APP/search`), so the
  // `studio` scope, which has none, offers no such command (objectui#11863).
  const showFullSearch = !inStudio && matches(fullSearchLabel, FULL_SEARCH_VALUE);

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
   * The object is read inside the function, never at render, so a closed
   * palette reads nothing (objectui#11863); and it is read by name
   * (`readObjectsByName`, objectstack#29121), so a few recent rows never load
   * the whole object registry — on Home nothing else has.
   */
  const metadata = useMetadata();
  const recentTargetLabel = useNavTargetLabel(RECENT_ROW_LABELS);
  const recentContext = (item: RecentItem): { objectName?: string; type?: string; icon?: string; color?: string } => {
    const objectName = recentItemObject(item);
    if (!objectName) return {};
    const def = findByName(readObjectsByName(metadata, [objectName]), objectName) as { icon?: unknown; color?: unknown } | undefined;
    return {
      objectName,
      type: recentTargetLabel({ kind: 'object', objectName }) ?? objectName,
      icon: typeof def?.icon === 'string' && def.icon !== '' ? def.icon : undefined,
      color: typeof def?.color === 'string' ? def.color : undefined,
    };
  };
  // objectstack#35985 — an object entry draws the object's tile, in its colour.
  const navTargetColor = useNavTargetColor();

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
      { objectLabel: string; icon?: string; color?: string; hits: typeof recordHits }
    >();
    for (const hit of recordHits) {
      let group = byObject.get(hit.objectName);
      if (!group) {
        // Prefer the i18n-resolved object label; fall back to the hit's plain
        // label (already objectName when the def had no string label).
        const objDef = objectsByName.get(hit.objectName);
        const label = resolveKeyedI18nLabel(objDef?.label, t) || hit.objectLabel;
        group = {
          objectLabel: label,
          icon: hit.icon,
          color: typeof objDef?.color === 'string' ? objDef.color : hit.color,
          hits: [],
        };
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

  // objectstack#36286 — the record hit the keyboard is on, previewed beside
  // the results while there are any.
  const recordHitByValue = new Map<string, RecordSearchHit>();
  for (const hit of recordHits) recordHitByValue.set(recordHitValue(hit), hit);
  const selectedHit = recordHitByValue.get(selectedValue);
  const previewTarget: PalettePreviewTarget | null = selectedHit
    ? { objectName: selectedHit.objectName, recordId: selectedHit.recordId }
    : null;
  const showPreview = recordGroups.length > 0;
  // A query's record hits answer after its other entries are drawn, above
  // them: when a new set of hits lands, the selection moves to the first one,
  // so the top entry is the one Enter opens and the pane previews.
  const firstHitValue = recordGroups[0]?.hits[0] ? recordHitValue(recordGroups[0].hits[0]) : '';
  // Compared by the hits' text alone (ui/AGENTS.md #10): only a new set of
  // hits moves the selection, and the arrow keys own it after.
  const hitSignature = recordHits.map(recordHitValue).join('\n');
  const [seenHitSignature, setSeenHitSignature] = useState('');
  if (hitSignature !== seenHitSignature) {
    setSeenHitSignature(hitSignature);
    if (firstHitValue !== '') setSelectedValue(firstHitValue);
  }

  // objectstack#36286 — what the page behind the palette offers (its list's
  // or its record's favorites entry), above everything else on the empty
  // palette; nothing once something is typed.
  const currentPage =
    open && !inStudio && inputValue.trim() === ''
      ? paletteCurrentPage(location.pathname, (name) => objectsByName.has(name))
      : null;

  // objectstack#36286 — the app's objects the member may create a record of,
  // the object of the page the palette was opened on first. Only once
  // something is typed: the empty palette is the recent records' screen.
  const predicateScope = usePredicateScope();
  const { objectLabel } = useObjectLabel();
  const query = inputValue.trim();
  const createTargets: PaletteCreateTarget[] =
    open && query !== '' && !inStudio
      ? paletteCreateTargets(
          searchableObjectNames,
          objectsByName as ReadonlyMap<string, PaletteCreateObjectDef>,
          perms,
          predicateScope,
          routeObjectName(location.pathname, searchableObjectNames),
        )
      : [];
  const createLabel = (target: PaletteCreateTarget) =>
    servedObjectLabel(target.def as { name: string; label?: unknown }, language, objectLabel, target.objectName);
  // A "New OBJECT" entry, found by its label's words and the object's own label and name.
  const newRecordRows = createTargets
    .map((target) => {
      const objectText = createLabel(target);
      const label = t('console.objectView.newObject', { object: objectText, defaultValue: 'New {{object}}' });
      return { target, label, objectText };
    })
    .filter((row) => matches(row.label, row.objectText, row.target.objectName, NEW_RECORD_TERM));
  // "Create 'words' as OBJECT": the typed words seed the object's title field.
  // Not for an object the query already names as a "New" entry — the words
  // ask for that action then, not for a record called that.
  const newRecordObjects = new Set(newRecordRows.map((row) => row.target.objectName));
  const createAsRows = createTargets
    .filter((target) => target.prefillField && !newRecordObjects.has(target.objectName))
    .slice(0, CREATE_AS_MAX)
    .map((target) => ({ target, objectText: createLabel(target) }));

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
        'data-testid': COMMAND_PALETTE_TESTID,
      }}
      value={selectedValue}
      onValueChange={setSelectedValue}
      wide={showPreview}
    >
      <CommandInput
        placeholder={t('console.commandPalette.placeholder')}
        value={inputValue}
        onValueChange={setInputValue}
      />
      <CommandList className="min-w-0">
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

        {currentPage && (
          <PaletteCurrentPageGroup
            page={currentPage}
            objectDef={objectsByName.get(currentPage.objectName)}
            run={runCommand}
          />
        )}

        {/* Recently visited records (cloud-synced via sys_user_preference).
            Only renders when the input is empty so search results don't
            compete with this fallback list. */}
        {showRecentRecords && (
          <CommandGroup
            heading={t('console.commandPalette.recentRecords', { defaultValue: 'Recently viewed' })}
          >
            {recentRecords.map((item) => {
              const { objectName, type, icon, color } = recentContext(item);
              const Icon = icon ? getIcon(icon) : FileText;
              return (
                <CommandItem
                  key={`recent:${item.id}`}
                  value={`recent ${recentLabel(item)} ${item.id}`}
                  onSelect={() => leaveTo(item.href)}
                >
                  {objectName ? (
                    <ObjectIconTile glyph={Icon} color={color} className="mr-2" />
                  ) : (
                    <Icon className="mr-2 h-4 w-4" />
                  )}
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
                  value={recordHitValue(hit)}
                  onSelect={() => leaveTo(`${recordHitBaseUrl(hit.objectName)}/${hit.objectName}/record/${hit.recordId}`)}
                >
                  <ObjectIconTile glyph={Icon} color={group.color} className="mr-2" />
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
                const color = item.objectName ? navTargetColor({ kind: 'object', objectName: item.objectName }) : undefined;
                return (
                  <CommandItem
                    key={item.id}
                    value={`object ${navLabel(item)} ${item.objectName}`}
                    onSelect={() => leaveTo(resolveHref(item, baseUrl, templateContext).href)}
                  >
                    <ObjectIconTile glyph={Icon} color={color} className="mr-2" />
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
                  value={`report ${navLabel(item)} ${item.reportName ?? ''}`}
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
                  return (
                    <CommandItem
                      key={app.name}
                      value={`app ${resolveKeyedI18nLabel(app.label, t)} ${app.name}`}
                      onSelect={() => runCommand(() => confirmUnsavedLeave(() => onAppChange(appAddressSegment(apps, app) ?? app.name)))}
                    >
                      {/* objectstack#36157 — the app's own mark, as the switcher draws it. */}
                      <AppMark app={app} size="sm" className="mr-2" />
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

        {/* objectstack#36286 — create a record, below every result: the
            "New OBJECT" entries the query finds, then "Create 'words' as
            OBJECT". Last, so Enter on a query that finds something opens it. */}
        {(newRecordRows.length > 0 || createAsRows.length > 0) && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t('console.commandPalette.create', { defaultValue: 'Create' })}>
              {newRecordRows.map(({ target, label }) => (
                <CommandItem
                  key={`create-new:${target.objectName}`}
                  value={`create new ${target.objectName}`}
                  onSelect={() => leaveTo(paletteCreateHref(baseUrl, target.objectName))}
                >
                  <ObjectIconTile
                    glyph={getIcon(typeof target.def.icon === 'string' ? target.def.icon : undefined)}
                    color={typeof target.def.color === 'string' ? target.def.color : undefined}
                    className="mr-2"
                  />
                  <span className="truncate">{label}</span>
                </CommandItem>
              ))}
              {createAsRows.map(({ target, objectText }) => (
                <CommandItem
                  key={`create-as:${target.objectName}`}
                  value={`create as ${target.objectName}`}
                  onSelect={() =>
                    leaveTo(paletteCreateHref(baseUrl, target.objectName, { field: target.prefillField!, value: query }))
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="truncate">
                    {t('console.commandPalette.createAs', {
                      query,
                      object: objectText,
                      defaultValue: 'Create "{{query}}" as {{object}}',
                    })}
                  </span>
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
                <span>{fullSearchLabel}</span>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
      {showPreview && <PalettePreviewPane target={previewTarget} dataSource={dataSource} />}
      <PaletteEnterHint value={selectedValue} />
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
  value,
  onValueChange,
  wide,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  contentProps: Record<`data-${string}`, string>;
  /** The selected entry's cmdk value (objectstack#36286). */
  value: string;
  onValueChange: (value: string) => void;
  /** Room for the record preview beside the results (objectstack#36286). */
  wide: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('overflow-hidden p-0 shadow-lg', wide && PALETTE_WIDE_CLASS)} {...contentProps}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command shouldFilter={false} value={value} onValueChange={onValueChange} className={PALETTE_COMMAND_CLASS}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The palette's width while a record preview is drawn beside the results
 * (objectstack#36286): room for two halves. The preview pane itself shows only
 * from a 45rem frame on (`PREVIEW_PANE_CLASS`), so a narrower window keeps the
 * results alone. The cap (768px) is wider than the narrowest `sm` window can
 * hold with a margin, so it reads the shared viewport gutter (objectui#12603).
 */
const PALETTE_WIDE_CLASS = `sm:max-w-3xl ${DIALOG_VIEWPORT_GUTTER}`;

/**
 * The cmdk root's classes, as `CommandDialog` draws them, laid out as a grid
 * (objectstack#36286): the input and the footer span the frame, the results
 * and the record preview pane share the row between them. The root is also the
 * container the pane's width query reads (`@container/palette`).
 */
const PALETTE_COMMAND_CLASS =
  '@container/palette grid grid-cols-[minmax(0,1fr)_auto] [&>[cmdk-input-wrapper]]:col-span-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5';

/** The theme commands, matched by their label and their value (objectui#11812, objectstack#33061). */
const THEME_COMMANDS = [
  { value: 'theme light', theme: 'light', Icon: Sun },
  { value: 'theme dark', theme: 'dark', Icon: Moon },
  { value: 'theme system', theme: 'system', Icon: Monitor },
] as const;

/**
 * A record hit's cmdk value (objectstack#36286 reads the selection back by it):
 * stable across queries, since cmdk filters nothing here (`shouldFilter`
 * false) and only selects by the value.
 */
function recordHitValue(hit: RecordSearchHit): string {
  return `record ${hit.display} ${hit.objectLabel} ${hit.objectName} ${hit.recordId}`;
}

/** A "New OBJECT" entry is also found by this word, in every language (objectstack#36286). */
const NEW_RECORD_TERM = 'create new';

/** The full-search command's value, matched beside its label (objectui#11812, objectstack#33061). */
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
