// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30089 — the selection-bar actions of a list view, in the
 * list-view panel: the buttons the list shows when rows are selected. Two keys
 * of the list body, both the spec's (`ListViewSchema`), and no other:
 *
 *  - `bulkActions` — names of actions the object declares, picked by label.
 *    The grid promotes each to that action (its label, params, `visible`), so
 *    it runs once per selected record. The built-in Delete is offered here
 *    too, under its reserved name `delete`.
 *  - `bulkActionDefs` — field updates (`operation: 'update'`): a label, the
 *    fields the dialog asks for (one param per field, named for it, so the
 *    value is written to that field) and a confirmation sentence. A def is
 *    written only once it has a label and a field, and only when the spec's
 *    `BulkActionDefSchema` accepts it.
 *
 * The built-in Delete: the grid shows it on the selection bar while the view
 * declares neither key. Once the view declares either, Delete stays only when
 * `bulkActions` names it (`bulkDeleteStateOf`). The section says which holds.
 *
 * A def of another kind (`delete`, an aggregate `custom` dispatch) is shown
 * with its label and can be removed; it is edited in metadata. A name in
 * `bulkActions` the object does not declare is shown marked, with its remove
 * button. An emptied key is removed, never written empty, so a view that
 * declares neither key is saved as it was.
 *
 * Only a grid draws the selection bar these keys configure, so only a grid
 * view shows the section (`listViewHasSelectionBar`). Writes go through the
 * panel's `writeBody`, the buffer every other section edits, so a read-only
 * base's view is written through the same customization copy.
 */

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { BulkActionDefSchema, resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { useMetadataClient } from '../metadata-admin/useMetadata.js';
import { readFields } from '../metadata-admin/previews/object-fields-io.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';

type Row = Record<string, unknown>;

function isPlainObject(v: unknown): v is Row {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function namesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && n !== '') : [];
}

function defsOf(v: unknown): Row[] {
  return Array.isArray(v) ? v.filter(isPlainObject) : [];
}

/** The reserved `bulkActions` name of the grid's built-in Delete. */
export const BUILTIN_BULK_DELETE = 'delete';

/** Whether a list body's type draws the selection bar these keys configure: a grid. */
export function listViewHasSelectionBar(body: Row): boolean {
  return body.type === undefined || body.type === 'grid';
}

/**
 * What the grid does with its built-in Delete for this body: `default` — the
 * view declares no selection action, so Delete shows; `kept` — `bulkActions`
 * names it; `dropped` — the view declares its own actions and not Delete.
 */
export type BulkDeleteState = 'default' | 'kept' | 'dropped';

export function bulkDeleteStateOf(body: Row): BulkDeleteState {
  const names = namesOf(body.bulkActions);
  if (names.length > 0) return names.some((n) => n.toLowerCase() === BUILTIN_BULK_DELETE) ? 'kept' : 'dropped';
  return defsOf(body.bulkActionDefs).length > 0 ? 'dropped' : 'default';
}

/** `body` with `key` set to `list`, or without `key` when `list` is empty. */
function withList(body: Row, key: 'bulkActions' | 'bulkActionDefs', list: unknown[]): Row {
  const { [key]: _dropped, ...rest } = body;
  return list.length > 0 ? { ...rest, [key]: list } : rest;
}

/** The field types a field update can ask for: a value the dialog can collect and the patch can write. */
const UPDATABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
  'text', 'textarea', 'email', 'url', 'phone',
  'number', 'currency', 'percent',
  'date', 'datetime', 'time',
  'boolean', 'toggle',
  'select', 'multiselect', 'radio', 'checkboxes',
  'lookup', 'master_detail', 'user',
]);

/** A field a field update can ask for, with what its param needs from the field. */
export interface UpdatableField {
  name: string;
  label: string;
  type: string;
  multiple: boolean;
  options?: Array<{ label: string; value: string | number | boolean }>;
  /** The record picker's object, for a `lookup` / `master_detail` field. */
  reference?: string;
}

interface ObjectAction {
  name: string;
  label: string;
}

function optionsOf(def: Row, locale: string): UpdatableField['options'] {
  if (!Array.isArray(def.options)) return undefined;
  const options = def.options.flatMap((o) => {
    if (!isPlainObject(o)) return [];
    const value = o.value;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return [];
    const label = resolveI18nLabel(o.label as I18nLabel | undefined, locale) || String(value);
    return [{ label, value }];
  });
  return options.length > 0 ? options : undefined;
}

/** The object's fields a field update can ask for: writable, of an updatable type, and not platform-injected. */
export function updatableFieldsOf(object: Row | null, locale: string): UpdatableField[] {
  if (!object) return [];
  return readFields(object.fields).entries.flatMap(({ name, def }) => {
    const type = typeof def.type === 'string' ? def.type : '';
    if (!UPDATABLE_FIELD_TYPES.has(type)) return [];
    if (def.readonly === true || isStudioHiddenSystemField(def)) return [];
    const reference = typeof def.reference === 'string' && def.reference !== '' ? def.reference : undefined;
    // A record picker with no object to search cannot be drawn.
    if ((type === 'lookup' || type === 'master_detail') && !reference) return [];
    const options = optionsOf(def, locale);
    return [
      {
        name,
        label: resolveI18nLabel(def.label as I18nLabel | undefined, locale) || name,
        type,
        multiple: def.multiple === true,
        ...(options ? { options } : {}),
        ...(reference && type !== 'user' ? { reference } : {}),
      },
    ];
  });
}

function objectActionsOf(object: Row | null, locale: string): ObjectAction[] {
  if (!object || !Array.isArray(object.actions)) return [];
  return object.actions.flatMap((a) => {
    if (!isPlainObject(a) || typeof a.name !== 'string' || a.name === '') return [];
    return [{ name: a.name, label: resolveI18nLabel(a.label as I18nLabel | undefined, locale) || a.name }];
  });
}

/** The param a field update asks for `field` with: named for the field, so its value is written there. */
export function bulkParamOfField(field: UpdatableField): Row {
  return {
    name: field.name,
    label: field.label,
    type: field.type,
    required: true,
    ...(field.multiple ? { multiple: true } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.reference ? { object: field.reference } : {}),
  };
}

/** A def name no other selection action of the view holds: `update_<fields>`, else with `_N`. */
function freeDefName(fields: string[], taken: string[]): string {
  const wanted = `update_${fields.join('_')}`.slice(0, 60).replace(/_+$/, '');
  const held = new Set(taken);
  if (!held.has(wanted)) return wanted;
  let i = 2;
  while (held.has(`${wanted}_${i}`)) i += 1;
  return `${wanted}_${i}`;
}

/** The first refusal the spec's `BulkActionDefSchema` answers `def` with, or `null` when it accepts it. */
export function bulkDefRefusal(def: Row): string | null {
  const verdict = BulkActionDefSchema.safeParse(def);
  if (verdict.success) return null;
  const issue = verdict.error.issues[0];
  return issue ? `${issue.path.join('.') || 'def'}: ${issue.message}` : 'invalid';
}

/** The object as the panel's other pickers read it: drafts overlaid. */
function useObjectRead(objectName: string): { object: Row | null; loading: boolean; error: string | null } {
  const client = useMetadataClient();
  const [state, setState] = React.useState<{ for: string; object: Row | null; error: string | null }>({
    for: '',
    object: null,
    error: null,
  });
  React.useEffect(() => {
    let cancelled = false;
    client
      .withPreviewDrafts(true)
      .get<Row>('object', objectName)
      .then(
        (obj) => {
          if (!cancelled) setState({ for: objectName, object: isPlainObject(obj) ? obj : null, error: null });
        },
        (err: unknown) => {
          if (!cancelled) setState({ for: objectName, object: null, error: err instanceof Error ? err.message : String(err) });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [client, objectName]);
  const current = state.for === objectName;
  return { object: current ? state.object : null, loading: !current, error: current ? state.error : null };
}

const ACTION_PICK_ID = 'studio-list-view-bulk-action-pick';

function RemoveButton({ name, onClick, locale }: { name: string; onClick: () => void; locale: string }) {
  return (
    <button
      type="button"
      aria-label={tFormat('engine.form.removeNamed', locale, { name })}
      onClick={onClick}
      className="px-1 text-muted-foreground hover:text-destructive"
    >
      <X className="h-3 w-3" />
    </button>
  );
}

/** Pick one of `fields` to add; the trigger reads `placeholder`. */
function FieldPick({
  id,
  fields,
  placeholder,
  onPick,
  disabled,
}: {
  id: string;
  fields: UpdatableField[];
  placeholder: string;
  onPick: (field: UpdatableField) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value=""
      onValueChange={(name) => {
        const field = fields.find((f) => f.name === name);
        if (field) onPick(field);
      }}
      disabled={disabled || fields.length === 0}
    >
      <SelectTrigger id={id} className="h-8 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {fields.map((f) => (
          <SelectItem key={f.name} value={f.name} className="text-xs">
            <span>{f.label}</span>
            <code className="ml-2 text-muted-foreground">{f.name}</code>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The params of a field update as chips: label, machine name, remove (never the last one). */
function ParamChips({
  params,
  onRemove,
  readOnly,
  locale,
}: {
  params: Row[];
  onRemove: (name: string) => void;
  readOnly: boolean;
  locale: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {params.map((p) => {
        const name = typeof p.name === 'string' ? p.name : '';
        const label = typeof p.label === 'string' && p.label ? p.label : name;
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5 text-[11px]"
            data-testid="list-view-bulk-def-field"
            data-name={name}
          >
            {label}
            {!readOnly && params.length > 1 && <RemoveButton name={label} onClick={() => onRemove(name)} locale={locale} />}
          </span>
        );
      })}
    </div>
  );
}

/** One field update of the view, edited in place. */
function FieldUpdateRow({
  def,
  index,
  fields,
  onChange,
  onRemove,
  readOnly,
  locale,
}: {
  def: Row;
  index: number;
  fields: UpdatableField[];
  onChange: (next: Row) => void;
  onRemove: () => void;
  readOnly: boolean;
  locale: string;
}) {
  const name = String(def.name ?? '');
  const params = defsOf(def.params);
  const asked = new Set(params.map((p) => p.name));
  const label = typeof def.label === 'string' ? def.label : '';
  // A served def carries `confirmText` as the parsed `{ dialect, source }`
  // envelope, the shorthand string lifted: the sentence is its `source`, and an
  // edit keeps the envelope.
  const envelope = isPlainObject(def.confirmText) ? def.confirmText : null;
  const confirm =
    typeof def.confirmText === 'string' ? def.confirmText : typeof envelope?.source === 'string' ? envelope.source : '';
  const setText = (key: 'label' | 'confirmText', value: string) => {
    const { [key]: _dropped, ...rest } = def;
    const kept = key === 'confirmText' && envelope ? { ...envelope, source: value } : value;
    onChange(value.trim() ? { ...rest, [key]: kept } : rest);
  };
  return (
    <div className="space-y-1.5 rounded border border-input p-2" data-testid="list-view-bulk-def" data-name={name} data-operation="update">
      <div className="flex items-center gap-1">
        <Input
          aria-label={t('engine.studio.inspector.listView.bulk.defLabel', locale)}
          value={label}
          onChange={(e) => setText('label', e.target.value)}
          placeholder={t('engine.studio.inspector.listView.bulk.defLabelPlaceholder', locale)}
          disabled={readOnly}
          className="h-7 flex-1 text-xs"
          data-testid="list-view-bulk-def-label"
        />
        {!readOnly && <RemoveButton name={label || name} onClick={onRemove} locale={locale} />}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('engine.studio.inspector.listView.bulk.defFields', locale)}</p>
      <ParamChips
        params={params}
        readOnly={readOnly}
        locale={locale}
        onRemove={(field) => onChange({ ...def, params: params.filter((p) => p.name !== field) })}
      />
      {!readOnly && (
        <FieldPick
          id={`studio-list-view-bulk-def-${index}-add-field`}
          fields={fields.filter((f) => !asked.has(f.name))}
          placeholder={t('engine.studio.inspector.listView.bulk.addField', locale)}
          onPick={(f) => onChange({ ...def, params: [...params, bulkParamOfField(f)] })}
        />
      )}
      <Input
        aria-label={t('engine.studio.inspector.listView.bulk.confirm', locale)}
        value={confirm}
        onChange={(e) => setText('confirmText', e.target.value)}
        placeholder={t('engine.studio.inspector.listView.bulk.confirmPlaceholder', locale)}
        disabled={readOnly}
        className="h-7 text-xs"
        data-testid="list-view-bulk-def-confirm"
      />
    </div>
  );
}

/** The "Add field update" form: held here until it has a label and a field. */
function NewFieldUpdate({
  fields,
  onAdd,
  onCancel,
  locale,
}: {
  fields: UpdatableField[];
  onAdd: (draft: { label: string; params: Row[]; confirmText: string }) => string | null;
  onCancel: () => void;
  locale: string;
}) {
  const [label, setLabel] = React.useState('');
  const [picked, setPicked] = React.useState<UpdatableField[]>([]);
  const [confirm, setConfirm] = React.useState('');
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const ready = label.trim() !== '' && picked.length > 0;
  const params = picked.map(bulkParamOfField);
  return (
    <div className="space-y-1.5 rounded border border-dashed p-2" data-testid="list-view-bulk-new-def">
      <Input
        aria-label={t('engine.studio.inspector.listView.bulk.defLabel', locale)}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('engine.studio.inspector.listView.bulk.defLabelPlaceholder', locale)}
        className="h-7 text-xs"
        data-testid="list-view-bulk-new-def-label"
      />
      <p className="text-[11px] text-muted-foreground">{t('engine.studio.inspector.listView.bulk.defFields', locale)}</p>
      <ParamChips
        params={params}
        readOnly={false}
        locale={locale}
        onRemove={(name) => setPicked((p) => p.filter((f) => f.name !== name))}
      />
      <FieldPick
        id="studio-list-view-bulk-new-def-field"
        fields={fields.filter((f) => !picked.some((p) => p.name === f.name))}
        placeholder={t('engine.studio.inspector.listView.bulk.addField', locale)}
        onPick={(f) => setPicked((p) => [...p, f])}
      />
      <Input
        aria-label={t('engine.studio.inspector.listView.bulk.confirm', locale)}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t('engine.studio.inspector.listView.bulk.confirmPlaceholder', locale)}
        className="h-7 text-xs"
        data-testid="list-view-bulk-new-def-confirm"
      />
      {refusal && (
        <p className="text-[11px] text-destructive" role="alert" data-testid="list-view-bulk-new-def-refusal">
          {refusal}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          {t('engine.studio.inspector.listView.bulk.cancel', locale)}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={!ready}
          data-testid="list-view-bulk-new-def-add"
          onClick={() => setRefusal(onAdd({ label: label.trim(), params, confirmText: confirm.trim() }))}
        >
          {t('engine.studio.inspector.listView.bulk.add', locale)}
        </Button>
      </div>
    </div>
  );
}

export function ListViewBulkActionsSection({
  objectName,
  body,
  writeBody,
  readOnly,
  locale,
}: {
  objectName: string;
  body: Row;
  writeBody: (next: Row) => void;
  readOnly: boolean;
  locale: string;
}) {
  const { object, loading, error } = useObjectRead(objectName);
  const actions = React.useMemo(() => objectActionsOf(object, locale), [object, locale]);
  const fields = React.useMemo(() => updatableFieldsOf(object, locale), [object, locale]);
  const [adding, setAdding] = React.useState(false);

  const names = namesOf(body.bulkActions);
  const defs = Array.isArray(body.bulkActionDefs) ? (body.bulkActionDefs as unknown[]) : [];
  const deleteState = bulkDeleteStateOf(body);
  const deleteLabel = t('engine.studio.inspector.listView.bulk.builtinDelete', locale);
  const labelOfName = (name: string): { label: string; known: boolean } => {
    if (name.toLowerCase() === BUILTIN_BULK_DELETE) return { label: deleteLabel, known: true };
    const action = actions.find((a) => a.name === name);
    return action ? { label: action.label, known: true } : { label: name, known: false };
  };
  const offered = [
    ...actions.filter((a) => !names.includes(a.name) && a.name.toLowerCase() !== BUILTIN_BULK_DELETE),
    ...(names.some((n) => n.toLowerCase() === BUILTIN_BULK_DELETE) ? [] : [{ name: BUILTIN_BULK_DELETE, label: deleteLabel }]),
  ];
  const writeNames = (next: string[]) => writeBody(withList(body, 'bulkActions', next));
  const writeDefs = (next: unknown[]) => writeBody(withList(body, 'bulkActionDefs', next));

  const addDef = (draft: { label: string; params: Row[]; confirmText: string }): string | null => {
    const taken = [...names, ...defs.flatMap((d) => (isPlainObject(d) && typeof d.name === 'string' ? [d.name] : []))];
    const def: Row = {
      name: freeDefName(draft.params.map((p) => String(p.name)), taken),
      label: draft.label,
      operation: 'update',
      params: draft.params,
      ...(draft.confirmText ? { confirmText: draft.confirmText } : {}),
    };
    const refusal = bulkDefRefusal(def);
    if (refusal) return refusal;
    writeDefs([...defs, def]);
    setAdding(false);
    return null;
  };

  return (
    <div className="space-y-2 border-t pt-3" data-testid="list-view-bulk">
      <div>
        <p className="text-xs font-medium">{t('engine.studio.inspector.listView.bulk', locale)}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t('engine.studio.inspector.listView.bulk.intro', locale)}
        </p>
      </div>
      <p
        className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground"
        data-testid="list-view-bulk-delete"
        data-state={deleteState}
      >
        {t(`engine.studio.inspector.listView.bulk.delete.${deleteState}`, locale)}
      </p>
      {error && (
        <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] leading-snug text-muted-foreground" role="status" data-testid="list-view-bulk-read-failed">
          {tFormat('engine.studio.inspector.listView.bulk.readFailed', locale, { reason: error })}
        </p>
      )}

      <div className="space-y-1.5" data-testid="list-view-bulk-actions">
        <Label htmlFor={ACTION_PICK_ID} className="text-xs text-muted-foreground">
          {t('engine.studio.inspector.listView.bulk.actions', locale)}
        </Label>
        {names.length > 0 && (
          <div className="space-y-1">
            {names.map((name) => {
              const { label, known } = labelOfName(name);
              const stale = !loading && !error && !known;
              return (
                <div
                  key={name}
                  className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs"
                  data-testid="list-view-bulk-action"
                  data-name={name}
                  data-stale={stale ? 'true' : undefined}
                >
                  <span className="flex-1 truncate">
                    <span>{label}</span>
                    <code className="ml-2 text-muted-foreground">{name}</code>
                    {stale && (
                      <span className="ml-2 text-destructive">{t('engine.studio.inspector.listView.bulk.notAnAction', locale)}</span>
                    )}
                  </span>
                  {!readOnly && <RemoveButton name={label} onClick={() => writeNames(names.filter((n) => n !== name))} locale={locale} />}
                </div>
              );
            })}
          </div>
        )}
        {!readOnly && (
          <Select value="" onValueChange={(name) => writeNames([...names, name])} disabled={loading || offered.length === 0}>
            <SelectTrigger id={ACTION_PICK_ID} className="h-8 text-xs" data-testid="list-view-bulk-action-pick">
              <SelectValue placeholder={t('engine.studio.inspector.listView.bulk.addAction', locale)} />
            </SelectTrigger>
            <SelectContent>
              {offered.map((a) => (
                <SelectItem key={a.name} value={a.name} className="text-xs">
                  <span>{a.label}</span>
                  <code className="ml-2 text-muted-foreground">{a.name}</code>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1.5" data-testid="list-view-bulk-defs">
        <p className="text-xs text-muted-foreground">{t('engine.studio.inspector.listView.bulk.fieldUpdates', locale)}</p>
        {defs.map((def, i) => {
          if (!isPlainObject(def)) return null;
          const name = String(def.name ?? '');
          const removeDef = () => writeDefs(defs.filter((_, j) => j !== i));
          if (def.operation === 'update') {
            return (
              <FieldUpdateRow
                key={`${name}-${i}`}
                def={def}
                index={i}
                fields={fields}
                readOnly={readOnly}
                locale={locale}
                onRemove={removeDef}
                onChange={(next) => writeDefs(defs.map((d, j) => (j === i ? next : d)))}
              />
            );
          }
          // Another kind of def: shown, removable, edited in metadata.
          const label = typeof def.label === 'string' && def.label ? def.label : name;
          return (
            <div
              key={`${name}-${i}`}
              className="flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs"
              data-testid="list-view-bulk-def"
              data-name={name}
              data-operation={String(def.operation ?? '')}
            >
              <span className="flex-1 truncate">
                <span>{label}</span>
                <span className="ml-2 text-muted-foreground">{t('engine.studio.inspector.listView.bulk.inMetadata', locale)}</span>
              </span>
              {!readOnly && <RemoveButton name={label} onClick={removeDef} locale={locale} />}
            </div>
          );
        })}
        {!readOnly &&
          (adding ? (
            <NewFieldUpdate fields={fields} onAdd={addDef} onCancel={() => setAdding(false)} locale={locale} />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-start gap-1.5 text-xs font-normal"
              disabled={loading || fields.length === 0}
              onClick={() => setAdding(true)}
              data-testid="list-view-bulk-add-def"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('engine.studio.inspector.listView.bulk.addFieldUpdate', locale)}
            </Button>
          ))}
      </div>
    </div>
  );
}
