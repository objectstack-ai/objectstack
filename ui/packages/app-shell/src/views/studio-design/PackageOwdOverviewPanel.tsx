// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PackageOwdOverviewPanel — the package-scoped Record Sharing Baseline (OWD)
 * overview (objectui#2505).
 *
 * A sibling surface in the Studio Access pillar, next to the permission-set
 * rail. Where the per-object Settings tab (`ObjectSettingsPanel`) edits one
 * object's `sharingModel` at a time, this table
 * surveys — and batch-edits — the OWD baseline of EVERY object the package
 * owns (published ∪ pending drafts, the same merge the pillars do).
 *
 * Ownership boundary (ADR-0090 / permission-model.md): every row here has the
 * same owner — the package author. This is an aggregation of N per-object
 * editing entry points within one ownership boundary, NOT a merge of OWD into
 * the per-principal permission-set matrix (which was considered and rejected).
 * It has no principal dimension.
 *
 *   • Save = per-object metadata DRAFTs under the package scope — byte-for-byte
 *     what the per-object Settings tab writes, just N objects in one action.
 *     Publish then flows through the unchanged package security-domain gate.
 *   • `controlled_by_parent` rows show the master link (read-only) under the
 *     row's dial.
 *   • There is no external column: `externalSharingModel` is retired by
 *     `@objectstack/spec` (objectstack#23268), so Studio neither reads,
 *     renders nor writes it (objectui#12353).
 *   • Read-only packages render badges only (the pillar's courtesy gate).
 */

import * as React from 'react';
import { Save, Loader2, Lock, ArrowUpRight } from 'lucide-react';
import type { MetadataClient, MetadataLayered } from '@object-ui/data-objectstack';
// The ONE draft-envelope reader (objectui#8181): unwrap AND strip the
// framework's read decorations in one place. This file used to carry its own
// copy that did the unwrap and skipped the strip.
// …and `formatMetadataError`, the one metadata-save error reader (objectui#11302).
// …and `dropServedPicklistOptions`, the served -> authored conversion of a
// picklist-bound field (objectui#10202, objectui#11692).
import { dropServedPicklistOptions, extractDraftBody, formatMetadataError } from '@object-ui/data-objectstack';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { t, tFormat, type SupportedLocale } from '../metadata-admin/i18n.js';
import { deriveMasterObject, requireCbpMasterDetails } from './owd-sharing.js';
import { toast } from 'sonner';


/**
 * A single object's loaded OWD values — read from its pending draft as-is when
 * one exists, else from its layered baseline (objectui#10765).
 */
interface OwdRow {
  name: string;
  label: string;
  /** Authored `sharingModel`; '' when unset (defaults to private, ADR-0090 D1). */
  internal: string;
  /**
   * The master (parent) object the row derives under `controlled_by_parent`:
   * the reference of its one required `master_detail` (objectui#12326). For a
   * row loaded as `controlled_by_parent` it is read from the body as stored,
   * which is what the runtime derives. For any other row it is the master the
   * row would derive once switched and saved here, since that save sets
   * `required: true` on its `master_detail` fields. Undefined = no master: zero
   * `master_detail` fields, or two or more, an authoring error the save door
   * refuses.
   */
  master?: string;
  /** True when this object already has an unpublished draft. */
  hasDraft: boolean;
  /** True when the package's published list held this object at load (objectui#11799). */
  saved: boolean;
}

/**
 * One object's two reads for this table: its layered baseline and its pending
 * draft. The baseline is used only when there is no draft (objectui#10765).
 *
 * objectui#11799 — an object the package's published list does not hold has
 * never been saved, so it has no layer, and `GET …/layers` answers 404 for it.
 * Such an object is not asked while its draft is in hand. Should no draft come
 * back (a failed read, or the object was published or discarded since the
 * list was read), its baseline is read as before. A saved object is read
 * exactly as before: both reads together.
 */
async function readObjectBodies(
  client: MetadataClient,
  name: string,
  saved: boolean,
): Promise<[MetadataLayered<Record<string, unknown>> | null, unknown]> {
  const readLayered = () => client.layered<Record<string, unknown>>('object', name).catch(() => null);
  const readDraft = () => client.getDraft<Record<string, unknown>>('object', name).catch(() => null);
  if (saved) return Promise.all([readLayered(), readDraft()]);
  const draftResp = await readDraft();
  if (extractDraftBody(draftResp)) return [null, draftResp];
  return [await readLayered(), draftResp];
}

/** The user's working value for one row ('' = unset). */
interface OwdEdit {
  internal: string;
}

const OWD_OPTION_KEYS: ReadonlyArray<{ value: string; key: string }> = [
  { value: 'private', key: 'engine.studio.settings.sharingPrivate' },
  { value: 'public_read', key: 'engine.studio.settings.sharingPublicRead' },
  { value: 'public_read_write', key: 'engine.studio.settings.sharingPublicReadWrite' },
  { value: 'controlled_by_parent', key: 'engine.studio.settings.sharingControlledByParent' },
];

/** Short localized label for an OWD value; unset → "(not set — defaults to Private)". */
function owdLabel(value: string, locale: SupportedLocale): string {
  if (!value) return t('engine.studio.settings.sharingUnset', locale);
  const hit = OWD_OPTION_KEYS.find((o) => o.value === value);
  return hit ? t(hit.key, locale) : value;
}

/** The item a stored value none of a dial's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — one row's sharing-model dial, drawn with the shared
 * `Select`, the control the object settings panel's dials (`SettingsPicker`)
 * pick with. They used to be browser-native `<select>`s. What a pick writes is
 * unchanged: `onPick` receives the picked option's own `value`, the string the
 * native control's `change` carried, and the row's working value takes it as
 * before. Re-picking the current option changes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: the dial opens on an
 *   option whose value is `''` ("not set"), which `SelectItem` refuses.
 * - A stored value none of the options carries gets an item of its own,
 *   labelled with the value, so the trigger shows what the object holds. The
 *   native control showed "not set" there, which is not what the object says.
 *   Picking that item changes nothing.
 * - Read-only draws no dial at all, as before: the row shows the value's label.
 * - The native controls had no label, so the triggers have no name either.
 */
function OwdPicker({
  value,
  options,
  onPick,
  className,
  testId,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  className: string;
  testId: string;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to change.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger data-testid={testId} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The classes a dial takes, at the size the native control had. */
const DIAL = 'h-7 min-w-[13rem] px-2 py-1 text-[12px]';

export interface PackageOwdOverviewPanelProps {
  client: MetadataClient;
  packageId: string;
  /** Bumped on package publish → re-read the freshly published baseline. */
  publishNonce?: number;
  /** Notify the surface so its pending-changes counter refreshes after a save. */
  onDraftSaved?: () => void;
  /**
   * Courtesy gate: read-only packages render badges only (the framework's
   * ADR-0124 D1 — server enforces, client is courtesy).
   */
  readOnly?: boolean;
  locale: SupportedLocale;
  /** Object to scroll to / highlight (deep-link from the permission matrix badge). */
  highlightObject?: string | null;
  /** objectui#2600 — mirrors the unsaved-row state up to the host pillar, whose
   * rail/header navigation unmounts this panel (SPA nav, so no beforeunload).
   * Reports `false` on unmount so a confirmed discard clears the host's guard —
   * same contract as PermissionMatrixEditPage's own onDirtyChange. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function PackageOwdOverviewPanel({
  client,
  packageId,
  publishNonce = 0,
  onDraftSaved,
  readOnly = false,
  locale,
  highlightObject,
  onDirtyChange,
}: PackageOwdOverviewPanelProps): React.ReactElement {
  const [rows, setRows] = React.useState<OwdRow[]>([]);
  const [edits, setEdits] = React.useState<Record<string, OwdEdit>>({});
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoaded(false);
    setLoadError(null);
    try {
      // Objects this package owns: published records ∪ pending draft headers
      // (the same union the Data / Access rails build). `list()` sees published
      // metadata only, so a draft-only object appears via `listDrafts()`.
      const [list, draftHeaders] = await Promise.all([
        client.list<Record<string, unknown>>('object', { packageId }),
        client.listDrafts({ packageId, type: 'object' }).catch(() => [] as Array<{ name?: string }>),
      ]);
      const publishedLabel = new Map<string, string>();
      const names: string[] = [];
      const seen = new Set<string>();
      for (const raw of list || []) {
        const item = ((raw as { item?: unknown }).item ?? raw) as Record<string, unknown>;
        const name = String(item.name ?? '');
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
        publishedLabel.set(name, String(item.label ?? name));
      }
      for (const d of draftHeaders || []) {
        const name = String(d?.name ?? '');
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }

      // The list row carries `sharingModel` but not reliably `fields` (needed
      // for the master link), and never the pending-draft value — so read each
      // object's body (its pending draft as-is, else its layered baseline),
      // exactly as the per-object Settings tab does, and derive every column
      // from that one source.
      const built = await Promise.all(
        names.map(async (name): Promise<OwdRow> => {
          // objectui#11799 — saved = held by the published list read above.
          const saved = publishedLabel.has(name);
          const [layRaw, draftResp] = await readObjectBodies(client, name, saved);
          const lay = (layRaw ?? {}) as { effective?: Record<string, unknown>; code?: Record<string, unknown> };
          const baseline = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
          const draftBody = extractDraftBody(draftResp);
          // The pending draft is the whole document: read it as-is, and the
          // published baseline only when no draft exists (objectui#10765). A
          // spread over `effective` showed a model the draft had cleared as
          // still set, from the published layer.
          const body = draftBody ?? baseline;
          const internal = typeof body.sharingModel === 'string' ? body.sharingModel : '';
          return {
            name,
            label: String(body.label ?? publishedLabel.get(name) ?? name),
            internal,
            master: deriveMasterObject(
              internal === 'controlled_by_parent' ? body.fields : requireCbpMasterDetails(body.fields),
            ),
            hasDraft: !!draftBody,
            saved,
          };
        }),
      );
      built.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
      setRows(built);
      // Reset working edits to the freshly loaded baseline.
      setEdits(Object.fromEntries(built.map((r) => [r.name, { internal: r.internal }])));
    } catch (e) {
      setLoadError(formatMetadataError(e));
    } finally {
      setLoaded(true);
    }
  }, [client, packageId]);

  React.useEffect(() => {
    void load();
  }, [load, publishNonce]);

  // Deep-link highlight — scroll the linked object's row into view.
  const rowRefs = React.useRef<Record<string, HTMLTableRowElement | null>>({});
  React.useEffect(() => {
    if (!highlightObject || !loaded) return;
    const el = rowRefs.current[highlightObject];
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightObject, loaded]);

  const setEdit = React.useCallback((name: string, patch: Partial<OwdEdit>) => {
    setEdits((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }, []);

  // A row is dirty when its working value differs from the loaded baseline.
  const rowState = React.useMemo(() => {
    return rows.map((r) => {
      const e = edits[r.name] ?? { internal: r.internal };
      const dirty = e.internal !== r.internal;
      return { row: r, edit: e, dirty };
    });
  }, [rows, edits]);

  const dirtyCount = rowState.filter((s) => s.dirty).length;

  // Report dirty transitions to the host (see onDirtyChange). Ref-stabilized
  // so a non-memoized callback prop doesn't refire the effect; the unmount
  // cleanup reports `false` so a deliberately-discarded panel clears the
  // host's guard state.
  const isDirty = dirtyCount > 0;
  const onDirtyChangeRef = React.useRef(onDirtyChange);
  React.useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  });
  React.useEffect(() => {
    onDirtyChangeRef.current?.(isDirty);
  }, [isDirty]);
  React.useEffect(
    () => () => {
      onDirtyChangeRef.current?.(false);
    },
    [],
  );

  const doSave = React.useCallback(async () => {
    const changed = rowState.filter((s) => s.dirty);
    if (changed.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Each changed row lands as that object's package-scoped DRAFT: read the
      // fresh body (below), apply just `sharingModel` (unset → drop the key), and
      // save. Identical to the per-object Settings write, N times — publish
      // then goes through the same package security-domain gate unchanged.
      for (const s of changed) {
        // objectui#11799 — the row's saved state from the load decides whether
        // the baseline is asked before the draft is in hand.
        const [layRaw, draftResp] = await readObjectBodies(client, s.row.name, s.row.saved);
        const lay = (layRaw ?? {}) as { effective?: Record<string, unknown>; code?: Record<string, unknown> };
        const baseline = (lay.effective ?? lay.code ?? {}) as Record<string, unknown>;
        const draftBody = extractDraftBody(draftResp);
        // The pending draft is the whole document — the edit lands on it as-is,
        // and on the published baseline only when no draft exists
        // (objectui#10765): a spread over `effective` would put back every key
        // the draft had deleted and save them again as this object's draft.
        const next: Record<string, unknown> = { ...(draftBody ?? baseline) };
        if (s.edit.internal) next.sharingModel = s.edit.internal;
        else delete next.sharingModel;
        // objectui#12326 — switching to `controlled_by_parent` sets
        // `required: true` on every `master_detail` field, as the per-object
        // Settings tab does: the save door refuses an omitted one there.
        if (s.edit.internal === 'controlled_by_parent' && next.fields !== undefined) {
          next.fields = requireCbpMasterDetails(next.fields);
        }
        // objectui#11692 — `next` is seeded from a SERVED object read, where a
        // picklist-bound field carries `picklist` beside the options the
        // runtime resolved from the list; the authoring door refuses the two
        // together, for the whole object. So the resolved `options` stay out of
        // the body, on every bound field and on nothing else.
        await client.save('object', s.row.name, dropServedPicklistOptions(next), { mode: 'draft', packageId, surface: 'studio' });
      }
      toast.success(tFormat('engine.studio.owd.saved', locale, { count: changed.length }));
      onDraftSaved?.();
      await load();
    } catch (e) {
      setSaveError(formatMetadataError(e));
    } finally {
      setSaving(false);
    }
  }, [rowState, client, packageId, onDraftSaved, load, locale]);

  const canSave = !readOnly && !saving && dirtyCount > 0;

  // The dial's options, in the order the native control listed them.
  const internalOptions = [
    { value: '', label: t('engine.studio.settings.sharingUnset', locale) },
    ...OWD_OPTION_KEYS.map((o) => ({ value: o.value, label: t(o.key, locale) })),
  ];
  return (
    <div className="flex h-full flex-col" data-testid="owd-overview">
      {/* objectui#12456 — the overview's title and subtitle are the Access
          pillar's item header above this panel, so its own header is the
          toolbar row: what the dials decide, and Save. */}
      <div className="flex items-center gap-3 border-b px-6 py-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t('engine.studio.owd.description', locale)}</p>
        {readOnly ? (
          <span
            title={t('engine.studio.pkg.readonlyHint', locale)}
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <Lock className="h-3 w-3" /> {t('engine.studio.pkg.readonly', locale)}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void doSave()}
            disabled={!canSave}
            data-testid="owd-save"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirtyCount > 0
              ? tFormat('engine.studio.owd.save', locale, { count: dirtyCount })
              : t('engine.studio.owd.saveNone', locale)}
          </button>
        )}
      </div>

      {saveError && (
        <p className="border-b bg-destructive/10 px-4 py-2 text-[11px] text-destructive">{saveError}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!loaded ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('engine.studio.loading', locale)}</p>
        ) : loadError ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('engine.studio.owd.loadFailed', locale)}</p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">{t('engine.studio.owd.none', locale)}</p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">{t('engine.studio.owd.colObject', locale)}</th>
                <th className="px-2 py-1.5 font-medium">{t('engine.studio.owd.colInternal', locale)}</th>
              </tr>
            </thead>
            <tbody>
              {rowState.map(({ row, edit, dirty }) => {
                const isParent = edit.internal === 'controlled_by_parent';
                return (
                  <tr
                    key={row.name}
                    ref={(el) => {
                      rowRefs.current[row.name] = el;
                    }}
                    data-testid={`owd-row-${row.name}`}
                    className={
                      'border-b align-top ' +
                      (highlightObject === row.name ? 'bg-primary/5' : '')
                    }
                  >
                    <td className="px-2 py-2">
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{row.label}</span>
                          {dirty && (
                            <span
                              data-testid={`owd-dirty-${row.name}`}
                              className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-300"
                            >
                              {t('engine.studio.owd.unsaved', locale)}
                            </span>
                          )}
                          {row.hasDraft && !dirty && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {t('engine.studio.unpublishedDraft', locale)}
                            </span>
                          )}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">{row.name}</span>
                      </span>
                    </td>

                    {/* Sharing model (sharingModel) — plus the master link for
                        controlled_by_parent rows. */}
                    <td className="px-2 py-2">
                      {readOnly ? (
                        <span className="text-muted-foreground">{owdLabel(edit.internal, locale)}</span>
                      ) : (
                        <OwdPicker
                          value={edit.internal}
                          testId={`owd-internal-${row.name}`}
                          onPick={(v) => setEdit(row.name, { internal: v })}
                          className={DIAL}
                          options={internalOptions}
                        />
                      )}
                      {isParent && (
                        <span
                          data-testid={`owd-master-${row.name}`}
                          title={t('engine.studio.owd.masterTip', locale)}
                          className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {row.master
                            ? tFormat('engine.studio.owd.byParent', locale, { master: row.master })
                            : t('engine.studio.owd.byParentNoMaster', locale)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default PackageOwdOverviewPanel;
