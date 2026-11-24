// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ItemToolTabs — the tabs of a Studio item page (objectstack#36901, epic
 * objectstack#36890 decision 8; ADR-0146 D1 as amended 2026-11-24): the item
 * tools are tabs of the item's page, not side sheets.
 *
 * Six tabs, in this order, each offered only where it applies:
 *
 *   details     the item's form — always
 *   preview     the type's editing canvas — a type with a registered preview
 *               (decision 4: the canvas IS the preview)
 *   related     the item's anchored children — a type with registered anchors
 *   references  what points at the item
 *   history     its versions with rollback, and the audit log read inside it —
 *               a caller the authoring-trail doors admit (`canReadTrail`)
 *   source      its JSON source, and the layered comparison read inside it —
 *               a caller who cannot write still sees both
 *
 * One component for every item page: the generic item page, the area's form
 * editor and the designers mount the same strip and the same three tool
 * panels (references, history, source). The host draws its own details,
 * preview and related bodies; this file draws the strip, the three tool
 * panels and the tab's address.
 *
 * The tab is addressable (`?tab=`, `urlParams.ts`'s `tab`, replace): a
 * refresh or a shared link reopens it. The two second views have addresses of
 * their own, which are the values the retired side sheets wrote: `audit`
 * opens History on the audit log and `layers` opens Source on the layered
 * comparison, so an old link still lands where it pointed.
 *
 * A tab switch keeps the page and its edit buffer: nothing is left, so the
 * strip asks the leave guard (`confirmUnsavedLeave`) only for a host whose
 * tabs DO drop an unsaved buffer (`confirmSwitch`).
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button, cn } from '@object-ui/components';
import type { MetadataLayered } from '@object-ui/data-objectstack';
import { RECORD_DETAIL_TAB_PARAM } from '../../urlParams.js';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { StudioTab } from '../studio-design/StudioItemHeader.js';
import { LayeredDiff } from './LayeredDiff.js';
import { ReferencesPanel, useReferencesScan, type ReferencesState } from './ReferencesPanel.js';
import { HistoryPanel } from './ResourceHistoryPage.js';
import { AuditPanel } from './AuditPanel.js';
import { JsonSourceEditor, type JsonIssue } from './JsonSourceEditor.js';

/** A tab of an item page, in display order. */
export type ItemToolTab = 'details' | 'preview' | 'related' | 'references' | 'history' | 'source';

/** The tabs in display order. */
export const ITEM_TOOL_TABS: readonly ItemToolTab[] = ['details', 'preview', 'related', 'references', 'history', 'source'];

/** A second view inside a tab: the audit log in History, the layered comparison in Source. */
export type ItemToolView = 'versions' | 'audit' | 'editor' | 'layers';

/** The address param of the open tab (the console's reserved `tab`). */
export const ITEM_TOOL_TAB_PARAM = RECORD_DETAIL_TAB_PARAM;

/** Where an item page is open: a tab, and for History or Source its view. */
export interface ItemToolLocation {
  tab: ItemToolTab;
  view?: ItemToolView;
}

/** What an item page offers, for {@link offeredItemToolTabs}. */
export interface ItemToolTabOffer {
  /** The type registers an editing canvas. */
  preview?: boolean;
  /** The type registers anchors (`listAnchorsFor`). */
  related?: boolean;
  /** The caller may read the authoring trail (`useCanReadAuthoringTrail`). */
  trail?: boolean;
  /** References and Source: an item that exists (not a create draft). Default on. */
  tools?: boolean;
}

/** The tabs a page offers, in display order. Details is always one. */
export function offeredItemToolTabs(offer: ItemToolTabOffer): ItemToolTab[] {
  const tools = offer.tools !== false;
  return ITEM_TOOL_TABS.filter((tab) => {
    switch (tab) {
      case 'details':
        return true;
      case 'preview':
        return !!offer.preview;
      case 'related':
        return !!offer.related;
      case 'history':
        return tools && !!offer.trail;
      default:
        return tools;
    }
  });
}

/**
 * The tab a page opens on (decision 4): the canvas on a type that has one,
 * where the type is edited, and the details form everywhere else.
 */
export function defaultItemToolTab(offered: readonly ItemToolTab[]): ItemToolTab {
  return offered.includes('preview') ? 'preview' : 'details';
}

/**
 * The location an address value names, among the offered tabs, or `null` for
 * a value that opens nothing here (absent, unknown, or a tab not offered to
 * this caller). `audit` and `layers` are the retired sheets' values.
 */
export function readItemToolLocation(raw: string | null | undefined, offered: readonly ItemToolTab[]): ItemToolLocation | null {
  if (!raw) return null;
  if (raw === 'audit') return offered.includes('history') ? { tab: 'history', view: 'audit' } : null;
  if (raw === 'layers') return offered.includes('source') ? { tab: 'source', view: 'layers' } : null;
  return (offered as readonly string[]).includes(raw) ? { tab: raw as ItemToolTab } : null;
}

/** The address value of a location: the tab, or `audit` / `layers` for a second view. */
export function itemToolAddress(location: ItemToolLocation): string {
  if (location.tab === 'history' && location.view === 'audit') return 'audit';
  if (location.tab === 'source' && location.view === 'layers') return 'layers';
  return location.tab;
}

export interface ItemToolTabState {
  /** The open tab and view, always one the page offers. */
  location: ItemToolLocation;
  /** The `?tab=` value in force, `null` on the default tab. */
  address: string | null;
  /** Open a tab (and a view of it). */
  select: (tab: ItemToolTab, view?: ItemToolView) => void;
}

/**
 * The open tab of an item page, seeded from the address and written back to
 * it (replace). The choice is kept as asked even while the tab is not offered
 * (a canvas registered by a lazily loaded chunk), and applies once it is.
 *
 * Read in the state's initializer, not in a mount effect: the page's other
 * address writers run their own mount passes, and a later read would miss it.
 * Written with `history.replaceState`, as the page's other in-page params
 * are, and re-written after any router navigation drops it.
 *
 * `enabled: false` (an item embedded in another surface) neither reads nor
 * writes the address: the parent page owns it.
 */
export function useItemToolTab(offered: readonly ItemToolTab[], { enabled = true }: { enabled?: boolean } = {}): ItemToolTabState {
  const [choice, setChoice] = React.useState<string | null>(() => {
    if (!enabled || typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(ITEM_TOOL_TAB_PARAM);
  });
  const fallback = defaultItemToolTab(offered);
  const asked = readItemToolLocation(choice, offered);
  const location: ItemToolLocation = asked ?? { tab: fallback };
  const value = itemToolAddress(location);
  const address = value === fallback ? null : value;

  const [searchParams] = useSearchParams();
  const routerSearch = searchParams.toString();
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get(ITEM_TOOL_TAB_PARAM) ?? null) === address) return;
    if (address) url.searchParams.set(ITEM_TOOL_TAB_PARAM, address);
    else url.searchParams.delete(ITEM_TOOL_TAB_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
  }, [enabled, address, routerSearch]);

  const select = React.useCallback((tab: ItemToolTab, view?: ItemToolView) => {
    setChoice(itemToolAddress({ tab, view }));
  }, []);
  return { location, address, select };
}

const TAB_LABEL_KEY: Readonly<Record<ItemToolTab, string>> = {
  details: 'engine.studio.itemTabs.details',
  preview: 'engine.studio.itemTabs.preview',
  related: 'engine.studio.itemTabs.related',
  references: 'engine.studio.itemTabs.references',
  history: 'engine.studio.itemTabs.history',
  source: 'engine.studio.itemTabs.source',
};

export interface ItemToolTabStripProps {
  /** The offered tabs ({@link offeredItemToolTabs}). */
  tabs: readonly ItemToolTab[];
  /** The open one. */
  active: ItemToolTab;
  onSelect: (tab: ItemToolTab) => void;
  /**
   * A count beside a tab's label (References: the scan's answer). Pass one
   * only once it is a real answer: a `0` over a check that never completed is
   * a false measurement (objectui#5110).
   */
  counts?: Partial<Record<ItemToolTab, number>>;
  /**
   * The host's tabs drop an unsaved buffer (each tab its own editor): a
   * switch asks the leave guard first. Off for a page whose tabs share one
   * buffer, where a switch leaves nothing.
   */
  confirmSwitch?: boolean;
  locale?: string;
}

/** The tab row, for `StudioDetailHeader`'s (or `StudioItemHeader`'s) `tabs` slot. */
export function ItemToolTabStrip({ tabs, active, onSelect, counts, confirmSwitch = false, locale }: ItemToolTabStripProps): React.ReactElement {
  return (
    <>
      {tabs.map((tab) => {
        const count = counts?.[tab];
        return (
          <StudioTab
            key={tab}
            active={tab === active}
            data-testid={`item-tab-${tab}`}
            onClick={() => {
              if (tab === active) return;
              if (confirmSwitch) confirmUnsavedLeave(() => onSelect(tab));
              else onSelect(tab);
            }}
          >
            {t(TAB_LABEL_KEY[tab], locale)}
            {count !== undefined && (
              <span
                data-testid={`item-tab-count-${tab}`}
                className="ml-1.5 rounded-full border bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground"
              >
                {count}
              </span>
            )}
          </StudioTab>
        );
      })}
    </>
  );
}

/** The pill pair that switches a tab's two views. */
function ViewSwitch({
  views,
  active,
  onSelect,
}: {
  views: ReadonlyArray<{ view: ItemToolView; label: string }>;
  active: ItemToolView;
  onSelect: (view: ItemToolView) => void;
}): React.ReactElement {
  return (
    <div role="group" className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
      {views.map(({ view, label }) => (
        <button
          key={view}
          type="button"
          aria-pressed={view === active}
          data-testid={`item-tab-view-${view}`}
          onClick={() => onSelect(view)}
          className={cn(
            'inline-flex items-center rounded px-2 py-1 text-xs transition-colors',
            view === active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The layers read, asked the first time the layered view needs it, for a host that did not read it. */
type LayersRead =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; layered: MetadataLayered<Record<string, unknown>> }
  | { status: 'error'; message: string };

export interface ItemToolTabPanelProps {
  /** The tool tab to draw: References, History or Source. */
  tab: 'references' | 'history' | 'source';
  /** The open view of History (`versions`, `audit`) or Source (`editor`, `layers`). */
  view?: ItemToolView;
  onViewChange: (view: ItemToolView) => void;
  type: string;
  name: string;
  /**
   * The package the item is read at: scopes the layers read (ADR-0048) and the
   * history and rollback doors' `?package=` (objectstack#32905).
   */
  packageId?: string | null;
  /**
   * The host's edit buffer: Source shows it, and with `onChange` (an item this
   * caller may write) an edit replaces it — the same buffer the host saves.
   * Omitted, Source shows the item's served body, read-only.
   */
  source?: {
    value: Record<string, unknown>;
    onChange?: (next: Record<string, unknown>) => void;
    issues?: JsonIssue[];
  };
  /** The host's layered read, when it holds one; omitted, the panel reads it. */
  layered?: MetadataLayered<Record<string, unknown>> | null;
  /** The host's references scan, when it holds one (its count rides the tab); omitted, the panel runs its own. */
  references?: { state: ReferencesState; load: () => Promise<void> };
  /** Rollback is offered (Save's gate); called once a rollback landed, so the host re-reads. */
  onRolledBack?: () => void;
  locale?: string;
  /** The panel's padding; a host whose body is padded already passes `''`. */
  className?: string;
}

/**
 * The body of one of the three tool tabs, wrapping the panels the side sheets
 * held (`ReferencesPanel`, `HistoryPanel`, `AuditPanel`, `JsonSourceEditor`,
 * `LayeredDiff`) unchanged.
 */
export function ItemToolTabPanel(props: ItemToolTabPanelProps): React.ReactElement {
  // One panel per item: a new item starts with nothing read.
  return <ItemToolTabPanelFor key={`${props.type}/${props.name}/${props.packageId ?? ''}`} {...props} />;
}

function ItemToolTabPanelFor({
  tab,
  view,
  onViewChange,
  type,
  name,
  packageId,
  source,
  layered,
  references,
  onRolledBack,
  locale,
  className = 'p-6',
}: ItemToolTabPanelProps): React.ReactElement {
  const client = useMetadataClient();
  const ownScan = useReferencesScan(client, type, name);
  const scan = references ?? ownScan;
  const [layers, setLayers] = React.useState<LayersRead>({ status: 'idle' });
  const hostLayers = layered !== undefined;

  async function loadLayers() {
    if (hostLayers || layers.status === 'loading' || layers.status === 'loaded') return;
    setLayers({ status: 'loading' });
    try {
      const read = await client.layered<Record<string, unknown>>(type, name, packageId ? { packageId } : {});
      setLayers({ status: 'loaded', layered: read });
    } catch (err) {
      setLayers({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const sourceView: ItemToolView = view === 'layers' ? 'layers' : 'editor';
  const historyView: ItemToolView = view === 'audit' ? 'audit' : 'versions';
  const needsLayers = tab === 'source' && (sourceView === 'layers' || !source);
  React.useEffect(() => {
    if (tab === 'references') void scan.load();
    if (needsLayers) void loadLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, needsLayers]);

  if (tab === 'references') {
    return (
      <div data-testid="item-tab-panel-references" className={className}>
        <ReferencesPanel state={scan.state} locale={locale} onRetry={() => void scan.load()} />
      </div>
    );
  }

  if (tab === 'history') {
    return (
      <div data-testid="item-tab-panel-history" className={cn('flex h-full min-h-0 flex-col gap-3', className)}>
        <ViewSwitch
          views={[
            { view: 'versions', label: t('engine.studio.itemTabs.versions', locale) },
            { view: 'audit', label: t('engine.edit.auditTab', locale) },
          ]}
          active={historyView}
          onSelect={onViewChange}
        />
        {historyView === 'audit' ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <AuditPanel type={type} name={name} client={client} locale={locale} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <HistoryPanel
              type={type}
              name={name}
              client={client}
              locale={locale}
              packageId={packageId ?? undefined}
              onRollback={
                onRolledBack
                  ? () => {
                      setLayers({ status: 'idle' });
                      onRolledBack();
                    }
                  : undefined
              }
              rollbackLabel={t('engine.edit.rollback', locale)}
              rollbackConfirm={(version) => t('engine.edit.rollbackConfirm', locale).replace('{version}', String(version))}
            />
          </div>
        )}
      </div>
    );
  }

  const shownLayered = hostLayers ? layered ?? null : layers.status === 'loaded' ? layers.layered : null;
  const layersError =
    !hostLayers && layers.status === 'error' ? (
      <div className="space-y-3 text-sm" data-testid="item-tab-layers-error">
        <p className="text-destructive">{tFormat('engine.studio.itemTools.layersFailed', locale, { message: layers.message })}</p>
        <Button variant="outline" size="sm" onClick={() => void loadLayers()}>
          {t('engine.studio.itemTools.layersRetry', locale)}
        </Button>
      </div>
    ) : null;
  const editable = !!source?.onChange;
  return (
    <div data-testid="item-tab-panel-source" className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <ViewSwitch
          views={[
            { view: 'editor', label: t('engine.edit.inspector.source', locale) },
            { view: 'layers', label: t('engine.edit.layers', locale) },
          ]}
          active={sourceView}
          onSelect={onViewChange}
        />
        {sourceView === 'editor' && !editable && (
          <span data-testid="item-tab-source-readonly" className="text-xs text-muted-foreground">
            {t('engine.studio.itemTools.sourceReadOnly', locale)}
          </span>
        )}
      </div>
      {sourceView === 'layers' ? (
        (layersError ?? <LayeredDiff layered={shownLayered} loading={!hostLayers && layers.status !== 'loaded'} locale={locale} />)
      ) : source ? (
        <JsonSourceEditor
          value={source.value}
          onChange={(next) => source.onChange?.(next)}
          readOnly={!editable}
          issues={source.issues}
        />
      ) : shownLayered ? (
        <JsonSourceEditor value={shownLayered.effective ?? {}} onChange={() => undefined} readOnly />
      ) : (
        (layersError ?? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="item-tab-source-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.edit.loading', locale)}
          </div>
        ))
      )}
    </div>
  );
}
