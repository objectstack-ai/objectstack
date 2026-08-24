// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Record title resolution (#11293)
 *
 * "What is this record called?" — answered once, server-side, from the object's
 * own declaration, so that no consumer has to re-compose it.
 *
 * ## The gap this closes
 *
 * A hook body ships body-only: the CLI lowers `handler` to `body.source` and the
 * runtime evaluates it in QuickJS with no module scope. Two consequences meet
 * there. A body cannot reach a **formula** field (`ctx.previous` / `ctx.input`
 * carry stored columns; a formula is computed on read), and nothing on `ctx`
 * answers "what is this record called?" — no accessor for the object's
 * `nameField`, and no way to resolve one for a **lookup-related** record, which
 * arrives as a bare id.
 *
 * So the only way for a body to name a record in a sentence was to re-implement
 * the object's title inline, per hook. Measured in the exemplar app: **five**
 * inline reimplementations, and in **four of the five** the `nameField` is a
 * FORMULA (`display_title`, `full_name`) — only one is a real column. Each copy
 * duplicates a formula declared once on the object and drifts from it in
 * silence.
 *
 * The measured consequence was not merely duplication. The cheap thing to write
 * when there is no title accessor is `record.id` — the one identifier a body
 * always holds — and that shipped: eight sites across four hooks put a raw
 * primary key into user-facing prose, and a walkthrough found 15 of 31 tasks in
 * a demo org titled by a 16-character key. The AI-authoring angle is the sharp
 * half: an agent writing a hook reaches for `${record.id}` precisely because it
 * is the value in scope. This module exists to make the correct alternative
 * closer to hand than the wrong one.
 *
 * ## Scope — design (a), and only (a)
 *
 * Maintainer ruling, 2026-08-23, live PM chat, verbatim:
 *
 * > 「10950 不考虑存量，其他接受你的建议」
 *
 * ⇒ a **minimal `ctx` title accessor**: this record's `nameField` and a
 * lookup-related record's `nameField`, with formula evaluated server-side.
 * Two neighbouring designs were considered and are **NOT approved**: hydrating
 * `nameField` into the hook pre-image (b), and general formula-field
 * readability from hook bodies (c). Neither is built here, and neither is
 * needed by what is: {@link resolveRecordTitle} reads one declared field — the
 * title pointer — and evaluates it only when that pointer names a formula.
 *
 * ## What is deliberately NOT here
 *
 * **No id fallback.** A record with no resolvable title answers `undefined`,
 * never its primary key. Falling back to the id would reintroduce, inside the
 * platform, the exact defect the accessor exists to remove — and it would do it
 * invisibly, since an id-shaped string is a perfectly plausible title to
 * whatever renders it. A caller that genuinely wants a fallback writes one and
 * owns it.
 *
 * **No second formula dialect.** Formula evaluation is delegated to
 * `evaluateFormulaField` (`engine.ts`), which drives the read path's own plan
 * builder and evaluator. A title composed here and a title read back from
 * `GET /data/:object/:id` are the same expression evaluated the same way.
 */

import { referenceTargetOf } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { evaluateFormulaField } from './engine.js';

/**
 * The field that carries the object's primary title.
 *
 * [ADR-0079] `nameField` is the canonical primary-title pointer;
 * `displayNameField` is the deprecated alias, still honoured. This is the SAME
 * resolution `expandSearchOnAst` performs when it decides which field a bare
 * `search` term matches against (`engine.ts`), stated once so the two cannot
 * answer differently for one object.
 */
export function titleFieldOf(schema: unknown): string | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const s = schema as { nameField?: unknown; displayNameField?: unknown };
  const pointer = typeof s.nameField === 'string' && s.nameField
    ? s.nameField
    : typeof s.displayNameField === 'string' && s.displayNameField
      ? s.displayNameField
      : undefined;
  return pointer;
}

/**
 * Normalize a resolved title value to the string a message can carry.
 *
 * `null` and `undefined` are ABSENCE and answer `undefined` — a formula that
 * did not evaluate lands here as `null` (`applyFormulaPlan`'s own
 * `r.ok ? … : null`), so an uncomputable title can never be mistaken for a
 * computed one. Everything else is stringified, `''` included: a record whose
 * title really is blank is a different fact from a record that has no title
 * pointer at all, and collapsing the two would hide a misconfigured object
 * behind a `??` in every caller.
 */
function toTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return undefined;
  return String(value);
}

/**
 * This record's title, resolved from the object's declaration.
 *
 * Two shapes, one entry point — and the FORMULA shape is the majority case, not
 * the exotic one (four of the five measured objects):
 *
 *  - the title pointer names a **formula** field → evaluated against the record
 *    already in hand, with **no round trip**. `evaluateFormulaField` plans just
 *    that one field and runs the read path's evaluator over a copy;
 *  - the title pointer names a **stored column** → read straight off the
 *    record.
 *
 * The plain-column case falls out of the formula case rather than the reverse,
 * which is the ordering the measurement demands: an accessor written
 * column-first answers the wrong four of five.
 *
 * `undefined` when the object declares no title pointer, when the pointed-at
 * field is absent from the record, or when a formula title did not evaluate.
 * Never the record's id — see this module's header.
 */
export function resolveRecordTitle(
  schema: unknown,
  record: Record<string, unknown> | null | undefined,
  execCtx?: ExecutionContext,
): string | undefined {
  const field = titleFieldOf(schema);
  if (!field || !record || typeof record !== 'object') return undefined;

  // The formula leg first — `evaluateFormulaField` answers `undefined` for a
  // field that is not a declared formula, which is exactly the signal to read
  // the stored column instead.
  const computed = evaluateFormulaField(schema, record, field, execCtx);
  if (computed !== undefined) return toTitle(computed);

  return toTitle(record[field]);
}

/** Where a related record's title has to be read from. */
export interface RelatedTitleTarget {
  /** The object the reference field points at. */
  object: string;
  /** The related record's id, as stored on this record. */
  id: string;
}

/**
 * Thrown when a title lookup names a field that cannot point at a record.
 *
 * Loud rather than `undefined`, deliberately: a typo'd field name and an empty
 * lookup column are opposite facts, and answering both with "no title" is how a
 * body ends up silently unable to name anything. This is a plain `Error` and
 * carries NO `code` — ADR-0112 makes `error.code` a closed wire vocabulary, and
 * `rest-server.ts` promotes a thrown `.code` straight onto the response
 * envelope, so adding one here would mint an unregistered wire code by side
 * effect.
 */
export class RecordTitleFieldError extends Error {
  override readonly name = 'RecordTitleFieldError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Resolve `field` on this record to the related record whose title is wanted.
 *
 * **Which target** is {@link referenceTargetOf} — the spec's single arbiter of
 * "what does this reference field point at", the same one the `$expand` gate
 * and the engine's own expansion ask. Reading `field.reference` raw here would
 * reintroduce cloud#983: a `{ type: 'user' }` field's target is fixed BY THE
 * TYPE (`sys_user`) and carries no `reference` of its own, so a raw read makes
 * a fully-specified field look targetless.
 *
 * Answers `undefined` — not an error — when the field is declared and simply
 * EMPTY on this record: an unset lookup is an ordinary state, and a hook that
 * refuses the write because an optional relationship is blank would be worse
 * than the hand-composed title it replaced. A field that is not declared, or
 * that is not a reference type at all, throws {@link RecordTitleFieldError}.
 */
export function resolveRelatedTitleTarget(
  schema: unknown,
  record: Record<string, unknown> | null | undefined,
  field: string,
  originLabel: string,
): RelatedTitleTarget | undefined {
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  const def = fields && typeof fields === 'object' ? fields[field] : undefined;
  if (!def) {
    throw new RecordTitleFieldError(
      `${originLabel}: '${field}' is not a declared field on this object, so it cannot name a related record`,
    );
  }
  const target = referenceTargetOf(def);
  if (!target) {
    const type = (def as { type?: unknown }).type;
    throw new RecordTitleFieldError(
      `${originLabel}: field '${field}' (type '${String(type)}') does not point at another record — ` +
        `pass a lookup / master_detail / user / tree field, or call the accessor with no argument for this record's own title`,
    );
  }
  const raw = record && typeof record === 'object' ? record[field] : undefined;
  // An EXPANDED reference (`$expand` overwrites the id in place with the
  // related record) still carries its own id; a multi-value reference is not a
  // single record and has no single title.
  const id = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as { id?: unknown }).id
    : raw;
  if (id === null || id === undefined || id === '') return undefined;
  if (typeof id !== 'string' && typeof id !== 'number') return undefined;
  return { object: target, id: String(id) };
}
