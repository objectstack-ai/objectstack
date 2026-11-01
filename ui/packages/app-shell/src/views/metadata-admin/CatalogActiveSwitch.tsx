// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ACTIVE switch of a catalog item — a position's, a permission set's or a
 * declared sharing rule's row in the activation ledger (`catalog-activation.ts`
 * reads and writes it; objectui#7611, objectstack ADR-0131 D3/D6) — drawn in
 * the two places it is offered:
 *
 *  - the environment-scope LIST, one switch per row (`ResourceListPage`);
 *  - the item's own page in Studio's "All metadata" area
 *    ({@link CatalogItemActiveSwitch}): objectstack ADR-0146 D1 retires
 *    Setup's catalog, and the M-1 ruling (A) moves the switch with the item
 *    into Studio, the way D4 put the flow switch on the flow's item. The door,
 *    its gate and its readings are unchanged; only the surface moved.
 *
 * Both draw the same cell and ask the same confirm before a switch-off, so the
 * two cannot say different things about one item.
 */

import * as React from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Switch,
  buttonVariants,
} from '@object-ui/components';
import { useAdapter, useMetadata } from '@object-ui/react';
import {
  audienceAnchorsOf,
  isCatalogItemActive,
  readCatalogActivation,
  writeCatalogActivation,
  type CatalogActivation,
} from './catalog-activation.js';
import { countsCatalogHolders, readCatalogHolderCount, type CatalogHolderCount } from './catalog-holders.js';
import { useWalledCatalogReadOnly } from './catalog-scope.js';
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { t, tFormat, useMetadataLocale } from './i18n.js';

/** A switch-off waiting on its confirm: the item, and its holder count once read. */
export interface PendingDeactivation {
  name: string;
  label: string;
  holders: CatalogHolderCount | { error: string } | null;
}

/**
 * objectui#13338 — the confirm a permission set's or a position's switch asks
 * before it switches the item OFF, naming how many users lose the access. The
 * count is the server's, read when the confirm opens; while it is read the
 * confirm says so and its Deactivate waits. A count that could not be read is
 * said as such (never as "0 users"), and the admin may still go ahead: the
 * confirm informs, it does not gate. Cancel leaves the item on.
 */
export function DeactivateConfirmDialog({
  pending,
  locale,
  onCancel,
  onConfirm,
}: {
  pending: PendingDeactivation | null;
  locale: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const holders = pending?.holders ?? null;
  let impact: string;
  if (holders === null) impact = t('engine.catalog.deactivate.counting', locale);
  else if ('error' in holders) impact = tFormat('engine.catalog.deactivate.countFailed', locale, { message: holders.error });
  else if (holders.everyone) impact = t('engine.catalog.deactivate.everyone', locale);
  else if (holders.truncated) impact = tFormat('engine.catalog.deactivate.holdersAtLeast', locale, { count: holders.count });
  else if (holders.count === 1) impact = t('engine.catalog.deactivate.holdersOne', locale);
  else impact = tFormat('engine.catalog.deactivate.holders', locale, { count: holders.count });
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="catalog-deactivate-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tFormat('engine.catalog.deactivate.title', locale, { name: pending?.label ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription data-testid="catalog-deactivate-impact">{impact}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="catalog-deactivate-cancel">{t('engine.cancel', locale)}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            disabled={holders === null}
            data-testid="catalog-deactivate-confirm"
            onClick={() => {
              if (pending) onConfirm(pending.name);
            }}
          >
            {t('engine.catalog.deactivate.confirm', locale)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The activation ledger's states for a type, and the names its door refuses. */
export interface CatalogLedger {
  states: CatalogActivation;
  anchors: ReadonlySet<string>;
}

/**
 * objectui#7611 — one item's active switch in the environment scope, showing
 * the activation ledger's state (see `catalog-activation.ts`). Its non-switch
 * states are each said, never rendered as a guessed "on": the state is still
 * loading, or the read failed (said in words, with the server's reason). An audience anchor shows its state on a
 * disabled switch with the reason, because the door refuses to switch it.
 */
export function CatalogActiveCell({
  itemName,
  ledger,
  refusal,
  canSwitch,
  busy,
  locale,
  onToggle,
}: {
  itemName: string;
  ledger: CatalogLedger | 'error' | null;
  /** Why the read failed: the server's refusal, as `actionErrorDetail` read it. */
  refusal: string | null;
  canSwitch: boolean;
  busy: boolean;
  locale: string;
  onToggle: (itemName: string, enabled: boolean) => void;
}) {
  if (ledger === null) return <span className="text-xs text-muted-foreground">…</span>;
  if (ledger === 'error') {
    // objectui#13091 — said in plain words, never a bare "?"; the server's
    // own sentence for why rides in the title.
    const why = [t('engine.catalog.active.unknown', locale), refusal].filter(Boolean).join(' ');
    return (
      <span
        className="text-xs text-muted-foreground whitespace-nowrap"
        title={why}
        data-testid={`catalog-active-unreadable-${itemName}`}
      >
        {t('engine.catalog.active.notVisible', locale)}
      </span>
    );
  }
  const enabled = isCatalogItemActive(ledger.states, itemName);
  const anchor = ledger.anchors.has(itemName);
  // A switch the caller cannot use states the state, and offers no click; the
  // page's read-only reason says why.
  const label = anchor
    ? t('engine.catalog.active.anchor', locale)
    : canSwitch
      ? t(enabled ? 'engine.catalog.active.on' : 'engine.catalog.active.off', locale)
      : t(enabled ? 'engine.catalog.status.active' : 'engine.catalog.status.inactive', locale);
  return (
    <span className="inline-flex" title={label}>
      <Switch
        checked={enabled}
        disabled={anchor || !canSwitch || busy}
        onCheckedChange={() => onToggle(itemName, enabled)}
        aria-label={label}
        data-testid={`catalog-active-${itemName}`}
      />
    </span>
  );
}

/**
 * objectstack ADR-0146 D1 (M-1 ruling A) — an item's active switch on its own
 * page in Studio's "All metadata" area, in the environment scope: the switch
 * Setup's catalog list carried, for this one item. The same reads, the same
 * confirm before a switch-off (with the holder count) and the same door as
 * the list's; a caller who may not author metadata, or whom the deployment's
 * wall refuses the catalog, sees the state and no live switch.
 */
export function CatalogItemActiveSwitch({
  type,
  name,
  label,
}: {
  type: string;
  name: string;
  /** The item's label for the confirm and the toast; the name when it has none. */
  label?: string;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const canAuthor = useCanAuthorMetadata();
  const walled = useWalledCatalogReadOnly(type);
  const adapter = useAdapter();
  const metadataStore = useMetadata();
  // Read through a ref when the confirm opens: the store's context value is
  // rebuilt whenever any cached type settles (ui AGENTS.md #10).
  const metadataStoreRef = React.useRef(metadataStore);
  React.useEffect(() => {
    metadataStoreRef.current = metadataStore;
  });
  const [ledger, setLedger] = React.useState<CatalogLedger | 'error' | null>(null);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [switchError, setSwitchError] = React.useState<string | null>(null);
  const [pendingOff, setPendingOff] = React.useState<PendingDeactivation | null>(null);
  const shownLabel = label || name;

  React.useEffect(() => {
    const controller = new AbortController();
    setLedger(null);
    setRefusal(null);
    Promise.all([readCatalogActivation(type, controller.signal), audienceAnchorsOf(type)])
      .then(([states, anchors]) => {
        if (!controller.signal.aborted) setLedger({ states, anchors });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLedger('error');
        setRefusal(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [type, name]);

  const write = React.useCallback(
    async (enabled: boolean) => {
      setBusy(true);
      setSwitchError(null);
      try {
        const now = await writeCatalogActivation(type, name, !enabled);
        setLedger((prev) => {
          if (!prev || prev === 'error') return prev;
          const states = new Map(prev.states);
          states.set(name, now);
          return { ...prev, states };
        });
        if (countsCatalogHolders(type)) {
          toast.success(
            tFormat(now ? 'engine.catalog.active.switchedOn' : 'engine.catalog.active.switchedOff', locale, {
              name: shownLabel,
            }),
          );
        }
      } catch (err: any) {
        setSwitchError(err?.message ?? String(err));
      } finally {
        setBusy(false);
      }
    },
    [type, name, locale, shownLabel],
  );

  // The holder-count read of the confirm now open; a newer open (or a close)
  // makes an older answer stale.
  const holderReadRef = React.useRef(0);
  const toggle = React.useCallback(
    (_itemName: string, enabled: boolean) => {
      if (!enabled || !countsCatalogHolders(type)) {
        void write(enabled);
        return;
      }
      const read = ++holderReadRef.current;
      setPendingOff({ name, label: shownLabel, holders: null });
      readCatalogHolderCount(adapter, metadataStoreRef.current, type, name)
        .then((holders) => {
          if (holderReadRef.current === read) setPendingOff((prev) => (prev ? { ...prev, holders } : prev));
        })
        .catch((err: unknown) => {
          if (holderReadRef.current !== read) return;
          const error = err instanceof Error ? err.message : String(err);
          setPendingOff((prev) => (prev ? { ...prev, holders: { error } } : prev));
        });
    },
    [type, name, shownLabel, adapter, write],
  );
  const closeConfirm = React.useCallback(() => {
    holderReadRef.current++;
    setPendingOff(null);
  }, []);

  return (
    <div
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
      data-testid="catalog-item-active"
    >
      <span className="text-sm font-medium">{t('engine.catalog.col.active', locale)}</span>
      <CatalogActiveCell
        itemName={name}
        ledger={ledger}
        refusal={refusal}
        canSwitch={canAuthor && !walled}
        busy={busy}
        locale={locale}
        onToggle={toggle}
      />
      {switchError && (
        <div className="basis-full text-xs text-destructive" role="alert">
          {tFormat('engine.catalog.active.failed', locale, { message: switchError })}
        </div>
      )}
      <DeactivateConfirmDialog
        pending={pendingOff}
        locale={locale}
        onCancel={closeConfirm}
        onConfirm={() => {
          closeConfirm();
          void write(true);
        }}
      />
    </div>
  );
}
