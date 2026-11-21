/**
 * ViewConfigPanel — the runtime ObjectView's right-rail "view editor".
 *
 * MIGRATED: this panel now hosts the studio's spec-driven
 * {@link ViewVariantInspector} instead of the legacy `buildViewConfigSchema`
 * engine, so the runtime and the metadata studio share ONE inspector. The
 * inspector renders the per-view-type config fields straight from
 * `@objectstack/spec` (grid / kanban / calendar / gallery / …) plus the
 * shared column / filter / sort / toolbar sections.
 *
 * The runtime ObjectView keeps the active view as a FLAT NamedListView; the
 * inspector authors a canonical ViewItem draft. {@link view-config-adapter}
 * bridges the two shapes so the `sys_view` persistence path is untouched:
 * edits live as a ViewItem draft while the panel is open, then flatten back
 * to the runtime view shape on update / save / create.
 *
 * Field loading is network-free: `objectDef.fields` is mapped into the
 * inspector's `objectFieldsOverride` so neither the inspector nor its
 * column editor issue a `client.get('object', …)` request.
 *
 * objectstack#35054 (route D) — an edit of a stored view edits the view as its
 * author STORED it, never the view as it is served. `activeView` comes from the
 * served view list, which the server translates for the console's
 * Accept-Language (a view's `label`, a form's section titles), and the save
 * door stores a view body verbatim, so a Save seeded from it stored the
 * translations as the view's source text. With a metadata client the buffer is
 * the layered read's authored document (`authoredBuffer`, the reading the
 * Studio editors share): the stored pending draft, else the published view.
 * The served draft read only says whether a draft is pending; a pending draft
 * whose stored copy the layers do not serve opens no editor. ⛔ Never seed from
 * the served copy instead. The draft bar no longer resumes its (served,
 * translated) draft into the inspector: the host seeds the stored one.
 */

import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { ViewVariantInspector } from './metadata-admin/inspectors/ViewVariantInspector.js';
import { RuntimeDraftBar } from './RuntimeDraftBar.js';
import { isFormFamilyKey } from './metadata-admin/view-variant-model.js';
import { useMetadataLocale, t as tStudio, tFormat } from './metadata-admin/i18n.js';
import { authoredBuffer, formatMetadataError, type AuthoredLayers } from '@object-ui/data-objectstack';
import { readRuntimeDraft } from './runtime-metadata-persistence.js';
import { isSameOptionsValue } from './objectViewOptions.js';
import type { ObjectFieldInfo } from './metadata-admin/previews/useObjectFields.js';
import {
    runtimeViewToInspectorDraft,
    inspectorDraftToRuntimeView,
    storedViewToRuntimeView,
    type InspectorViewDraft,
    type RuntimeView,
} from './view-config-adapter.js';

/** Editor panel types that can be opened from clickable rows */
export type EditorPanelType = 'columns' | 'filter' | 'sort';

export interface ViewConfigPanelProps {
    /** Whether the panel is open */
    open: boolean;
    /** Close callback */
    onClose: () => void;
    /** Panel mode: "edit" for existing views, "create" for new views */
    mode?: 'create' | 'edit';
    /** The active view definition */
    activeView: {
        id: string;
        label?: string;
        type?: string;
        columns?: string[];
        filter?: any[];
        sort?: any[];
        description?: string;
        [key: string]: any;
    };
    /** The object definition */
    objectDef: {
        name: string;
        label?: string;
        description?: string;
        fields?: Record<string, any>;
        [key: string]: any;
    };
    /** Optional record count to display */
    recordCount?: number;
    /** Called when any view config field changes (local draft update) */
    onViewUpdate?: (field: string, value: any) => void;
    /**
     * Called to persist all draft changes. Any return is accepted, as with the
     * `void` this prop was typed with before objectui#11583; the panel awaits
     * it and reads ONE refusal signal: `false` (returned, or resolved by a
     * promise) or a rejection leaves the panel dirty, with no draft
     * announced, so the edit can be saved again. Anything else, nothing
     * included, is read as saved: the dirty state clears and the draft
     * indicator is raised.
     *
     * Typed `unknown`, not a union naming the signal: against a union
     * TypeScript checks the host's return type, and refuses hosts the `void`
     * prop admitted (an `async` host that returns nothing, one resolving to a
     * record, a sync non-void return). The contract review of objectui#11583
     * measured that; `ViewConfigPanel.onSaveHosts-11583.test.ts` pins it.
     */
    onSave?: (draft: Record<string, any>) => unknown;
    /** Called when create-mode view is created */
    onCreate?: (config: Record<string, any>) => void;
    /**
     * Studio metadata client — drives saves and the ADR-0034 draft/publish
     * chrome ({@link RuntimeDraftBar}).
     */
    metadataClient?: any;
    /**
     * The DataSource whose view caches a publish / discard from this panel
     * stales (objectui#4373). Forwarded to {@link RuntimeDraftBar}; the object
     * half of the cache keys comes from `objectDef.name`, so nothing here has
     * to know what those keys are.
     */
    dataSource?: any;
    /** Called after a publish / discard so the host can refresh its read. */
    onAfterChange?: () => void;
    /**
     * objectstack#35974 — the view is one the server refuses to save (a view
     * a read-only package ships): the panel shows its configuration with
     * every control disabled, relays no edit to the host, and offers no Save
     * and no draft publish or discard, only Close.
     */
    readOnly?: boolean;
}

/**
 * objectstack#35054 — the authored view an edit-mode panel edits, read for one
 * view id: still being read, read (the runtime shape of the stored body), or
 * refused with the sentence the panel shows in place of the inspector.
 */
type AuthoredSeed =
    | { for: string; state: 'loading' }
    | { for: string; state: 'ready'; view: RuntimeView }
    | { for: string; state: 'refused'; message: string };

/**
 * Map an Object definition's `fields` record into the inspector's flat field
 * catalog so it can render field-reference pickers (columns, groupByField, …)
 * without a network fetch.
 *
 * @internal exported for tests
 */
export function mapObjectFields(objectDef: ViewConfigPanelProps['objectDef']): ObjectFieldInfo[] {
    const fields = objectDef.fields;
    if (!fields || typeof fields !== 'object') return [];
    return Object.entries(fields).map(([name, def]) => {
        const f = (def ?? {}) as Record<string, any>;
        return {
            name,
            label: typeof f.label === 'string' && f.label ? f.label : name,
            type: typeof f.type === 'string' ? f.type : 'text',
            hidden: f.hidden === true,
            // The filter builder offers a list-valued column membership and
            // the empty checks only (`operatorsForField`).
            ...(f.multiple === true ? { multiple: true } : {}),
        };
    });
}

export function ViewConfigPanel({ open, onClose, mode = 'edit', activeView, objectDef, onViewUpdate, onSave, onCreate, metadataClient, dataSource, onAfterChange, readOnly = false }: ViewConfigPanelProps) {
    const { t } = useObjectTranslation();
    const panelRef = useRef<HTMLDivElement>(null);
    const locale = useMetadataLocale();

    // Provisional id for a create-mode view. A lazy useState initializer runs
    // exactly once, keeping the impure `Date.now()` out of render; the backend
    // assigns the real `name` on create, so this only needs to be unique
    // within the draft.
    const [newViewId] = useState(() => `view_${Date.now()}`);

    // Default empty view used to seed create mode.
    const defaultNewView = useMemo<RuntimeView>(() => ({
        id: newViewId,
        label: t('console.objectView.newView'),
        type: 'grid',
        columns: [],
        filter: [],
        sort: [],
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    // objectstack#35054 — an edit with a metadata client edits the stored
    // view (module header). Read on every open, and again after a publish or a
    // discard from the draft bar, which change what is stored.
    const readsAuthored = mode === 'edit' && !!metadataClient && !!activeView.id;
    const [seed, setSeed] = useState<AuthoredSeed | null>(null);
    const [authoredReads, setAuthoredReads] = useState(0);
    useEffect(() => {
        if (!open || !readsAuthored) return;
        const id = activeView.id;
        let cancelled = false;
        setSeed({ for: id, state: 'loading' });
        (async () => {
            let next: AuthoredSeed;
            try {
                const [layers, servedDraft] = await Promise.all([
                    metadataClient.layered('view', id),
                    readRuntimeDraft<Record<string, unknown>>('view', id, { metadataClient }),
                ]);
                const authored = authoredBuffer('view', layers as AuthoredLayers, servedDraft);
                if (authored.kind === 'unserved') {
                    next = { for: id, state: 'refused', message: tStudio('engine.studio.refusal.draftUnreadable', locale) };
                } else if (Object.keys(authored.body).length === 0) {
                    next = {
                        for: id,
                        state: 'refused',
                        message: tFormat('engine.edit.loadFailed', locale, {
                            type: 'view',
                            name: id,
                            message: tStudio('engine.form.notFound', locale),
                        }),
                    };
                } else {
                    // The stored body is a ViewItem envelope or a flat view;
                    // its identity is the view the panel was opened on.
                    next = { for: id, state: 'ready', view: { ...storedViewToRuntimeView(authored.body), id } };
                }
            } catch (err) {
                next = {
                    for: id,
                    state: 'refused',
                    message: tFormat('engine.edit.loadFailed', locale, { type: 'view', name: id, message: formatMetadataError(err) }),
                };
            }
            if (!cancelled) setSeed(next);
        })();
        return () => { cancelled = true; };
    }, [open, readsAuthored, activeView.id, metadataClient, authoredReads]); // eslint-disable-line react-hooks/exhaustive-deps
    const seedFor = readsAuthored && seed?.for === activeView.id ? seed : null;
    const authoredView = seedFor?.state === 'ready' ? seedFor.view : null;
    // While the stored view is read, or when it cannot be, there is no buffer:
    // nothing is shown to edit and nothing can be saved.
    const awaitingAuthored = readsAuthored && !authoredView;

    // Inspector draft state. Rebuilt only when the source view ID (or create
    // mode) changes, or the stored view arrives — not on every parent
    // re-render — so in-flight edits are not clobbered (same stabilization the
    // legacy panel used with stableKey).
    const stableKey = mode === 'create' ? 'create' : activeView.id;
    // The view as the host previews it when the panel opened: what Discard
    // replays to the host's live list (the host's copy is the served one).
    const openingDraft = useMemo<InspectorViewDraft>(
        () => runtimeViewToInspectorDraft(
            mode === 'create' ? defaultNewView : (activeView as RuntimeView),
            objectDef.name,
        ),
        [stableKey, objectDef.name], // eslint-disable-line react-hooks/exhaustive-deps
    );
    // The buffer the inspector edits and Save sends: the stored view when one
    // was read (objectstack#35054), else the opening view (create mode, or a
    // host with no metadata client, which saves nothing).
    const initialDraft = useMemo<InspectorViewDraft>(
        () => (authoredView ? runtimeViewToInspectorDraft(authoredView, objectDef.name) : openingDraft),
        [authoredView, openingDraft, objectDef.name],
    );
    const [draft, setDraft] = useState<InspectorViewDraft>(initialDraft);
    const [isDirty, setIsDirty] = useState(false);
    // Bumped on each edit-mode save that lands, so the draft/publish chrome
    // surfaces the "unpublished changes" indicator immediately (the save
    // wrote a draft). Never on a refused one (objectui#11583).
    const [savedSignal, setSavedSignal] = useState(0);
    // An edit-mode save is in flight: Save is disabled until it settles.
    const [saving, setSaving] = useState(false);
    // Mirror the committed draft into a ref so `handlePatch` can compute the
    // next draft synchronously without a side-effecting state updater.
    const draftRef = useRef(draft);
    // Reset the draft when the source view changes — derived from `initialDraft`
    // during render (React's "adjust state on prop change" pattern) rather than
    // in an effect, so there's no extra render pass.
    const lastDraftRef = useRef(initialDraft);
    // The fields an edit has relayed to the host's live list (`handlePatch`).
    const relayedRef = useRef<Set<string>>(new Set());
    if (lastDraftRef.current !== initialDraft) {
        lastDraftRef.current = initialDraft;
        draftRef.current = initialDraft;
        relayedRef.current = new Set();
        setDraft(initialDraft);
        setIsDirty(false);
    }
    useEffect(() => { draftRef.current = draft; }, [draft]);

    // Focus the panel when it opens for keyboard accessibility.
    useEffect(() => {
        if (open && panelRef.current) {
            panelRef.current.focus();
        }
    }, [open]);

    // Network-free field catalog sourced from the object definition the host
    // already holds.
    const objectFields = useMemo(() => mapObjectFields(objectDef), [objectDef.fields]); // eslint-disable-line react-hooks/exhaustive-deps

    const familyKey = isFormFamilyKey(draft.viewKind) ? 'form' : 'list';

    // Shallow-merge an inspector patch into the draft, then mirror the
    // flattened runtime view back to the host field-by-field (matching the
    // legacy onViewUpdate(field, value) contract ObjectView expects).
    //
    // objectstack#35054: only the fields the admin changed, compared by content
    // with the buffer the panel opened (and any field relayed before, so a
    // change back reaches the list too). The buffer is the STORED view while
    // the host previews the SERVED one, which carries what the stored view
    // does not: the translation, and the columns the host draws into a view
    // that declares none (objectui#10694 judges a draft's `columns` against
    // those). Relaying an untouched stored field would present it as an edit.
    const handlePatch = useCallback((patch: Record<string, unknown>) => {
        // A read-only view takes no edit, whichever control would have sent one.
        if (readOnly) return;
        const next: InspectorViewDraft = { ...draftRef.current, ...(patch as Partial<InspectorViewDraft>) };
        draftRef.current = next;
        setDraft(next);
        setIsDirty(true);
        if (onViewUpdate) {
            const flat = inspectorDraftToRuntimeView(next);
            const opened = inspectorDraftToRuntimeView(lastDraftRef.current) as Record<string, unknown>;
            for (const [field, value] of Object.entries(flat)) {
                if (field === 'id') continue;
                if (!relayedRef.current.has(field) && isSameOptionsValue(value, opened[field])) continue;
                relayedRef.current.add(field);
                onViewUpdate(field, value);
            }
        }
    }, [onViewUpdate, readOnly]);

    const handleSave = useCallback(async () => {
        const flat = inspectorDraftToRuntimeView(draft);
        if (mode === 'create') {
            onCreate?.(flat);
            setIsDirty(false);
            return;
        }
        // objectui#11583: the edit is reported as saved only once the host
        // says it landed. A refused save keeps the panel dirty, so Save stays
        // live and no draft is announced. An edit made while the save is in
        // flight is not in it, so it keeps the panel dirty either way.
        const savedDraft = draftRef.current;
        setSaving(true);
        let landed: boolean;
        try {
            landed = (await onSave?.(flat)) !== false;
        } catch {
            landed = false;
        } finally {
            setSaving(false);
        }
        if (!landed) return;
        setSavedSignal((s) => s + 1);
        if (draftRef.current === savedDraft) setIsDirty(false);
    }, [draft, onSave, onCreate, mode]);

    // Discard = revert any unsaved edits AND close the panel, in both modes
    // (objectui#2320). Create mode has no committed view to preview against, so
    // there's nothing to revert on the host — just close (matching prior
    // behavior). Edit mode also restores the host's live list preview: edits
    // reach the list only through `onViewUpdate` (see `handlePatch`), so we
    // replay the panel's opening values — and clear any keys the edits
    // introduced — through the same seam, then reset the local draft.
    const revertEdits = useCallback(() => {
        if (onViewUpdate) {
            const original = inspectorDraftToRuntimeView(openingDraft);
            const edited = inspectorDraftToRuntimeView(draftRef.current);
            const fields = new Set([...Object.keys(edited), ...Object.keys(original)]);
            for (const field of fields) {
                if (field === 'id') continue;
                onViewUpdate(field, original[field]);
            }
        }
        draftRef.current = initialDraft;
        relayedRef.current = new Set();
        setDraft(initialDraft);
        setIsDirty(false);
    }, [initialDraft, openingDraft, onViewUpdate]);
    const handleDiscard = useCallback(() => {
        if (mode === 'edit') revertEdits();
        onClose();
    }, [mode, onClose, revertEdits]);

    // objectstack#35974 — the host's read-only verdict can land after the
    // panel opened editable (the package list was still being read) and after
    // an edit. A read-only panel offers no Discard, so the edit would be
    // stranded on the host's list and shown here in place of the stored view.
    // It is discarded instead, the panel staying open.
    const wasReadOnlyRef = useRef(readOnly);
    useEffect(() => {
        const turnedReadOnly = readOnly && !wasReadOnlyRef.current;
        wasReadOnlyRef.current = readOnly;
        if (turnedReadOnly && mode === 'edit' && (isDirty || relayedRef.current.size > 0)) revertEdits();
    }, [readOnly, mode, isDirty, revertEdits]);

    // A publish or a discard from the draft bar changes what is stored: the
    // buffer is read again (objectstack#35054), then the host refreshes.
    const handleAfterChange = useCallback(() => {
        setAuthoredReads((n) => n + 1);
        onAfterChange?.();
    }, [onAfterChange]);

    const panelTitle = mode === 'create'
        ? t('console.objectView.createView')
        : t('console.objectView.configureView');

    if (!open) {
        // Keep the slide container (owned by ObjectView) able to collapse to
        // zero width without rendering inspector internals while hidden.
        return <div ref={panelRef} tabIndex={-1} data-testid="view-config-panel" aria-hidden />;
    }

    return (
        <div
            ref={panelRef}
            tabIndex={-1}
            role="complementary"
            aria-label={panelTitle}
            data-testid="view-config-panel"
            className="flex h-full flex-col"
        >
            <div className="min-h-0 flex-1 overflow-auto">
                {awaitingAuthored ? (
                    seedFor?.state === 'refused' ? (
                        <p role="alert" data-testid="view-config-authored-refused" className="p-4 text-sm text-destructive">
                            {seedFor.message}
                        </p>
                    ) : (
                        <p data-testid="view-config-authored-loading" className="p-4 text-sm text-muted-foreground">
                            {tStudio('engine.form.loadingEditor', locale)}
                        </p>
                    )
                ) : (
                <ViewVariantInspector
                    type="view"
                    name={draft.name}
                    draft={draft as unknown as Record<string, unknown>}
                    variantKey="config"
                    familyKey={familyKey}
                    isHome
                    readOnly={readOnly}
                    locale={locale}
                    objectFieldsOverride={objectFields}
                    onPatch={handlePatch}
                />
                )}
            </div>
            <div
                data-testid="view-config-footer"
                className="flex items-center justify-end gap-2 border-t px-4 py-2.5"
            >
                {mode === 'edit' && !readOnly && (
                    <RuntimeDraftBar
                        type="view"
                        name={activeView.id}
                        metadataClient={metadataClient}
                        dataSource={dataSource}
                        objectName={objectDef.name}
                        dirty={isDirty}
                        savedSignal={savedSignal}
                        onAfterChange={handleAfterChange}
                    />
                )}
                {readOnly ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                        data-testid="view-config-close"
                    >
                        {t('common.close')}
                    </Button>
                ) : (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDiscard}
                            data-testid="view-config-discard"
                        >
                            {t('console.objectView.discard')}
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleSave}
                            disabled={saving || awaitingAuthored || (mode === 'edit' && !isDirty)}
                            data-testid="view-config-save"
                        >
                            {t('console.objectView.save')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
