/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * One field's change history (objectstack#36290, part ③): a small card, opened
 * in place from the record page's field or a list cell's context menu, that
 * lists only that field's changes on one record — who, when, old → new,
 * newest first, ten at a time — or, when the field was never changed, says so
 * with who created the record and when.
 *
 * The changes are the record's activity rows (`sys_activity`), the same rows
 * the record page's activity stream draws. The server serves each row's
 * field-change code narrowed to the reader (plugin-audit
 * `activity-field-redaction.ts`): a change of a field the reader may not read
 * is never sent. So the card reads what it is served and adds nothing, and
 * the entry points are not offered at all on a field the reader may not read
 * ({@link useFieldHistoryOffered}). The compliance ledger (`sys_audit_log`) is
 * not read: it stays the administrators'.
 *
 * The rows are read by record, never by field: a query naming the change
 * columns (`changed_fields`, `metadata`) is refused for a reader withheld any
 * field of the object (plugin-audit `parent-field-query-guard.ts`), so the
 * card pages the record's rows newest first and keeps those that changed the
 * field, until it has the page it shows or the rows run out.
 */

import * as React from 'react';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@object-ui/components';
import { History, Loader2 } from 'lucide-react';
import { useDisplayLocale, useSafeTranslate } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import type { DataSource } from '@object-ui/types';
import { FieldChangeItem } from './FieldChangeItem';
import { useFieldChangeWording } from './fieldChangeText';
import {
  activityActorLine,
  activityFieldChangesOf,
  activityTimestamp,
  isRefusedFeedRead,
  IMPERSONATED_ACTOR_FALLBACK,
  type ActivityFieldChange,
  type SysActivityRow,
} from './renderers/recordActivityFeed';
import { NON_EDITABLE_SYSTEM_FIELDS } from './systemFields';
import { useDetailTranslation } from './useDetailTranslation';

/** How many changes the card shows at first, and how many more each "Load more" adds. */
export const FIELD_HISTORY_PAGE_SIZE = 10;

/** How many activity rows of the record one read asks for while looking for the field's changes. */
export const FIELD_HISTORY_SCAN_BATCH = 50;

/** One change of the field, as the card draws it. */
export interface FieldHistoryEntry {
  id: string;
  /** Who made the change, as the activity row names them. */
  actor: string;
  /** When, as the row's timestamp. */
  at: string;
  change: ActivityFieldChange;
}

/** Who created the record and when, as its creation row says. */
export interface FieldHistoryCreation {
  actor: string;
  at: string;
}

export interface FieldHistoryState {
  /** The changes found so far, newest first. */
  entries: FieldHistoryEntry[];
  /** How many of them the card shows. */
  shown: number;
  /** The record's creation row, once a read reached it. */
  creation: FieldHistoryCreation | null;
  /** The record's rows have all been read. */
  exhausted: boolean;
  loading: boolean;
  /** The read was refused (401 / 403): the reader may not see this record's activity. */
  denied: boolean;
  /** The read failed otherwise. */
  failed: boolean;
  /** Whether "Load more" is offered: a found change not shown yet, or rows not read yet. */
  hasMore: boolean;
  loadMore: () => void;
}

export interface UseFieldHistoryOptions {
  dataSource: DataSource | null | undefined;
  objectName: string | null | undefined;
  recordId: string | number | null | undefined;
  field: string | null | undefined;
}

function rowsOf(res: unknown): SysActivityRow[] {
  const raw = (res as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(raw) ? (raw as SysActivityRow[]) : [];
}

/**
 * Read one field's changes on one record, newest first, a page at a time
 * (see the file header for why the rows are read by record).
 */
export function useFieldHistory({ dataSource, objectName, recordId, field }: UseFieldHistoryOptions): FieldHistoryState {
  // The actor words `record:activity` reads, read the same way: the
  // impersonation line is a template its caller fills, so it is read raw.
  const tt = useSafeTranslate();
  const systemActorLabel = tt('detail.systemActor', 'System');
  const impersonatedActorTemplate = tt('detail.impersonatedActor', IMPERSONATED_ACTOR_FALLBACK);
  const unknownUserLabel = tt('detail.unknownUser', 'Unknown');

  const [wanted, setWanted] = React.useState(FIELD_HISTORY_PAGE_SIZE);
  const [entries, setEntries] = React.useState<FieldHistoryEntry[]>([]);
  const [creation, setCreation] = React.useState<FieldHistoryCreation | null>(null);
  const [scanned, setScanned] = React.useState(0);
  const [exhausted, setExhausted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [denied, setDenied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const id = recordId === null || recordId === undefined || recordId === '' ? null : String(recordId);
  const canRead = typeof dataSource?.find === 'function' && !!objectName && id !== null && !!field;

  // A different record or field starts over.
  React.useEffect(() => {
    setWanted(FIELD_HISTORY_PAGE_SIZE);
    setEntries([]);
    setCreation(null);
    setScanned(0);
    setExhausted(false);
    setDenied(false);
    setFailed(false);
  }, [dataSource, objectName, id, field]);

  // Read the next batch of the record's rows while the card wants more changes
  // than it has found and rows remain. Each answer moves `scanned`, which runs
  // this again until one of the two stops it.
  const needsRead = canRead && !exhausted && !denied && !failed && entries.length < wanted;
  React.useEffect(() => {
    if (!needsRead) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.resolve(
      (dataSource as DataSource).find('sys_activity', {
        $filter: { object_name: objectName as string, record_id: id as string },
        $orderby: { timestamp: 'desc' },
        $skip: scanned,
        // One row past the batch says whether rows remain.
        $top: FIELD_HISTORY_SCAN_BATCH + 1,
        // The actor's record in place of its id, for a row with no `actor_name`.
        $expand: ['actor_id'],
      }),
    )
      .then((res) => {
        if (cancelled) return;
        const rows = rowsOf(res);
        const batch = rows.slice(0, FIELD_HISTORY_SCAN_BATCH);
        const found: FieldHistoryEntry[] = [];
        let created: FieldHistoryCreation | null = null;
        batch.forEach((row, index) => {
          const actor = activityActorLine(row, systemActorLabel, impersonatedActorTemplate, unknownUserLabel);
          const at = activityTimestamp(row);
          if (row.type === 'created') {
            created = { actor, at };
            return;
          }
          const change = activityFieldChangesOf(row)?.find((c) => c.field === field);
          if (change) found.push({ id: String(row.id ?? `${scanned + index}`), actor, at, change });
        });
        if (found.length > 0) setEntries((prev) => [...prev, ...found]);
        if (created) setCreation(created);
        setScanned(scanned + batch.length);
        setExhausted(rows.length <= FIELD_HISTORY_SCAN_BATCH);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (isRefusedFeedRead(err)) setDenied(true);
        else setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsRead, dataSource, objectName, id, field, scanned, systemActorLabel, impersonatedActorTemplate, unknownUserLabel]);

  const loadMore = React.useCallback(() => setWanted((n) => n + FIELD_HISTORY_PAGE_SIZE), []);
  const shown = Math.min(entries.length, wanted);
  return {
    entries,
    shown,
    creation,
    exhausted,
    loading: loading || needsRead,
    denied,
    failed,
    hasMore: !denied && !failed && (entries.length > wanted || (!exhausted && entries.length >= wanted)),
    loadMore,
  };
}

/**
 * Whether a field offers its change history to this reader: a field of the
 * object, not one of the platform's own record columns (`id`, `created_at`, …,
 * which no edit changes), and one the reader may read. Read permission is the
 * one `usePermissions().checkField(object, field, 'read')` answers, the gate
 * the record page and the list already draw the field by; with no permission
 * provider mounted there is no answer to narrow by and the server's narrowing
 * of the served changes is the floor.
 */
export function useFieldHistoryOffered(objectName: string | null | undefined, field: string | null | undefined): boolean {
  return fieldHistoryOffered(usePermissions(), objectName, field);
}

/** {@link useFieldHistoryOffered}'s answer for a caller that already holds the permissions (one call per field of a list). */
export function fieldHistoryOffered(
  perms: Pick<ReturnType<typeof usePermissions>, 'isLoaded' | 'checkField'> | null | undefined,
  objectName: string | null | undefined,
  field: string | null | undefined,
): boolean {
  if (!objectName || !field) return false;
  if (NON_EDITABLE_SYSTEM_FIELDS.has(field)) return false;
  if (perms?.isLoaded && !perms.checkField(objectName, field, 'read')) return false;
  return true;
}

function formatWhen(at: string, locale: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  } catch {
    return date.toISOString();
  }
}

export interface FieldHistoryCardProps {
  dataSource: DataSource | null | undefined;
  objectName: string;
  recordId: string | number;
  field: string;
  /** The object's schema, for the field's label and option labels. */
  objectSchema?: unknown;
  className?: string;
}

/**
 * The card's content: the field's name, then its changes newest first, each
 * `who · when` over `old → new`, with "Load more"; or, for a field never
 * changed, 「No changes recorded」 and who created the record and when.
 */
export const FieldHistoryCard: React.FC<FieldHistoryCardProps> = ({
  dataSource,
  objectName,
  recordId,
  field,
  objectSchema,
  className,
}) => {
  const { t } = useDetailTranslation();
  const locale = useDisplayLocale();
  const { labelOfField, changeSideText } = useFieldChangeWording(objectName, objectSchema);
  const history = useFieldHistory({ dataSource, objectName, recordId, field });
  const label = labelOfField(field);
  const visible = history.entries.slice(0, history.shown);
  const settled = !history.loading || visible.length > 0;
  const none = settled && !history.loading && visible.length === 0 && history.exhausted;

  return (
    <div className={cn('flex flex-col gap-2 text-sm', className)} data-field-history={field}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-foreground" data-field-history-label="">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{t('detail.fieldHistory')}</span>
      </div>
      {history.denied ? (
        <p className="text-xs text-muted-foreground" data-field-history-denied="">
          {t('detail.activityAccessDenied')}
        </p>
      ) : history.failed ? (
        <p className="text-xs text-muted-foreground" data-field-history-failed="">
          {t('detail.activityLoadFailed')}
        </p>
      ) : none ? (
        <div className="flex flex-col gap-1" data-field-history-none="">
          <p className="text-muted-foreground">{t('detail.fieldHistoryNone')}</p>
          {history.creation && (
            <p className="text-xs text-muted-foreground" data-field-history-created="">
              {t('detail.createdBy')} {history.creation.actor}
              {' · '}
              <time dateTime={history.creation.at}>{formatWhen(history.creation.at, locale)}</time>
            </p>
          )}
        </div>
      ) : (
        <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto" data-field-history-entries="">
          {visible.map((entry) => (
            <li key={entry.id} className="flex min-w-0 flex-col gap-0.5" data-field-history-entry="">
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80" data-field-history-actor="">{entry.actor}</span>
                {' · '}
                <time dateTime={entry.at}>{formatWhen(entry.at, locale)}</time>
              </span>
              <FieldChangeItem
                change={entry.change}
                // The card names the field once, above; each line is its values.
                label=""
                oldText={changeSideText(entry.change, 'old')}
                newText={changeSideText(entry.change, 'new')}
                emptyLabel={t('detail.fieldChangeEmpty')}
                expandLabel={t('detail.fieldChangeExpand')}
                collapseLabel={t('detail.fieldChangeCollapse')}
              />
            </li>
          ))}
        </ol>
      )}
      {history.loading && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-field-history-loading="">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {t('detail.loading')}
        </span>
      )}
      {!history.loading && history.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 self-start px-2 text-xs"
          onClick={history.loadMore}
          data-field-history-more=""
        >
          {t('detail.loadMore')}
        </Button>
      )}
    </div>
  );
};

/** The card's width and padding, one face for every entry point. */
const FIELD_HISTORY_POPOVER_CLASS = 'w-80 p-3';

export interface FieldHistoryButtonProps extends Omit<FieldHistoryCardProps, 'className'> {
  className?: string;
}

/**
 * The record page's entry point: a history button beside a field's value,
 * shown on hover and focus like the field's copy button, that opens the card
 * in place.
 */
export const FieldHistoryButton: React.FC<FieldHistoryButtonProps> = ({ className, ...card }) => {
  const { t } = useDetailTranslation();
  const [open, setOpen] = React.useState(false);
  const label = t('detail.fieldHistory');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                  open && 'opacity-100',
                  className,
                )}
                aria-label={label}
                data-field-history-trigger={card.field}
                onClick={(e) => e.stopPropagation()}
              >
                <History className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className={FIELD_HISTORY_POPOVER_CLASS} onClick={(e) => e.stopPropagation()}>
        {open && <FieldHistoryCard {...card} />}
      </PopoverContent>
    </Popover>
  );
};

export interface FieldHistoryPopoverProps extends FieldHistoryCardProps {
  /** Where to open, in viewport coordinates (a list cell's context-menu point). */
  at: { x: number; y: number };
  onClose: () => void;
}

/**
 * The list's entry point: the card opened at a point, after the cell's
 * context menu chose 「Change history」. Mounted only while open.
 */
export const FieldHistoryPopover: React.FC<FieldHistoryPopoverProps> = ({ at, onClose, className, ...card }) => (
  <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
    <PopoverTrigger asChild>
      <span
        aria-hidden
        tabIndex={-1}
        data-testid="field-history-anchor"
        className="pointer-events-none fixed h-px w-px"
        style={{ left: at.x, top: at.y }}
      />
    </PopoverTrigger>
    <PopoverContent align="start" className={cn(FIELD_HISTORY_POPOVER_CLASS, className)}>
      <FieldHistoryCard {...card} />
    </PopoverContent>
  </Popover>
);
