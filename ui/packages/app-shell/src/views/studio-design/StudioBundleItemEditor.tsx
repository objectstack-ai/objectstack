// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28569 (ADR-0146 Consequences, D1, D2) — the All metadata area's
 * simplified form editor for an email template and a translation.
 *
 * Setup edits both on the generic item page. Here the area opens them in this
 * editor instead (`metadataArea.ts#areaItemOpensFormEditor`): the fields the
 * Setup form offers, beside the type's preview. Both are the Setup pieces,
 * mounted, not copied: the form is `SchemaForm` over the schema the server
 * serves for the type, else `default-schemas.ts`'s entry (the generic page's
 * own resolution), and the preview is the one `previews/index.ts` registers
 * for the type (`EmailTemplatePreview`, `TranslationPreview`).
 *
 * ## Where an edit is written
 *
 *  - On a writable package: that package's draft, as the pillars save one
 *    (the shared autosave, the version pin of `useDraftSaveGuard`).
 *  - On a read-only base: nothing until Customize is pressed. The first saved
 *    edit asks the ensure door for the base's pair (`<base>.custom`) and
 *    writes the pair's draft, declaring `overrides: { package, basedOn }`
 *    (`overrideDraftBody`). Publish is the Studio header's, on the pair's
 *    drafts. "Restore package original" deletes the pair's draft and row.
 *    These are N-17's controls (`StudioCustomizeControls.tsx`), reused.
 *
 * ## One member at a time
 *
 * An email template is one item per `(name, locale)`: the editor opens the
 * member the list's row link names (`?member=`), reads, writes, declares and
 * restores that member alone, and keeps the locale out of the form, so an
 * edit never moves into another member. A translation is one locale bundle
 * whose override replaces the whole bundle (ADR-0146 D2), and the editor says
 * so before the first save.
 *
 * ## A dataset (objectstack#30064)
 *
 * On a read-only base the area opens a dataset here too
 * (`metadataArea.ts#AREA_CUSTOMIZE_EDITOR_TYPES`): the type's registered
 * designer (`DatasetDefaultInspector`) in place of the form, beside its
 * preview, customized as above, the whole dataset copied into the pair. A
 * dataset feeds every dashboard and report built on it, so the editor lists
 * what uses it, from the references read (`client.references`), before
 * anything is published; and a refusal the header's Publish kept for it is
 * shown here, at the item, as on its Pending changes entry.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@object-ui/components';
import { extractDraftBody, formatMetadataError } from '@object-ui/data-objectstack';
import { History, Link2, Lock, MoreHorizontal } from 'lucide-react';
import { SchemaForm } from '../metadata-admin/SchemaForm.js';
import { resolveResourceConfig } from '../metadata-admin/registry.js';
import { useRegisteredMetadataPreview } from '../metadata-admin/preview-registry.js';
import { useRegisteredMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry.js';
import { useReferencesScan, type ReferencesState } from '../item-tools/ReferencesPanel.js';
import { useMetadataClient, useMetadataTypes } from '../metadata-admin/useMetadata.js';
import { readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import { t, tFormat, translateMetadataType, useMetadataLocale } from '../metadata-admin/i18n.js';
import { emitMetadataRefresh } from '../../assistant/assistantBus.js';
import { plainRefusal, type StudioRefusal } from './metadataError.js';
import { StudioRefusalStrip } from './StudioRefusalStrip.js';
import { useDraftAutoSave, type DraftSend } from './useDraftAutoSave.js';
import {
  StudioCustomizeButton,
  StudioOverrideChip,
  StudioRestoreOriginalDialog,
  overrideDraftBody,
  useServedOverride,
  type CustomizeBlock,
} from './StudioCustomizeControls.js';
import type { StudioBaseCustomization } from './StudioDesignSurface.js';

/** The keys the form never offers: the identity, and the declaration Customize writes. */
function hiddenFieldsOf(type: string): string[] {
  // An email template's locale is its member: an edit of it would write another member.
  return type === 'email_template' ? ['name', 'locale', 'overrides'] : ['name', 'overrides'];
}

/** `doc` without its top-level `_` keys: the read's decorations are not the item's. */
function savedBody(doc: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!key.startsWith('_')) body[key] = value;
  }
  return body;
}

/** The referring items of a references read, one per item: a dashboard binding it twice is one dashboard. */
function referringItems(state: ReferencesState): Array<{ type: string; name: string; label: string }> {
  if (state.status !== 'loaded') return [];
  const seen = new Set<string>();
  const out: Array<{ type: string; name: string; label: string }> = [];
  for (const ref of state.items) {
    const key = `${ref.fromType}/${ref.fromName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: ref.fromType, name: ref.fromName, label: ref.fromLabel || ref.fromName });
  }
  return out;
}

/**
 * objectstack#30064 — what uses this item, read once by the references read
 * (`client.references`, the item tools' 引用关系): a dataset's dashboards and
 * reports, each opening in the area. A failed read says it failed and offers
 * the read again; it never reads as "nothing uses it".
 */
function StudioBundleUsedBy({
  type,
  name,
  packageId,
  basePath,
  locale,
}: {
  type: string;
  name: string;
  packageId: string;
  basePath: string;
  locale: string;
}): React.ReactElement {
  const navigate = useNavigate();
  const client = useMetadataClient();
  const { state, load } = useReferencesScan(client, type, name);
  const loadRef = React.useRef(load);
  React.useLayoutEffect(() => {
    loadRef.current = load;
  });
  React.useEffect(() => {
    void loadRef.current();
  }, []);
  const items = referringItems(state);
  return (
    <section
      data-testid="studio-bundle-editor-used-by"
      data-state={state.status}
      aria-label={t('engine.edit.references', locale)}
      className="border-b bg-amber-500/5 px-4 py-2 text-xs text-foreground"
    >
      {state.status === 'error' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="min-w-0 flex-1">
            {t('engine.studio.area.formEditor.usedByError', locale)}
          </p>
          <button
            type="button"
            data-testid="studio-bundle-editor-used-by-retry"
            onClick={() => void load()}
            className="inline-flex h-6 shrink-0 items-center rounded-md border bg-background px-2 text-[11px] font-medium hover:bg-muted"
          >
            {t('engine.edit.refsRetry', locale)}
          </button>
        </div>
      ) : state.status !== 'loaded' ? (
        <p role="status" className="text-muted-foreground">
          {t('engine.edit.refsScanning', locale)}
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">{t('engine.studio.area.formEditor.usedByNone', locale)}</p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 font-medium">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            {tFormat(
              items.length === 1 ? 'engine.studio.area.formEditor.usedByOne' : 'engine.studio.area.formEditor.usedByOther',
              locale,
              { count: items.length },
            )}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {items.map((item) => (
              <li key={`${item.type}/${item.name}`}>
                <button
                  type="button"
                  data-testid="studio-bundle-editor-used-by-item"
                  data-type={item.type}
                  data-name={item.name}
                  title={item.name}
                  onClick={() =>
                    navigate(
                      `${basePath}/${encodeURIComponent(item.type)}/${encodeURIComponent(item.name)}?${new URLSearchParams({ package: packageId })}`,
                    )
                  }
                  className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border bg-background px-2 hover:bg-muted"
                >
                  <span className="truncate">{item.label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{translateMetadataType(item.type, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export interface StudioBundleItemEditorProps {
  /** The package the area is open on. */
  packageId: string;
  /** `email_template` or `translation` (`AREA_FORM_EDITOR_TYPES`), or a read-only package's `dataset`. */
  type: string;
  name: string;
  /** The bundle member the URL names (`?member=`); absent for the canonical one and for a translation. */
  member?: string;
  /** The package is not writable (the area's gate). */
  readOnly: boolean;
  /** On a read-only base, what the Studio surface customizes it with; `null` otherwise. */
  customization?: StudioBaseCustomization | null;
  /** Bumped by the header's Publish: the buffer re-reads what is served. */
  publishNonce?: number;
  /** Told when a draft save lands, so the header's pending count follows it. */
  onDraftSaved?: (saved?: { type: string; name: string }) => void;
  /** The area's root (`MetadataAreaHost.basePath`), for the item's history link. */
  basePath: string;
  /** objectstack#30064 — what the header's last Publish refused for this item, kept until it is resolved. */
  publishRefusal?: StudioRefusal | null;
}

export function StudioBundleItemEditor({
  packageId,
  type,
  name,
  member,
  readOnly,
  customization = null,
  publishNonce = 0,
  onDraftSaved,
  basePath,
  publishRefusal = null,
}: StudioBundleItemEditorProps): React.ReactElement {
  const locale = useMetadataLocale();
  const navigate = useNavigate();
  const client = useMetadataClient();
  const { entries } = useMetadataTypes(client);
  const entry = entries.find((e) => e.type === type);
  const config = resolveResourceConfig(type, entry);
  // The generic page's resolution: the served schema first, the fallback second.
  const schema =
    (entry?.schema as Record<string, unknown> | undefined) ??
    (config.defaultSchema as Record<string, unknown> | undefined);
  const Preview = useRegisteredMetadataPreview(type);
  // objectstack#30064 — a type with a designer of its own (a dataset) is edited in it, not in the form.
  const Designer = useRegisteredMetadataDefaultInspector(type);
  // What the designer reports as blocking (a dimension with no field): held, never sent.
  const [blocking, setBlocking] = React.useState(0);
  const memberScope = React.useMemo(() => (member ? { member } : {}), [member]);
  const target = JSON.stringify([packageId, type, name, member ?? '']);

  // The customization as last handed down, read by the load and the saves, so
  // the pair the ensure door answers mid-edit never reloads the buffer.
  const customizationRef = React.useRef(customization);
  React.useLayoutEffect(() => {
    customizationRef.current = customization;
  });
  const customizationKnown = customization !== null;

  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [loadedFor, setLoadedFor] = React.useState('');
  const [hasDraft, setHasDraft] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  const [error, setError] = React.useState<StudioRefusal | null>(null);
  const [loadError, setLoadError] = React.useState<StudioRefusal | null>(null);
  // The server's refusal of this item's draft read (`403`): a pending draft is
  // there that this author may not read, so no buffer is installed over it.
  // Held as thrown and worded at render, so a language switch rewords it
  // without a reload.
  const [draftRefused, setDraftRefused] = React.useState<{ error: unknown } | null>(null);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const reload = React.useCallback(() => setReloadNonce((n) => n + 1), []);
  const guard = useDraftSaveGuard(client, reload);
  // Stable for the editor's life: the guard's own members.
  const { recordRead, forget } = guard;
  // The package the buffer's draft read was asked at: the address its pin describes.
  const readAtRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setDraftRefused(null);
    (async () => {
      const custom = readOnly ? customizationRef.current : null;
      // A read-only base's draft lives in its pair, when one is listed.
      const readAt = readOnly ? (custom?.pairId ?? null) : packageId;
      const draftRead = readAt
        ? await readDraftForSave<Record<string, unknown>>(client, type, name, readAt, member)
        : { answer: null, pin: null };
      if (cancelled) return;
      // objectstack#29148 — a pending draft the server refused to read is no
      // absence: a buffer seeded from the published layer would be saved over
      // it, dropping its keys and its audience gate. Nothing is installed, so
      // nothing is shown to edit and the autosave has nothing to send.
      if ('refused' in draftRead) {
        setDraft({});
        setLoadedFor('');
        setHasDraft(true);
        setDirty(false);
        forget();
        setDraftRefused({ error: draftRead.refused });
        return;
      }
      const body = extractDraftBody(draftRead.answer) as Record<string, unknown> | null;
      // The served document only when there is no pending draft: a spread
      // over it would bring back every key the draft deleted.
      const lay = body
        ? null
        : await client.layered<Record<string, unknown>>(type, name, { packageId, ...memberScope });
      if (cancelled) return;
      const baseline = (lay?.effective ?? lay?.code ?? {}) as Record<string, unknown>;
      setDraft(body ?? baseline);
      setLoadedFor(target);
      setHasDraft(!!body);
      setDirty(false);
      if (readAt) recordRead(type, name, readAt, draftRead.pin);
      else forget();
      readAtRef.current = readAt;
    })().catch((e: unknown) => {
      if (!cancelled) setLoadError(plainRefusal(e));
    });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    type,
    name,
    member,
    memberScope,
    packageId,
    readOnly,
    target,
    customizationKnown,
    publishNonce,
    reloadNonce,
    recordRead,
    forget,
  ]);

  // Customize (N-17): the served declaration, the button's block and its press.
  const [servedNonce, setServedNonce] = React.useState(0);
  const base = customization?.base ?? null;
  const served = useServedOverride(
    client,
    customization ? { type, name, ...memberScope } : null,
    base,
    customization?.pairId ?? null,
    `${publishNonce}:${servedNonce}`,
  );
  const inPair = served.declaration !== null;
  const inPairRef = React.useRef(inPair);
  React.useLayoutEffect(() => {
    inPairRef.current = inPair;
  });
  const [asked, setAsked] = React.useState(false);
  const block: CustomizeBlock = customization?.walled
    ? 'walled'
    : customization && !inPair && customization.basedOn === null
      ? 'noVersion'
      : null;
  const unlocked = !!customization && !customization.walled && (inPair || (block === null && asked));
  const editable = loadedFor === target && !loadError && !draftRefused && (readOnly ? unlocked : true);

  // The ensure door, asked once for this item's first saved edit, and again only after a refusal.
  const pairRef = React.useRef<Promise<string> | null>(null);
  const pairFor = React.useCallback((custom: StudioBaseCustomization): Promise<string> => {
    if (pairRef.current) return pairRef.current;
    const asking = custom.ensure();
    pairRef.current = asking;
    asking.catch(() => {
      if (pairRef.current === asking) pairRef.current = null;
    });
    return asking;
  }, []);

  const doSave = React.useCallback(
    async (sent: DraftSend) => {
      setSaving(true);
      setError(null);
      try {
        let at = packageId;
        let body = savedBody(draft);
        let entering = false;
        if (readOnly) {
          const custom = customizationRef.current;
          if (!custom) return;
          let pair: string;
          try {
            pair = await pairFor(custom);
          } catch (e) {
            setError(plainRefusal(e));
            return;
          }
          const declared = overrideDraftBody(draft, custom.base, custom.basedOn);
          if (declared === null) {
            setError({ message: tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }) });
            return;
          }
          // Read at another package (the base, before its pair was listed):
          // the pair is taken to hold no draft of this member, so one there is
          // a conflict the author is asked about, never overwritten.
          if (readAtRef.current !== pair) {
            recordRead(type, name, pair, { ifNoneMatch: '*' });
            readAtRef.current = pair;
          }
          entering = !inPairRef.current;
          at = pair;
          body = declared;
        }
        const outcome = await guard.save(type, name, body, { mode: 'draft', packageId: at, surface: 'studio' });
        if (outcome === 'reloaded') return;
        // The badge reads the declaration the server now serves.
        if (entering) setServedNonce((n) => n + 1);
        setHasDraft(true);
        if (sent.unmoved()) setDirty(false);
        onDraftSaved?.({ type, name });
      } catch (e) {
        setError(plainRefusal(e));
      } finally {
        setSaving(false);
      }
    },
    [draft, guard, locale, name, onDraftSaved, packageId, pairFor, readOnly, recordRead, type],
  );
  useDraftAutoSave({
    target,
    loadedFor,
    dirty,
    blocked: !editable || restoring || blocking > 0,
    snapshot: draft,
    save: doSave,
  });

  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const label = (typeof draft.label === 'string' && draft.label) || name;
  const restoreOriginal = React.useCallback(async () => {
    const custom = customizationRef.current;
    if (!custom) return;
    const held = pairRef.current ? await pairRef.current.catch(() => null) : null;
    const pair = held ?? custom.pairId;
    if (!pair) return;
    setRestoring(true);
    setError(null);
    try {
      await client.reset(type, name, { state: 'draft', packageId: pair, ...memberScope });
      await client.reset(type, name, { packageId: pair, ...memberScope });
      pairRef.current = null;
      setAsked(false);
      setDirty(false);
      setServedNonce((n) => n + 1);
      reload();
      emitMetadataRefresh();
      toast.success(tFormat('engine.studio.customize.restoreDone', locale, { item: label, package: custom.baseLabel }));
    } catch (e) {
      setError(plainRefusal(e));
    } finally {
      setRestoring(false);
    }
  }, [client, label, locale, memberScope, name, reload, type]);

  const onChange = React.useCallback((next: Record<string, unknown>) => {
    setDraft(next);
    setDirty(true);
  }, []);
  // The designer's shallow patch, as the generic item page applies it.
  const onPatch = React.useCallback((patch: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const baseLabel = customization?.baseLabel ?? packageId;
  // The member the URL names, else the one the canonical read served.
  const shownLocale = member ?? (typeof draft.locale === 'string' ? draft.locale : '');
  const customizing = readOnly && customization !== null;
  // objectstack#29148 — a refused draft read is the load's answer: the
  // draftUnreadable sentence, with the server's own behind Details.
  const shownError: StudioRefusal | null = draftRefused
    ? { message: t('engine.studio.refusal.draftUnreadable', locale), detail: formatMetadataError(draftRefused.error) }
    : (loadError ?? error);
  const status = saving
    ? t('engine.studio.autoSaving', locale)
    : hasDraft
      ? t('engine.studio.unpublishedDraft', locale)
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-bundle-editor" data-type={type}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{translateMetadataType(type, locale)}</p>
          <h2 className="truncate text-sm font-semibold" title={name}>
            {label}
          </h2>
        </div>
        {type === 'email_template' && shownLocale && (
          <span
            data-testid="studio-bundle-editor-locale"
            className="inline-flex h-[22px] shrink-0 items-center rounded-[5px] bg-muted px-2 font-mono text-[11px] text-muted-foreground"
          >
            {tFormat('engine.studio.area.formEditor.locale', locale, { locale: shownLocale })}
          </span>
        )}
        {customizing && served.declaration && (
          <StudioOverrideChip
            baseLabel={baseLabel}
            basedOn={served.declaration.basedOn}
            locale={locale}
            // objectstack#29692 — Restore lives on the mark that names the customization.
            onRestore={inPair ? () => setRestoreOpen(true) : undefined}
            restoreDisabled={restoring || saving || (customization?.pairId == null && pairRef.current === null)}
          />
        )}
        {status && (
          <span data-testid="studio-bundle-editor-status" className="shrink-0 text-xs text-muted-foreground">
            {status}
          </span>
        )}
        {customizing && !unlocked && (
          <StudioCustomizeButton block={block} baseLabel={baseLabel} locale={locale} onCustomize={() => setAsked(true)} />
        )}
        {readOnly && !customizing && (
          <span
            data-testid="studio-bundle-editor-readonly"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-amber-400/15 px-2.5 text-xs font-medium text-amber-700 dark:text-amber-300"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('engine.studio.pkg.readonly', locale)}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="studio-bundle-editor-more"
              aria-label={t('engine.studio.if.more', locale)}
              title={t('engine.studio.if.more', locale)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              data-testid="studio-bundle-editor-history"
              onSelect={() => {
                const qs = new URLSearchParams({ package: packageId });
                if (member) qs.set('member', member);
                navigate(`${basePath}/${encodeURIComponent(type)}/${encodeURIComponent(name)}/history?${qs}`);
              }}
            >
              <History className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
              {t('engine.edit.history', locale)}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {customizing && !inPair && type === 'translation' && (
        <p role="note" data-testid="studio-bundle-editor-whole-bundle" className="border-b bg-sky-500/5 px-4 py-2 text-xs text-foreground">
          {tFormat('engine.studio.area.formEditor.translationWhole', locale, {
            package: baseLabel,
            locale: shownLocale || name,
          })}
        </p>
      )}
      {customizing && !inPair && type === 'email_template' && (
        <p role="note" data-testid="studio-bundle-editor-one-locale" className="border-b bg-sky-500/5 px-4 py-2 text-xs text-foreground">
          {tFormat('engine.studio.area.formEditor.oneLocale', locale, {
            package: baseLabel,
            locale: shownLocale,
          })}
        </p>
      )}
      {customizing && !inPair && type === 'dataset' && (
        <p role="note" data-testid="studio-bundle-editor-whole-dataset" className="border-b bg-sky-500/5 px-4 py-2 text-xs text-foreground">
          {tFormat('engine.studio.area.formEditor.datasetWhole', locale, { package: baseLabel })}
        </p>
      )}
      {customizing && type === 'dataset' && (
        <StudioBundleUsedBy type={type} name={name} packageId={packageId} basePath={basePath} locale={locale} />
      )}
      {customizing && unlocked && (
        <p className="border-b px-4 py-1.5 text-[11px] text-muted-foreground">{t('engine.studio.customize.draftFooter', locale)}</p>
      )}
      {publishRefusal && (
        <div data-testid="studio-bundle-editor-publish-refusal" className="border-b px-4 py-2">
          <StudioRefusalStrip refusal={publishRefusal} locale={locale} className="px-2 py-1.5 text-xs" />
        </div>
      )}
      {shownError && (
        <div data-testid="studio-bundle-editor-error" className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <p role="alert" className="whitespace-pre-line">
            {shownError.message}
          </p>
          {shownError.detail && (
            <details data-testid="studio-bundle-editor-error-detail" className="mt-1">
              <summary className="cursor-pointer select-none opacity-80">{t('engine.studio.refusal.details', locale)}</summary>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono opacity-90">{shownError.detail}</pre>
            </details>
          )}
        </div>
      )}

      {draftRefused ? null : loadedFor !== target && !loadError ? (
        <div role="status" className="p-6 text-sm text-muted-foreground">
          {t('engine.studio.loading', locale)}
        </div>
      ) : (
        <div
          className={cn(
            'grid min-h-0 flex-1 overflow-auto',
            Preview && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:overflow-hidden',
          )}
        >
          <div className="min-w-0 p-4 lg:overflow-auto" data-testid="studio-bundle-editor-form">
            {Designer ? (
              // eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataDefaultInspector returns a registered component (stable), not one created during render
              <Designer
                type={type}
                name={name}
                draft={draft}
                onPatch={onPatch}
                onBlockingIssuesChange={setBlocking}
                readOnly={!editable}
                locale={locale}
                serverSchema={entry?.schema as Record<string, unknown> | undefined}
              />
            ) : (
              <SchemaForm
                schema={schema}
                form={entry?.form}
                value={draft}
                onChange={onChange}
                hiddenFields={hiddenFieldsOf(type)}
                fieldOrder={config.fieldOrder}
                readOnly={!editable}
              />
            )}
          </div>
          {Preview && (
            <div className="min-w-0 border-t lg:overflow-auto lg:border-l lg:border-t-0" data-testid="studio-bundle-editor-preview">
              {/* eslint-disable-next-line react-hooks/static-components -- useRegisteredMetadataPreview returns a registered component (stable), not one created during render */}
              <Preview type={type} name={name} draft={draft} locale={locale} editing={editable} />
            </div>
          )}
        </div>
      )}

      {guard.dialog}
      {customizing && (
        <StudioRestoreOriginalDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          label={label}
          baseLabel={baseLabel}
          hasDraft={hasDraft}
          locale={locale}
          onConfirm={() => void restoreOriginal()}
        />
      )}
    </div>
  );
}
