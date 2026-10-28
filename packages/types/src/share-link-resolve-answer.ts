// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26991] The answer of `GET /share-links/:token/resolve` — built in ONE place
 * for both mounts of that public route: `plugin-sharing`'s
 * `registerShareLinkRoutes` and the runtime dispatcher's `/share-links` domain.
 * The runtime has the plugin as a dev dependency only, so the plugin cannot be
 * the home; both already depend on this package, as they do for the password
 * header reading (`share-password-header.ts`), so the helper adds no edge.
 *
 *   { record, link, redactFields, fields }
 *
 * - `record` — the shared row with the link's effective `redactFields` (object
 *   default ∪ per-link) stripped, exactly as both mounts stripped it before.
 * - `link` — the nine link columns a holder may read; never the password hash,
 *   the email allowlist or the creator.
 * - `fields` — the DISPLAY projection of the fields `record` carries, keyed by
 *   field name. The route's visitor is usually anonymous and the meta door
 *   (`GET /meta/object/NAME`) refuses an anonymous caller, so this is the only
 *   place the shared-record page can read a field's authored label from.
 *
 * ## The projection's boundary
 *
 * A field is projected only when `record` carries its key AFTER redaction and
 * the shared object declares it. So a redacted field is absent from both
 * `record` and `fields`, a field the record read never returns (`internal`) is
 * absent from both, and no other field of the object is described — the answer
 * discloses nothing about the object the record itself does not already show.
 * ⛔ Never widen it to the object's whole field map: that is the anonymous
 * metadata read the meta door refuses.
 *
 * Each entry carries only what a read-only renderer needs to draw the value:
 * the authored `label` and `type`; a picklist's `options` (value, label and
 * colour — never `default` or visibility rules); `multiple`; a currency field's
 * `currencyConfig`; and a lookup's `reference` (target object) and authored
 * `displayField`. The labels are the authored ones the object schema holds:
 * the resolve read path has no caller-locale seam, and this module builds none.
 * A lookup's value stays what the record read returns — the stored id; nothing
 * here reads the target record.
 */

import type { ResolveShareLinkResult, ShareLink } from '@objectstack/spec/contracts';

/** One picklist option, as the shared-record page draws it. */
export interface ShareLinkFieldOption {
  value: string;
  label: string;
  color?: string;
}

/** A currency field's currency, as the object schema declares it. */
export interface ShareLinkFieldCurrencyConfig {
  currencyMode?: string;
  defaultCurrency?: string;
}

/** The display projection of one field the resolve answer's `record` carries. */
export interface ShareLinkFieldDisplay {
  label?: string;
  type?: string;
  options?: ShareLinkFieldOption[];
  multiple?: true;
  currencyConfig?: ShareLinkFieldCurrencyConfig;
  reference?: string;
  displayField?: string;
}

/** The link columns a holder of the token may read. */
export type ShareLinkResolvedLink = Pick<
  ShareLink,
  'id' | 'token' | 'object_name' | 'record_id' | 'permission' | 'audience' | 'expires_at' | 'label' | 'created_at'
>;

/** `data` of a served `GET /share-links/:token/resolve`. */
export interface ShareLinkResolveAnswer {
  record: unknown;
  link: ShareLinkResolvedLink;
  redactFields: string[];
  fields: Record<string, ShareLinkFieldDisplay>;
}

/** Strip `redactFields` from a record (also from each object of a top-level array). */
export function redactSharedRecord(record: unknown, redactFields: readonly string[]): unknown {
  if (!record || typeof record !== 'object' || redactFields.length === 0) return record;
  if (Array.isArray(record)) return record.map((r) => redactSharedRecord(r, redactFields));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (redactFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function projectOptions(options: unknown): ShareLinkFieldOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const out: ShareLinkFieldOption[] = [];
  for (const option of options) {
    if (!isPlainObject(option) || typeof option.value !== 'string' || typeof option.label !== 'string') continue;
    out.push({
      value: option.value,
      label: option.label,
      ...(typeof option.color === 'string' ? { color: option.color } : {}),
    });
  }
  return out;
}

function projectField(field: Record<string, unknown>): ShareLinkFieldDisplay {
  const out: ShareLinkFieldDisplay = {};
  if (typeof field.label === 'string') out.label = field.label;
  if (typeof field.type === 'string') out.type = field.type;
  const options = projectOptions(field.options);
  if (options) out.options = options;
  if (field.multiple === true) out.multiple = true;
  if (isPlainObject(field.currencyConfig)) {
    const { currencyMode, defaultCurrency } = field.currencyConfig;
    out.currencyConfig = {
      ...(typeof currencyMode === 'string' ? { currencyMode } : {}),
      ...(typeof defaultCurrency === 'string' ? { defaultCurrency } : {}),
    };
  }
  if (typeof field.reference === 'string') out.reference = field.reference;
  if (typeof field.displayField === 'string') out.displayField = field.displayField;
  return out;
}

/**
 * The display projection of the fields `record` carries — see the module
 * header for the boundary. `record` is the ALREADY-REDACTED record; a key in
 * `redactFields` is skipped all the same. An object schema the engine cannot
 * return projects nothing.
 */
export function projectSharedRecordFields(
  schema: unknown,
  record: unknown,
  redactFields: readonly string[],
): Record<string, ShareLinkFieldDisplay> {
  const fields: Record<string, ShareLinkFieldDisplay> = {};
  if (!isPlainObject(record) || !isPlainObject(schema) || !isPlainObject(schema.fields)) return fields;
  const declared = schema.fields;
  for (const key of Object.keys(record)) {
    if (redactFields.includes(key) || !Object.prototype.hasOwnProperty.call(declared, key)) continue;
    const field = declared[key];
    if (isPlainObject(field)) fields[key] = projectField(field);
  }
  return fields;
}

/**
 * The resolve answer both mounts serve, from the record they read with a system
 * context, the token's resolution, and the shared object's schema
 * (`engine.getSchema(link.object_name)`).
 */
export function buildShareLinkResolveAnswer(
  record: unknown,
  resolved: ResolveShareLinkResult,
  schema: unknown,
): ShareLinkResolveAnswer {
  const served = redactSharedRecord(record, resolved.redactFields);
  const link = resolved.link;
  return {
    record: served,
    link: {
      id: link.id,
      token: link.token,
      object_name: link.object_name,
      record_id: link.record_id,
      permission: link.permission,
      audience: link.audience,
      expires_at: link.expires_at,
      label: link.label,
      created_at: link.created_at,
    },
    redactFields: resolved.redactFields,
    fields: projectSharedRecordFields(schema, served, resolved.redactFields),
  };
}
