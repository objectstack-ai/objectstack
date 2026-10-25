/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * InlineEditSaveBar — the record-level sticky Save/Cancel bar for inline edit
 * (objectui#2407 P1). Reads the shared `InlineEditContext` (draft / editing /
 * saving / error) and commits the WHOLE draft in ONE atomic write, so
 * cross-field validation runs against a consistent record instead of the old
 * per-field save-on-blur loop.
 *
 * Two persistence modes:
 *   - **DataSource mode** (record page): one `dataSource.update(obj, id, draft,
 *     { ifMatch: data.updated_at })` → `refresh()`. A `409 CONCURRENT_UPDATE`
 *     opens `<ConcurrentUpdateDialog>` (reload / overwrite), reusing the OCC UX
 *     that previously lived in `record:details`.
 *   - **Callback mode** (standalone drawer): loops a caller-supplied
 *     `onFieldSave(field, value)` over the draft, preserving the drawer's
 *     existing per-field persistence contract with plugin-gantt/calendar/kanban.
 *
 * While the session is active the bar also owns the record-level keyboard
 * shortcuts (objectui#2572): **Esc** cancels (when no popover/dialog is open)
 * and **Cmd/Ctrl+Enter** saves — both respecting `saving`/`locked`.
 *
 * The bar renders nothing unless the record is actively being edited.
 *
 * ## Validation authority on this surface: the SERVER (objectui#6868)
 *
 * ⚖️ Ruled by the maintainer on 2026-08-31 (decision batch #13, on
 * https://github.com/objectstack-ai/objectui/issues/6868). Recorded here
 * because, until that ruling, the inline-edit surface's lack of client-side
 * validation was an ABSENCE, and an absence and a decision look identical in
 * code. This comment is the difference.
 *
 * The ruling, in its own words:
 *
 *   1. 正式记录:行内编辑面的校验权威是**服务端**…此前这是一个「缺席」,现在是
 *      一个「决定」——在相应模块注释写明并指向本裁定。
 *   2. 交付物:把服务端 `VALIDATION_FAILED` 拒绝**映射为就地字段提示**(拒绝信息
 *      已含字段与规则,缺的只是呈现层)——用户不再看到原始服务器错误。
 *   3. ⛔ 不抽取共享求值器。
 *   4. ⛔ 照旧不写第二套校验实现——服务端是唯一规则源,前端只做呈现。
 *
 * What that means for anyone editing this module:
 *
 *   - ⛔ Do NOT add a client-side rule evaluator here, and do NOT call
 *     `buildValidationRules` from this surface. The form surface's producer
 *     emits a react-hook-form rule DESCRIPTOR, not a verdict; RHF is the only
 *     evaluator in the repo, and this package depends on neither. Wiring one
 *     up would create a second rule source that can disagree with the server —
 *     which is precisely how AI-authored metadata gets a green form and a
 *     rejected write.
 *   - ✅ DO present what the server already decided. The refusal envelope is
 *     field-scoped: `@objectstack/objectql`'s validators throw
 *     `VALIDATION_FAILED` with `fields[]`, and `@object-ui/react`'s
 *     `extractFieldErrors` is the ONE in-repo normaliser for it (the same one
 *     `form.tsx` uses). This module reads that normaliser and renders per-field
 *     reasons; it never re-derives a rule.
 *
 * The rule kinds the engine refuses on this surface were measured on a real
 * ObjectQL engine before the ruling: `required` (empty AND null), `minLength`,
 * `maxLength`, `email`, `url`, `min`, `max` — every one a `VALIDATION_FAILED`
 * with the prior value left in storage. So no invalid value reachable here
 * survives the write; the only defect was the SHAPE of the refusal the user saw.
 */

import * as React from 'react';
import { Button, cn } from '@object-ui/components';
import { Check, X, Loader2 } from 'lucide-react';
import {
  useInlineEdit,
  extractFieldErrors,
  extractWriteErrorMessage,
  type WriteFieldError,
} from '@object-ui/react';
import { useDetailTranslation } from './useDetailTranslation';
import {
  ConcurrentUpdateDialog,
  isConcurrentUpdateError,
  type ConcurrentUpdateConflict,
} from './ConcurrentUpdateDialog';

export interface InlineEditSaveBarProps {
  /** DataSource for the atomic-update path (record page). */
  dataSource?: any;
  /** Object machine name for the atomic-update path. */
  objectName?: string;
  /** Record id for the atomic-update path. */
  recordId?: string | number | null;
  /** Current server record — supplies `updated_at` for the OCC `ifMatch` token. */
  data?: any;
  /** Re-fetch the record after a successful save / reload. */
  refresh?: () => void | Promise<void>;
  /** Map a field machine name to a user-facing label (for the conflict dialog). */
  fieldLabelFor?: (name: string) => string | undefined;
  /**
   * Callback-persistence mode (drawer): when provided, the save loops this
   * per-field callback over the draft instead of issuing a DataSource update.
   * Takes precedence over the DataSource path.
   */
  onFieldSave?: (field: string, value: any) => void | Promise<void>;
  /** When true, disables Save and shows a lock hint (e.g. approval-locked). */
  locked?: boolean;
  /** Tooltip/label explaining why the record is locked. */
  lockedHint?: string;
  className?: string;
}

/**
 * The shape `isConcurrentUpdateError` narrows to, DERIVED from the predicate
 * rather than restated here (objectui#6477).
 *
 * `buildConflict` below is that predicate's ONLY in-repo consumer, and it used
 * to take `err: any` — which discarded the narrowing one line after the call
 * site drew it, so the predicate's return type reached no typed consumer at
 * all. objectui#6421 / PR #6474 had just made that return type honest
 * (`code?: 'CONCURRENT_UPDATE'`, optional because the `name` limb carries no
 * `code`); this alias is what makes something listen.
 *
 * Derived, not copied, on purpose: a restated literal shape is a second
 * declaration that drifts silently, and the two disagreeing is exactly the
 * failure this card was opened to rule out. Written this way the compiler
 * re-checks every read in `buildConflict` against whatever the predicate
 * currently promises, so a future narrowing that stops covering
 * `currentRecord` / `currentVersion` is a red build here rather than a fresh
 * `any`.
 */
type NarrowedBy<F> = F extends (arg: unknown) => arg is infer N ? N : never;
type ConcurrentUpdateErrorShape = NarrowedBy<typeof isConcurrentUpdateError>;

/**
 * Signature of the module-local `buildConflict` callback. Exported as a TYPE
 * only, for its pin test to reach — the callback itself stays inside the
 * component. Deliberately NOT re-exported from `src/index.tsx`, which lists
 * every published name explicitly, so the package surface is unchanged.
 */
export type BuildConflict = (
  draft: Record<string, any>,
  err: ConcurrentUpdateErrorShape,
) => ConcurrentUpdateConflict;

/**
 * Strip noisy backend prefixes so the inline error reads cleanly.
 *
 * The LAST-RESORT channel since objectui#6868: it is what the user sees only
 * when the refusal is not field-scoped (a transport failure, a permission
 * denial, a bare `Error`). A `VALIDATION_FAILED` never reaches it — that path
 * goes through {@link attributeInlineRefusal} and renders per field.
 */
function cleanError(err: any): string {
  const raw = err?.message || err?.error || String(err ?? 'Save failed');
  return String(raw)
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[A-Z][A-Z0-9_]+:\s*/, '');
}

/**
 * Attribute a rejected inline save to the FIELDS it is about, or answer `null`
 * when it is not field-scoped (objectui#6868 deliverable 2).
 *
 * Two sources, in strict order, and neither of them guesses:
 *
 *  1. **The envelope.** `extractFieldErrors` — `@object-ui/react`'s single
 *     in-repo normaliser, the same one `form.tsx` reads — accepts the three
 *     shapes a `VALIDATION_FAILED` can arrive in (`validationErrors` from
 *     `@object-ui/data-objectstack`'s re-wrap, `details.fields` from the raw
 *     `@objectstack/client` error, or a bare `fields`) and drops any entry with
 *     no usable `field`. That drop is the point: a wrong mark on an innocent
 *     input is worse than the undirected string it replaces. This is the ONLY
 *     source for the DataSource path, whose write is one atomic multi-key
 *     update — nothing else there can say which key the server refused.
 *
 *  2. **The call shape, in callback mode only.** The drawer's persistence
 *     contract loops `onFieldSave(field, value)` one field at a time, so a
 *     rejection from that call belongs to that field by CONSTRUCTION, not by
 *     inference — the write in flight carried exactly one key. `inFlightField`
 *     is passed only from that loop; the atomic path passes `undefined`, so a
 *     multi-key write can never be attributed this way.
 *
 * ⚠️ This function evaluates NOTHING. It reads the server's verdict and says
 * which input it belongs beside. Adding a rule check here would be the second
 * validation implementation the ruling forbids.
 *
 * Module-local on purpose: its pin drives it through the rendered bar, which is
 * how the mapping is actually reached, so exporting it would widen the module's
 * name surface (and its fast-refresh footprint) for nothing.
 */
function attributeInlineRefusal(
  err: unknown,
  inFlightField?: string,
): WriteFieldError[] | null {
  const fromEnvelope = extractFieldErrors(err);
  if (fromEnvelope) return fromEnvelope;
  if (!inFlightField) return null;
  // Field-scoped by the call shape, but the envelope carried no per-field text
  // — fall back to the envelope's top-level reason rather than marking an input
  // with no reason next to it (the rule `form.tsx` applies to the same case).
  const message = extractWriteErrorMessage(err) || cleanError(err);
  return [{ field: inFlightField, message }];
}

/**
 * The `field` the server names on an OBJECT-LEVEL refusal (objectui#13292).
 *
 * `@objectstack/objectql`'s rule validator attributes a rule to its first
 * declared field and, when the rule declares none (a `script` rule, or a rule
 * whose `fields` is empty), to this sentinel instead — the documented contract
 * ("`_record` for an object-level rule"). It names no input, so it is never a
 * label and never a per-field hint.
 */
const RECORD_LEVEL_FIELD = '_record';

/**
 * A refusal split by what each entry is ABOUT (objectui#13292): `fieldLevel`
 * entries name a field of the record and are presented as today — labelled in
 * the banner and published as a per-field hint; `recordLevel` messages name no
 * field, so they are shown alone, the way `form.tsx` falls back to the
 * envelope's own text when an entry names no field it renders.
 */
interface SplitRefusal {
  fieldLevel: WriteFieldError[];
  recordLevel: string[];
}

/**
 * Sort attributed entries into field-level and record-level.
 *
 * `extractFieldErrors` is shared and keeps any entry with a non-empty `field`,
 * so the `_record` sentinel (and a `field` naming nothing on the object) passes
 * through it; deciding what such an entry is belongs HERE, on the surface that
 * presents it — not in the shared normaliser.
 */
function splitRefusal(
  entries: WriteFieldError[],
  isRecordField: (name: string) => boolean,
): SplitRefusal {
  const fieldLevel: WriteFieldError[] = [];
  const recordLevel: string[] = [];
  for (const entry of entries) {
    if (entry.field !== RECORD_LEVEL_FIELD && isRecordField(entry.field)) {
      fieldLevel.push(entry);
    } else if (entry.message) {
      recordLevel.push(entry.message);
    }
  }
  return { fieldLevel, recordLevel };
}

/**
 * Issue a partial-record update through whichever method the DataSource
 * exposes. Mirrors the update/updateOne/patch fallback + `ifMatch` OCC token
 * that `record:details` used for its per-field save.
 */
async function updateVia(
  ds: any,
  objectName: string,
  recordId: string | number,
  patch: Record<string, any>,
  opts?: { ifMatch?: string },
): Promise<void> {
  if (typeof ds?.update === 'function') {
    await ds.update(objectName, recordId, patch, opts);
  } else if (typeof ds?.updateOne === 'function') {
    await ds.updateOne(objectName, recordId, patch, opts);
  } else if (typeof ds?.patch === 'function') {
    await ds.patch(objectName, recordId, patch, opts);
  } else {
    throw new Error(
      '[InlineEditSaveBar] DataSource exposes no update/updateOne/patch method; cannot persist inline edit',
    );
  }
}

export const InlineEditSaveBar: React.FC<InlineEditSaveBarProps> = ({
  dataSource,
  objectName,
  recordId,
  data,
  refresh,
  fieldLabelFor,
  onFieldSave,
  locked = false,
  lockedHint,
  className,
}) => {
  const { t } = useDetailTranslation();
  const inline = useInlineEdit();
  const [conflict, setConflict] = React.useState<ConcurrentUpdateConflict | null>(null);
  const [conflictBusy, setConflictBusy] = React.useState(false);
  /** User-facing name for a rejected field; the machine name when the host resolves none. */
  const labelForField = React.useCallback(
    (name: string) => fieldLabelFor?.(name) || name,
    [fieldLabelFor],
  );

  const canAtomic = !!dataSource && !!objectName && recordId != null;

  /**
   * Record-level lines of the last refusal, held beside the banner text they
   * were rendered into (objectui#13292). Shown only while the session's
   * `error` is still that same text, so the context's own clears (`enter()`,
   * teardown, the next save) retire them without a second reset path.
   */
  const [recordRefusal, setRecordRefusal] = React.useState<{
    error: string;
    messages: string[];
  } | null>(null);

  /**
   * Whether `name` is a field of the record this bar is editing — the only
   * names that may carry a label and a per-field hint (objectui#13292). This
   * surface holds no object schema, so it accepts what it can see: a key the
   * user staged, a key of the server record, or a name the host resolves to a
   * label of its own (a host that echoes the machine name back resolves
   * nothing).
   */
  const isRecordField = React.useCallback(
    (name: string) => {
      if (inline && Object.prototype.hasOwnProperty.call(inline.draft, name)) return true;
      if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, name)) {
        return true;
      }
      const label = fieldLabelFor?.(name);
      return !!label && label !== name;
    },
    [inline, data, fieldLabelFor],
  );

  /**
   * Present a rejected save. A field-scoped refusal is published to the shared
   * session as a per-field map, which the field renderers (`DetailSection`,
   * `HeaderHighlight`) draw beside the input the server named — the in-place
   * hint objectui#6868 asks for. The record-level `error` is set either way, so
   * the bar keeps a summary for a field that is collapsed or scrolled out of
   * view, the same reason `form.tsx` keeps its banner.
   *
   * Publishing through the context rather than local state is also what makes
   * the attribution unable to outlive its session: `enter()` and teardown clear
   * both slots, so a stale hint cannot reappear over a later edit.
   */
  const presentRefusal = React.useCallback(
    (err: unknown, inFlightField?: string) => {
      if (!inline) return;
      const attributed = attributeInlineRefusal(err, inFlightField);
      if (!attributed) {
        setRecordRefusal(null);
        inline.setFieldErrors(null);
        inline.setError(cleanError(err));
        return;
      }
      const labelOf = (name: string) => fieldLabelFor?.(name) || name;
      const { fieldLevel, recordLevel } = splitRefusal(attributed, isRecordField);
      // objectui#13292: an object-level rule's refusal names no field, so its
      // message reads alone — no label prefix, and no per-field hint.
      const lines = [
        ...fieldLevel.map((r) => `${labelOf(r.field)}: ${r.message}`),
        ...recordLevel,
      ];
      const error = lines.length > 0 ? lines.join('; ') : cleanError(err);
      setRecordRefusal(recordLevel.length > 0 ? { error, messages: recordLevel } : null);
      inline.setFieldErrors(
        fieldLevel.length > 0 ? Object.fromEntries(fieldLevel.map((r) => [r.field, r.message])) : null,
      );
      inline.setError(error);
    },
    [inline, fieldLabelFor, isRecordField],
  );

  /**
   * Build the conflict payload for `<ConcurrentUpdateDialog>` from a 409. A
   * single-field draft shows the classic per-field before/after; a multi-field
   * draft shows a record-level summary (the dialog JSON-stringifies objects).
   */
  const buildConflict = React.useCallback<BuildConflict>(
    (draft, err) => {
      const keys = Object.keys(draft);
      // No `as` cast here: the narrowed type already declares `currentRecord`
      // as `Record<string, unknown> | null`, which is exactly what the conflict
      // payload takes. That cast was the only type this value ever got.
      const current = err?.currentRecord ?? null;
      if (keys.length === 1) {
        const f = keys[0];
        return {
          field: f,
          label: fieldLabelFor?.(f),
          pendingValue: draft[f],
          currentValue: current ? current[f] : undefined,
          currentVersion: err?.currentVersion,
          currentRecord: current,
        };
      }
      const currentSubset = current
        ? Object.fromEntries(keys.map((k) => [k, current[k]]))
        : undefined;
      return {
        field: keys.join(', '),
        label: t('detail.concurrentUpdateRecordLabel', { defaultValue: 'this record' }),
        pendingValue: draft,
        currentValue: currentSubset,
        currentVersion: err?.currentVersion,
        currentRecord: current,
      };
    },
    [fieldLabelFor, t],
  );

  const handleSave = React.useCallback(async () => {
    if (!inline) return;
    const draft = inline.draft;
    const entries = Object.entries(draft);
    // No edits staged → just leave edit mode (matches the old empty-save path).
    if (entries.length === 0) {
      inline.reset();
      return;
    }
    inline.setSaving(true);
    inline.setError(null);
    inline.setFieldErrors(null);
    // Callback mode persists ONE key per call, so the key in flight is what a
    // rejection is about. Stays `undefined` on the atomic path, where the write
    // carries every edited key at once and only the envelope can attribute it.
    let inFlightField: string | undefined;
    try {
      if (onFieldSave) {
        // Callback mode (drawer): persist each edited field sequentially so a
        // single backend rejection short-circuits, preserving the caller's
        // per-field contract.
        for (const [field, value] of entries) {
          inFlightField = field;
          await onFieldSave(field, value);
        }
        inFlightField = undefined;
      } else if (canAtomic) {
        // DataSource mode (record page): ONE atomic write of only the edited
        // keys, OCC-guarded by the record's current updated_at.
        const ifMatch =
          typeof data?.updated_at === 'string' ? (data.updated_at as string) : undefined;
        await updateVia(dataSource, objectName!, recordId!, draft, ifMatch ? { ifMatch } : undefined);
        await refresh?.();
      }
      inline.reset();
    } catch (err) {
      if (isConcurrentUpdateError(err) && canAtomic) {
        // Stay in edit mode; the dialog drives reload / overwrite.
        setConflict(buildConflict(draft, err));
      } else {
        // objectui#6868: the server is the validation authority here, so a
        // refusal is PRESENTED, never re-derived.
        presentRefusal(err, inFlightField);
      }
    } finally {
      inline.setSaving(false);
    }
  }, [inline, onFieldSave, canAtomic, data, dataSource, objectName, recordId, refresh, buildConflict, presentRefusal]);

  const closeConflict = React.useCallback(() => {
    setConflict(null);
    setConflictBusy(false);
  }, []);

  const handleConflictReload = React.useCallback(async () => {
    setConflictBusy(true);
    try {
      await refresh?.();
    } finally {
      // Discard the pending draft — the user chose the server's version.
      inline?.reset();
      closeConflict();
    }
  }, [refresh, inline, closeConflict]);

  const handleConflictOverwrite = React.useCallback(async () => {
    if (!conflict || !canAtomic) {
      closeConflict();
      return;
    }
    setConflictBusy(true);
    try {
      // Re-key the write against the version the server reported in the 409 —
      // "I've seen the newer record, apply my whole draft on top of it."
      const draft = inline?.draft ?? {};
      const opts = conflict.currentVersion ? { ifMatch: conflict.currentVersion } : undefined;
      await updateVia(dataSource, objectName!, recordId!, draft, opts);
      await refresh?.();
      inline?.reset();
    } catch (err) {
      // Same presentation contract as the first save — an overwrite the server
      // refuses on validation grounds gets per-field reasons, not a raw string.
      presentRefusal(err);
    } finally {
      closeConflict();
    }
  }, [conflict, canAtomic, inline, dataSource, objectName, recordId, refresh, closeConflict, presentRefusal]);

  // Record-level keyboard shortcuts for the shared edit session
  // (objectui#2572 item 5): Cmd/Ctrl+Enter commits the draft, Esc cancels.
  // Installed only while editing. Esc defers to any open Radix layer
  // (popover / select / dropdown / dialog) — those own Escape for "close the
  // layer", so the session only cancels when nothing is stacked on top.
  // Both respect the in-flight `saving` state; save also respects `locked`
  // and stands down while the conflict dialog drives the session.
  const editing = !!inline?.editing;
  const saving = !!inline?.saving;
  const cancel = inline?.cancel;
  const conflictOpen = !!conflict;
  React.useEffect(() => {
    if (!editing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        if (saving || locked || conflictOpen) return;
        e.preventDefault();
        void handleSave();
        return;
      }
      if (e.key === 'Escape') {
        if (e.defaultPrevented || saving || conflictOpen) return;
        // An open floating layer (lookup/select popover, dropdown, dialog)
        // owns this Esc — let it close instead of tearing down the draft.
        if (
          document.querySelector(
            '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
          )
        ) {
          return;
        }
        e.preventDefault();
        cancel?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, saving, locked, conflictOpen, handleSave, cancel]);

  // Render nothing unless a provider is present and the record is being edited.
  if (!inline || !inline.editing) return null;

  const recordMessages =
    recordRefusal && recordRefusal.error === inline.error ? recordRefusal.messages : [];

  return (
    <>
      <div
        className={cn(
          'sticky bottom-0 z-30 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-md border bg-background/95 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80',
          className,
        )}
        role="region"
        aria-label={t('detail.editFieldsInline')}
        // objectui#12248: this bar sticks to the bottom edge with Save at its
        // right end, which is where a host's floating launcher sits (the
        // console assistant's button covered Save at 1440 wide). The marker
        // asks such chrome to step aside while the two overlap; the console's
        // `ConsoleChatbotFab` reads it. A DOM attribute, not a prop.
        data-fab-yield=""
      >
        {/* objectui#6868: a field-scoped refusal reads as one reason PER FIELD,
            named by the field's own label, instead of the raw server string.
            The SAME reasons are drawn beside each input by the field renderers
            (they read `fieldErrors` off this session); this summary stays
            because a rejected field can be collapsed or scrolled out of view —
            the reason `form.tsx` keeps its banner too. */}
        {inline.error && (
          <div
            role="alert"
            className="mr-auto max-w-md rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-xs text-destructive"
          >
            {inline.fieldErrors || recordMessages.length > 0 ? (
              <ul className="space-y-0.5">
                {Object.entries(inline.fieldErrors ?? {}).map(([field, message]) => (
                  <li key={field} data-inline-field-error={field}>
                    <span className="font-medium">{labelForField(field)}</span>
                    {': '}
                    {message}
                  </li>
                ))}
                {/* objectui#13292: record-level reasons name no field — the
                    rule's own sentence, with no label in front of it. */}
                {recordMessages.map((message, i) => (
                  <li key={`record-${i}`} data-inline-record-error="">
                    {message}
                  </li>
                ))}
              </ul>
            ) : (
              inline.error
            )}
          </div>
        )}
        {/* The lock REASON is surfaced by DetailView's approval-lock band; here
            we only disable Save so a locked record can't be written. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={inline.cancel}
          disabled={inline.saving}
          className="gap-2"
        >
          <X className="h-4 w-4" />
          <span>{t('detail.cancel')}</span>
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={handleSave}
          disabled={inline.saving || locked}
          className="gap-2"
          title={locked ? lockedHint : undefined}
        >
          {inline.saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          <span>{inline.saving ? t('detail.saving') : t('detail.save')}</span>
        </Button>
      </div>
      <ConcurrentUpdateDialog
        open={!!conflict}
        conflict={conflict}
        busy={conflictBusy}
        onCancel={closeConflict}
        onReload={handleConflictReload}
        onOverwrite={handleConflictOverwrite}
      />
    </>
  );
};

export default InlineEditSaveBar;
