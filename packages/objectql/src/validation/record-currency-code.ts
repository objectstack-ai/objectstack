// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2, D8 rule 4] A `record`-mode amount is stored with its currency
 * code, or the write is refused.
 *
 * A `currency` field declaring `currencyConfig: { currencyMode: 'record',
 * currencyField }` holds a bare number (ADR-0104 D1) whose currency is the
 * ISO 4217 code in the sibling field `currencyField` names. An amount stored
 * beside a blank code is a number in no currency: every reader would label it
 * with something it never was. The ADR's design rule 4 settles who supplies
 * the code: a form pre-fills the organization's currency at the renderer, and
 * the stored value is always the one submitted — the server never fills one
 * in. This refusal is what makes that true.
 *
 * ## What is judged
 *
 * The row's IMAGE after the write — the insert row as the driver will store
 * it, or the stored row with the update payload laid over it. A pair is
 * judged when its amount holds a value and its code field is blank (absent,
 * `null`, or a string with no characters but white space). A blank amount
 * needs no code; a code that is not an ISO 4217 member is the code field's
 * own `valueDomain` refusal, judged by the record validator, not here.
 *
 * On an update only the pairs the payload touches — it carries the amount or
 * the code — are judged, as every other write-time rule here judges only what
 * a write changes: a row stored before the amount was declared `record` is
 * not refused for an edit of an unrelated field.
 *
 * ## The answer
 *
 * `ERR_CURRENCY_CODE_REQUIRED` / 400, registered under `@objectstack/objectql`
 * in the ADR-0112 ledger (ADR-0144 Open item 9), naming the code field in
 * `field` and the amount in `amountField`. A top-level code rather than a
 * field-level `VALIDATION_FAILED` entry because the ADR assigns this refusal
 * to ADR-0112's vocabulary, and a client that pre-fills the code recognises it
 * by that name.
 *
 * ## A child that follows its parent's currency (ADR-0144 D2, amended)
 *
 * The amended D2 note: "`currencyField` may name `<master_detail
 * field>.<parent code field>`, so a child follows its parent's currency by
 * construction", and "the explicit stored value of D8 rule 4 is the parent's
 * code". Such an amount's code is not a column of its row. The engine reads
 * each written row's parent through the `master_detail` and lays the parent's
 * code on a COPY of the row image, under the pointer as written
 * (`followParentCurrencyCodes`), before this guard and the home projection
 * read it. A field's machine name never holds a dot, so that key can never be
 * a stored column. A parent with a blank code refuses the child's amount here,
 * as a blank sibling code does ("a child amount beside a blank code is
 * refused at its own write", the D2 note).
 *
 * The parent is read the way the write's other header reads are: first
 * through the WRITER's read door, then elevated, keeping the organization. A
 * parent the writer's read door does not return (one it may not read, one in
 * another organization, one that does not exist) is never read elevated. A
 * child amount naming such a parent is answered here with the reference
 * check's own `reference_not_found` on the `master_detail` field, before any
 * currency verdict (a blank code, a missing rate), so no answer of this write
 * says anything about a row its writer cannot read. A system writer has no
 * read door: a parent its elevated read does not find, or a value that is no
 * row id, reads as no code, and the amount is refused
 * `ERR_CURRENCY_CODE_REQUIRED`. Either way a following amount is never stored
 * without a currency.
 *
 * On an update the pair's inputs are the amount, the `master_detail` field
 * (re-parenting a child is judged as writing a sibling code is) and, when the
 * amount declares `homeAmount`, the inputs of its projection (the document
 * date and the two projected fields): whenever the write converts the amount,
 * this guard has judged the parent it converts from.
 */

import { ValidationError, buildFieldError, type ValidationMessageContext } from './record-validator.js';

/** The ADR-0112 `code` {@link RecordCurrencyCodeRequiredError} carries. */
export const CURRENCY_CODE_REQUIRED_CODE = 'ERR_CURRENCY_CODE_REQUIRED' as const;

/**
 * [ADR-0144 D2, amended] A `currencyField` that names `MASTER_DETAIL.CODE`: the
 * `master_detail` field of the amount's own object the amount follows, the
 * code field on the parent it references, and that parent object.
 */
export interface RecordCurrencyPath {
  /** The `master_detail` field of the amount's own object (segment 1). */
  readonly via: string;
  /** The parent's code field (segment 2). */
  readonly code: string;
  /**
   * The object `via` references, when `via` is a declared `master_detail`
   * field naming one; `undefined` when the declaration is broken (the spec
   * refuses such a pointer at authoring), and then the code reads as blank.
   */
  readonly master: string | undefined;
}

/** One record-mode amount and the field that holds its currency code. */
export interface RecordCurrencyPair {
  /** The `currency` field declaring `currencyMode: 'record'`. */
  readonly amountField: string;
  /**
   * Its `currencyConfig.currencyField` as written: the sibling ISO 4217 code
   * field, or the two-segment path {@link path} spells.
   */
  readonly codeField: string;
  /** Set when {@link codeField} is a `MASTER_DETAIL.CODE` path the amount follows. */
  readonly path?: RecordCurrencyPath;
  /**
   * For a path pair whose amount declares `homeAmount`: the projection's other
   * inputs (`rateDate`, `field`, `rateField`). An update touching any of them
   * converts the amount, so it is judged too.
   */
  readonly projectionInputs?: readonly string[];
}

/**
 * The code field a declared field's amount is in, when the field is a
 * `record`-mode `currency` field naming one — `undefined` otherwise. Read off
 * the declaration as registered: the parse already refused a `record` config
 * with no pointer, and a body that skipped the parse and carries none names no
 * currency this seam could judge.
 *
 * The pointer is answered as written, a sibling field name or a
 * `MASTER_DETAIL.CODE` path: {@link recordCurrencyPathOf} splits the second.
 * A metadata save compares pointers as written (`currency_field_repointed`),
 * and every message names the pointer the author wrote.
 */
export function recordCurrencyFieldOf(def: unknown): string | undefined {
  if (def === null || typeof def !== 'object') return undefined;
  const { type, currencyConfig } = def as { type?: unknown; currencyConfig?: unknown };
  if (type !== 'currency' || currencyConfig === null || typeof currencyConfig !== 'object') return undefined;
  const { currencyMode, currencyField } = currencyConfig as { currencyMode?: unknown; currencyField?: unknown };
  return currencyMode === 'record' && typeof currencyField === 'string' && currencyField !== ''
    ? currencyField
    : undefined;
}

/**
 * [ADR-0144 D2, amended] Split a two-segment pointer `MASTER_DETAIL.CODE`
 * against the amount's own field map. `undefined` for a one-segment (sibling)
 * pointer, and for any other spelling: the spec refuses a path of three or
 * more segments, and a body that skipped the parse is judged as a sibling
 * name no row holds, so its amounts are refused, never stored without a
 * currency.
 */
export function recordCurrencyPathOf(pointer: string, fields?: unknown): RecordCurrencyPath | undefined {
  const segments = pointer.split('.');
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return undefined;
  const [via, code] = segments as [string, string];
  const declared = fields !== null && typeof fields === 'object' && !Array.isArray(fields)
    && Object.prototype.hasOwnProperty.call(fields, via)
    ? (fields as Record<string, unknown>)[via]
    : undefined;
  const { type, reference } = (declared ?? {}) as { type?: unknown; reference?: unknown };
  const master = type === 'master_detail' && typeof reference === 'string' && reference !== '' ? reference : undefined;
  return { via, code, master };
}

/**
 * The payload key whose presence moves a pair's currency on an update: its
 * sibling code field, or, for a path, the `master_detail` field the amount
 * follows (re-parenting a child changes its currency as writing a sibling
 * code does).
 */
export function recordCurrencyInputOf(pair: { readonly codeField: string; readonly path?: RecordCurrencyPath }): string {
  return pair.path ? pair.path.via : pair.codeField;
}

/** Every payload key whose presence makes an update judge `pair`. */
function pairInputsOf(pair: RecordCurrencyPair): readonly string[] {
  return [pair.amountField, recordCurrencyInputOf(pair), ...(pair.projectionInputs ?? [])];
}

/** A path amount's `homeAmount` inputs, when it declares one. */
function homeAmountInputsOf(def: unknown): string[] {
  const home = (def as { currencyConfig?: { homeAmount?: unknown } } | null)?.currencyConfig?.homeAmount;
  if (home === null || typeof home !== 'object') return [];
  const { field, rateDate, rateField } = home as { field?: unknown; rateDate?: unknown; rateField?: unknown };
  return [rateDate, field, rateField].filter((k): k is string => typeof k === 'string' && k !== '');
}

/** Every record-mode amount an object's field map declares, in declaration order. */
export function recordCurrencyPairs(fields: unknown): RecordCurrencyPair[] {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return [];
  const pairs: RecordCurrencyPair[] = [];
  for (const [amountField, def] of Object.entries(fields as Record<string, unknown>)) {
    const codeField = recordCurrencyFieldOf(def);
    if (codeField === undefined) continue;
    const path = recordCurrencyPathOf(codeField, fields);
    pairs.push(path
      ? { amountField, codeField, path, projectionInputs: homeAmountInputsOf(def) }
      : { amountField, codeField });
  }
  return pairs;
}

/**
 * [ADR-0144 D2, amended] The value laid on an image under a path pointer when
 * the WRITER's read door did not return the parent the row names (a row it may
 * not read, one in another organization, one that does not exist). Never a
 * stored value. The home projection reads no rate for it, and the guard below
 * answers it with the reference check's `reference_not_found`, so no currency
 * verdict is ever given about a parent the writer cannot read.
 */
export const PARENT_CODE_UNREAD: unique symbol = Symbol('objectstack.objectql.recordCurrencyParentCodeUnread');

/**
 * Reads the parent rows a write's children follow: `ids` of `master`, each
 * with `fields`. The engine supplies it (`HomeAmountServing.parentRows`): each
 * id the writer's read door returns is read elevated, keeping the
 * organization, and answers its row; an id the read door does not return
 * answers {@link PARENT_CODE_UNREAD}; an id the elevated read does not find
 * (a system writer's dangling reference) has no entry.
 */
export type ParentRowsReader = (
  master: string,
  ids: readonly string[],
  fields: readonly string[],
) => Promise<ReadonlyMap<string, Record<string, unknown> | typeof PARENT_CODE_UNREAD>>;

/** Lays the followed parent codes on a COPY of one image; never mutates it. */
export type FollowParentCodes = (image: Record<string, unknown>) => Record<string, unknown>;

const identityFollow: FollowParentCodes = (image) => image;

/**
 * [ADR-0144 D2, amended] Read the parents a batch of row images follow and
 * answer a function that lays each one's code on a copy of an image, under
 * the pointer as written. One read per `master_detail` field for the whole
 * batch. Free when no source is a path: the identity is answered and nothing
 * is read.
 *
 * Per path source, the value laid is:
 * - the parent's code (`null` when the parent holds none) — the guard judges it
 *   blank or not, and the projection converts from it;
 * - `null` when the row names no parent, names it by a value that is no row id
 *   (an object, an array), names one the elevated read does not find, or the
 *   path's first segment is no `master_detail` naming an object (a declaration
 *   the spec refuses): an amount there is refused as having no currency;
 * - {@link PARENT_CODE_UNREAD} when the writer's read door did not return the
 *   parent: the guard answers it `reference_not_found`.
 *
 * @param images the row images the follower will be asked about; a later image
 *   naming a parent outside them reads as unread.
 */
export async function followParentCurrencyCodes(
  sources: ReadonlyArray<{ readonly codeField: string; readonly path?: RecordCurrencyPath }>,
  images: Iterable<Record<string, unknown> | null | undefined>,
  readParents: ParentRowsReader | undefined,
): Promise<FollowParentCodes> {
  const paths = new Map<string, RecordCurrencyPath>();
  for (const source of sources) if (source.path) paths.set(source.codeField, source.path);
  if (paths.size === 0) return identityFollow;
  const rows = [...images].filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object');
  // One read per `master_detail` field: the ids the rows name, and the code fields followed through it.
  const byVia = new Map<string, { master: string; ids: Set<string>; codes: Set<string> }>();
  for (const path of paths.values()) {
    if (path.master === undefined) continue;
    let entry = byVia.get(path.via);
    if (!entry) {
      entry = { master: path.master, ids: new Set(), codes: new Set() };
      byVia.set(path.via, entry);
      for (const row of rows) {
        const id = row[path.via];
        if (!isRecordCurrencyBlank(id) && (typeof id === 'string' || typeof id === 'number')) entry.ids.add(String(id));
      }
    }
    entry.codes.add(path.code);
  }
  const parents = new Map<string, ReadonlyMap<string, Record<string, unknown> | typeof PARENT_CODE_UNREAD>>();
  for (const [via, { master, ids, codes }] of byVia) {
    parents.set(via, ids.size === 0 || !readParents ? new Map() : await readParents(master, [...ids], [...codes]));
  }
  return (image) => {
    const out: Record<string, unknown> = { ...image };
    for (const [pointer, path] of paths) {
      const id = image[path.via];
      if (path.master === undefined || isRecordCurrencyBlank(id) || (typeof id !== 'string' && typeof id !== 'number')) {
        out[pointer] = null;
        continue;
      }
      const parent = parents.get(path.via)?.get(String(id));
      out[pointer] = parent === undefined ? null : parent === PARENT_CODE_UNREAD ? PARENT_CODE_UNREAD : (parent[path.code] ?? null);
    }
    return out;
  };
}

/**
 * Is one side of a record-mode pair blank — absent, `null`, or a string with no
 * characters but white space? The one predicate this refusal and the backfill
 * behind `os migrate record-currency-codes` (`record-currency-backfill.ts`)
 * both judge by, so the rows the backfill fills are exactly the rows this
 * refusal would answer on their next write of the pair.
 */
export function isRecordCurrencyBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

const isBlank = isRecordCurrencyBlank;

/**
 * `ERR_CURRENCY_CODE_REQUIRED` / 400 — see the module header. Identified by
 * `code`, which survives crossing package boundaries.
 */
export class RecordCurrencyCodeRequiredError extends Error {
  readonly code = CURRENCY_CODE_REQUIRED_CODE;
  readonly status = 400;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = 400;
  /** The object written. */
  readonly object: string;
  /** The first blank code field — the one the caller must fill. */
  readonly field: string;
  /** Every blank code field of the row, first included. */
  readonly fields: string[];
  /** The record-mode amount whose currency `field` holds. */
  readonly amountField: string;

  constructor(object: string, operation: 'insert' | 'update', hits: readonly RecordCurrencyPair[], recordId?: unknown) {
    const [first] = hits;
    const row = recordId === undefined || recordId === null ? '' : ` (record ${String(recordId)})`;
    const path = first.path;
    super(
      `${operation === 'insert' ? 'Insert' : 'Update'} on '${object}'${row} was REFUSED: '${first.amountField}' `
        + (path
          ? `holds an amount in its parent record's currency (currencyMode: 'record', following '${first.codeField}' `
            + `through the master_detail '${path.via}'), and `
            + (path.master === undefined
              ? `'${path.via}' is no master_detail field naming a parent object, so no parent holds its code`
              : `the '${path.master}' record it names has a blank '${path.code}', or it names none`)
          : `holds an amount in the record's own currency (currencyMode: 'record'), and its currency code field `
            + `'${first.codeField}' is blank`)
        + (hits.length > 1 ? ` (also: ${hits.slice(1).map((h) => `'${h.codeField}' for '${h.amountField}'`).join(', ')})` : '')
        + (path
          ? `. The row was not written. Write the parent's ISO 4217 code (for example 'USD') into `
            + `'${path.master ?? path.via}.${path.code}' first, and name that parent in '${path.via}', or leave `
            + `'${first.amountField}' empty. A child stores no code of its own: it follows its parent's.`
          : `. The row was not written. Write the record's ISO 4217 code (for example 'USD') into '${first.codeField}' `
            + `in the same write, or leave '${first.amountField}' empty.`)
        + ` The server never fills a currency in: a form pre-fills the organization's currency, and the stored code `
        + `is always the one submitted.`,
    );
    this.name = 'RecordCurrencyCodeRequiredError';
    this.object = object;
    this.field = first.codeField;
    this.fields = [...new Set(hits.map((h) => h.codeField))];
    this.amountField = first.amountField;
  }
}

/**
 * Refuse a row image whose record-mode amount holds a value beside a blank
 * currency code — see the module header.
 *
 * An amount that follows a parent the writer's read door did not return
 * ({@link PARENT_CODE_UNREAD}) is refused first, with the reference check's
 * own finding (`VALIDATION_FAILED`, `reference_not_found` on the
 * `master_detail` field, built by `buildFieldError` in the caller's locale):
 * the writer learns of that parent exactly what a reference to it would tell
 * it, and nothing of its currency.
 *
 * @param image    the row as it will be stored (insert row, or stored row ⊕ payload),
 *                 with each followed parent code laid on it ({@link followParentCurrencyCodes});
 *                 a path pair whose code was never laid reads as blank and is refused
 * @param touched  an update's payload: only the pairs it carries an input of are judged;
 *                 omitted on insert, where every pair is judged
 * @param messages the write's validation message context, for the reference finding's locale
 */
export function assertRecordCurrencyCodes(
  object: string,
  fields: unknown,
  image: Record<string, unknown> | null | undefined,
  operation: 'insert' | 'update',
  touched?: Record<string, unknown> | null,
  recordId?: unknown,
  messages?: ValidationMessageContext,
): void {
  if (!image) return;
  const pairs = recordCurrencyPairs(fields);
  if (pairs.length === 0) return;
  const has = (key: string) => touched != null && Object.prototype.hasOwnProperty.call(touched, key);
  const judged = operation === 'update' ? pairs.filter((p) => pairInputsOf(p).some(has)) : pairs;
  const unread = judged.filter((p) => p.path && image[p.codeField] === PARENT_CODE_UNREAD && !isBlank(image[p.amountField]));
  if (unread.length > 0) {
    const defs = fields as Record<string, { label?: string } | undefined>;
    const vias = [...new Map(unread.map((p) => [p.path!.via, p.path!])).values()];
    throw new ValidationError(vias.map((path) => buildFieldError(
      {
        field: path.via,
        code: 'reference_not_found',
        def: defs[path.via],
        value: String(image[path.via]),
        constraint: { target: path.master },
      },
      messages,
    )));
  }
  const hits = judged.filter((p) => !isBlank(image[p.amountField]) && isBlank(image[p.codeField]));
  if (hits.length > 0) throw new RecordCurrencyCodeRequiredError(object, operation, hits, recordId);
}

/**
 * Does an update payload touch any record-mode pair? The engine asks it before
 * paying for the stored rows a predicate update would otherwise not read.
 */
export function touchesRecordCurrency(fields: unknown, payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) return false;
  return recordCurrencyPairs(fields).some(
    (p) => pairInputsOf(p).some((key) => Object.prototype.hasOwnProperty.call(payload, key)),
  );
}
