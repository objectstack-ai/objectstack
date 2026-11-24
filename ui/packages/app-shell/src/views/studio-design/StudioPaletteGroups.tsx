// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The groups the command palette lists on a Studio design page
 * (objectstack#36900): the left menu's groups, in its order, each with the
 * menu's own entries and, on a package, every item of the types it lists.
 * What it lists and where each entry opens is `studioPaletteModel.ts`; this
 * file reads it and draws it inside the palette.
 *
 * ## Read only while the palette is open
 *
 * The palette mounts this component inside its open dialog, so nothing here
 * is read on a page where ⌘K is never pressed. It reads what the left menu
 * reads, with the same rule (`scopeDirectoryEntries` over the registry's type
 * entries and the diagnostics sweep), so the palette and the menu never
 * disagree on which types a package holds; then, on a package, each of those
 * types' served list, the read the type's own list page makes. A list that
 * fails to answer lists none of its items: the type's list page shows that
 * read's error, and its menu entry is still offered here.
 *
 * ## Matched, not filtered by cmdk
 *
 * The palette turns cmdk's own filter off (objectui#13387); every entry here
 * is matched with the palette's one matcher (`matchesPaletteQuery`): a menu
 * entry by its label, its type's machine name and its group's name; an item by
 * its label, its name and its type's label.
 */

import * as React from 'react';
import {
  Activity,
  Building2,
  Database,
  KeyRound,
  Layers,
  List,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { CommandGroup, CommandItem } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { matchesPaletteQuery } from '../../chrome/paletteMatch.js';
import type { StudioPaletteGroupsProps } from '../../chrome/CommandPalette.js';
import { resolveKeyedI18nLabel } from '../../utils/index.js';
import { scopeDirectoryEntries } from '../metadata-admin/directoryScope.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { resolveResourceConfig } from '../metadata-admin/registry.js';
import {
  useGlobalDiagnostics,
  useMetadataClient,
  useMetadataTypes,
  type RichMetadataTypeEntry,
} from '../metadata-admin/useMetadata.js';
import { studioMenuGroupLabel } from './studioMenuGroupLabel.js';
import {
  STUDIO_MENU_DESIGNER_TYPES,
  buildStudioMenu,
  studioMenuScope,
  type StudioMenuEntry,
  type StudioMenuGroup,
} from './studioMenuModel.js';
import {
  STUDIO_PALETTE_ITEMLESS_TYPES,
  buildStudioPaletteGroups,
  studioPaletteItemAddress,
  studioPaletteItemsOf,
  studioPalettePackages,
  type StudioPaletteItem,
} from './studioPaletteModel.js';

/** The icon an item of each group draws, the menu's group icon. */
const GROUP_ICONS: Record<StudioMenuGroup, LucideIcon> = {
  data: Database,
  ui: Layers,
  automation: Workflow,
  system: Settings,
  security: ShieldCheck,
  ai: Sparkles,
};

/** The icon each menu entry draws: a type's list, or the page it opens. */
const ENTRY_ICONS: Record<StudioMenuEntry['kind'], LucideIcon> = {
  type: List,
  orgFlows: Building2,
  owd: Share2,
  diagnostics: Activity,
  environment: KeyRound,
};

/** The menu's own names of the entries that are not a type (`StudioMenu.tsx` names them so). */
const ENTRY_LABEL_KEYS: Record<Exclude<StudioMenuEntry['kind'], 'type'>, string> = {
  orgFlows: 'engine.studio.menu.orgFlows',
  owd: 'engine.studio.menu.owd',
  diagnostics: 'engine.studio.menu.diagnostics',
  environment: 'engine.studio.menu.environment',
};

/**
 * The items of a package's palette: each listed type's served list, scoped to
 * the package and its pair. `types` is `null` until the menu's rule has
 * answered, so the lists are read once, for the types the menu settled on.
 * The read is keyed on the package and the type names, never on the identity
 * of the memoised `types` (`ui/AGENTS.md` #10).
 */
function useStudioPaletteItems(
  client: ReturnType<typeof useMetadataClient>,
  packageId: string | null,
  types: readonly RichMetadataTypeEntry[] | null,
): { items: StudioPaletteItem[]; loading: boolean } {
  const key = packageId && types ? `${packageId}|${types.map((e) => e.type).join(',')}` : null;
  const typesRef = React.useRef(types);
  React.useLayoutEffect(() => {
    typesRef.current = types;
  });
  const [read, setRead] = React.useState<{ key: string; items: StudioPaletteItem[] } | null>(null);
  React.useEffect(() => {
    const listed = typesRef.current;
    if (!key || !packageId || !listed) return;
    let cancelled = false;
    const packages = studioPalettePackages(packageId);
    Promise.all(
      listed
        .filter((entry) => !STUDIO_PALETTE_ITEMLESS_TYPES.has(entry.type))
        .map(async (entry) => {
          const config = resolveResourceConfig(entry.type, entry);
          try {
            const rows = await client.list<unknown>(entry.type);
            return studioPaletteItemsOf(entry.type, rows ?? [], {
              packages,
              primaryKey: config.primaryKey,
              listFilter: config.listFilter,
            });
          } catch {
            return [];
          }
        }),
    ).then((lists) => {
      if (!cancelled) setRead({ key, items: lists.flat() });
    });
    return () => {
      cancelled = true;
    };
  }, [client, packageId, key]);
  if (!packageId) return { items: [], loading: false };
  if (!key || read?.key !== key) return { items: [], loading: true };
  return { items: read.items, loading: false };
}

export interface StudioPaletteGroupsComponentProps extends StudioPaletteGroupsProps {
  /** The `/studio/:segment` the palette is open on: a package id, `~org` or `~all`. */
  segment: string;
}

export function StudioPaletteGroups({
  segment,
  query,
  open,
  onLoadingChange,
}: StudioPaletteGroupsComponentProps): React.ReactElement {
  const locale = useMetadataLocale();
  const { t: translate } = useObjectTranslation();
  const scope = studioMenuScope(segment);
  const packageId = scope.kind === 'package' ? scope.packageId : null;
  const environment = scope.kind !== 'package';

  // The left menu's reads and rule (`StudioMenu.tsx`), so the two agree.
  const client = useMetadataClient();
  const { entries, loading: typesLoading } = useMetadataTypes(client);
  const { countsByType, packagesByType, loading: sweepLoading } = useGlobalDiagnostics(
    client,
    'error',
    packageId ?? undefined,
  );
  const types = scopeDirectoryEntries(entries, {
    environment,
    packageId,
    packagesByType,
    always: STUDIO_MENU_DESIGNER_TYPES,
  });
  const settled = !typesLoading && !sweepLoading;
  const { items, loading: itemsLoading } = useStudioPaletteItems(client, packageId, settled ? types : null);

  const loading = !settled || itemsLoading;
  const onLoadingChangeRef = React.useRef(onLoadingChange);
  React.useLayoutEffect(() => {
    onLoadingChangeRef.current = onLoadingChange;
  });
  React.useEffect(() => {
    onLoadingChangeRef.current(loading);
  }, [loading]);
  React.useEffect(() => () => onLoadingChangeRef.current(false), []);

  const served = new Map(types.map((e) => [e.type, e]));
  const typeLabel = (type: string) =>
    translateMetadataType(type, locale, (served.get(type) as { label?: string } | undefined)?.label);
  const entryLabel = (entry: StudioMenuEntry) =>
    entry.kind === 'type' ? typeLabel(entry.type ?? '') : t(ENTRY_LABEL_KEYS[entry.kind], locale);
  const itemLabel = (item: StudioPaletteItem) =>
    resolveKeyedI18nLabel(item.label as Parameters<typeof resolveKeyedI18nLabel>[0], translate) || item.name;

  const groups = buildStudioPaletteGroups(buildStudioMenu({ scope, types, counts: countsByType }), items);

  return (
    <>
      {groups.map(({ group, entries: groupEntries, items: groupItems }) => {
        const groupLabel = studioMenuGroupLabel(group, locale);
        const shownEntries = groupEntries.filter((entry) =>
          matchesPaletteQuery(query, [entryLabel(entry), entry.type, groupLabel]),
        );
        const shownItems = groupItems.filter((item) =>
          matchesPaletteQuery(query, [itemLabel(item), item.name, typeLabel(item.type)]),
        );
        if (shownEntries.length === 0 && shownItems.length === 0) return null;
        const ItemIcon = GROUP_ICONS[group];
        return (
          <CommandGroup key={group} heading={groupLabel} data-testid={`studio-palette-group-${group}`}>
            {shownEntries.map((entry) => {
              const Icon = ENTRY_ICONS[entry.kind];
              return (
                <CommandItem
                  key={entry.key}
                  value={`studio-entry ${entry.key}`}
                  data-testid={`studio-palette-entry-${entry.key}`}
                  onSelect={() => open(entry.to)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span className="truncate">{entryLabel(entry)}</span>
                  {entry.count !== undefined && (
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                      {tFormat('engine.studio.menu.itemCount', locale, { count: entry.count })}
                    </span>
                  )}
                </CommandItem>
              );
            })}
            {shownItems.map((item) => (
              <CommandItem
                key={`${item.type}:${item.packageId}:${item.name}`}
                value={`studio-item ${item.type} ${item.packageId} ${item.name}`}
                data-testid={`studio-palette-item-${item.type}:${item.name}`}
                onSelect={() => open(studioPaletteItemAddress(segment, item))}
              >
                <ItemIcon className="mr-2 h-4 w-4" />
                <span className="truncate">{itemLabel(item)}</span>
                <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                  {item.packageId === packageId ? typeLabel(item.type) : `${typeLabel(item.type)} · ${item.packageId}`}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        );
      })}
    </>
  );
}
