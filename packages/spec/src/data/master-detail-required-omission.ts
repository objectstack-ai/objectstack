// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0055 §1 as amended · maintainer ruling A on the optional master] The
 * spec-declared record that an AUTHOR omitted `required` on a `master_detail`
 * field of a `controlled_by_parent` object — kept by `defineStack` on the
 * field it returns, read by `@objectstack/lint`.
 *
 * ## The gap this record closes
 *
 * `required` is `z.boolean().default(false)` (`field.zod.ts`), so the parse
 * writes `false` into an omitted `required` before anything downstream reads
 * the field. Under `controlled_by_parent` that makes the omission
 * indistinguishable from the explicit `required: false` that ruling A admits
 * as the OPTIONAL master. The ruling keeps exactly that reading at the parse
 * (an omitted `required` is admitted as the optional master; nothing refuses
 * the stack), and pairs it with a lint promise: `os lint`'s
 * `relationship/master-detail-required` reports the omitted spelling at
 * `error`, so the author writes `true` or `false`. A user's
 * `objectstack.config.ts` calls `defineStack` itself, so on the default
 * (strict) door every author-time verb receives the parsed stack, where the
 * omission is already gone — and the promised finding never fired.
 *
 * So the one party that sees both the authored field and the parsed one —
 * `defineStack`'s strict path, which holds the normalized input it parses —
 * RECORDS the omission on the parsed field it returns, and
 * {@link masterDetailRequiredOmitted} is the one reader. Nothing about the
 * parsed value changes: `required` stays `false`, so every runtime reader
 * (the security plugin's master resolution, `controlledByParentMasterOf`)
 * reads the optional master exactly as the ruling has it. The record only
 * tells the linter what the author wrote.
 *
 * ## Why a symbol on the field, not a key in it
 *
 * The record must be invisible to everything that reads the field as DATA:
 * the strict `FieldSchema` (which refuses an undeclared key), the compiled
 * `dist/objectstack.json`, and every `Object.keys` walk. It lives on the
 * FIELD rather than on the stack (where `stack-provenance.ts` keeps the
 * producer's mark) because the CLI's config load spreads the default export
 * into a new top-level object, which drops a stack-level symbol, while the
 * `objects` array — and each field definition in it — reaches the linter by
 * reference. `Symbol.for` (the global registry) rather than a module-local
 * symbol, so a CLI that loads its own copy of this package reads the key the
 * config's copy wrote. Precedent: `stack-provenance.ts`,
 * `filter-subtree-provenance.ts`.
 *
 * ## The fail direction is the pre-record behaviour
 *
 * Non-enumerable, non-writable and non-configurable, so a later actor cannot
 * flip it; every copy (`{ ...spread }`, `JSON.stringify`, structured clone, a
 * copy-on-write conversion) DROPS it. A field that lost the record reads as
 * an explicit `required: false` — the optional master — which is exactly what
 * every door read before the record existed: no stack is refused because of
 * it, and no finding appears that the author did not earn.
 *
 * Only the reader is published (`@objectstack/spec/data`); stamping belongs
 * to `defineStack` alone, so no third party can attest an authored spelling
 * it never saw.
 */

/** The symbol key the record lives under on a parsed `master_detail` field. */
const MASTER_DETAIL_REQUIRED_OMITTED: symbol = Symbol.for('objectstack.field.masterDetailRequiredOmitted');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Does this parsed field carry `defineStack`'s record that its author omitted
 * `required` (see the module header)? `true` only for a field the producer
 * stamped: a `master_detail` field of a `controlled_by_parent` object whose
 * authored definition wrote no `required`. Any other value — an unstamped
 * field, a copy, a non-object — answers `false`, and reads as written.
 */
export function masterDetailRequiredOmitted(field: unknown): boolean {
  if (field === null || typeof field !== 'object') return false;
  return (field as Record<symbol, unknown>)[MASTER_DETAIL_REQUIRED_OMITTED] === true;
}

/**
 * Stamp the record on every parsed `master_detail` field of a
 * `controlled_by_parent` object whose AUTHORED definition omits `required`
 * (the key absent, or `undefined`). `authoredObjects` is the normalized input
 * the parse read, `parsedObjects` what it returned; the parse keeps the
 * array's order and length, and each pair is matched by object `name` too, so
 * a pair that does not line up is skipped (no record, the pre-record reading).
 *
 * The sharing model and the field type are read on the PARSED side: they are
 * what the stack carries. A non-extensible field cannot take the property and
 * is left unstamped.
 *
 * Internal to `defineStack`: NOT re-exported from the package entry.
 */
export function recordMasterDetailRequiredOmissions(authoredObjects: unknown, parsedObjects: unknown): void {
  if (!Array.isArray(authoredObjects) || !Array.isArray(parsedObjects)) return;
  for (let i = 0; i < parsedObjects.length; i++) {
    const parsed = parsedObjects[i];
    const authored = authoredObjects[i];
    if (!isRecord(parsed) || !isRecord(authored)) continue;
    if (parsed.sharingModel !== 'controlled_by_parent') continue;
    if (authored.name !== parsed.name) continue;
    const parsedFields = parsed.fields;
    const authoredFields = authored.fields;
    if (!isRecord(parsedFields) || !isRecord(authoredFields)) continue;
    for (const [key, field] of Object.entries(parsedFields)) {
      if (!isRecord(field) || field.type !== 'master_detail') continue;
      const written = authoredFields[key];
      if (!isRecord(written) || written.required !== undefined) continue;
      if (!Object.isExtensible(field) || masterDetailRequiredOmitted(field)) continue;
      Object.defineProperty(field, MASTER_DETAIL_REQUIRED_OMITTED, {
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    }
  }
}
