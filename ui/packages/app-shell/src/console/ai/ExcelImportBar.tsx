// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ExcelImportBar — the "my real data is in it" half of the Excel→App wedge
 * (cloud#797). When a user attaches a spreadsheet in the AI build panel, the
 * agent parses a brief and builds the schema; this bar then lets them load the
 * SAME file's real rows into a built object in two clicks — no re-picking the
 * file, no hunting for the Import button in a list view.
 *
 * It's a thin host: pick a target object → hand the attached File straight to
 * the existing ImportWizard with `initialFile`, which owns parsing, column
 * mapping, dry-run and the real server-side import. So the magic-flow trial
 * goes from "one sentence → app with demo data" to "app with MY data" — the
 * retention hinge for a spreadsheet refugee.
 *
 * Import is the `listImport` row of the affordance-to-grant map (objectui#12082),
 * the row the console list's Import reads for the same wizard: it is offered for
 * the picked object only when the caller's create grant and the server's
 * effective operation set allow it, and picking another object asks again.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { toast } from 'sonner';
import { useObjectTranslation } from '@object-ui/i18n';
import { resolveAffordance } from '@object-ui/core';
import { usePermissions } from '@object-ui/permissions';
import { ImportWizard } from '@object-ui/plugin-grid';

interface WizardField {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  options?: Array<{ label?: string; value?: string | number } | string>;
}

interface ExcelImportBarProps {
  /** The attached spreadsheet, retained by the composer (objectui#2386). */
  file: File;
  /** The console data adapter (has getObjectSchema + import routes). */
  dataSource: any;
  /** Pre-select this object (e.g. the one just built this session). */
  defaultObjectName?: string;
  /** Called when the user dismisses the bar or an import completes. */
  onDone: () => void;
}

const SKIP_OBJECT_PREFIXES = ['sys_', 'ai_', 'cloud_'];
const NON_WRITABLE_TYPES = ['formula', 'summary', 'autonumber'];

/** Normalize a getObjectSchema result's fields → the ImportWizard field shape. */
function normalizeFields(schema: any): WizardField[] {
  const raw = schema?.fields ?? schema?.data?.fields ?? schema?.item?.fields ?? {};
  const entries: Array<[string, any]> = Array.isArray(raw)
    ? raw.map((f: any) => [f?.name, f])
    : Object.entries(raw);
  return entries
    .map(([name, def]) => ({
      name: (def?.name ?? name) as string,
      label: (def?.label ?? def?.name ?? name) as string,
      type: (def?.type ?? 'text') as string,
      required: !!def?.required,
      options: def?.options,
    }))
    .filter((f) => f.name && !NON_WRITABLE_TYPES.includes(f.type));
}

/** The item a held object name none of the listed objects carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the target-object picker, drawn with the shared `Select`
 * the rest of the console picks with. It used to be a browser-native
 * `<select>`. What a pick writes is unchanged: `onPick` receives the picked
 * object's `name`, the string the native control's `change` carried, and the
 * bar imports into it as before.
 *
 * - Items carry their option's INDEX, not its value, as every picker on
 *   objectui#11865 does; an index cannot collide with an object name.
 * - A held name none of the listed objects carries (a `defaultObjectName` the
 *   list does not return, or any name while the list is loading or failed) gets
 *   an item of its own, labelled with the name, so the trigger shows the
 *   object Import would load into. The native control showed the first listed
 *   object there, or nothing. Picking that item writes nothing.
 * - Disabled follows the primitive (objectui#11781): `disabled` disables the
 *   trigger itself.
 */
function ObjectPicker({
  value,
  options,
  onPick,
  disabled,
}: {
  value: string;
  options: ReadonlyArray<{ name: string; label: string }>;
  onPick: (name: string) => void;
  disabled: boolean;
}) {
  const at = options.findIndex((o) => o.name === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the held name, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.name);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-auto gap-2 px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.name}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ExcelImportBar({ file, dataSource, defaultObjectName, onDone }: ExcelImportBarProps) {
  const { t } = useObjectTranslation();
  const authFetch = useMemo(() => createAuthenticatedFetch(), []);
  const [objects, setObjects] = useState<Array<{ name: string; label: string }> | null>(null);
  const [selected, setSelected] = useState<string>(defaultObjectName ?? '');
  const [loadingFields, setLoadingFields] = useState(false);
  const [fields, setFields] = useState<WizardField[] | null>(null);
  const [open, setOpen] = useState(false);
  const perms = usePermissions();
  // objectui#12082 — the `listImport` row, asked of the picked object. The bar
  // has not read that object's schema when it offers Import (it reads it on the
  // press), so the policy half reads the default bucket; the grant and the
  // effective operation set are the server's own refusal. With no permission
  // provider mounted both read open, as before.
  const importGranted = resolveAffordance('listImport', {
    objectSchema: null,
    objectName: selected,
    perms,
  }).allowed;

  // List the env's user objects so the user can target the import. Uses the
  // uncached meta list endpoint; filters platform/system objects.
  useEffect(() => {
    let cancelled = false;
    const apiBase = ((import.meta as any).env?.VITE_SERVER_URL || '').replace(/\/+$/, '');
    (async () => {
      try {
        const res = await authFetch(`${apiBase}/api/v1/meta/object`, { method: 'GET', credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json().catch(() => null);
        const items = json?.data?.items ?? json?.items ?? json?.data ?? (Array.isArray(json) ? json : []);
        const objs = (Array.isArray(items) ? items : [])
          .map((o: any) => ({ name: o?.name as string, label: (o?.label as string) || (o?.name as string) }))
          .filter((o: { name: string }) => o.name && !SKIP_OBJECT_PREFIXES.some((p) => o.name.startsWith(p)));
        if (cancelled) return;
        setObjects(objs);
        if (!selected && objs.length) {
          const preferred = defaultObjectName && objs.find((o: { name: string }) => o.name === defaultObjectName);
          setSelected(preferred ? defaultObjectName! : objs[0].name);
        }
      } catch {
        if (!cancelled) setObjects([]);
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch, defaultObjectName]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openWizard() {
    if (!selected || !importGranted) return;
    setLoadingFields(true);
    try {
      const schema = await dataSource.getObjectSchema(selected);
      const f = normalizeFields(schema);
      if (!f.length) {
        toast.error(t('excelImport.noImportableFields'));
        return;
      }
      setFields(f);
      setOpen(true);
    } catch {
      toast.error(t('excelImport.schemaReadFailed'));
    } finally {
      setLoadingFields(false);
    }
  }

  const selectedLabel = objects?.find((o) => o.name === selected)?.label ?? selected;

  if (open && fields) {
    return (
      <ImportWizard
        open={open}
        onOpenChange={(v) => { setOpen(v); if (!v) onDone(); }}
        objectName={selected}
        objectLabel={selectedLabel}
        fields={fields}
        dataSource={dataSource}
        initialFile={file}
        onComplete={(result) => {
          toast.success(
            t('excelImport.imported', { count: result.importedRows, object: selectedLabel }),
          );
        }}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-excel-import-bar>
      <Badge variant="secondary">CSV / Excel</Badge>
      <span className="text-muted-foreground">
        {t('excelImport.importFrom')}
      </span>
      <code className="font-medium">{file.name}</code>
      <span className="text-muted-foreground">{t('excelImport.into')}</span>
      <ObjectPicker
        value={selected}
        options={objects ?? []}
        onPick={setSelected}
        disabled={!objects || objects.length === 0}
      />
      <Button size="sm" onClick={openWizard} disabled={!selected || loadingFields || !importGranted}>
        {loadingFields ? t('excelImport.opening') : t('excelImport.importAction')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t('excelImport.dismiss')}
      </Button>
    </div>
  );
}
