// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Configuration → Recycle bin (ADR-0148 D2, objectstack#30239): pick
 * an object whose recycle bin you manage, then list its deleted records,
 * restore one, or empty the bin.
 *
 * - The object list costs no bin read: it is the `object` catalog narrowed to
 *   the business objects whose `manageRecycleBin` the caller holds (the
 *   spec's fold over `/auth/me/permissions`). A caller who manages none sees
 *   that said, and no bin read is sent.
 * - Picking an object reads one page of its bin (`limit` 50, the door's own
 *   default); "Load more" reads the next page while the door says there is one.
 * - Restore is the delete toast's own Undo (`recordDelete.undo`): a restore
 *   under the original ids, never a create, and a refusal says why in the
 *   user's language, naming objects and fields by label.
 * - Empty asks first, says it is permanent, and reports how many it removed.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { Trash2, Loader2, AlertCircle, RotateCcw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Skeleton,
  buttonVariants,
} from '@object-ui/components';
import { getRecordDisplayName, recordDelete, recycleBinRestoreRefusalText } from '@object-ui/core';
import { useDisplayLocale, useObjectTranslation } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { useAdapter, useMetadata } from '@object-ui/react';
import { recycleBinRefusalLabelsOf, recycleBinRestoreOf } from '../../utils/recycleBinRestore.js';
import { CatalogAssignmentPage } from './CatalogAssignmentPage.js';
import type { CatalogEntry } from './peopleAssignments.js';
import {
  RECYCLE_BIN_OBJECT_PARAM,
  RECYCLE_BIN_PAGE_SIZE,
  entryRecord,
  managedRecycleBinObjects,
  recycleBinDoorsOf,
  type RecycleBinListEntry,
} from './recycleBin.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function RecycleBinPage() {
  const { t } = useObjectTranslation();
  const { isLoaded, effectiveObjects } = usePermissions();
  const select = React.useCallback(
    (entries: CatalogEntry[]) => managedRecycleBinObjects(entries, effectiveObjects),
    [effectiveObjects],
  );
  if (!isLoaded) {
    return (
      <div className="space-y-2 p-6" data-testid="setup-recycle-bin-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  return (
    <CatalogAssignmentPage
      type="object"
      param={RECYCLE_BIN_OBJECT_PARAM}
      testId="setup-recycle-bin"
      icon={<Trash2 className="h-4 w-4" />}
      select={select}
      copy={{
        title: t('recycleBin.page.title'),
        subtitle: t('recycleBin.page.subtitle'),
        listLabel: t('recycleBin.page.objectsList'),
        filterPlaceholder: t('recycleBin.page.objectsFilter'),
        emptyTitle: t('recycleBin.page.noObjectsTitle'),
        emptyBody: t('recycleBin.page.noObjectsBody'),
        pick: t('recycleBin.page.pick'),
        loadFailed: t('recycleBin.page.objectsLoadFailed'),
        noMatch: t('setupAssignments.noMatch'),
        notFound: (name) => t('setupAssignments.notFound', { name }),
        retry: t('setupAssignments.retry'),
        refresh: t('setupAssignments.refresh'),
      }}
      renderSection={(name, entry) => <RecycleBinSection objectName={name} objectLabel={entry.label} />}
    />
  );
}

type BinRead =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; entries: RecycleBinListEntry[]; hasMore: boolean };

/** The sentence for a failed bin read or empty: a known door code's, else the server message. */
function failureText(t: Translate, err: unknown, labels: ReturnType<typeof recycleBinRefusalLabelsOf>): string {
  return recycleBinRestoreRefusalText(t, err, labels) ?? (err instanceof Error ? err.message : '');
}

const personLabel = (u: Record<string, unknown>): string => {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return text(u.full_name) || text(u.name) || text(u.display_name) || text(u.email);
};

export function RecycleBinSection({ objectName, objectLabel }: { objectName: string; objectLabel: string }) {
  const { t } = useObjectTranslation();
  const displayLocale = useDisplayLocale();
  const adapter = useAdapter();
  const metadata = useMetadata();
  const { effectiveObjects } = usePermissions();
  const objectDef = React.useMemo(
    () => (metadata.objects ?? []).find((o: { name?: unknown } | null) => o?.name === objectName),
    [metadata.objects, objectName],
  );
  const doors = React.useMemo(() => recycleBinDoorsOf(adapter), [adapter]);
  const restore = recycleBinRestoreOf(adapter as Parameters<typeof recycleBinRestoreOf>[0], objectName, effectiveObjects);
  // A refusal names objects by label: this one by the page's, a parent by its
  // definition's, either falling back to the machine name.
  const labels = React.useMemo(() => {
    const objects = (metadata.objects ?? []) as Array<{ name?: unknown; label?: unknown } | null>;
    const labelOf = (name: string) => {
      if (name === objectName) return objectLabel;
      const label = objects.find((o) => o?.name === name)?.label;
      return typeof label === 'string' && label !== '' ? label : name;
    };
    return recycleBinRefusalLabelsOf(objectName, objectDef, labelOf);
  }, [metadata.objects, objectName, objectDef, objectLabel]);

  const [read, setRead] = React.useState<BinRead>({ kind: 'loading' });
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [restoring, setRestoring] = React.useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = React.useState(false);
  const [emptying, setEmptying] = React.useState(false);
  const [people, setPeople] = React.useState<Record<string, string>>({});
  const [nonce, setNonce] = React.useState(0);

  /** Name the people a page cites: one batched `sys_user` read; a refused read leaves the ids. */
  const lookUpPeople = React.useCallback(
    async (entries: RecycleBinListEntry[], known: Record<string, string>) => {
      const wanted = [...new Set(entries.map((e) => e.deletedBy).filter((id): id is string => !!id && !(id in known)))];
      const find = (adapter as { find?: (o: string, q: unknown) => Promise<unknown> } | null)?.find;
      if (wanted.length === 0 || typeof find !== 'function') return;
      try {
        const res = await find.call(adapter, 'sys_user', { $filter: { id: { $in: wanted } }, $top: wanted.length });
        const rows = (Array.isArray(res) ? res : ((res as { data?: unknown[] } | null)?.data ?? [])) as Record<string, unknown>[];
        const found: Record<string, string> = {};
        for (const row of rows) {
          const label = row?.id != null ? personLabel(row) : '';
          if (label) found[String(row.id)] = label;
        }
        if (Object.keys(found).length > 0) setPeople((prev) => ({ ...prev, ...found }));
      } catch {
        /* the id stays the text */
      }
    },
    [adapter],
  );

  const peopleRef = React.useRef(people);
  peopleRef.current = people;

  React.useEffect(() => {
    let live = true;
    setRead({ kind: 'loading' });
    if (!doors) {
      setRead({ kind: 'failed', message: t('recycleBin.refusal.notAvailable') });
      return;
    }
    doors.list(objectName, { limit: RECYCLE_BIN_PAGE_SIZE, offset: 0 }).then(
      (page) => {
        if (!live) return;
        setRead({ kind: 'ready', entries: page.entries, hasMore: page.hasMore });
        void lookUpPeople(page.entries, peopleRef.current);
      },
      (err) => {
        if (live) setRead({ kind: 'failed', message: failureText(t, err, labels) });
      },
    );
    return () => {
      live = false;
    };
    // `t` and `labels` only word a failure; a language change does not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doors, objectName, nonce, lookUpPeople]);

  const loadMore = async () => {
    if (!doors || read.kind !== 'ready') return;
    setLoadingMore(true);
    try {
      const page = await doors.list(objectName, { limit: RECYCLE_BIN_PAGE_SIZE, offset: read.entries.length });
      setRead((prev) =>
        prev.kind === 'ready' ? { kind: 'ready', entries: [...prev.entries, ...page.entries], hasMore: page.hasMore } : prev,
      );
      void lookUpPeople(page.entries, peopleRef.current);
    } catch (err) {
      toast.error(t('recycleBin.page.loadFailed', { object: objectLabel }), { description: failureText(t, err, labels) });
    } finally {
      setLoadingMore(false);
    }
  };

  const restoreEntry = async (entry: RecycleBinListEntry) => {
    if (!restore) return;
    setRestoring(entry.id);
    const restored = await recordDelete.undo(
      { t, label: objectLabel, objectDef, toast, refusalLabels: labels, restore },
      entryRecord(entry),
      entry.id,
    );
    setRestoring(null);
    // A restored entry leaves the bin; nothing else on the page changed.
    if (restored) {
      setRead((prev) =>
        prev.kind === 'ready' ? { ...prev, entries: prev.entries.filter((e) => e.id !== entry.id) } : prev,
      );
    }
  };

  const emptyBin = async () => {
    if (!doors) return;
    setEmptying(true);
    try {
      const { removed } = await doors.empty(objectName);
      toast.success(t('recycleBin.page.emptied', { count: removed }));
      setRead({ kind: 'ready', entries: [], hasMore: false });
    } catch (err) {
      toast.error(t('recycleBin.page.emptyFailed', { object: objectLabel }), { description: failureText(t, err, labels) });
    } finally {
      setEmptying(false);
    }
  };

  const when = (at: string | null) => {
    if (!at) return '—';
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString(displayLocale);
  };
  const day = (at: string | null) => {
    if (!at) return '—';
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString(displayLocale);
  };

  let body: React.ReactNode;
  if (read.kind === 'loading') {
    body = (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground" data-testid="recycle-bin-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    );
  } else if (read.kind === 'failed') {
    body = (
      <div role="alert" className="space-y-2 text-sm" data-testid="recycle-bin-load-failed">
        <div className="flex items-start gap-2 text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {t('recycleBin.page.loadFailed', { object: objectLabel })} {read.message}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
          {t('setupAssignments.retry')}
        </Button>
      </div>
    );
  } else if (read.entries.length === 0) {
    body = (
      <p className="py-2 text-sm text-muted-foreground" data-testid="recycle-bin-empty">
        {t('recycleBin.page.entriesEmpty', { object: objectLabel })}
      </p>
    );
  } else {
    body = (
      <>
        <table className="w-full text-sm" data-testid="recycle-bin-entries">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">{t('recycleBin.page.colRecord')}</th>
              <th className="py-2 pr-3 font-medium">{t('recycleBin.page.colDeletedBy')}</th>
              <th className="py-2 pr-3 font-medium">{t('recycleBin.page.colDeletedAt')}</th>
              <th className="py-2 pr-3 font-medium">{t('recycleBin.page.colKeptUntil')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {read.entries.map((entry) => {
              const name = getRecordDisplayName(objectDef, entryRecord(entry));
              const related = entry.recordCount - 1;
              return (
                <tr key={entry.id} className="border-b last:border-0" data-testid="recycle-bin-entry">
                  <td className="py-2 pr-3">
                    <span className="block font-medium">{name}</span>
                    {related > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {t('recycleBin.page.related', { count: related })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{entry.deletedBy ? (people[entry.deletedBy] ?? entry.deletedBy) : '—'}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{when(entry.deletedAt)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{day(entry.purgeAfter)}</td>
                  <td className="py-2 text-right">
                    {restore && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 text-xs"
                        disabled={restoring !== null || emptying}
                        onClick={() => void restoreEntry(entry)}
                      >
                        {restoring === entry.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        {t('recycleBin.page.restore')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {read.hasMore && (
          <div className="pt-3">
            <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {t('recycleBin.page.loadMore')}
            </Button>
          </div>
        )}
      </>
    );
  }

  const canEmpty = read.kind === 'ready' && (read.entries.length > 0 || read.hasMore);

  return (
    <div className="mt-4 rounded-md border" data-testid="recycle-bin-section">
      <div className="flex items-center justify-end border-b px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs text-destructive"
          disabled={!canEmpty || emptying || restoring !== null}
          onClick={() => setConfirmEmpty(true)}
          data-testid="recycle-bin-empty-action"
        >
          {emptying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {t('recycleBin.page.emptyAction')}
        </Button>
      </div>
      <div className="overflow-x-auto px-4 py-3">{body}</div>

      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent data-testid="recycle-bin-empty-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('recycleBin.page.emptyTitle', { object: objectLabel })}</AlertDialogTitle>
            <AlertDialogDescription>{t('recycleBin.page.emptyBody', { object: objectLabel })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                setConfirmEmpty(false);
                void emptyBin();
              }}
            >
              {t('recycleBin.page.emptyAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
