// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio → Data → an object → Form → Public forms (objectstack#36444): the
 * designer of the object's public forms (forms anyone can fill in without
 * signing in, each submission a record of the object). Create and delete a
 * form; pick its fields (fillable ones only), drag them into order, mark them
 * required and group them into named sections; set its title, description,
 * after-submit message and address; see it live as it is edited.
 *
 * Saves go through Studio's draft → publish path: Save draft writes the
 * form's draft where the open object is edited (its package, or on an
 * installed app its customization package, as a declared override of a form
 * the app ships), and Publish puts it live. Switching a form on or off is
 * Setup's (Setup → Public forms), not the designer's.
 *
 * The rules (fillable fields, object-required fields, the address) are
 * `publicFormDesign.ts`'s.
 */

import * as React from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, GripVertical, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { MetadataClient } from '@object-ui/data-objectstack';
import { ObjectForm } from '@object-ui/plugin-form';
import { SchemaRendererProvider } from '@object-ui/react';
import { emitMetadataRefresh } from '../../../assistant/assistantBus.js';
import { t, tFormat } from '../../metadata-admin/i18n.js';
import { declaredOverrideOf, overrideDraftBody } from '../StudioCustomizeControls.js';
import { markShippedOff } from '../../setup/publicForms.js';
import type { StudioBaseCustomization, StudioSavedDraft } from '../StudioPillarKit.js';
import {
  addressProblem,
  fieldsOnForm,
  fillableFields,
  isPublicFormItem,
  missingRequiredFields,
  newPublicFormModel,
  newPublicFormName,
  previewSectionsOf,
  publicFormItemOf,
  publicFormModelOf,
  publicFormObjectOf,
  publicFormShownName,
  removeFieldRefusal,
  slugFromTitle,
  takenAddresses,
  withField,
  withFieldMoved,
  withoutField,
  withoutSection,
  withRequired,
  withSection,
  withSectionLabel,
  withSectionMoved,
  type PublicFormModel,
} from './publicFormDesign.js';

type FormDoc = Record<string, any>;

const isDoc = (v: unknown): v is FormDoc => !!v && typeof v === 'object' && !Array.isArray(v);

/** One public form of the object, as the list shows it. */
interface ListedForm {
  name: string;
  title: string;
  slug: string;
  /** Live (served) and taking submissions. */
  on: boolean;
  /** Published at all (a form only drafted is not). */
  published: boolean;
  /** The package that serves it, when published. */
  packageId: string | null;
  /** Its installed app ships it switched off, so it stays closed whatever is published here (`markShippedOff`). */
  shippedOff?: boolean;
  /** Its app's own document could not be read, so whether it is live is not known. */
  unknown?: boolean;
}

/** The open form: what was read, and the buffer being edited. */
interface OpenForm {
  name: string;
  /** The stored document the buffer started from (`null`: a new form). */
  base: FormDoc | null;
  /** The package whose row serves the form, or `null` for a new or draft-only one. */
  owner: string | null;
  /** A draft of it is pending where it is saved. */
  hasDraft: boolean;
  /** Where its draft is read and written: a package id, or `null` before the ensure door names the pair. */
  at: string | null;
  model: PublicFormModel;
  dirty: boolean;
}

export interface PublicFormsDesignerProps {
  objectName: string;
  /** The object's definition as Studio edits it (its fields). */
  objectDef: Record<string, unknown>;
  client: MetadataClient;
  /** The package the open object is read and saved at. */
  packageId: string;
  /** The open object's package is read-only (an installed app). */
  readOnly: boolean;
  /** On a read-only base, its customization package. */
  customization: StudioBaseCustomization | null;
  publishNonce: number;
  onDraftSaved?: (saved?: StudioSavedDraft) => void;
  locale: string;
  /** The data source the live preview renders with (it never writes). */
  previewDataSource: unknown;
  /** The Form tab's leading controls (the record form / public forms switch). */
  leading: React.ReactNode;
  /** The address of the anonymous form route (`useHref('/f')`), for the address preview. */
  formRoute?: string;
}

/** The address prefix shown before the slug. */
function addressPrefix(formRoute: string | undefined): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${formRoute ?? '/f'}/`;
}

export function PublicFormsDesigner(props: PublicFormsDesignerProps): React.ReactElement {
  const { objectName, objectDef, client, packageId, readOnly, customization, publishNonce, onDraftSaved, locale } = props;
  const [listed, setListed] = React.useState<ListedForm[] | null>(null);
  const [taken, setTaken] = React.useState<Map<string, string>>(new Map());
  const [listError, setListError] = React.useState<string | null>(null);
  const [listNonce, setListNonce] = React.useState(0);
  const [open, setOpen] = React.useState<OpenForm | null>(null);
  const [busy, setBusy] = React.useState<null | 'load' | 'save' | 'publish' | 'discard' | 'delete'>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState<{ title: string; slug: string; slugTouched: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);

  const canWrite = !readOnly || (customization !== null && !customization.walled);
  const fields = React.useMemo(() => fillableFields(objectDef), [objectDef]);
  const fieldLabel = React.useMemo(() => new Map(fields.map((f) => [f.name, f.label])), [fields]);
  const requiredByObject = React.useMemo(
    () => new Set(fields.filter((f) => f.objectRequired).map((f) => f.name)),
    [fields],
  );

  // The object's public forms: the published list, plus the forms only drafted.
  React.useEffect(() => {
    let live = true;
    setListError(null);
    (async () => {
      try {
        const [published, drafts] = await Promise.all([
          client.list<FormDoc>('view'),
          client.listDrafts({ type: 'view' }).catch(() => []),
        ]);
        const items = (published ?? []).filter(isDoc);
        const rows: ListedForm[] = [];
        const seen = new Set<string>();
        for (const item of items) {
          if (!isPublicFormItem(item) || publicFormObjectOf(item) !== objectName) continue;
          const model = publicFormModelOf(item);
          seen.add(model.name);
          rows.push({
            name: model.name,
            title: publicFormShownName(item),
            slug: model.slug,
            on: model.enabled,
            published: true,
            packageId: typeof item._packageId === 'string' ? item._packageId : null,
          });
        }
        const draftItems: FormDoc[] = [];
        for (const d of drafts ?? []) {
          if (!d?.name || seen.has(d.name) || !d.name.startsWith(`${objectName}.`)) continue;
          const body = await client.getDraft<FormDoc>('view', d.name, d.packageId ? { packageId: d.packageId } : {}).catch(() => null);
          const doc = isDoc(body) && isDoc((body as FormDoc).item) ? (body as FormDoc).item : body;
          if (!isPublicFormItem(doc)) continue;
          draftItems.push(doc);
          const model = publicFormModelOf(doc);
          rows.push({ name: model.name, title: publicFormShownName(doc), slug: model.slug, on: false, published: false, packageId: null });
        }
        // A form its installed app ships switched off is never listed as on (Setup → Public forms reads it the same way).
        const marked = await markShippedOff(rows, client as never);
        if (!live) return;
        marked.sort((a, b) => a.title.localeCompare(b.title));
        setListed(marked);
        setTaken(takenAddresses([...items, ...draftItems]));
      } catch (err) {
        if (live) setListError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [client, objectName, listNonce, publishNonce]);

  /** Where an existing form's draft is read and saved. */
  const addressOf = React.useCallback(
    (owner: string | null): string | null => {
      if (!readOnly) return owner && owner !== packageId ? owner : packageId;
      // An installed app: the customization package, once it exists.
      return customization?.pairId ?? null;
    },
    [readOnly, packageId, customization],
  );

  const openForm = React.useCallback(
    async (row: ListedForm) => {
      setNotice(null);
      setCreating(null);
      setConfirmDelete(false);
      setBusy('load');
      try {
        const at = addressOf(row.packageId);
        let layers = await client.layered<FormDoc>('view', row.name, at ? { packageId: at } : row.packageId ? { packageId: row.packageId } : {});
        if (!isDoc(layers.effective) && !isDoc(layers.code) && !isDoc((layers as FormDoc).draft) && row.packageId) {
          layers = await client.layered<FormDoc>('view', row.name, { packageId: row.packageId });
        }
        const draft = isDoc((layers as FormDoc).draft) ? ((layers as FormDoc).draft as FormDoc) : null;
        const stored = draft ?? (isDoc(layers.effective) ? layers.effective : isDoc(layers.code) ? layers.code : null);
        if (!stored) throw new Error(tFormat('engine.studio.publicForms.unreadable', locale, { name: row.title }));
        setOpen({
          name: row.name,
          base: stored,
          owner: row.packageId,
          hasDraft: !!draft,
          at,
          model: publicFormModelOf({ ...stored, name: row.name }),
          dirty: false,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [client, addressOf, locale],
  );

  const edit = (next: PublicFormModel) => setOpen((o) => (o ? { ...o, model: next, dirty: true } : o));

  const problem = open ? addressProblem(open.model.slug, open.model.name, taken) : null;
  const missing = open ? missingRequiredFields(open.model, requiredByObject) : [];
  const isNew = open !== null && open.base === null;
  const shippedByApp = open !== null && readOnly && open.owner !== null && open.owner === customization?.base;

  /** Where a save lands, and the body it writes. */
  const writeTarget = async (model: PublicFormModel): Promise<{ packageId: string; body: FormDoc }> => {
    const body = publicFormItemOf(model, open?.base ?? null);
    if (!readOnly) return { packageId: open?.at ?? packageId, body };
    if (!customization || customization.walled) throw new Error(t('engine.studio.publicForms.readOnly', locale));
    const pair = await customization.ensure();
    if (!shippedByApp) return { packageId: pair, body };
    // A form the app ships is customized as a declared override, never edited in the app.
    const declared = declaredOverrideOf(open?.base, customization.base) ? body : overrideDraftBody(body, customization.base, customization.basedOn);
    if (!declared) throw new Error(t('engine.studio.publicForms.noVersion', locale));
    return { packageId: pair, body: declared };
  };

  const save = async () => {
    if (!open || problem || missing.length > 0) return;
    setBusy('save');
    setNotice(null);
    try {
      const target = await writeTarget(open.model);
      await client.save('view', open.model.name, target.body, {
        mode: 'draft',
        packageId: target.packageId,
        surface: 'studio',
        // A form nobody has drafted yet: a draft written meanwhile is never overwritten.
        ...(open.hasDraft ? {} : { ifNoneMatch: '*' }),
      } as never);
      setOpen({ ...open, at: target.packageId, hasDraft: true, dirty: false, base: { ...(open.base ?? {}), ...target.body } });
      onDraftSaved?.({ type: 'view', name: open.model.name });
      toast.success(tFormat('engine.studio.publicForms.saved', locale, { name: open.model.title || open.model.name }));
      setListNonce((n) => n + 1);
    } catch (err) {
      const status = (err as { status?: unknown })?.status;
      setNotice(status === 409 ? t('engine.studio.publicForms.draftConflict', locale) : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!open?.hasDraft || open.dirty || !open.at) return;
    setBusy('publish');
    setNotice(null);
    try {
      await client.publish('view', open.model.name, { packageId: open.at });
      toast.success(tFormat('engine.studio.publicForms.published', locale, { name: open.model.title || open.model.name }));
      setOpen({ ...open, hasDraft: false, owner: open.owner ?? open.at });
      emitMetadataRefresh();
      setListNonce((n) => n + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!open) return;
    if (!open.hasDraft) {
      // Nothing saved: the buffer goes back to what was read.
      if (open.base) setOpen({ ...open, model: publicFormModelOf({ ...open.base, name: open.name }), dirty: false });
      else setOpen(null);
      return;
    }
    if (!open.at) return;
    setBusy('discard');
    try {
      await client.reset('view', open.model.name, { state: 'draft', packageId: open.at });
      onDraftSaved?.();
      setListNonce((n) => n + 1);
      const row = listed?.find((r) => r.name === open.model.name && r.published);
      setOpen(null);
      if (row) await openForm(row);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!open || shippedByApp) return;
    setBusy('delete');
    setNotice(null);
    try {
      const at = open.at ?? open.owner;
      if (open.hasDraft && at) await client.reset('view', open.model.name, { state: 'draft', packageId: at });
      const row = listed?.find((r) => r.name === open.model.name && r.published);
      if (row) await client.reset('view', open.model.name, { packageId: row.packageId ?? at ?? undefined });
      toast.success(tFormat('engine.studio.publicForms.deleted', locale, { name: open.model.title || open.model.name }));
      onDraftSaved?.();
      emitMetadataRefresh();
      setOpen(null);
      setConfirmDelete(false);
      setListNonce((n) => n + 1);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const startCreate = () => {
    setOpen(null);
    setNotice(null);
    setConfirmDelete(false);
    setCreating({ title: '', slug: '', slugTouched: false });
  };

  const createProblem = creating ? addressProblem(creating.slug, newPublicFormName(objectName, creating.slug), taken) : null;
  const nameTaken =
    creating !== null &&
    !!creating.slug &&
    (listed ?? []).some((r) => r.name === newPublicFormName(objectName, creating.slug));

  const create = () => {
    if (!creating || !creating.title.trim() || createProblem || nameTaken) return;
    const model = newPublicFormModel(objectName, creating.title.trim(), creating.slug, objectDef);
    setCreating(null);
    setOpen({ name: model.name, base: null, owner: null, hasDraft: false, at: readOnly ? null : packageId, model, dirty: true });
  };

  /** Ask to remove a field: refused, with the reason, for one the object requires. */
  const askRemoveField = (field: string) => {
    if (!open) return;
    if (removeFieldRefusal(field, requiredByObject)) {
      setNotice(tFormat('engine.studio.publicForms.requiredByObject', locale, { field: fieldLabel.get(field) ?? field }));
      return;
    }
    setNotice(null);
    edit(withoutField(open.model, field, requiredByObject));
  };

  const prefix = addressPrefix(props.formRoute);
  const problemText = (p: string | null) =>
    p === 'empty'
      ? t('engine.studio.publicForms.addressEmpty', locale)
      : p === 'shape'
        ? t('engine.studio.publicForms.addressShape', locale)
        : p === 'taken'
          ? t('engine.studio.publicForms.addressTaken', locale)
          : null;

  const input =
    'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
  const smallBtn =
    'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted disabled:pointer-events-none disabled:opacity-50';
  const primaryBtn =
    'inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50';

  const editable = canWrite && !!open;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="public-forms-designer">
      {/* The Form tab's one toolbar row. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
        {props.leading}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {open && (
            <>
              {open.hasDraft && !open.dirty && (
                <span className="inline-flex h-6 items-center rounded bg-primary/10 px-2 text-[11px] font-medium text-primary" data-testid="public-form-draft-chip">
                  {t('engine.studio.publicForms.draftChip', locale)}
                </span>
              )}
              {canWrite && (
                <>
                  <button type="button" className={smallBtn} onClick={() => void discard()} disabled={busy !== null || (!open.dirty && !open.hasDraft)} data-testid="public-form-discard">
                    {t('engine.studio.publicForms.discard', locale)}
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => void save()}
                    disabled={busy !== null || !open.dirty || !!problem || missing.length > 0}
                    data-testid="public-form-save"
                  >
                    {busy === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t('engine.studio.publicForms.saveDraft', locale)}
                  </button>
                  <button
                    type="button"
                    className={primaryBtn}
                    onClick={() => void publish()}
                    disabled={busy !== null || !open.hasDraft || open.dirty}
                    title={open.dirty ? t('engine.studio.publicForms.publishNeedsSave', locale) : undefined}
                    data-testid="public-form-publish"
                  >
                    {busy === 'publish' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {t('engine.studio.publicForms.publish', locale)}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* The object's public forms. */}
        <aside className="flex w-56 shrink-0 flex-col border-r" data-testid="public-forms-list">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">{t('engine.studio.publicForms.listTitle', locale)}</span>
            {canWrite && (
              <button type="button" className={smallBtn} onClick={startCreate} data-testid="public-form-new">
                <Plus className="h-3.5 w-3.5" /> {t('engine.studio.publicForms.new', locale)}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {listError ? (
              <p className="px-1 text-xs text-destructive">{listError}</p>
            ) : listed === null ? (
              <p className="px-1 text-xs text-muted-foreground">{t('engine.studio.publicForms.loading', locale)}</p>
            ) : listed.length === 0 ? (
              <p className="px-1 text-xs text-muted-foreground" data-testid="public-forms-list-empty">
                {t('engine.studio.publicForms.none', locale)}
              </p>
            ) : (
              listed.map((row) => (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => void openForm(row)}
                  aria-current={open?.name === row.name ? 'true' : undefined}
                  data-testid={`public-form-item-${row.name}`}
                  className={`mb-0.5 flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted ${open?.name === row.name ? 'bg-muted' : ''}`}
                >
                  <span className="w-full truncate font-medium">{row.title}</span>
                  <span className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">/f/{row.slug}</span>
                    <span className="ml-auto shrink-0">
                      {!row.published
                        ? t('engine.studio.publicForms.stateDraft', locale)
                        : row.on
                          ? t('engine.studio.publicForms.stateOn', locale)
                          : row.shippedOff
                            ? t('engine.studio.publicForms.stateShippedOff', locale)
                            : row.unknown
                              ? t('engine.studio.publicForms.stateUnknown', locale)
                              : t('engine.studio.publicForms.stateOff', locale)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <p className="border-t px-3 py-2 text-[11px] leading-4 text-muted-foreground">{t('engine.studio.publicForms.switchInSetup', locale)}</p>
        </aside>

        {/* The editor. */}
        <section className="min-h-0 flex-1 overflow-auto px-6 py-4" data-testid="public-form-editor">
          {creating ? (
            <div className="max-w-md space-y-3" data-testid="public-form-create">
              <h3 className="text-sm font-semibold">{t('engine.studio.publicForms.newTitle', locale)}</h3>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('engine.studio.publicForms.title', locale)}</span>
                <input
                  className={input}
                  value={creating.title}
                  autoFocus
                  onChange={(e) =>
                    setCreating((c) =>
                      c ? { ...c, title: e.target.value, slug: c.slugTouched ? c.slug : slugFromTitle(e.target.value) } : c,
                    )
                  }
                  data-testid="public-form-create-title"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">{t('engine.studio.publicForms.address', locale)}</span>
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-xs text-muted-foreground">{prefix}</span>
                  <input
                    className={input}
                    value={creating.slug}
                    onChange={(e) => setCreating((c) => (c ? { ...c, slug: e.target.value.trim(), slugTouched: true } : c))}
                    data-testid="public-form-create-address"
                  />
                </div>
                {creating.slug && (createProblem || nameTaken) && (
                  <span className="block text-xs text-destructive" data-testid="public-form-create-address-problem">
                    {nameTaken ? t('engine.studio.publicForms.addressTaken', locale) : problemText(createProblem)}
                  </span>
                )}
              </label>
              <p className="text-xs text-muted-foreground">{t('engine.studio.publicForms.newHint', locale)}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={create}
                  disabled={!creating.title.trim() || !!createProblem || nameTaken}
                  data-testid="public-form-create-confirm"
                >
                  {t('engine.studio.publicForms.create', locale)}
                </button>
                <button type="button" className={smallBtn} onClick={() => setCreating(null)}>
                  {t('engine.studio.publicForms.cancel', locale)}
                </button>
              </div>
            </div>
          ) : !open ? (
            <div className="py-16 text-center text-sm text-muted-foreground" data-testid="public-form-pick">
              {busy === 'load' ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t('engine.studio.publicForms.pick', locale)}
            </div>
          ) : (
            <div className="max-w-xl space-y-4">
              {!canWrite && <p className="rounded-md bg-muted px-3 py-2 text-xs">{t('engine.studio.publicForms.readOnly', locale)}</p>}
              {notice && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="public-form-notice">
                  <span className="flex-1">{notice}</span>
                  <button type="button" aria-label={t('engine.studio.publicForms.dismiss', locale)} onClick={() => setNotice(null)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {missing.length > 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs" data-testid="public-form-missing-required">
                  {tFormat('engine.studio.publicForms.missingRequired', locale, {
                    fields: missing.map((f) => fieldLabel.get(f) ?? f).join(', '),
                  })}
                </p>
              )}

              <div className="grid gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('engine.studio.publicForms.title', locale)}</span>
                  <input className={input} value={open.model.title} disabled={!editable} onChange={(e) => edit({ ...open.model, title: e.target.value })} data-testid="public-form-title" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('engine.studio.publicForms.description', locale)}</span>
                  <textarea
                    className={`${input} h-16 py-1`}
                    value={open.model.description}
                    disabled={!editable}
                    onChange={(e) => edit({ ...open.model, description: e.target.value })}
                    data-testid="public-form-description"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('engine.studio.publicForms.address', locale)}</span>
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 text-xs text-muted-foreground">{prefix}</span>
                    <input
                      className={input}
                      value={open.model.slug}
                      disabled={!editable}
                      onChange={(e) => edit({ ...open.model, slug: e.target.value.trim() })}
                      data-testid="public-form-address"
                    />
                  </div>
                  {problem && (
                    <span className="block text-xs text-destructive" data-testid="public-form-address-problem">
                      {problem === 'taken'
                        ? tFormat('engine.studio.publicForms.addressTakenBy', locale, { form: taken.get(open.model.slug) ?? '' })
                        : problemText(problem)}
                    </span>
                  )}
                </label>
              </div>

              {/* Sections and their fields. */}
              <div className="space-y-3" data-testid="public-form-sections">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground">{t('engine.studio.publicForms.fields', locale)}</h3>
                  {editable && (
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => edit(withSection(open.model, t('engine.studio.publicForms.newSection', locale)))}
                      data-testid="public-form-add-section"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t('engine.studio.publicForms.addSection', locale)}
                    </button>
                  )}
                </div>
                {open.model.sections.map((section, si) => {
                  const offered = fields.filter((f) => !fieldsOnForm(open.model).includes(f.name));
                  return (
                    <div
                      key={section.key}
                      className="rounded-md border"
                      data-testid={`public-form-section-${section.key}`}
                      onDragOver={(e) => {
                        if (dragging) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragging) edit(withFieldMoved(open.model, dragging, section.key, section.fields.length));
                        setDragging(null);
                      }}
                    >
                      <div className="flex items-center gap-1 border-b px-2 py-1.5">
                        <input
                          className="h-7 flex-1 rounded border-none bg-transparent px-1 text-sm font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={section.label}
                          placeholder={t('engine.studio.publicForms.sectionUnnamed', locale)}
                          aria-label={t('engine.studio.publicForms.sectionName', locale)}
                          disabled={!editable}
                          onChange={(e) => edit(withSectionLabel(open.model, section.key, e.target.value))}
                          data-testid={`public-form-section-label-${section.key}`}
                        />
                        {editable && (
                          <>
                            <button type="button" className={smallBtn} disabled={si === 0} aria-label={t('engine.studio.publicForms.moveUp', locale)} onClick={() => edit(withSectionMoved(open.model, section.key, -1))}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={smallBtn}
                              disabled={si === open.model.sections.length - 1}
                              aria-label={t('engine.studio.publicForms.moveDown', locale)}
                              onClick={() => edit(withSectionMoved(open.model, section.key, 1))}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className={smallBtn}
                              disabled={open.model.sections.length < 2}
                              title={t('engine.studio.publicForms.removeSectionHint', locale)}
                              aria-label={t('engine.studio.publicForms.removeSection', locale)}
                              onClick={() => edit(withoutSection(open.model, section.key))}
                              data-testid={`public-form-remove-section-${section.key}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <ul className="divide-y">
                        {section.fields.map((entry, fi) => {
                          const locked = requiredByObject.has(entry.field);
                          return (
                            <li
                              key={entry.field}
                              draggable={editable}
                              onDragStart={() => setDragging(entry.field)}
                              onDragEnd={() => setDragging(null)}
                              onDragOver={(e) => {
                                if (dragging) e.preventDefault();
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (dragging && dragging !== entry.field) edit(withFieldMoved(open.model, dragging, section.key, fi));
                                setDragging(null);
                              }}
                              className={`flex items-center gap-2 px-2 py-1.5 text-sm ${dragging === entry.field ? 'opacity-50' : ''}`}
                              data-testid={`public-form-field-${entry.field}`}
                            >
                              {editable && <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden="true" />}
                              <span className="flex-1 truncate">{fieldLabel.get(entry.field) ?? entry.field}</span>
                              <label
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                                title={locked ? t('engine.studio.publicForms.requiredLockedHint', locale) : undefined}
                              >
                                <input
                                  type="checkbox"
                                  checked={entry.required || locked}
                                  disabled={!editable || locked}
                                  onChange={(e) => edit(withRequired(open.model, entry.field, e.target.checked, requiredByObject))}
                                  data-testid={`public-form-required-${entry.field}`}
                                />
                                {t('engine.studio.publicForms.required', locale)}
                              </label>
                              {editable && (
                                <>
                                  <button type="button" className={smallBtn} disabled={fi === 0} aria-label={t('engine.studio.publicForms.moveUp', locale)} onClick={() => edit(withFieldMoved(open.model, entry.field, section.key, fi - 1))}>
                                    <ArrowUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className={smallBtn}
                                    disabled={fi === section.fields.length - 1}
                                    aria-label={t('engine.studio.publicForms.moveDown', locale)}
                                    onClick={() => edit(withFieldMoved(open.model, entry.field, section.key, fi + 1))}
                                  >
                                    <ArrowDown className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    className={smallBtn}
                                    aria-label={t('engine.studio.publicForms.removeField', locale)}
                                    title={locked ? t('engine.studio.publicForms.requiredLockedHint', locale) : undefined}
                                    onClick={() => askRemoveField(entry.field)}
                                    data-testid={`public-form-remove-${entry.field}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </li>
                          );
                        })}
                        {section.fields.length === 0 && (
                          <li className="px-2 py-2 text-xs text-muted-foreground">{t('engine.studio.publicForms.sectionEmpty', locale)}</li>
                        )}
                      </ul>
                      {editable && offered.length > 0 && (
                        <div className="border-t px-2 py-1.5">
                          <select
                            className="h-7 rounded-md border border-input bg-background px-1 text-xs"
                            value=""
                            onChange={(e) => {
                              if (e.target.value) edit(withField(open.model, e.target.value, section.key, requiredByObject));
                            }}
                            aria-label={t('engine.studio.publicForms.addField', locale)}
                            data-testid={`public-form-add-field-${section.key}`}
                          >
                            <option value="">{t('engine.studio.publicForms.addField', locale)}</option>
                            {offered.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* After submit. */}
              <div className="grid gap-3">
                <h3 className="text-xs font-semibold text-muted-foreground">{t('engine.studio.publicForms.afterSubmit', locale)}</h3>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('engine.studio.publicForms.thankYouTitle', locale)}</span>
                  <input className={input} value={open.model.thankYouTitle} disabled={!editable} onChange={(e) => edit({ ...open.model, thankYouTitle: e.target.value })} data-testid="public-form-thank-you-title" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t('engine.studio.publicForms.thankYouMessage', locale)}</span>
                  <textarea
                    className={`${input} h-16 py-1`}
                    value={open.model.thankYouMessage}
                    disabled={!editable}
                    onChange={(e) => edit({ ...open.model, thankYouMessage: e.target.value })}
                    data-testid="public-form-thank-you-message"
                  />
                </label>
              </div>

              {canWrite && !isNew && (
                <div className="border-t pt-3">
                  {shippedByApp ? (
                    <p className="text-xs text-muted-foreground" data-testid="public-form-delete-shipped">
                      {t('engine.studio.publicForms.deleteShipped', locale)}
                    </p>
                  ) : confirmDelete ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="public-form-delete-confirm">
                      <span>{tFormat('engine.studio.publicForms.deleteConfirm', locale, { name: open.model.title || open.model.name })}</span>
                      <button
                        type="button"
                        className="inline-flex h-7 items-center rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                        onClick={() => void remove()}
                        disabled={busy !== null}
                        data-testid="public-form-delete-yes"
                      >
                        {t('engine.studio.publicForms.delete', locale)}
                      </button>
                      <button type="button" className={smallBtn} onClick={() => setConfirmDelete(false)}>
                        {t('engine.studio.publicForms.cancel', locale)}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={`${smallBtn} text-destructive`} onClick={() => setConfirmDelete(true)} data-testid="public-form-delete">
                      <Trash2 className="h-3.5 w-3.5" /> {t('engine.studio.publicForms.delete', locale)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Live preview: the runtime form, as the person filling it in sees it. */}
        {open && (
          <aside className="hidden w-[420px] shrink-0 flex-col overflow-auto border-l bg-sidebar p-4 lg:flex" data-testid="public-form-preview">
            <span className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('engine.studio.publicForms.preview', locale)}
            </span>
            <div className="rounded-lg border bg-background p-4 [&_button[type=submit]]:pointer-events-none">
              {open.model.title && <h2 className="mb-1 text-lg font-semibold" data-testid="public-form-preview-title">{open.model.title}</h2>}
              {open.model.description && <p className="mb-3 text-sm text-muted-foreground">{open.model.description}</p>}
              <SchemaRendererProvider dataSource={props.previewDataSource as never}>
                <ObjectForm
                  key={`${objectName}:public:${open.model.name}`}
                  schema={
                    {
                      type: 'object-form',
                      objectName,
                      mode: 'create',
                      sections: previewSectionsOf(open.model),
                    } as never
                  }
                  dataSource={props.previewDataSource as never}
                />
              </SchemaRendererProvider>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
