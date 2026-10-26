/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * MasterDetailForm — enter a parent record together with its child "line
 * items" in a single screen, and persist them as one client-orchestrated
 * transaction (see ADR-0001).
 *
 * The parent fields are rendered by the existing <ObjectForm>; the child
 * collection(s) by <LineItemsField>. On submit we build ONE ordered
 * cross-object operation list — parent create/update as op 0, each child a
 * create/update/delete linked to it (via `{ $ref: 0 }` on create, or the
 * known parent id on edit) — and hand it to `dataSource.batchTransaction`
 * through {@link runBatchTransaction}. Client-side rollups are folded into the
 * parent payload so they commit in the same batch.
 *
 * The form is deliberately ignorant of atomicity: a server with the
 * transactional `/api/v1/batch` endpoint commits all-or-nothing, while an
 * adapter without one emulates the batch internally (sequential writes with
 * best-effort compensation, see `emulateBatchTransaction` in `@object-ui/core`).
 * Either way there is no master-detail-specific cleanup code here (ObjectStack
 * objectui #2679 / framework ADR-0034 item 4).
 *
 * No `@objectstack/spec` change: the relationship is a `master_detail` (or
 * `lookup`) FK on the child object.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BatchTransactionOperation, DataSource, GridFieldMetadata, I18nLabel } from '@object-ui/types';
import { resolveAffordance, runBatchTransaction } from '@object-ui/core';
import { LineItemsField, useBooleanValueLabel, type BooleanValueLabel, type GridColumn } from '@object-ui/fields';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, toast } from '@object-ui/components';
import {
  formatDisplayNumber,
  pickLocalized,
  resolveFieldCurrency,
  useDisplayLocale,
  useLocalization,
  useObjectTranslation,
} from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import { dataChangeMatches, subscribeDataChanges } from '@object-ui/react';
import { ObjectForm } from './ObjectForm';
import { applyColumnPermissions } from './fieldWriteGate';
import { useUploadGate, UploadGateProvider, UploadInFlightNotice } from './uploadGate';
import { useFormChromeTranslation } from './formChrome';
import {
  buildMasterDetailBatch,
  buildMasterDetailEditBatch,
  idOf,
  isBlankRow,
  sumRows,
  type BatchEditDetailInput,
  type ChildSchema,
} from './masterDetailTx';
import { isSameStoredValue } from './sanitize';
import { resolveInitialRecord } from './initialRecord';
import { sectionEntryName } from './sectionFields';
import { deriveDetail } from './deriveMasterDetail';
// objectui#11428 — the per-row form's offer test is the spec's rule.
import { isInlineRowFormOffered } from '@objectstack/spec/data';
// objectui#11396 — one `details` entry, by reference: the spec's own type for
// `ComponentPropsMap['object-master-detail-form'].details[]`. Type-only.
import type { ObjectMasterDetailFormProps } from '@objectstack/spec/ui';

/**
 * One detail collection: the `details` entry of
 * `ComponentPropsMap['object-master-detail-form']` in `@objectstack/spec`, on
 * its authoring face (`z.input`, what a document writes), taken by reference
 * rather than restated here (objectui#11396). Since 17.6.0 the spec judges that
 * entry as a closed shape (objectstack-ai/objectstack#21215): `childObject`
 * required, every other member optional, `columns` the spec's inline grid
 * column (the type the line grid's `GridColumn` is), an undeclared key refused
 * by name. `@object-ui/types` takes the whole props row by reference, so
 * `objectui validate` gives the spec's verdict on an entry; this is the
 * TypeScript face of that entry, and
 * `__tests__/masterDetailDetailsMembers-8071.test.tsx` holds the two equal at
 * compile time.
 *
 * ONE key is left off, and it is no longer a fork: `sortField`. This form
 * reads no such member — objectui#11070 round 9 retired the authored override:
 * the child field the grid stamps with each line's position is DERIVED from
 * the child object (`deriveDetail` picks its `position` / `sort_order` / …
 * field) and carried on the resolved entry, and row 2c of that test pins that a
 * written `sortField` is read by nothing. Through 17.6.0 the spec entry still
 * declared it; `@objectstack/spec` 17.7.0 retires it — a `retiredKey()`
 * tombstone on the entry (objectstack-ai/objectstack#21589, landed by PR
 * objectstack-ai/objectstack#21632 as `6ec54f00`) — so both published zod faces
 * refuse an authored `sortField` with the spec's retired-key message
 * (objectui#11717). The entry still LISTS the key as that tombstone, and the
 * omission below keeps it off this face rather than offer a member whose only
 * legal value is absence. That omission is the whole of what is hand-written
 * about the shape.
 *
 * Where each member lands — the renderer's reading, which the spec's
 * description does not carry:
 * - `childObject` names the child object; `relationshipField` is the FK on the
 *   child back to the parent, auto-detected from the child's `master_detail` /
 *   `lookup` field that references the parent when omitted.
 * - `columns` are the line grid's editable columns, derived from the child's
 *   fields (via `DataSource.getObjectSchema`) when omitted; `formFields` are
 *   the per-row expand form's field names (broader than `columns`: rich types
 *   included), derived likewise.
 * - `inlineMode`: `grid` = editable cells, `form` = read-only list + per-row
 *   full form; resolved from the relationship's `inlineEdit` (incl. the smart
 *   default) when omitted.
 * - `amountField` is the CHILD column summed, and reaches the grid as its
 *   `totalField`; `totalField` is the PARENT field the sum is saved to, and is
 *   not forwarded to the grid.
 * - `title` heads the collection's section (`Line Items` when unset);
 *   `minRows`, `maxRows` and `addLabel` reach the grid under the same names.
 */
export type MasterDetailDetailConfig = Omit<
  NonNullable<ObjectMasterDetailFormProps['details']>[number],
  'sortField'
>;

export interface MasterDetailFormSchema {
  type?: 'object-master-detail-form';
  /** Parent object name, e.g. 'expense_claim'. */
  objectName: string;
  mode?: 'create' | 'edit';
  /**
   * `string | number` to match `ObjectFormSchema` and the drawer/modal/split/
   * tabbed/wizard envelopes that hand a record straight through to this form —
   * a numeric primary key is a real backend shape. Narrowed to a string only at
   * the batch-transaction boundary, whose `BatchTransactionOperation.id` is a
   * string by protocol.
   */
  recordId?: string | number;
  /** Prefilled parent header values (create mode) — seeds the parent form's
   *  initial values, e.g. a conversion wizard carrying the lead/account over. */
  initialValues?: Record<string, any>;
  initialData?: Record<string, any>;
  /** Parent form sections/fields — passed straight through to ObjectForm. */
  sections?: any[];
  fields?: any[];
  formType?: 'simple' | 'tabbed';
  /**
   * `title`, `submitText` and `cancelText` are the spec's `I18nLabel`, as
   * `ComponentPropsMap['object-master-detail-form']` in `@objectstack/spec`
   * declares them: a plain string or an inline per-locale map such as
   * `{ en: 'Purchase order', 'zh-CN': '采购单' }`. The form resolves each one
   * with `pickLocalized` against the active UI language
   * (`useObjectTranslation().language`) before it reaches the screen
   * (objectui#10935).
   *
   * `title` names the record in the built-in edit-save toast ("… saved",
   * pack key `form.savedNamed`), which shows only when the host supplies no
   * `onSuccess`.
   */
  title?: I18nLabel;
  /** Label of the Save button. Defaults to the session locale's `common.save`
   *  (edit) or `form.create` ('Save' / 'Create' in English). */
  submitText?: I18nLabel;
  /** Label for the Cancel button in the action bar, which renders only when the
   *  host supplies `onCancel`. Defaults to the session locale's `common.cancel`
   *  ('Cancel' in English); an authored label, a string or a per-locale map,
   *  always wins (objectui#11039). */
  cancelText?: I18nLabel;
  /** Hide the bottom Save/Cancel action bar — e.g. a non-persisting design
   *  preview. Defaults to shown (the form owns the only Save in this layout). */
  showSubmit?: boolean;
  /** One or more child collections. */
  details: MasterDetailDetailConfig[];
  /** Parent header field holding a tax rate (percent). When the parent form has
   *  this field, a live Subtotal / Tax / Total stack renders under the lines.
   *  Defaults to `tax_rate`; the stack only appears if the field is present. */
  taxRateField?: string;
  onSuccess?: (parent: any) => void | Promise<void>;
  /**
   * Called after a refused save, for bookkeeping only (logging, custom focus
   * handling, …) — NOT for showing the failure to the user. The form
   * renderer already toasts every rejected write for any host `submitHandler`
   * (objectui#7354); a host that also toasts here puts the same refusal on
   * screen twice.
   */
  onError?: (err: Error) => void;
  onCancel?: () => void;
  className?: string;
}

/** Rows keyed by their persisted id (when known), for edit-mode diffing. */
interface RowState {
  rows: Record<string, any>[];
  /**
   * Snapshot of the persisted rows (edit mode) for diffing on submit. Two
   * writers: the children-fetch effect sets it from the read, and every
   * successful edit save advances it to what that save wrote
   * ({@link childRowsAfterSave}, objectui#10564).
   */
  original: Record<string, any>[];
}

/** One detail collection as the edit batch was built from it. */
interface SavedDetailInput {
  entryId: string;
  /** The exact input handed to `buildMasterDetailEditBatch`. */
  input: BatchEditDetailInput;
}

/**
 * What one SUCCESSFUL edit batch wrote to one detail collection: the child-row
 * form of `advanceLoadedRecord`, the parent record's baseline advance
 * (objectui#10156 / objectui#10564).
 */
interface SavedChildRows {
  entryId: string;
  /**
   * The `original` the batch diffed against. The advance lands only while it
   * is still the collection's baseline: a reload that replaced the row state
   * while the save was in flight has set a newer one.
   */
  diffedAgainst: Record<string, unknown>[];
  /** Each row the batch CREATED (the row object it was built from) → the id the server gave it. */
  createdIds: Map<object, unknown>;
  /** The baseline after the save: every persisted row, laid over with what this batch wrote to it. */
  original: Record<string, unknown>[];
}

/**
 * Whether a `create` operation's payload was built from `row`: every field it
 * writes, other than the parent link the builder sets, holds the row's value.
 * The builder only drops keys from a row (sanitize) and never rewrites one.
 */
function isBuiltFrom(
  data: Record<string, unknown> | undefined,
  row: Record<string, unknown>,
  relationshipField: string,
): boolean {
  return Object.entries(data ?? {}).every(
    ([k, v]) => k === relationshipField || isSameStoredValue(v, row[k]),
  );
}

/**
 * The child rows' baseline after an edit batch COMMITTED (objectui#10564).
 *
 * A form that stays mounted after a save must not diff its next save against
 * the rows as FIRST read. Against that stale baseline a row the save created
 * is still id-less and is created again; a row the save deleted is deleted
 * again; and a cell changed back to its first-read value compares clean and is
 * dropped while the server keeps the saved value.
 *
 * Two facts come from the batch, and nothing is inferred beyond them:
 *
 * - **Ids.** `batchTransaction` answers `results` index-aligned with the
 *   operations, a create echoing the record it wrote (`DataSource`'s contract;
 *   the server's `/batch` and `emulateBatchTransaction` both do). The edit
 *   builder puts the parent at index 0 and then, collection by collection in
 *   the order it was handed them, one `create` per non-blank row without an
 *   id, in row order. Each such row is paired with the next create operation,
 *   and the pair is checked ({@link isBuiltFrom}) before it is trusted. A pair
 *   that does not check out stops the pairing: the rows left unpaired stay
 *   creates, which is the behaviour before this advance, never a row updating
 *   another row's record. A create echo without an id leaves its row a create
 *   too.
 * - **Written values.** What the batch sent, laid over the row as read — the
 *   same rule `advanceLoadedRecord` applies to the parent. A row the batch
 *   deleted leaves the baseline; a row it did not touch keeps its snapshot.
 *
 * Pure, and it does not throw: it runs between a committed batch and the
 * parent's own advance, where a throw would report a save that landed as a
 * failure.
 */
function childRowsAfterSave(
  ops: BatchTransactionOperation[],
  results: unknown,
  details: SavedDetailInput[],
): SavedChildRows[] {
  const echoes = Array.isArray(results) ? results : [];
  const creates: Array<{ op: BatchTransactionOperation; echo: unknown }> = [];
  ops.forEach((op, k) => {
    if (k > 0 && op.action === 'create') creates.push({ op, echo: echoes[k] });
  });
  let nextCreate = 0;
  let pairingLost = false;

  const saved = details.map(({ entryId, input }): SavedChildRows => {
    const { childObject, relationshipField } = input;
    const rows = input.rows || [];
    const original = input.original || [];
    const createdIds = new Map<object, unknown>();
    const written = new Map<unknown, Record<string, unknown>>();

    for (const row of rows) {
      if (pairingLost) break;
      if (idOf(row) != null || isBlankRow(row, relationshipField)) continue;
      const pair = creates[nextCreate];
      if (!pair || pair.op.object !== childObject || !isBuiltFrom(pair.op.data, row, relationshipField)) {
        pairingLost = true;
        break;
      }
      nextCreate += 1;
      const id = idOf(pair.echo);
      if (id == null) continue;
      createdIds.set(row, id);
      written.set(id, pair.op.data ?? {});
    }
    for (let k = 1; k < ops.length; k++) {
      const op = ops[k];
      if (op.action === 'update' && op.object === childObject && op.id != null) {
        written.set(op.id, op.data ?? {});
      }
    }

    const before = new Map<unknown, Record<string, unknown>>();
    for (const r of original) {
      const id = idOf(r);
      if (id != null) before.set(id, r);
    }
    const next: Record<string, unknown>[] = [];
    for (const row of rows) {
      const id = idOf(row) ?? createdIds.get(row);
      if (id == null) continue;
      const was = before.get(id);
      const wrote = written.get(id);
      if (!was && !wrote) continue;
      const entry: Record<string, unknown> = { ...(was ?? {}), ...(wrote ?? {}) };
      if (idOf(entry) == null) entry.id = id;
      next.push(entry);
    }
    return { entryId, diffedAgainst: input.original, createdIds, original: next };
  });

  if (pairingLost || nextCreate !== creates.length) {
    console.warn(
      '[MasterDetailForm] could not pair every row created by this save with its create operation; an unpaired row keeps no id, and the next save creates it again.',
    );
  }
  return saved;
}

/**
 * What happened to one detail entry's schema resolution (objectui#6372).
 *
 * A plain `MasterDetailDetailConfig[]` cannot express this. An entry whose
 * fetch FAILED and one that is STILL IN FLIGHT are represented identically —
 * both are simply an entry with no `columns` — so the renderer showed the same
 * "Loading columns…" for both. For the failed one that message never ends: the
 * fetch that would have supplied those columns has already failed and is not
 * retried, so nothing can ever replace it.
 */
type DetailResolution =
  /** The schema fetch has not settled yet — "Loading columns…" is TRUE here. */
  | 'pending'
  /** No `childObject` was authored, so no fetch was made (objectui#5940). */
  | 'declined'
  /** Columns are hydrated, or were fully authored to begin with. */
  | 'ready'
  /** The schema fetch THREW — columns can never arrive (objectui#6372). */
  | 'failed'
  /**
   * The schema LOADED FINE, but `deriveDetail` threw on it (objectui#6394) —
   * almost always "no lookup/master_detail field on the child references the
   * parent". A CONFIGURATION error, not a load error, which is why it is a
   * state of its own rather than a second reading of `failed`: the remedy is a
   * key the author writes (`relationshipField`), not a reload, and the two
   * placeholders must not borrow each other's copy.
   */
  | 'underivable';

/**
 * One authored detail collection, plus the two pieces of per-entry metadata a
 * bare `MasterDetailDetailConfig[]` could not carry: WHICH entry this is, and
 * WHAT happened to it.
 *
 * ⭐ Both defects this record closes came from the same absence. With no
 * per-entry metadata, "what happened to this entry" (objectui#6372) and "which
 * entry is this" (objectui#6371) were BOTH inferred from the entry's position
 * in the array. One record answers both, which is why they land together:
 * either one alone would have reshaped this structure and the second would
 * then have rewritten the first.
 */
interface DetailEntry {
  /**
   * Stable identity, synthesized ONCE from the incoming config — never the map
   * index of the rendered array. See {@link synthesizeDetailIds}.
   */
  id: string;
  /** The authored config, with derived columns / FK folded in once resolved. */
  config: MasterDetailDetailConfig;
  status: DetailResolution;
  /**
   * The child field the line grid stamps with each line's position, so a
   * drag-reorder persists: `deriveDetail`'s pick (the child object's
   * `position` / `sort_order` / … field), handed to the grid as `sortField`.
   * Derived only, never authored (objectui#11070 round 9), so it lives here
   * beside the other resolved state rather than on the authored config. Absent
   * when the entry was not derived (a fully configured entry loads no child
   * schema) or the child has no such field.
   */
  sortField?: string;
  /**
   * The child object's own definition of `config.amountField`, kept from the
   * schema the resolve effect loaded, so the document totals stack can read the
   * amount's currency off the FIELD (objectui#11132). Absent when no schema was
   * loaded for this entry (a fully configured entry skips the fetch) or the
   * child declares no such field; the stack then resolves to the tenant's
   * currency. Internal state, never part of the authored config.
   */
  amountFieldDef?: CurrencyFieldDef;
  /**
   * The resolve effect's column derivation for this entry, re-runnable with
   * another `booleanLabel` (objectui#12924): the same `deriveDetail` call over
   * the same child schema and authored config. The line grid's columns are
   * drawn through it at render, keyed on the session's two boolean words, so
   * a catalogue that lands after the child schema re-labels a derived
   * `boolean` / `toggle` column's options without re-running the effect.
   * Absent when the entry was not derived. Internal state, never part of the
   * authored config.
   */
  columnsWith?: (booleanLabel: BooleanValueLabel) => GridColumn[];
}

/** The field shape `resolveFieldCurrency` reads — the one currency resolver. */
type CurrencyFieldDef = Parameters<typeof resolveFieldCurrency>[0];

/**
 * The child object's definition of `fieldName`, or `undefined` when the name is
 * unset or the child declares no such field.
 */
function childFieldDef(
  childSchema: { fields?: Record<string, unknown> } | undefined,
  fieldName: string | undefined,
): CurrencyFieldDef {
  if (!fieldName) return undefined;
  const def = childSchema?.fields?.[fieldName];
  return def && typeof def === 'object' ? (def as CurrencyFieldDef) : undefined;
}

/**
 * The currency the document totals stack is denominated in (objectui#11132).
 *
 * Each entry that switches the stack on (one with an `amountField`) resolves its
 * amount's currency through `resolveFieldCurrency`, the one precedence every
 * currency face shares: the field's fixed currency, else the tenant default.
 * ⛔ No constant: the stack used to print a literal `¥` whatever either said.
 *
 * The stack adds every entry's amounts into ONE subtotal, so it has one
 * currency only when every entry resolves to the same code. When they differ,
 * or none is known, this answers `undefined` and the stack shows plain numbers,
 * the resolver's own answer for an amount with no known currency: never a
 * guessed sign.
 */
function totalsCurrency(entries: DetailEntry[], tenantCurrency: string | undefined): string | undefined {
  const codes = new Set(
    entries
      .filter((e) => !!e.config.amountField)
      .map((e) => resolveFieldCurrency(e.amountFieldDef, tenantCurrency)),
  );
  return codes.size === 1 ? codes.values().next().value : undefined;
}

/**
 * The fraction width of a totals line with no currency: the historical two
 * places the stack always showed, which is also `CurrencyField`'s width when
 * no currency resolves.
 */
const PLAIN_AMOUNT_DIGITS = 2;

/**
 * One line of the document totals stack, in the display locale (objectui#9909).
 *
 * With a currency, the amount is `Intl`'s own currency format through
 * `formatDisplayNumber`, the formatter the line grid's currency cells use. So
 * the sign sits where the locale puts it (`$1,234.50`, `1.234,50 $` in de-DE)
 * and the width is the currency's ISO 4217 minor unit, the default `Intl`
 * applies to `style: 'currency'`: 2 for USD, 0 for JPY, 3 for KWD. A
 * currency's decimal places are the currency's, not a setting.
 *
 * Without one, a plain number at {@link PLAIN_AMOUNT_DIGITS}. A code `Intl`
 * refuses (`RangeError: Invalid currency code`) is shown as the code beside
 * that plain number, as `CurrencyField` and the grid cells show one, rather
 * than taking the form down; the digits stay in the display locale.
 */
function formatTotalsAmount(n: number, currency: string | undefined, locale: string): string {
  const plain = () =>
    formatDisplayNumber(n, { locale, minimumFractionDigits: PLAIN_AMOUNT_DIGITS, maximumFractionDigits: PLAIN_AMOUNT_DIGITS });
  if (!currency) return plain();
  try {
    return formatDisplayNumber(n, { locale, currency });
  } catch {
    return `${currency} ${plain()}`;
  }
}

/**
 * Give every authored detail entry an identity that does not change when a
 * SIBLING moves.
 *
 * ## The hazard, stated correctly
 *
 * ⛔ The old key — `${d.childObject}` joined to the map index — did NOT
 * collide. The index is unique among siblings by construction, so two declined
 * details keyed as `undefined-0` and `undefined-1`: distinct, no React
 * duplicate-key warning, no remount collision. Anyone re-deriving this starts
 * from the INDEX-IDENTITY hazard, never from a collision claim (objectui#6371
 * corrects the record on that point).
 *
 * The real defect: for a declined entry the DATA half of that key is
 * `undefined`, so the entry's identity was purely its POSITION — and the
 * row-state store was addressed the same way. Reordering or removing an entry
 * therefore re-associated a collection's DOM node, its rows, AND its
 * contribution to the document subtotal with a different collection.
 *
 * ## What the identity is
 *
 * A named collection is identified by the child object it lists: the half of
 * the old key that actually carried data, and the half that survives a
 * reorder. A DECLINED entry has no such half — the decline is precisely the
 * absence of one — so its identity is its AUTHORED POSITION in the incoming
 * `details` array, synthesized here, once, at config time.
 *
 * Two collections may legitimately list the SAME child object, so an
 * occurrence counter separates them without sending the named case back to
 * position. Two entries indistinguishable in the config stay indistinguishable
 * here: that ambiguity is authored, not introduced.
 */
function synthesizeDetailIds(raw: MasterDetailDetailConfig[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((d, authoredPosition) => {
    // The prefixes keep the two namespaces apart, so a child object literally
    // named `pos:0` cannot take a declined entry's identity.
    const base = d.childObject ? `obj:${d.childObject}` : `pos:${authoredPosition}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    return nth === 0 ? base : `${base}~${nth}`;
  });
}

/**
 * objectui#10853 — `useDataInvalidation` (`@object-ui/react`) for a SET of
 * objects: each name's nonce moves once per change the data-invalidation bus
 * reports for it.
 *
 * The edit-mode lines read one child object per detail collection, and the
 * collections are authored, so there is no fixed number of hook calls to make.
 * This is the same bus and the same test, not a second channel:
 * `subscribeDataChanges` is the listener set `useDataInvalidation` subscribes
 * through, and `dataChangeMatches` its matcher. It is applied object-level (no
 * `recordId`), because a collection is many records of its object.
 *
 * Keyed on the set's CONTENT, so a fresh array of the same names neither
 * resubscribes nor resets a nonce (AGENTS.md #10).
 */
function useObjectsInvalidation(objectNames: readonly string[]): Readonly<Record<string, number>> {
  const namesKey = JSON.stringify(Array.from(new Set(objectNames)).sort());
  const [nonces, setNonces] = useState<Record<string, number>>({});
  useEffect(() => {
    const names = JSON.parse(namesKey) as string[];
    if (names.length === 0) return;
    const unsubscribe = subscribeDataChanges((change) => {
      const hit = names.filter((name) => dataChangeMatches(change, name));
      if (hit.length === 0) return;
      setNonces((prev) => {
        const next = { ...prev };
        for (const name of hit) next[name] = (next[name] ?? 0) + 1;
        return next;
      });
    });
    return () => {
      unsubscribe();
    };
  }, [namesKey]);
  return nonces;
}

/**
 * objectui#10853 — whether one collection holds lines the user has not saved:
 * the edit save's own row diff (`buildMasterDetailEditBatch`) finds something
 * to write to it OTHER than the parent link. A user's edit therefore reads as
 * unsaved exactly when the save would send it, and a line changed back to its
 * stored value (a revert) reads as saved again.
 *
 * The parent link is set aside on purpose, and it is the one place the two
 * disagree. The save restates the link on every row it writes, as the parent
 * id in string form, and a row read back can carry it in another form (a
 * numeric id, an expanded lookup); against such a backend the save restates it
 * on every row while this reads the lines as saved. That restatement is not the
 * user's input, so it does not hold a re-read.
 */
function linesUnsaved(
  state: RowState | undefined,
  detail: MasterDetailDetailConfig,
  parentId: string,
  childSchema: ChildSchema,
): boolean {
  if (!state || !detail.relationshipField) return false;
  const relationshipField = detail.relationshipField;
  const ops = buildMasterDetailEditBatch('', parentId, {}, [
    {
      childObject: detail.childObject,
      relationshipField,
      rows: state.rows,
      original: state.original.map((row) => ({ ...row, [relationshipField]: parentId })),
      childSchema,
    },
  ]);
  // Op 0 is the (empty) parent update the builder always leads with.
  return ops.length > 1;
}

/**
 * The header's RECORD, as the header itself obtained it (objectui#13062): the
 * record its edit-mode read answered, or the record a create form opens on;
 * and the header object's FIELD NAMES, as its schema read answered them.
 *
 * The line grids evaluate their `parent.*` rules against the record, and the
 * totals stack asks whether the header carries the tax-rate field. Before
 * #13062 both read a DOM scrape of the header taken at mount and on three
 * timers (120 / 360 / 800 ms), so a header that answered later than the last
 * tick left `parent` empty: a stored paid invoice opened with its locked line
 * cells editable.
 *
 * A listener set, not React state in <MasterDetailForm>: a landing reaches only
 * <MasterDetailLines>, and never re-renders the header <ObjectForm> (#1581).
 */
interface HeaderRecordFeed {
  /** The latest record; read by a subscriber that mounts after a landing. */
  record: Record<string, unknown>;
  /** The header object's field names, once its schema read has answered. */
  objectFields: readonly string[] | null;
  /** Bumped per header record read started, so only the newest answer lands. */
  seq: number;
  listeners: Set<(landed: 'record' | 'objectFields') => void>;
}

function createHeaderRecordFeed(opening: Record<string, unknown>): HeaderRecordFeed {
  return { record: opening, objectFields: null, seq: 0, listeners: new Set() };
}

/**
 * The data source the header <ObjectForm> reads through, observing the two
 * reads that ARE the header's record and field set: `findOne(objectName,
 * recordId)` and `getObjectSchema(objectName)`. The header's own value channels
 * do not carry them. <ObjectForm> forwards no value callback to its host, and
 * the form renderer's `onChange` keeps a `defaultValues` reset (the record
 * landing) off its channel by design (#2968, #5235). The read itself is the
 * moment the record lands, and every re-read of it (a data-invalidation
 * re-read, a remount) lands here too.
 *
 * Every call is passed through untouched: the same arguments, the same
 * promise back (its rejection still reaches the header), with `this` the
 * caller's own data source. A read of any other record or object (a lookup's
 * display read, say) is not observed.
 */
function observeHeaderReads(
  dataSource: DataSource | undefined,
  objectName: string,
  recordId: string | number | undefined,
  feed: HeaderRecordFeed,
): DataSource | undefined {
  if (!dataSource) return dataSource;
  const readsRecord = recordId !== undefined && recordId !== null && recordId !== '';
  const bound = new Map<PropertyKey, unknown>();
  const observe = (answer: unknown, land: (value: unknown) => void) => {
    // The header reports its own failed read; nothing lands here.
    Promise.resolve(answer).then(land, () => undefined);
  };
  return new Proxy(dataSource, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      if (!bound.has(prop)) {
        const call = (args: unknown[]) => (value as (...a: unknown[]) => unknown).apply(target, args);
        let wrapped: unknown;
        if (prop === 'findOne' && readsRecord) {
          wrapped = (...args: unknown[]) => {
            const answer = call(args);
            if (args[0] === objectName && String(args[1]) === String(recordId)) {
              const seq = ++feed.seq;
              observe(answer, (record) => {
                if (seq !== feed.seq) return; // a newer read superseded this one
                feed.record = (record ?? {}) as Record<string, unknown>;
                feed.listeners.forEach((listener) => listener('record'));
              });
            }
            return answer;
          };
        } else if (prop === 'getObjectSchema') {
          wrapped = (...args: unknown[]) => {
            const answer = call(args);
            if (args[0] === objectName) {
              observe(answer, (objectSchema) => {
                const fields = (objectSchema as { fields?: Record<string, unknown> } | null)?.fields;
                feed.objectFields = fields ? Object.keys(fields) : [];
                feed.listeners.forEach((listener) => listener('objectFields'));
              });
            }
            return answer;
          };
        } else {
          wrapped = (value as (...a: unknown[]) => unknown).bind(target);
        }
        bound.set(prop, wrapped);
      }
      return bound.get(prop);
    },
  });
}

/**
 * The header fields an author DECLARED for the form — its `sections`' members,
 * else its `fields` — or null when it declares none and the header draws the
 * object's own field set. The same precedence <ObjectForm> draws by.
 */
function declaredHeaderFields(schema: {
  sections?: ReadonlyArray<{ fields?: unknown[] } | null | undefined>;
  fields?: unknown[];
}): string[] | null {
  const names = (entries: unknown[] | undefined) =>
    (entries ?? []).map(sectionEntryName).filter((n): n is string => typeof n === 'string');
  if (schema.sections?.length) return schema.sections.flatMap((section) => names(section?.fields));
  if (schema.fields?.length) return names(schema.fields);
  return null;
}

/**
 * Read the header's controls as the user edits them, by scraping the named
 * controls of the rendered parent-form host. It runs ONLY on the host's
 * bubbling `input` / `change` events, overlaid on the header record above: the
 * header is owned by react-hook-form (inside <ObjectForm>), which exposes no
 * values callback to this host. Radix <Select> renders a visually-hidden native
 * `<select name=...>` for form participation, so selects (e.g. an invoice
 * `status`) are captured too, and a user's pick dispatches a bubbling `change`
 * the host listener catches.
 */
function scrapeHeaderRecord(host: HTMLElement | null): Record<string, unknown> {
  if (!host) return {};
  const out: Record<string, unknown> = {};
  const els = host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]');
  els.forEach((el) => {
    const name = el.getAttribute('name');
    if (!name) return;
    if (el.tagName === 'INPUT') {
      const input = el as HTMLInputElement;
      if (input.type === 'checkbox') { out[name] = input.checked; return; }
      if (input.type === 'radio') { if (input.checked) out[name] = input.value; return; }
      if (input.type === 'number' || input.type === 'range') {
        if (input.value === '') { out[name] = null; return; }
        const n = Number(input.value);
        out[name] = Number.isFinite(n) ? n : input.value;
        return;
      }
      out[name] = input.value;
      return;
    }
    // <select> (incl. Radix's hidden native select) and <textarea>.
    out[name] = (el as HTMLSelectElement | HTMLTextAreaElement).value;
  });
  return out;
}

/**
 * A configuration hint's pack sentence, with each `{{hole}}` rendered as code
 * (objectui#11160).
 *
 * The three collection hints below name what the author has to find or set: a
 * property (`childObject`, `relationshipField`) or an object's name. Those stay
 * code and are never translated, so the pack sentence carries a hole for each.
 * The caller asks `t` for the sentence with every hole filled by itself, and
 * this splits the text on the holes and puts each one's value in its place, in
 * whatever order the locale's word order puts them. `LineItemsPanel`'s
 * `form.lineItems.noChildObject` split is the one-hole form of the same move.
 */
function withCodeHoles(sentence: string, holes: Record<string, string | undefined>): React.ReactNode[] {
  const names = Object.keys(holes);
  const pattern = new RegExp(`(${names.map((name) => `\\{\\{${name}\\}\\}`).join('|')})`);
  return sentence.split(pattern).map((part, i) => {
    const name = names.find((n) => part === `{{${n}}}`);
    return name === undefined ? part : (
      <code key={i} className="font-mono">{holes[name]}</code>
    );
  });
}

interface MasterDetailLinesProps {
  entries: DetailEntry[];
  /** Row state addressed by ENTRY ID, never by array position (objectui#6371). */
  rowState: Record<string, RowState>;
  setRows: (entryId: string, rows: Record<string, any>[]) => void;
  /**
   * A save is in flight: every grid takes no input (objectui#10631). A created
   * row takes its echoed id by identity with the row object the batch was built
   * from, and a grid with a sort field maps EVERY row to a new object on any
   * change, so a single keystroke during the save would leave every row it
   * created without its id.
   */
  saving: boolean;
  /** Host wrapping the header <ObjectForm> — scraped on the user's edits. */
  formHostRef: React.RefObject<HTMLDivElement | null>;
  taxRateField: string;
  /**
   * The header's record and object field set (objectui#13062). A new feed per
   * record and per header remount (after create), which drops the edits
   * scraped against the old one.
   */
  headerRecord: HeaderRecordFeed;
  /** The header fields the author declared, or null for the object's own set. */
  declaredHeaderFieldNames: readonly string[] | null;
  onRowExpand: (entryId: string, rowIdx: number) => void;
  onAddViaForm: (entryId: string) => void;
  /**
   * The PARENT object's name, for the `underivable` config hint — "which parent
   * this collection could not be linked to" is half the diagnosis, and the
   * entry's own config cannot carry it (objectui#6394).
   */
  parentObjectName: string;
  /**
   * The form's mode, which picks the question the child grids' cells ask
   * (objectui#12082): every line of a CREATE form is a new child record, so its
   * cells ask the create question (the server's insert rule); an edit form's
   * lines may already exist, and a per-column lock cannot split per row, so
   * they keep the edit question. For the same reason only an edit form's
   * Remove asks the child's delete grant: a create form's lines are drafts.
   */
  formMode: 'create' | 'edit';
}

/**
 * The line-item grids + document totals, isolated from the header form.
 *
 * It owns `parentRecord` — the header's record (`headerRecord`) with the user's
 * live edits scraped from the form host over it — and binds it to every grid as
 * `contextRecord`, so a column's `readonlyWhen` / `requiredWhen` CEL rule can
 * react to the header (the "paid invoice → lock lines" case,
 * `parent.status == 'paid'`; see #1581 / ADR-0036).
 *
 * Holding `parentRecord` HERE rather than in <MasterDetailForm> is the whole
 * point: a header keystroke re-renders only these lines, never the header
 * <ObjectForm> whose react-hook-form state would otherwise reset mid-edit. The
 * scrape is deduped by value so an identical re-read causes no state churn.
 */
const MasterDetailLines: React.FC<MasterDetailLinesProps> = ({
  entries,
  rowState,
  setRows,
  saving,
  formHostRef,
  taxRateField,
  headerRecord,
  declaredHeaderFieldNames,
  onRowExpand,
  onAddViaForm,
  parentObjectName,
  formMode,
}) => {
  // The subtotal / tax / grand-total stack formats in the display locale; it
  // used to pass `toLocaleString` an explicit `undefined`, i.e. the MACHINE's
  // locale (objectui#9909).
  const displayLocale = useDisplayLocale();
  // The tenant default currency (ADR-0053): the totals stack's currency when
  // the amount field fixes none (objectui#11132).
  const { currency: tenantCurrency } = useLocalization();
  // The collection placeholder, the document totals stack and the in-form
  // collection's default add label, in the session locale (objectui#11071).
  // Since objectui#11145 also a collection's heading when it authors no
  // `title`: the key the record page's line-items panel reads for its own.
  // Since objectui#11160 also the three collection hints (no `childObject`,
  // a schema that failed to load, no relationship field to the parent).
  const { t } = useFormChromeTranslation();
  // The caller's field-level grants on each CHILD object. With no provider
  // mounted this is the fail-open answer (`isLoaded` false) and every grid below
  // renders exactly as it did before permissions existed (objectui#10163).
  const perms = usePermissions();
  // The header's record, whenever it lands (objectui#13062) — no timer bounds
  // it, so a header that answers late still locks a paid invoice's lines.
  const [loadedRecord, setLoadedRecord] = useState<Record<string, unknown>>(headerRecord.record);
  const [objectFields, setObjectFields] = useState<readonly string[] | null>(headerRecord.objectFields);
  // The user's edits, scraped from the host on its input/change events; null
  // until the first one. A landing record replaces the form's values, so it
  // drops them.
  const [editedRecord, setEditedRecord] = useState<Record<string, unknown> | null>(null);
  const editedKeyRef = useRef<string>('');

  useEffect(() => {
    const land = (landed: 'record' | 'objectFields') => {
      if (landed === 'objectFields') {
        setObjectFields(headerRecord.objectFields);
        return;
      }
      editedKeyRef.current = '';
      setEditedRecord(null);
      setLoadedRecord(headerRecord.record);
    };
    // What landed before this subscription (or a new feed's opening).
    land('record');
    land('objectFields');
    headerRecord.listeners.add(land);
    return () => {
      headerRecord.listeners.delete(land);
    };
  }, [headerRecord]);

  useEffect(() => {
    const host = formHostRef.current;
    if (!host) return;
    const onEvt = () => {
      const next = scrapeHeaderRecord(host);
      let key: string;
      try { key = JSON.stringify(next); } catch { key = String(Math.random()); }
      if (key === editedKeyRef.current) return; // value-identical → no re-render
      editedKeyRef.current = key;
      setEditedRecord(next);
    };
    host.addEventListener('input', onEvt);
    host.addEventListener('change', onEvt);
    return () => {
      host.removeEventListener('input', onEvt);
      host.removeEventListener('change', onEvt);
    };
  }, [formHostRef]);

  const parentRecord = useMemo(
    () => (editedRecord ? { ...loadedRecord, ...editedRecord } : loadedRecord),
    [loadedRecord, editedRecord],
  );

  // Document totals: Subtotal (Σ line amounts) → Tax (header rate %) → Total.
  // Shown only when the header carries the tax-rate field AND a detail has an
  // amount column; otherwise each grid keeps its own footer total.
  // "The header carries the field" is the header's field set, not whether the
  // record happens to hold a value for it (objectui#13062).
  const headerCarriesTax =
    Object.prototype.hasOwnProperty.call(parentRecord, taxRateField) ||
    (declaredHeaderFieldNames ?? objectFields ?? []).includes(taxRateField);
  const taxRaw = parentRecord[taxRateField];
  const taxRate = !headerCarriesTax ? null : (Number.isFinite(Number(taxRaw)) ? Number(taxRaw) : 0);
  // ⚠️ Addressed by ENTRY ID. This reducer read `state[i]` — so a reorder did
  // not merely show a collection the wrong grid, it MIS-COMPUTED the document
  // total: each entry summed a different collection's rows, under its own
  // `amountField` (objectui#6371).
  const subtotal = entries.reduce(
    (acc, e) => acc + sumRows(rowState[e.id]?.rows ?? [], e.config.amountField || 'amount'),
    0,
  );
  const showTaxStack = taxRate !== null && entries.some((e) => !!e.config.amountField);
  const taxPct = taxRate ?? 0;
  const taxAmount = subtotal * (taxPct / 100);
  const grandTotal = subtotal + taxAmount;
  // The amounts' own currency, else the tenant's; never a constant sign
  // (objectui#11132). See `totalsCurrency` and `formatTotalsAmount`.
  const currency = totalsCurrency(entries, tenantCurrency);
  const money = (n: number) => formatTotalsAmount(n, currency, displayLocale);

  return (
    <>
      {/* Line items below the header. Rendered as a light section (label + the
          grid's own bordered table) rather than a heavy Card — a Card here would
          double-frame the grid and its p-6 padding wastes the width the line
          table needs. */}
      {entries.map((entry) => {
        const d = entry.config;
        // objectui#12082 — adding and removing a line are rows of the
        // affordance-to-grant map, asked of the CHILD object, the same two
        // rows `LineItemsPanel` reads for the same two writes: a new line is a
        // child created under this parent (`relatedNew`), a removed line a
        // child deleted (`relatedRowDelete`). Each is the child's policy, its
        // effective operation set and the caller's grant on it; the policy half
        // reads the default bucket, since a fully configured entry loads no
        // child schema into this render. Remove asks only on an EDIT form: a
        // create form's batch holds nothing but creates
        // (`buildMasterDetailBatch`), so a line removed there is a draft dropped
        // before it is ever written, never a server delete. With no permission
        // provider mounted both read open, as before.
        const lineSource = { objectSchema: null, objectName: d.childObject, perms };
        const lineAddGranted = resolveAffordance('relatedNew', lineSource).allowed;
        const lineRemoveGranted =
          formMode === 'create' || resolveAffordance('relatedRowDelete', lineSource).allowed;
        return (
        // Keyed on the entry's SYNTHESIZED identity, not on the map index. The
        // old key put `d.childObject` — `undefined` for a declined entry —
        // ahead of the index, which left such a section with no identity beyond
        // its position, so a sibling moving above it re-associated the section
        // and its rows with a different collection (objectui#6371).
        <section key={entry.id} className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">{d.title || t('form.lineItems.title')}</h3>
          {/* A detail whose child object never resolved gets its OWN branch,
              ahead of the columns/loading one (objectui#6360) — the render half
              of the decline at `MasterDetailForm`'s resolve effect, and the same
              shape `LineItemsPanel` takes for this exact key (objectui#6194)
              following objectui#5940's config-hint precedent. It must not sit on
              "Loading columns…": the decline is precisely the guarantee that
              those columns can never arrive, so the spinner-shaped message is
              permanently, unfixably wrong and never names the key the author has
              to set. Checked BEFORE the columns arm because nothing is pending —
              there is no first paint where "loading" is true. */}
          {!d.childObject ? (
            <p
              className="py-4 text-sm text-muted-foreground"
              data-testid="md-detail-no-child-object"
            >
              {withCodeHoles(
                t('form.masterDetail.noChildObject', { property: '{{property}}' }),
                { property: 'childObject' },
              )}
            </p>
          ) : entry.status === 'failed' ? (
            /* The OTHER arm of the same resolver (objectui#6372). This entry
               DOES name a child object, so it skips the config hint above — and
               before this branch existed it fell through to "Loading columns…"
               and stayed there forever, because the fetch that would have
               supplied those columns already failed and is not retried.
               Distinguishing it from a genuinely-pending entry is exactly what
               `entry.status` exists for: on a bare `MasterDetailDetailConfig[]`
               the two states are identical (no `columns`).
               Shaped on `AdvancedChartImpl`'s refusal placeholders — a refusal
               is a state, not an alert, so `role="status"` — and it NAMES the
               child object, because "which collection refused" is the whole
               diagnosis for the author reading it. */
            <p
              className="py-4 text-sm text-muted-foreground"
              role="status"
              data-testid="md-detail-schema-unavailable"
            >
              {withCodeHoles(
                t('form.masterDetail.schemaUnavailable', { object: '{{object}}' }),
                { object: d.childObject },
              )}
            </p>
          ) : entry.status === 'underivable' ? (
            /* The THIRD arm of the same resolver (objectui#6394): the schema
               LOADED, and `deriveDetail` then threw on it — no lookup /
               master_detail field on the child references the parent. Before
               this branch existed it fell through to "Loading columns…" and
               stayed there forever, exactly like the two arms above, because
               the derive is not retried either.
               ⛔ NOT the refusal placeholder above: that one states the schema
               could not be LOADED, which is false here — "dishonest copy for a
               schema that loaded fine" (objectui#6394 triage). This is a
               CONFIGURATION error with a named remedy, so it takes the config
               hint shape of the `!d.childObject` branch (objectui#5940 /
               objectui#6360) and NAMES `relationshipField` as the key to set —
               the same key the thrown message names, which is why that error is
               also logged rather than discarded. */
            <p
              className="py-4 text-sm text-muted-foreground"
              data-testid="md-detail-no-relationship-field"
            >
              {withCodeHoles(
                t('form.masterDetail.noRelationshipField', {
                  object: '{{object}}',
                  parent: '{{parent}}',
                  property: '{{property}}',
                }),
                { object: d.childObject, parent: parentObjectName, property: 'relationshipField' },
              )}
            </p>
          ) : !d.columns?.length ? (
            <p className="py-4 text-sm text-muted-foreground">{t('form.masterDetail.loadingColumns')}</p>
          ) : (
            <LineItemsField
              value={rowState[entry.id]?.rows ?? []}
              onChange={(rows) => setRows(entry.id, rows)}
              // The grid's own `disabled`: cells locked, and no ghost row, add,
              // duplicate, remove or reorder while the save is in flight
              // (objectui#10631). Its row "expand" control stays; the editor it
              // opens is held by the same state in <MasterDetailForm>.
              disabled={saving}
              // The live header record — a line cell's readonlyWhen/requiredWhen
              // CEL rule evaluates against it as `parent` (e.g. lock when
              // parent.status == 'paid').
              contextRecord={parentRecord}
              // Per-row "expand to full form" is offered when it adds something:
              // always in form mode (it IS the editor), and in grid mode only
              // when the full form has fields the grid omits. A thin grid whose
              // columns already cover every field (e.g. invoice lines) shows no
              // redundant expand button. The test is `@objectstack/spec`'s
              // `isInlineRowFormOffered` (objectui#11428), asked with the
              // collection's RESOLVED form factor and lists, authored or derived.
              {...(isInlineRowFormOffered({ inlineMode: d.inlineMode, formFields: d.formFields, columns: d.columns })
                ? { onRowExpand: (rowIdx: number) => onRowExpand(entry.id, rowIdx) }
                : {})}
              displayMode={d.inlineMode === 'form' ? 'list' : 'grid'}
              {...(d.inlineMode === 'form' ? { onAdd: () => onAddViaForm(entry.id) } : {})}
              field={
                ({
                  // FLS gate, through the ONE render pass `LineItemsPanel` and
                  // the record-form containers share: a child column the caller
                  // may not read is omitted, and one they may read but not edit
                  // renders its cells locked (objectui#10163).
                  columns: applyColumnPermissions(d.columns, { perms, objectName: d.childObject, mode: formMode }),
                  // Show the per-grid running total whenever an amount column is
                  // set — unless the document totals stack below subsumes it.
                  // The grid's `totalField` names the CHILD column summed (this
                  // detail's `amountField`); the detail's own `totalField` is the
                  // PARENT field the sum is saved to, and never reaches the grid.
                  totalField: showTaxStack ? undefined : (d.amountField || (d.totalField ? 'amount' : undefined)),
                  sortField: entry.sortField,
                  minRows: d.minRows,
                  maxRows: d.maxRows,
                  // The map rows above: the grid's Add, entry row and Duplicate
                  // follow `allowAdd`, its per-row Remove `allowDelete`.
                  allowAdd: lineAddGranted,
                  allowDelete: lineRemoveGranted,
                  addLabel: d.inlineMode === 'form' ? (d.addLabel || t('detail.add')) : d.addLabel,
                  // Checked against the grid's published type (objectui#11610), so
                  // a key the grid does not declare, or one of its retired
                  // snake_case spellings, fails to compile here.
                } satisfies Partial<GridFieldMetadata>) as GridFieldMetadata
              }
            />
          )}
        </section>
        );
      })}

      {/* Document totals stack (Subtotal / Tax / Total) — the right-aligned block
          every invoicing tool shows. Live as lines and the header tax rate change. */}
      {showTaxStack && (
        <div className="flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm" data-testid="md-totals">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t('form.masterDetail.subtotal')}</dt>
              <dd className="tabular-nums" data-testid="md-subtotal">{money(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">{t('form.masterDetail.tax', { rate: taxPct })}</dt>
              <dd className="tabular-nums" data-testid="md-tax">{money(taxAmount)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-1.5 text-base font-semibold">
              <dt>{t('form.masterDetail.total')}</dt>
              <dd className="tabular-nums" data-testid="md-grand-total">{money(grandTotal)}</dd>
            </div>
          </dl>
        </div>
      )}
    </>
  );
};

export interface MasterDetailFormProps {
  schema: MasterDetailFormSchema;
  dataSource?: DataSource;
  className?: string;
}

export const MasterDetailForm: React.FC<MasterDetailFormProps> = ({
  schema,
  dataSource,
  className,
}) => {
  const rawDetails = schema.details || [];
  const isEdit = schema.mode === 'edit' && !!schema.recordId;
  // `title` / `submitText` / `cancelText` are `I18nLabel` (see the schema
  // above), so a locale map is resolved here, against the UI language — the
  // source `ObjectMetricWidget` resolves its own `I18nLabel` members against.
  // Read raw, a map threw "Objects are not valid as a React child" as a Button
  // child and toasted "[object Object] saved" (objectui#10935).
  const { language } = useObjectTranslation();
  const titleText = pickLocalized(schema.title, language);
  // The defaults behind those three, and the built-in save toast, in the
  // session locale (objectui#11039). See `formChrome.ts`.
  const { t } = useFormChromeTranslation();
  // The session's word for a boolean value, which draws a derived `boolean` /
  // `toggle` column's two option labels (objectui#12924). The resolve effect
  // derives with the words of the latest render (the ref); the line grid then
  // re-labels at render with the current words (`linesEntries` below), so a
  // catalogue that lands after the child schema still reaches the options.
  // ⛔ Not an effect dependency: re-running the effect re-resolves every
  // entry, and a new `resolvedEntries` re-reads the lines over any unsaved
  // edit.
  const booleanLabel = useBooleanValueLabel();
  const booleanLabelRef = useRef(booleanLabel);
  booleanLabelRef.current = booleanLabel;
  const booleanTrueWord = booleanLabel(true);
  const booleanFalseWord = booleanLabel(false);

  // A detail can be configured with just `{ childObject }` — the relationship
  // FK and grid columns are then derived from the child object's metadata
  // (DataSource.getObjectSchema). We also resolve when columns are hand-authored
  // as bare `{ name, label }` (no `type`): those need their widget type
  // hydrated from the child schema, else every cell falls back to a text input.
  const needsDerive = rawDetails.some(
    (d) => !d.relationshipField || !d.columns?.length || d.columns.some((c) => !c.type),
  );
  /**
   * Per-entry identity, synthesized ONCE from the incoming config — the anchor
   * everything below is addressed by (objectui#6371). Recomputed only when the
   * authored `details` array itself changes, never per render and never from a
   * map index.
   */
  const detailIds = useMemo(
    () => synthesizeDetailIds(rawDetails),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema.details],
  );

  /** The unresolved entries — what renders until (or unless) the fetch lands. */
  const baseEntries = useMemo<DetailEntry[]>(
    () =>
      rawDetails.map((d, i) => ({
        id: detailIds[i],
        config: d,
        status: needsDerive ? ('pending' as const) : ('ready' as const),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema.details, detailIds, needsDerive],
  );

  const [resolvedEntries, setResolvedEntries] = useState<DetailEntry[] | null>(null);
  const entries = resolvedEntries ?? baseEntries; // length always matches rawDetails
  /**
   * What the line grids draw: `entries`, each derived entry's columns re-run
   * with the CURRENT session words (objectui#12924). A host that has not
   * awaited the active catalogue renders through the `en` fallback until it
   * lands, and a child schema that arrives first is derived with the `en`
   * words; this is what re-labels those options when the catalogue lands or
   * the language is switched. Keyed on the two WORDS, not on `booleanLabel`,
   * a new function every render (AGENTS.md #10). ⛔ Only the grids read it:
   * `entries` and `resolvedEntries` keep their identity, so the lines are not
   * re-read and an unsaved edit survives.
   */
  const linesEntries = useMemo(
    () =>
      entries.map((e) =>
        e.columnsWith ? { ...e, config: { ...e.config, columns: e.columnsWith(booleanLabel) } } : e,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `booleanLabel` keyed on its WORDS, see above
    [entries, booleanTrueWord, booleanFalseWord],
  );

  useEffect(() => {
    if (!needsDerive) { setResolvedEntries(baseEntries); return; }
    if (!dataSource || typeof (dataSource as any).getObjectSchema !== 'function') return;
    let cancelled = false;
    (async () => {
      const out = await Promise.all(
        baseEntries.map(async (entry): Promise<DetailEntry> => {
          const d = entry.config;
          const columnsTyped = d.columns?.length ? d.columns.every((c) => !!c.type) : false;
          // Fully configured (FK + every column typed) — nothing to resolve.
          if (d.relationshipField && columnsTyped) return { ...entry, status: 'ready' };
          // Decline to fetch when the child object never resolved (objectui#5940).
          // `childObject` is REQUIRED on `MasterDetailDetailConfig`, but a detail
          // entry reaches this renderer straight off an authored schema, so a
          // malformed one (or a bare string) arrives with it `undefined` — and the
          // fetch below then asked the data layer for an object literally named
          // `undefined`. A real backend receives that query and whatever it returns
          // becomes the console's problem. `RelatedList` already takes the other
          // choice for the same class of missing key ("has no referenceField/parentId
          // — refusing to fetch all rows", RelatedList.tsx), and the sibling effect
          // below already spells it `.filter(Boolean)`; this makes the three agree.
          // Left as-is rather than dropped: `details` stays length-matched to
          // `rawDetails` (the row-state array is indexed against it), and the
          // `!d.childObject` branch in <MasterDetailLines> renders a config hint
          // naming this key. That hint did not exist when this comment was first
          // written — the branch showed "Loading columns…" forever, and a reader
          // who trusted the claim had to run the component to find out
          // (objectui#6360). Do not restore the claim that the `catch` below
          // behaves the same way: it does not (objectui#6372).
          if (!d.childObject) {
            console.warn(
              `[MasterDetailForm] a detail collection has no childObject — refusing to fetch its schema. Set childObject to the child object the collection lists.`,
            );
            return { ...entry, status: 'declined' };
          }
          // ⭐ The FETCH and the DERIVE are caught SEPARATELY, because they are
          // different failures with different truths to tell. The bare `catch`
          // this replaces covered both, so both showed the same permanent
          // "Loading columns…" — and folding both into the new refusal
          // placeholder would be just as wrong in the other direction: it says
          // the schema could not be loaded, which is FALSE for a schema that
          // loaded fine and then failed to yield a relationship field.
          // Measured while building this: `deriveDetail` throwing is what the
          // objectui#6360 fixture actually hits, not a pending fetch.
          let childSchema: Awaited<ReturnType<DataSource['getObjectSchema']>>;
          try {
            childSchema = await dataSource.getObjectSchema(d.childObject);
          } catch (err) {
            // THE FETCH FAILED — objectui#6372's subject. The entry is kept (not
            // dropped) so `entries` stays length-matched to `rawDetails` and the
            // author still sees WHICH collection failed; what changes is that
            // the failure is now RECORDED. `status: 'failed'` is the smallest
            // shape that tells this apart from "still in flight": on a bare
            // `MasterDetailDetailConfig[]` the two are identical (no `columns`),
            // which is why the renderer showed the same spinner-shaped message
            // for both, and why for this one it never ended — the fetch is not
            // retried, so nothing can ever replace it.
            //
            // The thrown error used to be DISCARDED, so whoever debugged this
            // had neither a message nor a stack. The parity bar is the decline
            // arm above, which has warned since objectui#5940; the error object
            // itself is passed through because the stack is the half that makes
            // the failure actionable.
            console.warn(
              `[MasterDetailForm] could not load the schema of child object "${d.childObject}" — its columns cannot be derived, so the collection renders a refusal placeholder instead of a permanent "Loading columns…".`,
              err,
            );
            return { ...entry, status: 'failed' };
          }
          try {
            // ONE derivation for every entry that reaches here. With authored
            // `columns`, `deriveDetail` keeps them: its `columns` is
            // `hydrateColumns(d.columns, childSchema)`, and its amount rule
            // picks from that same set. An authored `amountField` still wins
            // over the derived one. The sort field is the derived one, full
            // stop: there is no authored override to weigh it against
            // (objectui#11070 round 9).
            const overrides = {
              relationshipField: d.relationshipField,
              columns: d.columns,
              amountField: d.amountField,
            };
            const derived = deriveDetail(d.childObject, childSchema, schema.objectName, {
              booleanLabel: booleanLabelRef.current,
              ...overrides,
            });
            // The same derivation with the words of a later render — see
            // `DetailEntry.columnsWith`. Pure over inputs that already derived
            // once, so it cannot throw where this call did not.
            const columnsWith = (label: BooleanValueLabel) =>
              deriveDetail(d.childObject, childSchema, schema.objectName, { booleanLabel: label, ...overrides }).columns;
            const amountField = d.amountField ?? derived.amountField;
            // Author gave the FK + an explicit column set but left some columns
            // untyped — hydrate just their widget types from the schema, keeping
            // their exact column set / order / labels (don't re-derive columns),
            // and their own `formFields` / `inlineMode`. The sort field and the
            // amount field are still taken from the derivation: a child whose
            // relationship declares `inlineColumns` lands here, and nothing
            // else supplies them (the spec has no inline sort-field key), so
            // skipping them lost the drag-reorder `position` and the running
            // total (objectui#11144).
            if (d.relationshipField && d.columns?.length) {
              return {
                ...entry,
                config: { ...d, columns: derived.columns, amountField },
                status: 'ready',
                sortField: derived.sortField,
                amountFieldDef: childFieldDef(childSchema, amountField),
                columnsWith,
              };
            }
            return {
              ...entry,
              status: 'ready',
              config: {
                ...d,
                relationshipField: derived.relationshipField,
                columns: derived.columns,
                formFields: d.formFields ?? derived.formFields,
                inlineMode: d.inlineMode ?? derived.mode,
                amountField,
              },
              sortField: derived.sortField,
              amountFieldDef: childFieldDef(childSchema, amountField),
              columnsWith,
            };
          } catch (err) {
            // THE DERIVE FAILED, on a schema that loaded fine — almost always
            // "no lookup/master_detail field on the child references the
            // parent", i.e. a configuration error the author fixes by setting
            // `relationshipField`.
            //
            // ⛔ Still NOT the refusal placeholder above: that one states the
            // schema could not be loaded, and here it was — triage's words,
            // "dishonest copy for a schema that loaded fine". What changed in
            // objectui#6394 is the OTHER half: this arm used to return the entry
            // UNRESOLVED (`return entry`), so it fell through to "Loading
            // columns…" and stayed there forever — the derive is not retried, so
            // those columns can never arrive, the same unbounded-wait-shown-as-a
            // -spinner defect objectui#5940 / objectui#6360 / objectui#6372
            // removed one arm at a time. `status: 'underivable'` routes it to a
            // config hint of its own, naming `relationshipField`.
            //
            // The error stays logged, not discarded (objectui#6372): it carries
            // the whole diagnosis — which child object, which parent, which key
            // to set — and the placeholder deliberately shows the author the
            // key, not the raw message.
            console.warn(
              `[MasterDetailForm] loaded the schema of child object "${d.childObject}" but could not derive its detail configuration; the collection cannot render its columns. Set relationshipField (and columns) explicitly on the detail entry.`,
              err,
            );
            return { ...entry, status: 'underivable' };
          }
        }),
      );
      if (!cancelled) setResolvedEntries(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, schema.objectName, schema.details]);

  /**
   * One row-state per detail collection, addressed by the collection's
   * SYNTHESIZED ENTRY ID.
   *
   * ⚠️ This used to be an ARRAY indexed in parallel with `details`, seeded once
   * at mount from the original `rawDetails` and never re-synced when the
   * authored config changed. Reordering or removing an entry therefore handed a
   * collection a different collection's rows — visible in the grid, in the
   * document subtotal, and in the batch payload on save (objectui#6371). Keyed
   * by identity, a collection can only ever read its own slot: an entry whose
   * identity is new simply finds nothing, which is the correct answer.
   */
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const rowStateRef = useRef(rowState);
  rowStateRef.current = rowState;

  // Cache of child object schemas (keyed by childObject), fetched once so the
  // client-orchestrated and atomic-batch child writes can strip computed /
  // read-only columns from each row — parity with the parent form's
  // `sanitizeFormData`. Child rows are seeded from a full record read, so an
  // edit would otherwise round-trip formula/summary columns the server rejects.
  // A ref (not state) so a late-arriving schema never re-renders — and thus
  // never resets — the header <ObjectForm> (see #1581). Reads happen at submit
  // time, long after the fetch resolves.
  const childSchemasRef = useRef<Record<string, { fields?: Record<string, any> }>>({});
  useEffect(() => {
    const ds: any = dataSource;
    if (!ds || typeof ds.getObjectSchema !== 'function') return;
    let cancelled = false;
    const objects = Array.from(new Set(rawDetails.map((d) => d.childObject).filter(Boolean)));
    (async () => {
      const entries = await Promise.all(
        objects.map(async (obj) => {
          try { return [obj, await ds.getObjectSchema(obj)] as const; }
          catch { return [obj, null] as const; }
        }),
      );
      if (cancelled) return;
      const next: Record<string, { fields?: Record<string, any> }> = {};
      for (const [obj, sch] of entries) if (sch) next[obj] = sch;
      childSchemasRef.current = next;
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSource, schema.objectName, schema.details]);

  // Bumped after a successful CREATE to remount the parent <ObjectForm> (which
  // owns react-hook-form state) so its fields clear for the next entry.
  const [formKey, setFormKey] = useState(0);
  /**
   * The save guard: set from the moment a save is asked for until its OUTCOME
   * (objectui#10631). While it is set, Save and Cancel are disabled and the
   * lines take no input (`MasterDetailLines`, the row editor below).
   */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  /**
   * Armed by a Save click and cleared as soon as that submit reaches the batch.
   * It covers only the stretch BEFORE the batch: see `handleSave`.
   */
  const saveGuardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Set while `submitViaBatch` has a batch in flight. One batch at a time: a
   * second batch built from the same baseline writes every created row twice
   * (objectui#10631).
   */
  const batchInFlightRef = useRef(false);
  /**
   * The sonner id BOTH save outcomes of THIS form are published under.
   *
   * `handleSaved` and `handleError` below each raised their toast under
   * sonner's auto-generated id, so nothing here held a handle on the previous
   * attempt's. A save the server refused left its error toast on screen, and
   * when the user corrected the input and saved again inside that toast's
   * lifetime the confirmation landed BESIDE the refusal — the form ending on a
   * screen that asserted both outcomes at once (objectui#7345, the
   * objectui#7252 defect class).
   *
   * One stable id closes both halves. Reusing an id sonner already holds
   * UPDATES that toast rather than stacking a second one, so the later outcome
   * supersedes the earlier; and the dismissal at the top of `handleSave`
   * retires it the moment a new attempt starts — which is the half that matters
   * when a host supplies `onSuccess`, because the built-in confirmation is then
   * skipped and a shared id alone would leave the stale refusal standing over a
   * save that succeeded.
   *
   * Scoped to this form instance (`React.useId()`) on purpose: a blanket
   * `toast.dismiss()` would take unrelated toasts down with it. Same spelling
   * the form renderer and the console's `FormPage` publish under (#7342).
   */
  const formInstanceId = React.useId();
  const outcomeToastId = `form-outcome:${formInstanceId}`;
  const clearSaveGuardTimer = useCallback(() => {
    if (saveGuardTimer.current) {
      clearTimeout(saveGuardTimer.current);
      saveGuardTimer.current = null;
    }
  }, []);
  const releaseSave = useCallback(() => {
    savingRef.current = false;
    setSaving(false);
    clearSaveGuardTimer();
  }, [clearSaveGuardTimer]);
  /**
   * A batch is about to go out: hold the guard until its outcome. Also reached
   * by a submit that did not come through the Save button (an implicit
   * submission of the header form), which must hold the form just the same.
   */
  const holdSaveForBatch = useCallback(() => {
    savingRef.current = true;
    setSaving(true);
    clearSaveGuardTimer();
  }, [clearSaveGuardTimer]);

  // Per-row "expand to full form": opens the child's complete form (all business
  // fields, incl. rich types the grid omits) in a drawer, pre-filled with the
  // row. Saving writes back into the in-memory row — the atomic batch still
  // persists everything on the parent Save (no separate backend write here).
  // `isNew` marks a row created by "Add" in list/form mode — cancelling the
  // editor without applying discards that empty row.
  const [expanded, setExpanded] = useState<{ entryId: string; rowIdx: number; isNew?: boolean } | null>(null);
  // objectui#10853 — the collection the row editor is open on. The editor holds
  // its draft in its own form, not in `rowState`, so the rows alone cannot say
  // that collection is being edited; the bus re-read reads this instead.
  // Mirrored in render, as `rowStateRef` is, so a read that lands later sees
  // the editor as it stands.
  const rowEditorEntryRef = useRef<string | null>(null);
  rowEditorEntryRef.current = expanded?.entryId ?? null;

  /**
   * objectui#10853 — the edit-mode lines read the data-invalidation bus
   * (`notifyDataChanged` from `@object-ui/react`), the objectui#10623 /
   * objectui#10778 way: a change the bus reports for a collection's CHILD
   * object (or `'*'`) re-reads that collection's lines in place. Before, they
   * were read only when the record, the adapter or the resolved details
   * changed, so a page action over raw HTTP left them stale unless the host
   * remounted this form, and `PageView` is to stop doing that
   * (objectui#10519). The header re-reads through its own `<ObjectForm>`
   * (objectui#10572).
   *
   * Subscribed only for what the reads below can query: edit mode, an adapter,
   * and a collection whose relationship field has resolved.
   *
   * Unsaved lines are the objectui#10712 R3 / objectui#10572 rule applied per
   * collection: a collection holding lines the user has not saved
   * ({@link linesUnsaved}), or with the row editor open on it, HOLDS its
   * re-read. One re-read is replayed once the editor is closed and the lines
   * read as saved again (a revert), or once this form's save lands. An open
   * editor is never reset, re-keyed or disabled by a re-read.
   */
  const linesReadObjects =
    isEdit && dataSource
      ? entries.flatMap((e) => (e.config.childObject && e.config.relationshipField ? [e.config.childObject] : []))
      : [];
  const linesBusNonces = useObjectsInvalidation(linesReadObjects);
  /** Bumped when the load effect below is torn down: every read in flight is then superseded. */
  const linesReadGenRef = useRef(0);
  /** The number of each collection's latest read: only that read commits. */
  const linesReadSeqRef = useRef<Record<string, number>>({});
  /** Collections whose bus re-read is held behind unsaved lines. */
  const heldLinesRereadRef = useRef<Set<string>>(new Set());
  /** Collections a save has written since the lines were last replayed. */
  const linesSavedRef = useRef<Set<string>>(new Set());
  /** Per collection, the bus nonce of its child object already answered. */
  const linesBusSeenRef = useRef<Record<string, number>>({});

  const parentIdKey = String(schema.recordId);
  const unsavedLines = useCallback(
    (entry: DetailEntry) =>
      rowEditorEntryRef.current === entry.id ||
      linesUnsaved(
        rowStateRef.current[entry.id],
        entry.config,
        parentIdKey,
        childSchemasRef.current[entry.config.childObject],
      ),
    [parentIdKey],
  );

  /**
   * Read one collection's lines. `origin`:
   * - `'load'`: the record, the adapter or the resolved details changed. The
   *   answer replaces the collection's rows and baseline, and a failed read
   *   leaves it empty (the behaviour before objectui#10853).
   * - `'bus'`: the bus reported a change to the child object. HELD while the
   *   collection holds unsaved lines. A failed re-read keeps the lines on
   *   screen.
   * - `'replay'`: a held re-read, replayed after a revert or a save.
   * A `'bus'` or `'replay'` read keeps the grid drawn over the lines on screen
   * and commits only over those same lines: if they were edited while it was
   * in flight, its answer is not committed and the re-read is asked for again,
   * so it is held behind the edit.
   */
  const readLines = useCallback(
    async function readLinesOf(entry: DetailEntry, origin: 'load' | 'bus' | 'replay'): Promise<void> {
      if (origin === 'bus') {
        if (unsavedLines(entry)) {
          heldLinesRereadRef.current.add(entry.id);
          return;
        }
        heldLinesRereadRef.current.delete(entry.id);
      }
      const gen = linesReadGenRef.current;
      const seq = (linesReadSeqRef.current[entry.id] ?? 0) + 1;
      linesReadSeqRef.current[entry.id] = seq;
      const isCurrent = () => linesReadGenRef.current === gen && linesReadSeqRef.current[entry.id] === seq;
      const d = entry.config;
      if (!dataSource || !d.relationshipField) {
        // Not resolved yet: nothing to read, and no lines to show.
        setRowState((prev) => ({ ...prev, [entry.id]: { rows: [], original: [] } }));
        return;
      }
      const inPlace = origin !== 'load';
      const rowsAtIssue = rowStateRef.current[entry.id]?.rows;
      let rows: RowState['rows'];
      try {
        const res = await dataSource.find(d.childObject, {
          $filter: { [d.relationshipField]: schema.recordId },
          // objectui#12286 — the lines open in their STORED order: ascending by
          // the sort field the grid stamps, the record id breaking ties (two
          // lines on one position, or none on any), so the same lines always
          // open in the same order. Unsorted, the grid drew the server's order
          // and its next renumber wrote that order over every line.
          ...(entry.sortField
            ? { $orderby: [{ field: entry.sortField, order: 'asc' as const }, { field: 'id', order: 'asc' as const }] }
            : {}),
          $top: 500,
        });
        rows = (res?.data ?? []) as Record<string, any>[];
      } catch (err) {
        if (!isCurrent()) return;
        if (inPlace) {
          console.warn(
            `[MasterDetailForm] could not re-read the lines of "${d.childObject}" after a data change; ${rowsAtIssue === undefined ? 'no lines have been read for it yet' : 'the lines on screen are kept'}.`,
            err,
          );
          return;
        }
        rows = [];
      }
      if (!isCurrent()) return;
      if (inPlace && rowEditorEntryRef.current === entry.id) {
        // The row editor was opened while this read was in flight: its commit
        // would reset the editor's draft. Held, and replayed when it closes.
        heldLinesRereadRef.current.add(entry.id);
        return;
      }
      if (inPlace && rowStateRef.current[entry.id]?.rows !== rowsAtIssue) {
        // Edited while this read was in flight: its answer would overwrite the
        // edit. Ask again, which holds it behind the edit while it is unsaved.
        void readLinesOf(entry, 'bus');
        return;
      }
      // Keyed by entry id, so a collection's rows land in ITS slot regardless
      // of where it currently sits in the authored array.
      setRowState((prev) => {
        if (inPlace && (prev[entry.id]?.rows !== rowsAtIssue || rowEditorEntryRef.current === entry.id)) {
          heldLinesRereadRef.current.add(entry.id);
          return prev;
        }
        return { ...prev, [entry.id]: { rows: rows.map((r) => ({ ...r })), original: rows.map((r) => ({ ...r })) } };
      });
    },
    [dataSource, schema.recordId, unsavedLines],
  );

  // Edit mode: load existing children for each detail collection.
  useEffect(() => {
    heldLinesRereadRef.current.clear();
    linesSavedRef.current.clear();
    if (isEdit && dataSource) {
      for (const e of entries) void readLines(e, 'load');
    }
    return () => {
      linesReadGenRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, dataSource, schema.recordId, resolvedEntries]);

  // objectui#10853 — the bus reported a change to a collection's child object.
  // A nonce the collection has not seen before is taken as seen: the load
  // above reads it. Values, not identities, decide here, so a run for any
  // other reason re-reads nothing.
  useEffect(() => {
    for (const e of entries) {
      const obj = e.config.childObject;
      if (!obj || !e.config.relationshipField) continue;
      const nonce = linesBusNonces[obj] ?? 0;
      const seen = linesBusSeenRef.current[e.id];
      linesBusSeenRef.current[e.id] = nonce;
      if (seen === undefined || seen === nonce) continue;
      void readLines(e, 'bus');
    }
  }, [linesBusNonces, entries, readLines]);

  // objectui#10853 — a held re-read is replayed once its collection's lines
  // read as saved again (a revert), or once this form's save has written them.
  // Not while a save is in flight: the lines take no input then, and its
  // outcome decides. Never while the row editor is open on the collection: it
  // runs here again when the editor closes (Apply or cancel).
  useEffect(() => {
    if (saving) return;
    const held = heldLinesRereadRef.current;
    for (const e of entries) {
      if (!held.has(e.id)) continue;
      if (rowEditorEntryRef.current === e.id) continue;
      if (!linesSavedRef.current.has(e.id) && unsavedLines(e)) continue;
      held.delete(e.id);
      void readLines(e, 'replay');
    }
    linesSavedRef.current.clear();
  }, [rowState, saving, expanded, entries, readLines, unsavedLines]);

  const setRows = useCallback((entryId: string, rows: Record<string, any>[]) => {
    setRowState((prev) => ({
      ...prev,
      [entryId]: { rows, original: prev[entryId]?.original ?? [] },
    }));
  }, []);

  // Header tax-rate field name — the live value is read by <MasterDetailLines>
  // (from the header record and the user's edits) and drives the Subtotal / Tax
  // / Total stack.
  const taxRateField = schema.taxRateField || 'tax_rate';

  const expandedRow =
    expanded ? rowState[expanded.entryId]?.rows?.[expanded.rowIdx] : undefined;
  const expandedDetail = expanded ? entries.find((e) => e.id === expanded.entryId)?.config : undefined;

  const applyRowEdit = useCallback(
    (entryId: string, rowIdx: number, values: Record<string, any>) => {
      setRowState((prev) => {
        const cur = prev[entryId] ?? { rows: [], original: [] };
        return {
          ...prev,
          [entryId]: { ...cur, rows: cur.rows.map((r, j) => (j === rowIdx ? { ...r, ...values } : r)) },
        };
      });
    },
    [],
  );

  /** List/form mode "Add": append a blank row and open it in the full form. */
  const addRowViaForm = useCallback((entryId: string) => {
    setRowState((prev) => {
      const cur = prev[entryId] ?? { rows: [], original: [] };
      const rows = [...cur.rows, {}];
      setExpanded({ entryId, rowIdx: rows.length - 1, isNew: true });
      return { ...prev, [entryId]: { ...cur, rows } };
    });
  }, []);

  /** Editor cancelled: drop the row if it was a freshly-added (empty) one. */
  const cancelRowEdit = useCallback(() => {
    setExpanded((cur) => {
      if (cur?.isNew) {
        setRowState((prev) => {
          const s = prev[cur.entryId];
          if (!s) return prev;
          return { ...prev, [cur.entryId]: { ...s, rows: s.rows.filter((_, j) => j !== cur.rowIdx) } };
        });
      }
      return null;
    });
  }, []);

  /**
   * Built-in feedback so a save is NEVER silent (a silent success looks broken
   * and invites duplicate submits). On CREATE also clears the form for the next
   * entry by resetting the line items + remounting the parent form.
   *
   * The success toast is only our fallback: when the host supplies `onSuccess`
   * it owns confirmation (e.g. the console toasts a localized message via its
   * crud-success handler), so we stay quiet to avoid double-confirming — the
   * same contract flat `ObjectForm` follows. Without a host `onSuccess` we keep
   * the built-in toast so the save is never silent.
   */
  const handleSaved = useCallback(
    async (parent: any) => {
      releaseSave();
      if (!schema.onSuccess) {
        toast.success(
          isEdit
            ? (titleText ? t('form.savedNamed', { title: titleText }) : t('form.saved'))
            : t('form.created'),
          { id: outcomeToastId },
        );
      }
      // An edit keeps its rows: `submitViaBatch` has already advanced their
      // baseline to what this save wrote (objectui#10564).
      if (!isEdit) {
        // Every collection back to empty for the next entry. Dropping the whole
        // record is the same statement the per-detail rebuild made, without
        // re-deriving it from positions.
        setRowState({});
        setFormKey((k) => k + 1);
      }
      await schema.onSuccess?.(parent);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isEdit, schema.onSuccess, titleText, entries.length, releaseSave, outcomeToastId, t],
  );

  /**
   * Release the save guard and forward the failure to the host's own
   * `onError`, WITHOUT toasting it here.
   *
   * This form's parent `<ObjectForm>` always re-throws after calling this
   * callback (see its `handleSubmit` catch), and that throw surfaces in the
   * form renderer's own catch (`packages/components/.../form.tsx`), which
   * ALREADY toasts every rejected write for ANY host `submitHandler` — not
   * just this one. Toasting here too put the identical message on screen
   * twice, under two different sonner ids (`form-outcome:<id>` where `<id>`
   * is each site's own independently-generated `React.useId()` — the shared
   * PREFIX from objectui#7345 never bought de-duplication across the two
   * raisers, only within each one's own retries) — objectui#7354.
   *
   * Removing the toast from THIS raiser, rather than the renderer's, is the
   * fix that generalizes: the renderer's catch is the one raiser every
   * `submitHandler` host shares, so it is the one that must stay. It is also
   * the richer of the two — `declaredUserMessage` / `isPermissionError` /
   * `extractWriteErrorMessage` — where this callback only ever showed the
   * raw `err.message`. `schema.onError` is still called: a host may still
   * want to know the write failed for its own bookkeeping (logging, focusing
   * a field, etc.) even though it no longer owns display.
   */
  const handleError = useCallback(
    (err: Error) => {
      // A submit refused because another batch is still in flight (see
      // `submitViaBatch`) is not that batch's outcome: releasing here would
      // re-arm Save and the grid under a save that has not landed. Every other
      // failure, including the in-flight batch's own, has settled by now.
      if (!batchInFlightRef.current) releaseSave();
      schema.onError?.(err);
    },
    [schema, releaseSave],
  );

  // Persistence ALWAYS goes through dataSource.batchTransaction: the parent and
  // all child collections are expressed as one ordered operation list and
  // handed to runBatchTransaction, which uses the adapter's atomic endpoint
  // when present and emulates it (sequential + best-effort compensation)
  // otherwise. This covers BOTH create (parent + child creates via `$ref`) and
  // edit (parent update + child create/update/delete diffs). There is no
  // separate client-orchestrated / cleanup path anymore (#2679).
  const sendBatch = useCallback(
    async (parentValues: Record<string, any>) => {
      if (!dataSource) throw new Error('MasterDetailForm: dataSource is required');
      const parentData: Record<string, any> = { ...parentValues };
      // Client-side rollups merged into the parent payload (hooks can't do
      // nested writes — see ADR-0001).
      entries.forEach((e) => {
        const d = e.config;
        if (d.totalField) {
          parentData[d.totalField] = sumRows(rowStateRef.current[e.id]?.rows ?? [], d.amountField || 'amount');
        }
      });
      // ⚠️ Read by ENTRY ID. This was
      // `.filter(…).map((d, i) => stateRef.current[i])`, where `i` indexes
      // the FILTERED array while the row state was indexed against the
      // FULL one — so a declined or unresolved entry sitting above a real
      // collection shifted every read below it by one and that
      // collection's rows were silently dropped from the transaction.
      // Data loss on save, not a display defect (objectui#6371).
      // Kept beside its entry id: the same inputs advance the baseline once
      // the batch has committed (objectui#10564).
      const editDetails: SavedDetailInput[] | null = isEdit
        ? entries.filter((e) => e.config.relationshipField).map((e) => ({
            entryId: e.id,
            input: {
              childObject: e.config.childObject,
              relationshipField: e.config.relationshipField!,
              rows: rowStateRef.current[e.id]?.rows ?? [],
              original: rowStateRef.current[e.id]?.original ?? [],
              childSchema: childSchemasRef.current[e.config.childObject],
            },
          }))
        : null;
      const ops = editDetails
        ? buildMasterDetailEditBatch(
            schema.objectName,
            String(schema.recordId),
            parentData,
            editDetails.map((d) => d.input),
          )
        : buildMasterDetailBatch(
            schema.objectName,
            parentData,
            // Same identity read as the edit branch above, for the same reason.
            entries.filter((e) => e.config.relationshipField).map((e) => ({
              childObject: e.config.childObject,
              relationshipField: e.config.relationshipField!,
              rows: rowStateRef.current[e.id]?.rows ?? [],
              childSchema: childSchemasRef.current[e.config.childObject],
            })),
          );
      const res = await runBatchTransaction(dataSource, ops);
      // The batch COMMITTED: advance the child rows' baseline from it, so a
      // form that stays mounted diffs its next save against what this one
      // wrote (objectui#10564). The parent's baseline advances in the header
      // `<ObjectForm>` once this handler resolves, from the same save. A batch
      // that rejects skips both, so the retry still carries every operation;
      // `childRowsAfterSave` does not throw, so a committed batch never reads
      // as a failed save with one baseline moved. Create mode has no baseline:
      // `handleSaved` empties the rows for the next entry.
      if (editDetails) {
        const saved = childRowsAfterSave(ops, res?.results, editDetails);
        // objectui#10853 — these lines are now what the server holds, so a bus
        // re-read held behind them (this save's own echo included) is replayed
        // once the save has settled.
        for (const s of saved) linesSavedRef.current.add(s.entryId);
        setRowState((prev) => {
          let next = prev;
          for (const s of saved) {
            const cur = prev[s.entryId];
            if (!cur || cur.original !== s.diffedAgainst) continue;
            // A created row takes its id by identity with the row the batch
            // was built from. The lines take no input while the save is in
            // flight (objectui#10631), so every such row is still that object.
            // Were one replaced anyway, it keeps no id: the next save then
            // deletes the created record and creates the row as it now stands.
            const rows = s.createdIds.size === 0
              ? cur.rows
              : cur.rows.map((r) => {
                  const id = s.createdIds.get(r);
                  return id === undefined ? r : { ...r, id };
                });
            next = { ...next, [s.entryId]: { rows, original: s.original } };
          }
          return next;
        });
      }
      // create → parent is op 0; edit → echo the parent values back.
      return res?.results?.[0] ?? { ...parentData, id: schema.recordId };
    },
    [dataSource, entries, schema.objectName, schema.recordId, isEdit],
  );

  /**
   * The header form's `submitHandler`: one batch at a time, with the save
   * guard held until its outcome (objectui#10631).
   *
   * A second batch built while the first is in flight diffs against the same
   * baseline and writes every created row again. The Save button cannot start
   * one while the guard holds it, but a submit of the header form that does
   * not come through that button can (an implicit submission, when the header
   * has a single text input). That submit is refused by THROWING, so the
   * header `ObjectForm` neither advances its baseline nor reports a success
   * for a write that was never sent, and `handleError` releases nothing.
   */
  const submitViaBatch = useCallback(
    async (parentValues: Parameters<typeof sendBatch>[0]) => {
      if (batchInFlightRef.current) {
        throw new Error('This save was not sent: another save of this form was still in progress.');
      }
      batchInFlightRef.current = true;
      holdSaveForBatch();
      try {
        return await sendBatch(parentValues);
      } finally {
        // Cleared before the header form sees the outcome, so `handleSaved` and
        // `handleError` read this save as settled.
        batchInFlightRef.current = false;
      }
    },
    [sendBatch, holdSaveForBatch],
  );

  // The parent form renders WITHOUT its own submit button — the master-detail
  // form owns a single action bar at the bottom (header → lines → Save), the
  // layout every mainstream enterprise platform uses for header+line entry.
  const parentSchema = useMemo(
    () => ({
      type: 'object-form',
      objectName: schema.objectName,
      mode: schema.mode ?? 'create',
      recordId: schema.recordId,
      // Carry prefilled header values into the parent form (create-mode
      // wizards, e.g. lead conversion prefilling name/account).
      initialValues: schema.initialValues,
      initialData: schema.initialData,
      formType: schema.formType,
      sections: schema.sections,
      fields: schema.fields,
      // The resolved string: `ObjectFormSchema.title` is a `string`.
      title: titleText || undefined,
      showSubmit: false,
      showCancel: false,
      // ObjectForm validates + hands the parent values to submitViaBatch (which
      // persists parent + children as one batch via dataSource.batchTransaction),
      // then handleSaved (toast + reset + page onSuccess).
      submitHandler: submitViaBatch,
      onSuccess: handleSaved,
      onError: handleError,
    }),
    [schema, titleText, submitViaBatch, handleSaved, handleError],
  );

  const formHostRef = useRef<HTMLDivElement>(null);

  // The header's record for the line grids' `parent.*` rules (objectui#13062).
  // A form that READS its record (the header <ObjectForm>'s own test: a
  // `recordId`, not create mode) publishes the read's answer when it lands; a
  // create form opens on its seed record. A new feed per record and per header
  // remount, keyed on those PRIMITIVES in a ref, never on a memo's identity
  // (AGENTS.md #10): a discarded memo would hand the header a new data source,
  // and its read effect would re-run.
  const headerReadsRecord = !!schema.recordId && (schema.mode ?? 'create') !== 'create';
  const headerOpening = headerReadsRecord ? {} : resolveInitialRecord(schema);
  let headerFeedKey: string;
  try {
    headerFeedKey = JSON.stringify([schema.objectName, headerReadsRecord ? String(schema.recordId) : null, formKey, headerOpening]);
  } catch {
    headerFeedKey = JSON.stringify([schema.objectName, headerReadsRecord ? String(schema.recordId) : null, formKey]);
  }
  const headerReadRef = useRef<{
    key: string;
    source: DataSource | undefined;
    feed: HeaderRecordFeed;
    dataSource: DataSource | undefined;
  } | null>(null);
  if (!headerReadRef.current || headerReadRef.current.key !== headerFeedKey || headerReadRef.current.source !== dataSource) {
    const feed = headerReadRef.current?.key === headerFeedKey
      ? headerReadRef.current.feed
      : createHeaderRecordFeed(headerOpening);
    headerReadRef.current = {
      key: headerFeedKey,
      source: dataSource,
      feed,
      dataSource: observeHeaderReads(dataSource, schema.objectName, headerReadsRecord ? schema.recordId : undefined, feed),
    };
  }
  const { feed: headerRecord, dataSource: headerDataSource } = headerReadRef.current;

  const submitText = pickLocalized(schema.submitText, language) || (isEdit ? t('common.save') : t('form.create'));
  const cancelText = pickLocalized(schema.cancelText, language) || t('common.cancel');

  // Upload-in-flight gate (objectui#10166), and this host is the reason the
  // scope CHAINS rather than shadows. The parent fields and every expanded row
  // are nested `ObjectForm`s with scopes of their own, and this Save persists
  // parent AND children in one batch — so a gate that saw only the parent's
  // uploads would refuse nothing while a child row's attachment was still in
  // flight, and would read as coverage. Chaining makes those inner scopes
  // report up to this one, so `uploading` here is true for an upload anywhere
  // in the document.
  const uploadGate = useUploadGate();

  const handleSave = useCallback(() => {
    // An upload is still in flight somewhere in this document — the parent
    // fields, a line-item grid cell, or an expanded row's editor
    // (objectui#10166). The batch would persist that row without its
    // attachment and report success. The action-bar Save is disabled and
    // labelled for this; this arm covers every other route into it.
    if (uploadGate.uploading) {
      toast.error(uploadGate.reason);
      return;
    }
    // Drive the (button-less) parent form's submit so its validation + RHF
    // onSubmit fire; success chains into child persistence via onSuccess.
    if (savingRef.current) return; // guard against duplicate submits
    const form = formHostRef.current?.querySelector('form') as HTMLFormElement | null;
    if (!form) return;
    savingRef.current = true;
    setSaving(true);
    // The previous attempt's outcome belongs to the previous attempt: retire it
    // the moment a new one starts, so no host can confirm a success while this
    // form's last refusal is still on screen (objectui#7345).
    toast.dismiss(outcomeToastId);
    // IMPORTANT: defer the submit out of this click's React dispatch AND
    // re-query the <form> inside the timer. Calling requestSubmit()
    // synchronously inside the onClick (or on a form reference captured before
    // the setSaving() re-render) intermittently fails to invoke react-hook-form's
    // onSubmit — the nested submit event is dropped — which made "Create" feel
    // unresponsive (only the occasional lucky click submitted). A fresh query in
    // a macrotask reliably triggers RHF validation + submit.
    setTimeout(() => {
      const liveForm = formHostRef.current?.querySelector('form') as HTMLFormElement | null;
      liveForm?.requestSubmit();
    }, 0);
    // Safety net for the stretch BEFORE the batch: react-hook-form blocks an
    // invalid submit without firing onSuccess/onError, and the deferred submit
    // above has been seen to drop, either of which would otherwise leave the
    // button stuck. Release the guard after a beat so the user can correct
    // fields and retry. `submitViaBatch` clears this timer the moment the
    // submit reaches the batch: from there only the batch's outcome releases
    // the guard. Releasing on this timer whatever the batch was doing re-armed
    // Save under a batch slower than it, and a second click wrote the same
    // records again (objectui#10631).
    saveGuardTimer.current = setTimeout(() => releaseSave(), 1500);
  }, [releaseSave, outcomeToastId, uploadGate.uploading, uploadGate.reason]);

  useEffect(() => () => { if (saveGuardTimer.current) clearTimeout(saveGuardTimer.current); }, []);

  return (
    <UploadGateProvider gate={uploadGate}>
    <div className={cn('space-y-6', className, schema.className)}>
      {/* 1) Header fields on top */}
      <div ref={formHostRef}>
        <ObjectForm key={formKey} schema={parentSchema as any} dataSource={headerDataSource} />
      </div>

      {/* 2) Line items + document totals, in a sibling component that owns the
          live header record (the header's record, with the user's edits over
          it — objectui#13062) so header edits never
          re-render — and thus never reset — the header <ObjectForm> (see #1581). */}
      <MasterDetailLines
        entries={linesEntries}
        rowState={rowState}
        setRows={setRows}
        saving={saving}
        formHostRef={formHostRef}
        taxRateField={taxRateField}
        headerRecord={headerRecord}
        declaredHeaderFieldNames={declaredHeaderFields(schema)}
        onRowExpand={(entryId, rowIdx) => setExpanded({ entryId, rowIdx })}
        onAddViaForm={addRowViaForm}
        parentObjectName={schema.objectName}
        formMode={isEdit ? 'edit' : 'create'}
      />

      {/* Per-row "expand to full form": an inline editor panel for the selected
          row. Rendered INLINE (not a portaled drawer) so it behaves identically
          whether this form is itself inside a modal (New-from-list) or a full
          page — nested portaled overlays inherit the host modal's
          pointer-events / aria-hidden lock and become unclickable. Edits the
          row in the child's COMPLETE form (rich types the grid omits) and writes
          the values back into the in-memory row; the atomic batch persists
          everything on the parent Save. */}
      {expanded && expandedDetail && (
        <Card className="border-primary/40 shadow-none ring-1 ring-primary/10" data-testid="md-row-form">
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-sm font-medium">
              {t('form.masterDetail.rowTitle', {
                title: expandedDetail.title || t('form.masterDetail.lineItem'),
                row: expanded.rowIdx + 1,
              })}
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={cancelRowEdit}
            >
              {t('common.close')}
            </Button>
          </CardHeader>
          <CardContent>
            {/* Held while a save is in flight, like the grid (objectui#10631):
                "Apply" writes the edited values over the row as a NEW object,
                and a created row takes its echoed id by identity with the row
                the batch was built from, so an apply mid-save would cost that
                row its id. A disabled fieldset disables every control in the
                editor, "Apply" included, until the save has settled. */}
            <fieldset disabled={saving} className="min-w-0">
              <ObjectForm
                key={`row-${expanded.entryId}-${expanded.rowIdx}`}
                schema={{
                  type: 'object-form',
                  objectName: expandedDetail.childObject,
                  mode: 'edit',
                  // No recordId → ObjectForm uses initialData (no backend fetch).
                  initialData: expandedRow ?? {},
                  ...(expandedDetail.formFields?.length ? { fields: expandedDetail.formFields } : {}),
                  submitText: t('form.masterDetail.applyRow'),
                  // Non-persisting: return the values; the atomic batch on the
                  // parent Save does the real write.
                  submitHandler: async (values: any) => values,
                  onSuccess: (values: any) => {
                    applyRowEdit(expanded.entryId, expanded.rowIdx, values);
                    setExpanded(null);
                  },
                  onCancel: cancelRowEdit,
                } as any}
                dataSource={dataSource}
              />
            </fieldset>
          </CardContent>
        </Card>
      )}

      {/* Single action bar at the bottom — suppressed when the host opts out
          (e.g. the Studio screen-preview, which must never persist). */}
      {schema.showSubmit !== false && (
        <div className="border-t border-border pt-4">
          {/* Why Save is unavailable — above the row so it reads before the
              dead control (objectui#10166). */}
          <UploadInFlightNotice gate={uploadGate} />
          <div className="flex items-center justify-end gap-2">
            {schema.onCancel && (
              <Button type="button" variant="outline" onClick={schema.onCancel} disabled={saving} data-testid="md-form-cancel">
                {cancelText}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || (needsDerive && !resolvedEntries) || uploadGate.uploading}
              data-testid="md-form-submit"
            >
              {uploadGate.uploading ? uploadGate.busyLabel : saving ? t('detail.saving') : submitText}
            </Button>
          </div>
        </div>
      )}
    </div>
    </UploadGateProvider>
  );
};
