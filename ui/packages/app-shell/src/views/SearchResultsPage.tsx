/**
 * SearchResultsPage
 *
 * A dedicated search results page accessible via /apps/:appName/search?q=...
 * Extends the command palette with a full-page search experience, showing
 * objects, dashboards, pages, and reports matching the query.
 * @module
 */

import { useState, useMemo } from 'react';
import { useSearchParams, Link, useParams } from 'react-router-dom';
import {
  Input,
  Card,
  CardContent,
  Badge,
} from '@object-ui/components';
import {
  Search,
  Database,
  LayoutDashboard,
  FileText,
  BarChart3,
  ArrowLeft,
} from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useRecordSearch } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useAdapter } from '../providers/AdapterProvider.js';
import { matchAppBySegment } from '../utils/appRoute.js';
import { resolveKeyedI18nLabel, getRecordDisplayName } from '../utils/index.js';
import { getIcon } from '../utils/getIcon.js';
import { resolveHref, resolveNavItemLabel } from '@object-ui/layout';
import { useNavTargetLabel } from '../hooks/useNavTargetLabel.js';
import { useAuth } from '@object-ui/auth';

interface SearchResult {
  id: string;
  label: string;
  href: string;
  type: 'object' | 'dashboard' | 'page' | 'report';
  description?: string;
}

/** Flatten nested navigation groups into a flat list of leaf items */
function flattenNavigation(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items) {
    if (item.type === 'group' && item.children) {
      result.push(...flattenNavigation(item.children));
    } else {
      result.push(item);
    }
  }
  return result;
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  object: Database,
  dashboard: LayoutDashboard,
  page: FileText,
  report: BarChart3,
};

const TYPE_COLORS: Record<string, string> = {
  object: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  dashboard: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  page: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  report: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
};

export function SearchResultsPage() {
  const { t, language } = useObjectTranslation();
  const { appName } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';
  const [query, setQuery] = useState(queryParam);

  const { apps: metadataApps, objects: metadataObjects } = useMetadata();
  const apps = metadataApps || [];
  // Stable reference so the record-search memos below don't rerun every render
  // (useMetadata().objects can hand back a fresh array each call).
  const objects = useMemo(() => metadataObjects || [], [metadataObjects]);
  const activeApp = matchAppBySegment(apps, appName) || apps[0];
  const baseUrl = `/apps/${appName}`;
  const { user, activeOrganization } = useAuth();
  const dataSource = useAdapter();
  // The same resolver the sidebar, `nav:menu` and the ⌘K palette use: an entry
  // with NO `label` is listed — and matched — by its target's current label,
  // else its target's machine name (objectui#9868).
  const targetLabel = useNavTargetLabel();

  // Build searchable items from navigation
  const allItems = useMemo((): SearchResult[] => {
    if (!activeApp) return [];
    const navItems = flattenNavigation(activeApp.navigation || []);
    const templateContext = { currentUserId: user?.id ?? null, currentOrgId: activeOrganization?.id ?? null };
    return navItems.map((item: any) => {
      const { href } = resolveHref(item, baseUrl, templateContext);

      return {
        id: item.id,
        // `resolveNavItemLabel`, not `item.label || item.objectName || …`: that
        // chain listed an unlabelled entry by its machine name even when its
        // target is labelled, and handed a keyed label object to `toLowerCase`.
        // An inline locale map is listed — and matched — in the viewer's
        // `language`, as the sidebar shows it (objectui#11299).
        label: resolveNavItemLabel(item, t, targetLabel, language),
        href,
        type: item.type,
        description: item.description,
      };
    }).filter((item: SearchResult) => item.href !== '#');
  }, [activeApp, baseUrl, user?.id, t, targetLabel, language]);

  // Filter results
  const results = useMemo(() => {
    if (!query.trim()) return allItems;
    const lower = query.toLowerCase();
    return allItems.filter(
      item =>
        item.label.toLowerCase().includes(lower) ||
        item.type.toLowerCase().includes(lower) ||
        (item.description && item.description.toLowerCase().includes(lower)),
    );
  }, [allItems, query]);

  const handleSearch = (value: string) => {
    setQuery(value);
    setSearchParams(value ? { q: value } : {});
  };

  // Group results by type
  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    for (const r of results) {
      (groups[r.type] ||= []).push(r);
    }
    return groups;
  }, [results]);

  // Record search — the same global-search path the ⌘K palette uses
  // (`/api/v1/search` via `useRecordSearch`/`searchAll`), scoped to the app's
  // searchable nav objects so record links resolve within this app. This is
  // what makes the full-page search actually surface records, not just the
  // metadata nav items above (issue objectstack-ai/objectstack#3371 follow-up).
  const searchableObjectNames = useMemo(() => {
    if (!activeApp) return [] as string[];
    return flattenNavigation(activeApp.navigation || [])
      .filter((i: any) => i.type === 'object' && typeof i.objectName === 'string')
      .map((i: any) => i.objectName as string);
  }, [activeApp]);

  // A hit is labelled from the row as the viewer may read it: the hook removes
  // the fields this policy denies before the resolver reads it (objectui#10500).
  const perms = usePermissions();
  const { results: recordHits, isSearching: recordsSearching } = useRecordSearch({
    query,
    objects,
    dataSource,
    objectNames: searchableObjectNames,
    enabled: Boolean(dataSource) && query.trim().length >= 2,
    // The full page has room for more than the palette's terse list.
    topPerObject: 5,
    maxObjectsQueried: 12,
    getDisplayName: getRecordDisplayName,
    fieldReadPolicy: perms,
  });

  // Index object defs by name for i18n-resolved group headings and icons.
  const objectsByName = useMemo(() => {
    const map = new Map<string, any>();
    for (const obj of objects) {
      if (typeof obj?.name === 'string') map.set(obj.name, obj);
    }
    return map;
  }, [objects]);

  // Group record hits by object, preserving the server's cross-object ranking
  // for which object leads.
  const recordGroups = useMemo(() => {
    const order: string[] = [];
    const byObject = new Map<
      string,
      { label: string; icon?: string; hits: typeof recordHits }
    >();
    for (const hit of recordHits) {
      let group = byObject.get(hit.objectName);
      if (!group) {
        const objDef = objectsByName.get(hit.objectName);
        const label = resolveKeyedI18nLabel(objDef?.label, t) || hit.objectLabel;
        group = { label, icon: objDef?.icon ?? hit.icon, hits: [] };
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

  const totalCount = results.length + recordHits.length;
  const hasAnyResults = totalCount > 0;

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to={baseUrl}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('search.back')}
        </Link>
        <h1 className="text-xl font-semibold">{t('search.title')}</h1>
      </div>

      {/* Search input */}
      <div className="relative">
        <label htmlFor="search-results-input" className="sr-only">{t('search.placeholder')}</label>
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          id="search-results-input"
          value={query}
          onChange={(e: any) => handleSearch(e.target.value)}
          placeholder={t('search.placeholder')}
          className="pl-10 h-11 text-base"
          autoFocus
        />
      </div>

      {/* Results count */}
      {/*
        Both branches are i18next count families (objectui#11445): each passes
        `count` and i18next picks the slot `Intl.PluralRules` selects, so `ru`
        and `ar` read their own noun form at every count rather than the two
        slots a `=== 1` key switch gave them. The browse branch once asked one
        plural string at every count and shipped `1 items available`
        (objectui#9664); its `_one` slot is the repair now.
      */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {query.trim()
            ? t('search.resultsCount', { count: totalCount, query })
            : t('search.itemsAvailable', { count: allItems.length })}
        </span>
        {recordsSearching && (
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse"
          />
        )}
      </div>

      {/* Results */}
      {!hasAnyResults && !recordsSearching ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">{t('search.noResults')}</p>
          <p className="text-sm text-muted-foreground/80 mt-1">
            {t('search.noResultsHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Record hits (record instances) grouped by object — server-ranked. */}
          {recordGroups.map((group) => {
            const GroupIcon = getIcon(group.icon);
            return (
              <div key={`records:${group.objectName}`}>
                <h2 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <GroupIcon className="h-4 w-4" />
                  {group.label}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {group.hits.length}
                  </Badge>
                </h2>
                <div className="grid gap-2">
                  {group.hits.map((hit) => {
                    const HitIcon = getIcon(hit.icon);
                    return (
                      <Link
                        key={`${hit.objectName}:${hit.recordId}`}
                        to={`${baseUrl}/${hit.objectName}/record/${hit.recordId}`}
                        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                          <CardContent className="flex items-center gap-3 p-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                              <HitIcon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{hit.display}</p>
                              {hit.subtitle && (
                                <p className="text-xs text-muted-foreground truncate">{hit.subtitle}</p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Navigation matches (objects, dashboards, pages, reports). */}
          {Object.entries(grouped).map(([type, items]) => {
            const TypeIcon = TYPE_ICONS[type] || Database;
            const typeLabelKey = `search.type${type.charAt(0).toUpperCase()}${type.slice(1)}s`;
            return (
              <div key={type}>
                <h2 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <TypeIcon className="h-4 w-4" />
                  {t(typeLabelKey)}
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {items.length}
                  </Badge>
                </h2>
                <div className="grid gap-2">
                  {items.map(item => {
                    const ItemIcon = TYPE_ICONS[item.type] || Database;
                    const itemBadgeKey = `search.badge${item.type.charAt(0).toUpperCase()}${item.type.slice(1)}`;
                    return (
                    <Link key={item.id} to={item.href} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                        <CardContent className="flex items-center gap-3 p-3">
                          <div className={`flex h-8 w-8 items-center justify-center rounded ${TYPE_COLORS[item.type] || ''}`}>
                            <ItemIcon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.label}</p>
                            {item.description && (
                              <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {t(itemBadgeKey)}
                          </Badge>
                        </CardContent>
                      </Card>
                    </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
