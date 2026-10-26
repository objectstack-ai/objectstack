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
 */

import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { ViewVariantInspector } from './metadata-admin/inspectors/ViewVariantInspector.js';
import { RuntimeDraftBar } from './RuntimeDraftBar.js';
import { isFormFamilyKey } from './metadata-admin/view-variant-model.js';
import { useMetadataLocale } from './metadata-admin/i18n.js';
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
}

/**
 * Map an Object definition's `fields` record into the inspector's flat field
 * catalog so it can render field-reference pickers (columns, groupByField, …)
 * without a network fetch.
 */
function mapObjectFields(objectDef: ViewConfigPanelProps['objectDef']): ObjectFieldInfo[] {
    const fields = objectDef.fields;
    if (!fields || typeof fields !== 'object') return [];
    return Object.entries(fields).map(([name, def]) => {
        const f = (def ?? {}) as Record<string, any>;
        return {
            name,
            label: typeof f.label === 'string' && f.label ? f.label : name,
            type: typeof f.type === 'string' ? f.type : 'text',
            hidden: f.hidden === true,
        };
    });
}

export function ViewConfigPanel({ open, onClose, mode = 'edit', activeView, objectDef, onViewUpdate, onSave, onCreate, metadataClient, dataSource, onAfterChange }: ViewConfigPanelProps) {
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

    // Inspector draft state. Rebuilt only when the source view ID (or create
    // mode) changes — not on every parent re-render — so in-flight edits are
    // not clobbered (same stabilization the legacy panel used with stableKey).
    const stableKey = mode === 'create' ? 'create' : activeView.id;
    const initialDraft = useMemo<InspectorViewDraft>(
        () => runtimeViewToInspectorDraft(
            mode === 'create' ? defaultNewView : (activeView as RuntimeView),
            objectDef.name,
        ),
        [stableKey, objectDef.name], // eslint-disable-line react-hooks/exhaustive-deps
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
    if (lastDraftRef.current !== initialDraft) {
        lastDraftRef.current = initialDraft;
        draftRef.current = initialDraft;
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
    const handlePatch = useCallback((patch: Record<string, unknown>) => {
        const next: InspectorViewDraft = { ...draftRef.current, ...(patch as Partial<InspectorViewDraft>) };
        draftRef.current = next;
        setDraft(next);
        setIsDirty(true);
        if (onViewUpdate) {
            const flat = inspectorDraftToRuntimeView(next);
            for (const [field, value] of Object.entries(flat)) {
                if (field === 'id') continue;
                onViewUpdate(field, value);
            }
        }
    }, [onViewUpdate]);

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
    const handleDiscard = useCallback(() => {
        if (mode === 'edit') {
            if (onViewUpdate) {
                const original = inspectorDraftToRuntimeView(initialDraft);
                const edited = inspectorDraftToRuntimeView(draftRef.current);
                const fields = new Set([...Object.keys(edited), ...Object.keys(original)]);
                for (const field of fields) {
                    if (field === 'id') continue;
                    onViewUpdate(field, original[field]);
                }
            }
            draftRef.current = initialDraft;
            setDraft(initialDraft);
            setIsDirty(false);
        }
        onClose();
    }, [initialDraft, mode, onClose, onViewUpdate]);

    // ADR-0034 (#1515): resume a pending draft into the inspector when the
    // panel reopens (flag-ON only; the bar never fires this when the flag is
    // off). The stored body is a ViewItem envelope (objectui#10210) or, for a
    // draft saved before that, the flat runtime view — read it back to the
    // runtime shape, then adapt that to the inspector draft before seeding.
    const handleResumeDraft = useCallback((body: Record<string, unknown>) => {
        const resumed = runtimeViewToInspectorDraft(storedViewToRuntimeView(body), objectDef.name);
        draftRef.current = resumed;
        setDraft(resumed);
        setIsDirty(false);
    }, [objectDef.name]);

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
                <ViewVariantInspector
                    type="view"
                    name={draft.name}
                    draft={draft as unknown as Record<string, unknown>}
                    variantKey="config"
                    familyKey={familyKey}
                    isHome
                    readOnly={false}
                    locale={locale}
                    objectFieldsOverride={objectFields}
                    onPatch={handlePatch}
                />
            </div>
            <div
                data-testid="view-config-footer"
                className="flex items-center justify-end gap-2 border-t px-4 py-2.5"
            >
                {mode === 'edit' && (
                    <RuntimeDraftBar
                        type="view"
                        name={activeView.id}
                        metadataClient={metadataClient}
                        dataSource={dataSource}
                        objectName={objectDef.name}
                        dirty={isDirty}
                        onResume={handleResumeDraft}
                        savedSignal={savedSignal}
                        onAfterChange={onAfterChange}
                    />
                )}
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
                    disabled={saving || (mode === 'edit' && !isDirty)}
                    data-testid="view-config-save"
                >
                    {t('console.objectView.save')}
                </Button>
            </div>
        </div>
    );
}
