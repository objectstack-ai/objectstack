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
 *   the email allowlist or the creator. Beside them, `object_label`: the shared
 *   object's label in the request's locale (see "The object label" below), so
 *   the page can name what was shared without the meta door it cannot open.
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
 * `currencyConfig` (its mode, a fixed code, and — for a `record`-mode amount,
 * ADR-0144 D2 — the `currencyField` pointer, only while `record` also carries
 * that code field, so a redacted code field's name is never disclosed); and a
 * lookup's `reference` (target object) and authored
 * `displayField`; and `hidden: true` for a field the object declares hidden
 * (`FieldSchema.hidden`, which the injected scope and queue columns carry at
 * their source), so the page leaves off what the record page leaves off. The
 * field labels are the authored ones the object schema holds. A lookup's value
 * stays what the record read returns — the stored id; nothing here reads the
 * target record.
 *
 * ## The object label
 *
 * `link.object_label` is the object's label as `GET /meta/object/NAME` serves
 * it in the request's locale: the translation bundle laid over the served
 * `label` (the schema the engine answers, a tenant rename or a code
 * extension's rename folded in) by `translateObject`
 * (`@objectstack/spec/system`), with the inputs that route hands it for the
 * label:
 *
 * - the resolve options `metaTranslateOptions` (`@objectstack/rest`) builds —
 *   the locale, the declared fallback locale, and the authored language (the
 *   declared `sourceLocale`, else the default locale);
 * - `packagedBase`, the packaged (code-layer) declaration the meta door reads
 *   through `packagedObjectBaseOf(protocol, 'object', NAME)`, which for an
 *   object is the protocol's `getPackagedObjectBase(NAME)`. A served label
 *   that diverged from the packaged one (a rename) is authored data, and the
 *   deployment catalog's translation of the OLD label is not laid over it
 *   (ADR-0029 D9.2a);
 * - no `pairBundle`: an `object` is extended, never replaced (ADR-0146 D10;
 *   `servedOverrideBaseOf` answers none for it), so the meta door hands the
 *   object translator no pair catalog either, and a `.custom` pair's
 *   translation of the label reaches both through the deployment bundle.
 *
 * The locale is the request's `Accept-Language` top tag, else the i18n
 * service's default locale, as the meta door reads it. No i18n service, no
 * locale, a bundle with no entry, or a service that throws: the served label.
 * A protocol that cannot answer the packaged base (absent, no accessor, a
 * throw) is read as "no baseline known", the meta door's rule. An object that
 * declares no label carries no `object_label`, and the page names it by
 * `object_name`.
 *
 * ## The public answers' `Vary`
 *
 * {@link SHARE_LINK_PUBLIC_VARY} is the `Vary` both mounts' public routes
 * answer with: the password pair (`SHARE_PASSWORD_VARY`) and, because the
 * object label is read in the request's locale, `Accept-Language`.
 */

import type { ResolveShareLinkResult, ShareLink } from '@objectstack/spec/contracts';
import { preferredLocaleFromHeader, translateObject, type TranslationBundle } from '@objectstack/spec/system';
import { SHARE_PASSWORD_VARY } from './share-password-header.js';

/**
 * The `Vary` value both public share-link routes (`/resolve` and `/messages`)
 * answer with: the password header pair, and `Accept-Language`, which the
 * resolve answer's `link.object_label` is read in. For a cache that does not
 * honour their `Cache-Control: no-store`.
 */
export const SHARE_LINK_PUBLIC_VARY = `${SHARE_PASSWORD_VARY}, Accept-Language`;

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
  /**
   * A `record`-mode amount's sibling code field (ADR-0144 D2): the page reads
   * the record's code from it. Projected only when the answer's `record`
   * carries that field.
   */
  currencyField?: string;
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
  /** The object declares the field hidden from the default UI (`FieldSchema.hidden`). */
  hidden?: true;
}

/**
 * The link columns a holder of the token may read, and the shared object's
 * label in the request's locale (absent when the object declares none).
 */
export type ShareLinkResolvedLink = Pick<
  ShareLink,
  'id' | 'token' | 'object_name' | 'record_id' | 'permission' | 'audience' | 'expires_at' | 'label' | 'created_at'
> & { object_label?: string };

/** The slice of `II18nService` the object label is translated through — what the metadata route reads. */
export interface ShareLinkLabelI18n {
  getLocales?: () => string[];
  getTranslations?: (locale: string) => Record<string, unknown>;
  getFallbackLocale?: () => string | undefined;
  getDefaultLocale?: () => string | undefined;
  /** The declared `i18n.sourceLocale`; read before `getDefaultLocale` as the authored language. */
  getSourceLocale?: () => string | undefined;
}

/** The slice of the metadata protocol the meta door reads an object's packaged base through. */
export interface ShareLinkLabelProtocol {
  getPackagedObjectBase?: (name: string) => unknown;
}

/** The request facts the answer's `link.object_label` is read in — see "The object label". */
export interface ShareLinkAnswerLocale {
  /** The request's `Accept-Language` header value, as it arrived. */
  acceptLanguage?: string | null;
  /** The deployment's i18n service, when one is registered. */
  i18n?: ShareLinkLabelI18n;
  /** The request's metadata protocol (`'protocol'` service), for the object's packaged base. */
  protocol?: ShareLinkLabelProtocol;
}

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

function projectField(field: Record<string, unknown>, carried: (key: string) => boolean): ShareLinkFieldDisplay {
  const out: ShareLinkFieldDisplay = {};
  if (typeof field.label === 'string') out.label = field.label;
  if (typeof field.type === 'string') out.type = field.type;
  const options = projectOptions(field.options);
  if (options) out.options = options;
  if (field.multiple === true) out.multiple = true;
  if (isPlainObject(field.currencyConfig)) {
    const { currencyMode, defaultCurrency, currencyField } = field.currencyConfig;
    out.currencyConfig = {
      ...(typeof currencyMode === 'string' ? { currencyMode } : {}),
      ...(typeof defaultCurrency === 'string' ? { defaultCurrency } : {}),
      // The pointer names another field: kept only when that field is one the
      // record shows, so the answer still describes nothing the record hides.
      // Without it a record-mode amount renders as a plain number.
      ...(typeof currencyField === 'string' && carried(currencyField) ? { currencyField } : {}),
    };
  }
  if (typeof field.reference === 'string') out.reference = field.reference;
  if (typeof field.displayField === 'string') out.displayField = field.displayField;
  if (field.hidden === true) out.hidden = true;
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
  const carried = (key: string) =>
    !redactFields.includes(key) && Object.prototype.hasOwnProperty.call(record, key);
  for (const key of Object.keys(record)) {
    if (redactFields.includes(key) || !Object.prototype.hasOwnProperty.call(declared, key)) continue;
    const field = declared[key];
    if (isPlainObject(field)) fields[key] = projectField(field, carried);
  }
  return fields;
}

/** A non-empty string, or `undefined`. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Every locale the service holds, keyed by locale, as the metadata route builds it; `undefined` when it holds none. */
function bundleOf(i18n: ShareLinkLabelI18n): TranslationBundle | undefined {
  if (typeof i18n.getLocales !== 'function' || typeof i18n.getTranslations !== 'function') return undefined;
  const bundle: Record<string, unknown> = {};
  for (const locale of i18n.getLocales()) {
    const data = i18n.getTranslations(locale);
    if (data && typeof data === 'object') bundle[locale] = data;
  }
  return Object.keys(bundle).length > 0 ? (bundle as TranslationBundle) : undefined;
}

/**
 * The object's packaged base as the meta door reads it (`packagedObjectBaseOf`
 * in `@objectstack/rest`, its `object` row: the protocol's
 * `getPackagedObjectBase`) — `undefined` on every uncertainty, that reader's
 * rule: no protocol, no accessor, a throw.
 */
function packagedObjectBaseOf(protocol: ShareLinkLabelProtocol | undefined, name: string): unknown {
  if (!protocol || typeof protocol.getPackagedObjectBase !== 'function') return undefined;
  try {
    return protocol.getPackagedObjectBase(name);
  } catch {
    return undefined;
  }
}

/**
 * The shared object's label in the request's locale — see "The object label"
 * in the module header. `undefined` when the schema declares no label.
 */
export function sharedObjectLabel(schema: unknown, request?: ShareLinkAnswerLocale): string | undefined {
  if (!isPlainObject(schema)) return undefined;
  const authored = textOf(schema.label);
  const name = textOf(schema.name);
  const i18n = request?.i18n;
  if (!authored || !name || !i18n) return authored;
  try {
    const locale = preferredLocaleFromHeader(request?.acceptLanguage)
      ?? (typeof i18n.getDefaultLocale === 'function' ? textOf(i18n.getDefaultLocale()) : undefined);
    if (!locale) return authored;
    const bundle = bundleOf(i18n);
    if (!bundle) return authored;
    const fallback = typeof i18n.getFallbackLocale === 'function' ? textOf(i18n.getFallbackLocale()) : undefined;
    // The authored language: the declared `sourceLocale`, else the users'
    // `defaultLocale` (the metadata route's `metaTranslateOptions` rule).
    const source = typeof i18n.getSourceLocale === 'function' ? textOf(i18n.getSourceLocale()) : undefined;
    const defaultLocale = source ?? (typeof i18n.getDefaultLocale === 'function' ? textOf(i18n.getDefaultLocale()) : undefined);
    const packagedBase = packagedObjectBaseOf(request?.protocol, name);
    const translated = translateObject({ name, label: authored }, bundle, {
      locale,
      ...(fallback ? { fallbackChain: [fallback] } : {}),
      ...(defaultLocale ? { defaultLocale } : {}),
      ...(packagedBase !== undefined ? { packagedBase } : {}),
    });
    return textOf(translated.label) ?? authored;
  } catch {
    // A misbehaving i18n service never fails the resolve: the declared label stands.
    return authored;
  }
}

/**
 * The resolve answer both mounts serve, from the record they read with a system
 * context, the token's resolution, the shared object's schema
 * (`engine.getSchema(link.object_name)`), and the request facts the object's
 * label is read in.
 */
export function buildShareLinkResolveAnswer(
  record: unknown,
  resolved: ResolveShareLinkResult,
  schema: unknown,
  request?: ShareLinkAnswerLocale,
): ShareLinkResolveAnswer {
  const served = redactSharedRecord(record, resolved.redactFields);
  const link = resolved.link;
  const objectLabel = sharedObjectLabel(schema, request);
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
      ...(objectLabel ? { object_label: objectLabel } : {}),
    },
    redactFields: resolved.redactFields,
    fields: projectSharedRecordFields(schema, served, resolved.redactFields),
  };
}
