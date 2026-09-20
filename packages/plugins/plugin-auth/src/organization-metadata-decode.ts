// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18728] `sys_organization.metadata` reaches the wire DECODED on every route
 * that reads the row back — the producer half of the maintainer's ruling C
 * (batch #158 item 4): the spec declares `OrganizationSchema.metadata` an
 * object, so the producer emits an object rather than the consumer learning to
 * tolerate text.
 *
 * ## What was wrong, measured
 *
 * The column is a text column holding JSON (`sys_organization.metadata` is
 * `Field.textarea`, described "JSON-serialized organization metadata"), and
 * better-auth declares its own `organization.metadata` as `type: "string"`.
 * Its adapter factory's `transformOutput` decodes a string into JSON only for
 * a field declared `type: "json"` AND only when the adapter sets
 * `supportsJSON: false` — this adapter declares `supportsJSON: true`, so
 * neither half applies and the stored text passes straight through.
 *
 * Only better-auth's two WRITE paths decode it, and they do it in the plugin's
 * own organization adapter rather than in the transform:
 * `createOrganization` (`JSON.parse`) and `updateOrganization` (`parseJSON`).
 * Every READ path returns the row as the data adapter handed it over —
 * `findOrganizationById` (which serves `POST /organization/set-active` and
 * `POST /organization/delete`), `findFullOrganization` (`GET
 * /organization/get-full-organization`) and `listOrganizations` (`GET
 * /organization/list`, where the organization arrives through the factory's
 * fallback join, itself another `findOne` on this model).
 *
 * So all four read routes served the stored TEXT while
 * `@objectstack/spec/identity`'s `Organization` declared an object — a
 * published schema that could not parse a served body.
 *
 * ## Why the seam is the data adapter's READ verbs, and only those
 *
 * Every one of the four read routes reaches the row through this adapter's
 * `findOne` / `findMany`, so decoding there covers all four at once with no
 * per-route code and nothing to keep in sync (Route & surface ownership §1).
 *
 * ⛔ It must NOT be applied to `create` / `update`. better-auth's own
 * organization adapter decodes those two echoes itself, and it discriminates
 * on the value still being a string:
 * `metadata: organization.metadata && typeof organization.metadata === 'string'
 * ? JSON.parse(organization.metadata) : void 0`. Handing it an already-decoded
 * object would fold the create echo's `metadata` to `undefined` — the exact
 * shape of a regression that reads as "unset" rather than as an error.
 * `organization-metadata-decode.test.ts` pins both directions.
 *
 * ## Absent, not null
 *
 * The spec declares `metadata` `.optional()` — an object or the key absent,
 * never `null`. SQL stores an unset column as `null`, so an unset value is
 * DELETED here rather than passed on; a document store that never
 * materialised the column is already absent and is left alone.
 *
 * ## A value we cannot decode is left exactly as it is
 *
 * ⛔ Never invent a shape for text that will not parse, and ⛔ never throw:
 * either would turn one bad row into a read outage or into a silent "this
 * organization has no metadata". The undecodable value is passed through
 * untouched, which makes the spec parse at the consumer refuse the body and
 * name the field — loud, located, and distinguishable from an unset column
 * ("Absence must be loud"). The same applies to text that decodes to a JSON
 * scalar or array: it is not the declared shape, so it is not laundered into
 * one.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * Is `value` a JSON object — the one shape `OrganizationSchema.metadata`
 * declares (`z.record(z.string(), z.unknown())`)?
 *
 * Arrays are excluded deliberately: `typeof [] === 'object'` and an array
 * parses out of JSON text, but it is not a record.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Decode `metadata` on an organization row on its way OUT of the data adapter.
 *
 * Mutates `row` in place — the adapter's read verbs hand their result straight
 * to better-auth, so there is nothing to return and no copy to keep.
 *
 * A no-op for every other object, and a no-op for a row that carries no
 * `metadata` key at all.
 *
 * @param objectName The resolved ObjectStack object name the row came from.
 * @param row The row as the data engine returned it.
 */
export function decodeOrganizationMetadataOnRead(
  objectName: string,
  row: Record<string, unknown> | null | undefined,
): void {
  if (objectName !== SystemObjectName.ORGANIZATION) return;
  if (!row || typeof row !== 'object') return;
  if (!('metadata' in row)) return;

  const raw = row.metadata;

  // Unset: SQL `null`, an empty text column, or an explicit `undefined`.
  // The spec says absent, so make it absent.
  if (raw === null || raw === undefined || raw === '') {
    delete row.metadata;
    return;
  }

  // Already the declared shape — a document store, or a caller that decoded
  // upstream. Nothing to do.
  if (isJsonObject(raw)) return;

  // Anything that is not text is not ours to reinterpret.
  if (typeof raw !== 'string') return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Undecodable text: pass it through untouched so the consumer's spec parse
    // refuses the body and names the field. See the docblock.
    return;
  }

  // `JSON.parse('null')` is a legal parse of an unset-looking value.
  if (parsed === null) {
    delete row.metadata;
    return;
  }

  // A scalar or an array is not the declared record shape — leave the stored
  // text in place rather than laundering it into one.
  if (!isJsonObject(parsed)) return;

  row.metadata = parsed;
}
