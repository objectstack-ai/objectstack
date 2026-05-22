// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LiveFormPreview — runs an ObjectForm against the **real** running
 * backend.
 *
 * Studio's job is to be a faithful mirror of the live service: when an
 * author looks at a form preview, they should see (and be able to
 * exercise) exactly the form an end-user will see, with real
 * references, real validation, and real submits hitting the actual DB.
 *
 * Three modes (mutually exclusive, picked from the toggle at the top):
 *
 *   - create   → blank form, Submit writes a new record (toast shows id)
 *   - edit     → pick from the 10 most recent records, edit + save
 *   - view     → same as edit but read-only (for design review)
 *
 * The component never falls back to mock data; if the backend is down
 * or the object has no records, it surfaces the error inline.
 */

import { useEffect, useMemo, useState } from 'react';
import { ObjectForm } from '@object-ui/plugin-form';
import { Eye, Pencil, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useObjectUiDataSource } from '@/hooks/useObjectUiDataSource';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { LivePreviewStatusBar } from './LivePreviewStatusBar';
import { toast } from '@/hooks/use-toast';

type Mode = 'create' | 'edit' | 'view';

export interface LiveFormPreviewProps {
  /** Form view spec (sections/fields/layout/…) */
  spec: any;
  /** Object machine name backing the form */
  objectName: string;
  /** Optional initial mode (defaults to 'create') */
  initialMode?: Mode;
  className?: string;
}

interface RecordRow {
  id: string | number;
  label: string;
}

export function LiveFormPreview({
  spec,
  objectName,
  initialMode = 'create',
  className,
}: LiveFormPreviewProps) {
  const dataSource = useObjectUiDataSource();
  const { version: hmrVersion } = useMetadataHmr();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumping this resets the inner ObjectForm (re-mounts), useful after
  // a successful create so the next submission starts blank.
  const [nonce, setNonce] = useState(0);

  // Load recent records whenever we need them (edit/view modes).
  useEffect(() => {
    if (mode === 'create' || !objectName) {
      setRecords([]);
      setSelectedId('');
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoadingRecords(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await dataSource.find(objectName, {
          pagination: { page: 1, perPage: 10 },
          sort: { field: 'updatedAt', order: 'DESC' },
        });
        if (cancelled) return;
        const rows: RecordRow[] = (res?.data ?? []).map((r: any) => ({
          id: r.id,
          label: pickLabel(r),
        }));
        setRecords(rows);
        if (rows.length > 0 && !selectedId) setSelectedId(String(rows[0].id));
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message ?? String(err));
        setRecords([]);
      } finally {
        if (!cancelled) setLoadingRecords(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, objectName, dataSource, nonce, hmrVersion]);

  const recordId = mode === 'create' ? undefined : selectedId || undefined;

  const schema = useMemo(
    () => ({
      type: 'object-form' as const,
      objectName,
      mode,
      ...(recordId ? { recordId } : {}),
      readOnly: mode === 'view',
      ...spec,
    }),
    [objectName, mode, recordId, spec],
  );

  const onSuccess = (data: any) => {
    if (mode === 'create') {
      toast({
        title: 'Created record',
        description: data?.id ? `id: ${data.id}` : undefined,
      });
      setNonce((n) => n + 1);
    } else {
      toast({ title: 'Saved' });
    }
  };
  const onError = (err: Error) => {
    toast({ title: 'Submission failed', description: err.message, variant: 'destructive' as any });
  };

  return (
    <div className={['flex h-full flex-col', className].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed px-4 py-2">
        <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 text-xs">
          {(['create', 'edit', 'view'] as const).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'default' : 'ghost'}
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => setMode(m)}
            >
              {m === 'create' && <Plus className="h-3 w-3" />}
              {m === 'edit' && <Pencil className="h-3 w-3" />}
              {m === 'view' && <Eye className="h-3 w-3" />}
              {m === 'create' ? 'New' : m === 'edit' ? 'Edit' : 'Read-only'}
            </Button>
          ))}
        </div>
        {mode !== 'create' && (
          <div className="flex items-center gap-2">
            <Select
              value={selectedId}
              onValueChange={(v) => setSelectedId(v)}
              disabled={loadingRecords || records.length === 0}
            >
              <SelectTrigger className="h-8 w-[260px] text-xs">
                <SelectValue
                  placeholder={
                    loadingRecords
                      ? 'Loading…'
                      : records.length === 0
                        ? 'No records yet'
                        : 'Pick a record'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {records.map((r) => (
                  <SelectItem key={String(r.id)} value={String(r.id)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={() => setNonce((n) => n + 1)}
              title="Refresh records"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {loadError && (
          <div className="mb-3 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            Failed to load records: {loadError}
          </div>
        )}
        {mode !== 'create' && !loadingRecords && records.length === 0 && !loadError && (
          <div className="mb-3 rounded border border-dashed p-3 text-xs text-muted-foreground">
            No records exist for <code>{objectName}</code>. Switch to{' '}
            <button
              className="underline underline-offset-2"
              onClick={() => setMode('create')}
            >
              New
            </button>{' '}
            to create one.
          </div>
        )}
        {/* Re-mount ObjectForm when nonce or recordId changes so it
            re-fetches data and resets dirty state cleanly. */}
        <ObjectForm
          key={`${mode}:${recordId ?? 'new'}:${nonce}:hmr-${hmrVersion}`}
          schema={{ ...schema, onSuccess, onError } as any}
          dataSource={dataSource}
        />
      </div>
      <LivePreviewStatusBar objectName={objectName} />
    </div>
  );
}

/** Choose the most human-friendly identifier for a record row. */
function pickLabel(r: any): string {
  const display =
    r?.name ?? r?.label ?? r?.title ?? r?.subject ?? r?.email ?? r?.code;
  if (display) return `${display} (${r.id})`;
  return String(r?.id ?? '');
}
