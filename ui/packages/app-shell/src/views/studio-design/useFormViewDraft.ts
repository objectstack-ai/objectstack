// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30057 — the form view the Studio Data pillar's Form tab edits.
 *
 * ## Which form view
 *
 * The one the app opens, asked of the app's own resolver: the create and edit
 * dialogs render `selectRecordFormView(objectDef, flow)` (`recordFormNavigation`)
 * over the shell's merged objects (`useMetadata().objects`, the published
 * world the app reads). {@link formLayoutChoiceOf} calls it, ⛔ never a second
 * reading of its rule. No form view: the Form tab edits the object's
 * `fieldGroups`, which is what the dialogs lay out then. Create and edit can
 * open different form views (a `OBJECT.create` view beside the default one);
 * then the author picks which one the tab shows.
 *
 * ## Where it is read and written
 *
 * The view item, by the id the merge stamps on it (`OBJECT.KEY`), through the
 * metadata draft door like every other Studio buffer: read at the address the
 * save writes (`readDraftForSave`), else its published layer; saved as a draft
 * under its own version guard (objectui#11773), debounced by the pillar's
 * autosave. The package publish publishes it with the package's other drafts.
 *
 * On a read-only base (ADR-0146 D2) the view is customized, not edited: read
 * in the base's pair when one is listed, and saved into the pair the ensure
 * door answers as a declared override of the base's view (`overrideDraftBody`),
 * the same door the Interfaces pillar's list views go through
 * (`ListViewCustomization`). A refused door saves nothing and is shown.
 */

import * as React from 'react';
import { extractDraftBody, type MetadataClient } from '@object-ui/data-objectstack';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { readDraftForSave, useDraftSaveGuard } from '../metadata-admin/DraftConflictDialog.js';
import { t, tFormat } from '../metadata-admin/i18n.js';
import {
  selectRecordFormView,
  type FormViewDefinition,
  type ObjectDefinitionForFormView,
  type RecordFormFlow,
} from '../../utils/recordFormNavigation.js';
import { overrideDraftBody } from './StudioCustomizeControls.js';
import type { StudioBaseCustomization } from './StudioPillarKit.js';
import { formViewSectionsOf, withFormViewSections } from './formViewSections.js';
import type { DraftSend } from './useDraftAutoSave.js';
import { readAuthoredDraft } from './authoredDraft.js';

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

/** What the Form tab lays out, for one flow. */
export interface FormLayoutChoice {
  /** The flow the shown layout is opened by. */
  flow: RecordFormFlow;
  /** The form view the app opens for it; `null`: none, and the layout is the object's field groups. */
  view: FormViewDefinition | null;
  /** That view's item id (`OBJECT.KEY`); `''` with no view, or a view served under no id. */
  viewId: string;
  /** Create and edit open different layouts, so the author picks which one is shown. */
  flowsDiffer: boolean;
}

/**
 * The layout the app opens for `flow` on `objectDef` (the shell's merged
 * object): `selectRecordFormView`'s answer, and whether create and edit get
 * different answers.
 */
export function formLayoutChoiceOf(
  objectDef: ObjectDefinitionForFormView | null | undefined,
  flow: RecordFormFlow,
): FormLayoutChoice {
  const view = selectRecordFormView(objectDef, flow) ?? null;
  const create = selectRecordFormView(objectDef, 'create');
  const edit = selectRecordFormView(objectDef, 'edit');
  const idOf = (v: FormViewDefinition | undefined | null) => (v && typeof v.name === 'string' ? v.name : '');
  const flowsDiffer = (create ?? null) !== (edit ?? null) && idOf(create) !== idOf(edit);
  return { flow, view, viewId: idOf(view), flowsDiffer };
}

export interface FormViewDraft {
  /** The view the buffer is for; `''` with none. */
  viewId: string;
  /** The autosave's `target` / `loadedFor` (`form-view:ID`): a local buffer tag, never an adapter cache key (the `view:` cache-key spelling is guarded by `viewCacheInvalidation.guard`). */
  targetKey: string;
  loadedFor: string;
  /** The view item as the server holds it (draft, else published), with edits; `null` until loaded. */
  row: Row | null;
  /** The view's sections in the buffer; `null` until loaded. */
  sections: Row[] | null;
  dirty: boolean;
  hasDraft: boolean;
  saving: boolean;
  /** The last load's or save's failure; `draftUnreadable`: the server refused to read its pending draft. */
  failure: { during: 'load' | 'save' | 'draftUnreadable'; error: unknown } | null;
  /** Replace the buffer's sections with the ones an edit left. */
  setSections: (sections: Row[]) => void;
  /** Send the buffer to the draft door — the autosave's `save`. */
  save: (sent: DraftSend) => Promise<void>;
  /** The version-conflict dialog of this buffer's guard; render it once. */
  conflictDialog: React.ReactElement;
}

/**
 * The open object's form view buffer. `viewId: ''` holds nothing.
 * `customization`: the view is a read-only base's, customized in its pair.
 */
export function useFormViewDraft({
  client,
  packageId,
  viewId,
  publishNonce,
  customization = null,
  onDraftSaved,
  locale,
}: {
  client: MetadataClient;
  packageId: string;
  viewId: string;
  /** Bumped by a publish: the draft is gone, and the view is re-read. */
  publishNonce: number;
  customization?: StudioBaseCustomization | null;
  onDraftSaved?: () => void;
  locale: string;
}): FormViewDraft {
  const targetKey = viewId ? `form-view:${viewId}` : '';
  const [buffer, setBuffer] = React.useState<{ for: string; row: Row | null; dirty: boolean; hasDraft: boolean }>({
    for: '',
    row: null,
    dirty: false,
    hasDraft: false,
  });
  const [failure, setFailure] = React.useState<FormViewDraft['failure']>(null);
  const [saving, setSaving] = React.useState(false);
  const [reloadNonce, setReloadNonce] = React.useState(0);
  const reload = React.useCallback(() => setReloadNonce((n) => n + 1), []);
  // objectui#11773 — one guard per editing buffer; a conflict's "reload" re-runs the load.
  const { save: guardedSave, recordRead, dialog: conflictDialog } = useDraftSaveGuard(client, reload);
  // Read when a load or a save runs; only its presence keys a load.
  const customizationRef = React.useRef(customization);
  React.useLayoutEffect(() => {
    customizationRef.current = customization;
  });
  const customizing = customization !== null;
  // Read when a load words a failure; a language switch does not re-run the load.
  const localeRef = React.useRef(locale);
  React.useLayoutEffect(() => {
    localeRef.current = locale;
  });
  // The package the installed buffer's draft read was asked at: the address its pin describes.
  const readAtRef = React.useRef<{ viewId: string; at: string } | null>(null);

  React.useEffect(() => {
    setFailure(null);
    if (!viewId) {
      setBuffer({ for: '', row: null, dirty: false, hasDraft: false });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Read at the address the save writes: on a read-only base, its pair once listed.
        const readAt = customizationRef.current?.pairId ?? packageId;
        const draftRead = await readDraftForSave<Row>(client, 'view', viewId, readAt);
        if (cancelled) return;
        // objectstack#29148 — a pending draft the server refused to read is no
        // absence: no buffer is installed over it, so nothing is saved over it.
        if ('refused' in draftRead) {
          readAtRef.current = null;
          setBuffer({ for: '', row: null, dirty: false, hasDraft: true });
          setFailure({ during: 'draftUnreadable', error: draftRead.refused });
          return;
        }
        // objectstack#30859 — a pending draft is edited as stored, read at the
        // draft read's address: the served body is translated for this locale.
        const served = extractDraftBody(draftRead.answer);
        const authored = served ? await readAuthoredDraft(client, 'view', viewId, served, { packageId: readAt }) : null;
        if (cancelled) return;
        if (authored?.kind === 'unserved') {
          readAtRef.current = null;
          setBuffer({ for: '', row: null, dirty: false, hasDraft: true });
          setFailure({ during: 'draftUnreadable', error: new Error(t('engine.studio.refusal.draftUnreadable', localeRef.current)) });
          return;
        }
        const draft = authored ? (authored.body as Row) : null;
        // ADR-0048 — the published layer is read at the rail's package; on a
        // read-only base that is the base, whose read serves its declared
        // override (ADR-0146 D8).
        const lay = draft ? null : await client.layered<Row>('view', viewId, { packageId });
        if (cancelled) return;
        const published = (lay as { effective?: unknown; code?: unknown } | null)?.effective ?? (lay as { code?: unknown } | null)?.code;
        const row = draft ?? (isRow(published) ? (stripReadDecorations(published) as Row) : null);
        recordRead('view', viewId, readAt, draftRead.pin);
        readAtRef.current = { viewId, at: readAt };
        setBuffer({ for: `form-view:${viewId}`, row, dirty: false, hasDraft: !!draft });
      } catch (e) {
        if (!cancelled) setFailure({ during: 'load', error: e });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, viewId, packageId, publishNonce, reloadNonce, recordRead, customizing]);

  const loaded = buffer.for === targetKey && targetKey !== '';
  const row = loaded ? buffer.row : null;
  const sections = React.useMemo(() => (row ? formViewSectionsOf(row) : null), [row]);
  const setSections = React.useCallback(
    (next: Row[]) => {
      setBuffer((b) => (b.for === targetKey && b.row ? { ...b, row: withFormViewSections(b.row, next), dirty: true } : b));
    },
    [targetKey],
  );

  const save = React.useCallback(
    async (sent: DraftSend) => {
      if (!viewId || !row) return;
      setSaving(true);
      try {
        // ADR-0146 D2 — a read-only base's view is written into the pair the
        // ensure door answers, declaring the override; a refused door saves nothing.
        const custom = customizationRef.current;
        let target = { packageId, body: row };
        if (custom) {
          const pair = await custom.ensure();
          const body = overrideDraftBody(row, custom.base, custom.basedOn);
          if (body === null) {
            throw new Error(tFormat('engine.studio.customize.noVersion', locale, { package: custom.baseLabel }));
          }
          target = { packageId: pair, body };
          // Read at another package (the base, before its pair was listed):
          // the pair is taken to hold no draft of the view, so one there is a
          // conflict the author is asked about, never one this save overwrites.
          const readAt = readAtRef.current;
          if (!(readAt?.viewId === viewId && readAt.at === pair)) {
            recordRead('view', viewId, pair, { ifNoneMatch: '*' });
            readAtRef.current = { viewId, at: pair };
          }
        }
        const outcome = await guardedSave('view', viewId, target.body, {
          mode: 'draft',
          packageId: target.packageId,
          surface: 'studio',
        });
        if (outcome === 'reloaded') return;
        // objectui#11204 — clean only if nothing was edited while it was in flight.
        const clean = sent.unmoved();
        setBuffer((b) => (b.for === `form-view:${viewId}` ? { ...b, hasDraft: true, dirty: clean ? false : b.dirty } : b));
        setFailure(null);
        onDraftSaved?.();
      } catch (e) {
        setFailure({ during: 'save', error: e });
      } finally {
        setSaving(false);
      }
    },
    [guardedSave, recordRead, viewId, row, packageId, onDraftSaved, locale],
  );

  return {
    viewId,
    targetKey,
    loadedFor: loaded ? targetKey : '',
    row,
    sections,
    dirty: loaded && buffer.dirty,
    hasDraft: loaded && buffer.hasDraft,
    saving,
    failure,
    setSections,
    save,
    conflictDialog,
  };
}
