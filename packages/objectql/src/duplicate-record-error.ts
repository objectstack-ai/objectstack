// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { renderOperationMessage } from '@objectstack/spec/system';
import { isUniqueViolationError, uniqueViolationColumns, uniqueViolationField } from '@objectstack/types';
import { objectDisplayLabel } from './engine-validation-messages.js';
import { resolveFieldLabel, type ValidationMessageContext } from './validation/record-validator.js';

/**
 * The ADR-0112 envelope `engine.insert` (#14095) and `engine.update` (commit 9d7f7259f)
 * raise when a driver refuses a row as a unique-constraint violation.
 *
 * ## The defect this retires
 *
 * The platform RECOMMENDS "declare a unique index, attempt the insert, swallow
 * the violation" — `createWithAutonumberResync`'s own doc argues at length
 * against the read-then-write alternative ("a probe costs a query on every
 * insert … and is still racy"). An application could not complete that pattern,
 * because the insert door rethrew the DRIVER's error verbatim and left the app
 * three bad options:
 *
 *  1. test `err.code === 'SQLITE_CONSTRAINT_UNIQUE'` — couples the app to one
 *     dialect, and it silently stops being idempotent the day it is deployed on
 *     Postgres (`23505`), MySQL (`ER_DUP_ENTRY`) or Mongo (`E11000`);
 *  2. pattern-match the message — which on the measured SQLite path is the
 *     whole compiled INSERT statement;
 *  3. use the platform's own `isUniqueViolationError`, which is correct and
 *     dialect-independent and lives in `@objectstack/types` — a package an
 *     application cannot reach (`ERR_MODULE_NOT_FOUND`).
 *
 * Triage ruled (2026-09-01) for wrapping in ObjectQL rather than re-exporting
 * the predicate: 「抛一个带既有词表码(`DUPLICATE_RECORD` 已在 ADR-0112 台账里)
 * 的平台错误,原驱动错误作 `cause` ⇒ `insert` 在每个驱动上有同一份契约」.
 *
 * ## The shape, and why each half is here
 *
 *  - **`code: 'DUPLICATE_RECORD'`** — already a member of `StandardErrorCode`
 *    (the 409 conflict group), so nothing in `packages/spec` had to grow a
 *    member for this. It is the engine's THROWN identity — what an in-process
 *    caller of `engine.insert` / `engine.update` (a hook, a flow node, a
 *    script holding the engine) branches on, on every driver. ⛔ It is not
 *    the WIRE spelling: every REST route — the single-record door, the
 *    whole-request bulk / import doors, and since commit 65846bc46 the per-row reports
 *    of `POST /data/:object/batch` and the import runner alike — reports a
 *    unique-constraint refusal as `UNIQUE_VIOLATION`, the standard-catalog
 *    member the published protocol docs give for the 409 constraint-violation
 *    body (maintainer ruling 2026-09-03: one wire spelling on every route).
 *    A client of the HTTP API branches on `UNIQUE_VIOLATION`; only code that
 *    catches this class in-process sees `DUPLICATE_RECORD`. One condition,
 *    one spelling per boundary, and `developerMessage` below says both.
 *  - **`status: 409`** — the conflict status the engine's sibling refusals
 *    already declare (`DELETE_RESTRICTED`, `CONCURRENT_UPDATE`), so REST's
 *    declared-status passthrough answers 409 instead of the sanitised 500 an
 *    undeclared status would have earned.
 *  - **`cause`** — the driver's own error. Nothing is copied out of it into
 *    the message: `isUniqueViolationError` and `uniqueViolationColumn` both
 *    walk a `cause` chain, so every existing consumer of the raw error keeps
 *    its answer by asking the envelope. [#21274] It is whole when built here;
 *    where the envelope leaves the engine its `cause` is cut like any driver
 *    error (`redactPropagatedDriverFault`): the class, the codes and the
 *    database's diagnostic stay, the bound statement and values do not.
 *  - **`field`** — the conflicting field, and ONLY when
 *    {@link uniqueViolationField} determinably named one. An index name is
 *    never reported as a column (MySQL's `for key 'idx_email_unique'`,
 *    Postgres' constraint name, a composite of authored columns): that
 *    function's contract is that a wrong field name is worse than none, and
 *    this envelope does not widen it. An organization-scoped unique field's
 *    key `(organization_id, FIELD)` does name FIELD — the organization part is
 *    the implied scope, not a value the writer typed — so the refusal of a
 *    duplicate invoice number reads "A record with this Invoice Number
 *    already exists" over HTTP, through `fieldLabel` below. ⛔ The autonumber
 *    retry does not read this `field`: it asks `uniqueViolationColumn` of the
 *    driver error on `cause`, whose composite answer stays `undefined`.
 *  - **`developerMessage`** — the remedy half, split off exactly as the
 *    engine's `DELETE_RESTRICTED` refusal splits it: `message` is the sentence
 *    a user-facing surface renders, `developerMessage` is the one addressed to
 *    the application author.
 *  - **Labels in `message`, API names in `developerMessage`** — every door keeps
 *    `message` as thrown, so a refused record save and a screen flow show it to
 *    the end user verbatim. [#24951] It therefore names the object and the field
 *    by their declared `label` (the engine resolves them from its registry at
 *    the write), falling back to the API name only where no label is declared —
 *    the same "object label" naming ruling B of #23556 / #23594 set for the
 *    approval notifications. The API names stay on `object` / `field` and open
 *    `developerMessage`, for diagnostics.
 *  - **`fieldLabel`** — [#26867] the conflicting field's display name, the same
 *    one `message` names it by, and ONLY when the field has one: a translation
 *    in the writer's locale, else its declared `label`. Absent when there is no
 *    `field`, or the field declares no label and the bundle holds none — the
 *    API name is never repeated here. It is what the HTTP doors' user-facing
 *    sentence names the field by ("A record with this Global SKU already
 *    exists"), so the end user reads the label while `field` keeps the API key
 *    for programs. One resolution feeds both sentences: the doors do not look
 *    the label up a second time, and they could not — they hold no schema.
 *  - **The writer's locale** — the labels are resolved on the ladder the record
 *    validator and the `DELETE_RESTRICTED` refusal already climb (translation
 *    bundle → declared `label` → API name: `resolveFieldLabel`,
 *    `objectDisplayLabel`), in the locale of the write's execution context, so
 *    a write made in `zh-CN` against a translated object reads its labels in
 *    `zh-CN`. With no message context (a bare-kernel caller) they are the
 *    declared labels, exactly as before.
 *  - **`endUserMessage`** — the end user's sentence, composed in the writer's
 *    locale from the platform's operation catalog (`duplicate_record*`,
 *    `renderOperationMessage` in `@objectstack/spec/system`, the catalog the
 *    `DELETE_RESTRICTED` refusal renders from), so a deployment's
 *    `errors.duplicate_record*` translation overrides it. The HTTP doors ship
 *    it as the 409 body's `error`; before, they composed a fixed English
 *    sentence there, so a `zh-CN` writer read English beside a Chinese
 *    object label. It names the conflicting field by label (one field), the
 *    fields of a composite unique index by their labels (see `uniqueFields`
 *    below), or nothing. ⛔ It is deliberately NOT spelled `userMessage`:
 *    that name is the ApiError contract's producer-marked channel, which every
 *    boundary promotes to a wire key of its own (`withDeclaredUserMessage`),
 *    and whether this refusal joins that channel is a contract decision this
 *    sentence does not make. The wire shape is unchanged: only the text of
 *    `error` moves.
 *  - **The fields of a composite unique index** — named in `endUserMessage`
 *    and in `message` ONLY when the columns the store named
 *    (`uniqueViolationColumns`, organization part set aside) match, as a set,
 *    the `fields` of a unique index the object DECLARES. Driver text alone is evidence, not a verdict: a
 *    `tenancy.tenantField` column prints beside the authored ones and cannot
 *    be told from them, so anything short of a declared match names nothing —
 *    the rule `field` follows, for the reason it does. `field` itself keeps
 *    its single-column contract and stays absent for a composite; the
 *    composite's API names open `developerMessage`. And the user's sentence
 *    names them only when every one has a label — never an API name, the
 *    rule `field_edit_denied` set for its list of fields.
 *
 * ## ⛔ What this deliberately does NOT do
 *
 * It does not copy the driver's prose into `message`. The measured SQLite
 * message IS the compiled statement with its bound values, and REST's declared
 * 4xx arm ships `message` to the client verbatim — so quoting the driver here
 * would move #8682's leak from the log onto the wire. The driver's own
 * diagnosis stays reachable, in one place, on `cause`.
 */
export const DUPLICATE_RECORD_CODE = 'DUPLICATE_RECORD' as const;

/** The conflict status the engine's sibling 409 refusals declare. */
const DUPLICATE_RECORD_STATUS = 409 as const;

/**
 * What the user-facing sentences name: the display labels of the refused
 * write's object and conflicting field, the composite unique index's fields
 * when one was matched, and the writer's locale to render the end user's
 * sentence in.
 */
type DuplicateRecordLabels = {
  readonly object?: string;
  readonly field?: string;
  /**
   * The fields of the declared unique index the store's composite key matched,
   * in the index's declared order, each with its display label (absent where
   * the field has none). Absent when no declared index matched.
   */
  readonly uniqueFields?: ReadonlyArray<{ readonly name: string; readonly label?: string }>;
  /** The writer's locale and the deployment's translation hook; absent ⇒ `en`. */
  readonly messages?: Pick<ValidationMessageContext, 'locale' | 'translate'>;
};

export class DuplicateRecordError extends Error {
  readonly code = DUPLICATE_RECORD_CODE;
  readonly status = DUPLICATE_RECORD_STATUS;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads (the CLI `--json` envelope). `status` stays for the HTTP doors, which read it. */
  readonly httpStatus = DUPLICATE_RECORD_STATUS;
  /**
   * The driver's own error, whole.
   *
   * DECLARED on the class rather than merely assigned, because this repo
   * compiles against `lib: ES2020`, where `Error` has no `cause` member and no
   * `ErrorOptions` to pass one through the constructor — so an undeclared
   * assignment would be invisible to every TypeScript consumer of the very
   * field this envelope's contract rests on.
   */
  readonly cause: unknown;
  /** The remedy half — see the module header on why it is not in `message`. */
  readonly developerMessage: string;
  /**
   * [#26867] The conflicting field's display name in the writer's locale, when
   * it has one (a translation, else its declared `label`); absent otherwise.
   * See the module header.
   */
  readonly fieldLabel?: string;
  /**
   * The end user's sentence, in the writer's locale, from the platform's
   * operation catalog — what the HTTP doors ship as the 409 body's `error`.
   * See the module header, and on why it is not `userMessage`.
   */
  readonly endUserMessage: string;

  constructor(
    /** The object the refused write targeted. */
    public readonly object: string,
    cause: unknown,
    /** The conflicting column, when the dialect determinably named one. */
    public readonly field?: string,
    /** The display labels the user-facing `message` names them by; absent ⇒ the API name. */
    labels?: DuplicateRecordLabels,
  ) {
    const uniqueFields = field ? undefined : labels?.uniqueFields;
    super(
      buildDuplicateMessage(
        labels?.object || object,
        field ? [labels?.field || field] : uniqueFields?.map((f) => f.label || f.name),
      ),
    );
    this.name = 'DuplicateRecordError';
    this.cause = cause;
    if (field && labels?.field) this.fieldLabel = labels.field;
    this.endUserMessage = buildEndUserMessage(field ? labels?.field : undefined, uniqueFields, labels?.messages);
    this.developerMessage =
      `Duplicate record refused on object '${object}'` +
      (field ? `, field '${field}'` : '') +
      (uniqueFields ? `, unique index fields ${uniqueFields.map((f) => `'${f.name}'`).join(', ')}` : '') +
      `. The driver refused this write as a unique-constraint violation. Its own error is attached ` +
      `as \`cause\`. Branch on the platform code (ADR-0112), never on a dialect's code or message, ` +
      `so the handling survives a change of store: over the HTTP API this refusal is reported as ` +
      `\`code === 'UNIQUE_VIOLATION'\` on every route, whole-request and per-row alike; inside the ` +
      `engine the thrown class carries \`code === '${DUPLICATE_RECORD_CODE}'\`. To make the write ` +
      `idempotent, catch it and treat the row as already present.`;
  }
}

/**
 * The user-facing sentence, naming the object and the field by label (or by API
 * name where none is declared — the caller has already chosen).
 *
 * ⛔ It must not begin with a SQL verb. `@objectstack/rest`'s importer runs
 * every row error through `sanitizeRowError`, whose SQL backstop replaces any
 * message STARTING with `insert`/`update`/`delete`/… with generic text — so a
 * message opening "Insert on 'x' …" would be thrown away by a guard written
 * against leaked driver statements. Measured, not guessed.
 */
function buildDuplicateMessage(object: string, fields?: readonly string[]): string {
  return (
    `Duplicate record refused on '${object}': ` +
    (fields?.length === 1
      ? `a unique constraint on '${fields[0]}' already holds this value. `
      : fields && fields.length > 1
        ? `a unique constraint on ${fields.map((f) => `'${f}'`).join(', ')} already holds these values. `
        : 'a unique constraint already holds these values. ') +
    'No record was written.'
  );
}

/**
 * The end user's sentence, rendered from the operation catalog in the writer's
 * locale: the one field's label, the composite index's labels as a list
 * spelled by the locale's `field_label_quoted` / `field_label_list_separator`
 * rules, or nothing named. A composite is named only when EVERY field has a
 * label — never an API name in this sentence.
 */
function buildEndUserMessage(
  fieldLabel: string | undefined,
  uniqueFields: DuplicateRecordLabels['uniqueFields'],
  messages: DuplicateRecordLabels['messages'],
): string {
  const opts = { locale: messages?.locale, translate: messages?.translate };
  if (fieldLabel) {
    return renderOperationMessage({ messageKey: 'duplicate_record_field', params: { field: fieldLabel } }, opts);
  }
  const labels = uniqueFields?.map((f) => f.label);
  if (labels && labels.length > 1 && labels.every((l): l is string => typeof l === 'string' && l.length > 0)) {
    const separator = renderOperationMessage({ messageKey: 'field_label_list_separator' }, opts);
    const list = labels
      .map((label) => renderOperationMessage({ messageKey: 'field_label_quoted', params: { label } }, opts))
      .join(separator);
    return renderOperationMessage({ messageKey: 'duplicate_record_fields', params: { fields: list } }, opts);
  }
  return renderOperationMessage({ messageKey: 'duplicate_record' }, opts);
}

/**
 * A write door's driver-error exit — `insert` (#14095) and `update` (commit 9d7f7259f),
 * by-id and predicate alike: the platform envelope for a unique violation, or
 * the caller's own error unchanged for anything else.
 *
 * **Unrecognised is passed through untouched**, which is the whole of the
 * negative contract: a NOT NULL violation, a deadlock, a missing table and an
 * unreachable store all leave the door exactly as they did before. The verdict
 * is {@link isUniqueViolationError} — never a dialect sniff and never a message
 * match written here.
 *
 * Idempotent: an error that is already this envelope is returned as-is, so a
 * seam that wraps a value another seam already wrapped cannot bury the driver's
 * error one `cause` step deeper.
 *
 * `messages` is the write's message context — its locale and translator, the
 * one the record validator renders with — and the labels are read in it.
 */
export function envelopeUniqueViolation(
  error: unknown,
  object: string,
  schema?: unknown,
  messages?: ValidationMessageContext,
): unknown {
  if (error instanceof DuplicateRecordError) return error;
  if (!isUniqueViolationError(error)) return error;
  const field = uniqueViolationField(error);
  const uniqueFields = field ? undefined : declaredCompositeIndex(schema, uniqueViolationColumns(error));
  return new DuplicateRecordError(object, error, field, {
    ...displayLabels(schema, object, field, messages),
    ...(uniqueFields ? { uniqueFields: uniqueFields.map((name) => ({ name, label: fieldDisplayLabel(schema, object, name, messages) })) } : {}),
    ...(messages ? { messages: { locale: messages.locale, translate: messages.translate } } : {}),
  });
}

/**
 * The `fields` of the unique index the object DECLARES whose field set equals
 * the composite key the store named — in the index's declared order — or
 * `undefined` when none matches exactly. The store's side arrives with the
 * organization key part already set aside (`uniqueViolationColumns`), which
 * is what a `unique: 'organization'` index lists: only its authored fields.
 * The declared side is compared as written, so a legacy hand-written global
 * index that lists the organization column itself matches nothing and names
 * nothing — the conservative answer. A non-unique index never matches: it
 * refuses nothing.
 */
function declaredCompositeIndex(schema: unknown, columns: readonly string[] | undefined): readonly string[] | undefined {
  if (!columns || columns.length < 2) return undefined;
  const indexes = (schema as { indexes?: unknown } | undefined)?.indexes;
  if (!Array.isArray(indexes)) return undefined;
  const wanted = new Set(columns);
  if (wanted.size !== columns.length) return undefined;
  for (const raw of indexes) {
    const index = raw as { fields?: unknown; unique?: unknown } | null;
    if (!index || typeof index !== 'object') continue;
    if (index.unique !== 'global' && index.unique !== 'organization') continue;
    if (!Array.isArray(index.fields) || !index.fields.every((f): f is string => typeof f === 'string')) continue;
    const declared = index.fields;
    if (declared.length === wanted.size && new Set(declared).size === declared.length && declared.every((f) => wanted.has(f))) {
      return declared;
    }
  }
  return undefined;
}

/**
 * One field's display label in the writer's locale — a translation, else its
 * declared `label` — or `undefined` when it has neither (the API name is never
 * returned as a label). The ladder {@link displayLabels} climbs for `field`.
 */
function fieldDisplayLabel(
  schema: unknown,
  object: string,
  field: string,
  messages: ValidationMessageContext | undefined,
): string | undefined {
  const s = schema as { fields?: Record<string, { label?: unknown } | undefined> } | undefined;
  const declared = typeof s?.fields?.[field]?.label === 'string' && (s.fields[field]!.label as string).trim() !== ''
    ? (s.fields[field]!.label as string).trim()
    : undefined;
  const label = resolveFieldLabel(field, { label: declared }, messages && { ...messages, objectName: object });
  return label === field && declared === undefined ? undefined : label;
}

/**
 * The display labels of the object and of the conflicting field, read off the
 * registry's schema for the written object in the writer's locale: translation
 * bundle → declared `label`, the ladder `objectDisplayLabel` and
 * `resolveFieldLabel` climb. Their last rung, the API name itself, is not
 * returned: the sentence then falls back to the API name and `fieldLabel`
 * stays absent.
 */
function displayLabels(
  schema: unknown,
  object: string,
  field: string | undefined,
  messages: ValidationMessageContext | undefined,
): DuplicateRecordLabels {
  const s = schema as { label?: unknown; fields?: Record<string, { label?: unknown } | undefined> } | undefined;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const declaredObject = text(s?.label);
  const declaredField = field ? text(s?.fields?.[field]?.label) : undefined;
  const objectLabel = objectDisplayLabel(object, declaredObject, messages ?? {});
  const fieldLabel = field
    ? resolveFieldLabel(field, { label: declaredField }, messages && { ...messages, objectName: object })
    : undefined;
  return {
    object: objectLabel === object && declaredObject === undefined ? undefined : objectLabel,
    field: fieldLabel === field && declaredField === undefined ? undefined : fieldLabel,
  };
}
