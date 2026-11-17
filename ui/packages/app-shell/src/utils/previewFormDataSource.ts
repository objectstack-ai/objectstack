/**
 * The record form's data source under draft preview (objectstack#34807,
 * ADR-0037 Phase 1).
 *
 * Under `?preview=draft` the console's metadata reads come from the REST
 * `?preview=draft` overlay (`MetadataProvider`, through
 * `createConsoleMetadataClient({ previewDrafts: true })`), so a record form's
 * field NAMES include a field that exists only in a draft, while its field
 * DEFINITIONS come from `dataSource.getObjectSchema`, the adapter's published
 * read, which carries no preview flag. `ObjectForm` draws only a name the
 * definition declares.
 *
 * {@link usePreviewFormDataSource} joins the two at the call site, not in the
 * form: in preview it hands the form a proxy over the adapter whose
 * `getObjectSchema` answers {@link withDraftOnlyFields} over the overlay
 * document (the provider's own `getItem('object', name)`, which reads through
 * the preview client in preview). Outside preview it returns the adapter
 * ITSELF, so the published path keeps its single adapter read per document
 * (objectui#13044) unchanged.
 *
 * Preview stays read-only for data (ADR-0037 Phase 1: the data plane is
 * untouched; seat ruling 6946403206). A field the draft adds does not exist in
 * the published object the data door validates against, so it carries
 * {@link DRAFT_ONLY_FIELD_KEY} and the form draws it DISABLED: visible with its
 * draft definition, never fillable (`@object-ui/plugin-form` maps the marker
 * onto the field's `disabled`, in `ObjectForm` and in `fromObjectSchema`). As
 * the safety net, the proxy's `create` / `update` leave its name out of the
 * record they send, so its declared default is never written either. Its
 * `required` / `requiredWhen` are dropped from the marked copy: a disabled
 * control the form still requires would make every save refuse.
 * ⛔ Not `readonly: true`: `filterSystemFields` in `@object-ui/plugin-form`
 * drops such a field before render, on create and edit alike, and a create
 * form does not evaluate `readonlyWhen` — either would hide the very field
 * the preview exists to show, or do nothing. Every other member is the
 * adapter's own, bound to it, so a write goes out as it does without preview.
 *
 * @module utils/previewFormDataSource
 */

import { useMemo } from 'react';
import { MetadataNotFoundError } from '@object-ui/data-objectstack';
import { attachObjectSortability, readObjectSortability } from '@object-ui/core';
import { useMetadata } from '../providers/MetadataProvider.js';
import { usePreviewDrafts } from '../preview/PreviewModeContext.js';

/** The one adapter member this proxy answers differently. */
interface SchemaReader {
  getObjectSchema(objectName: string): Promise<unknown>;
}

type ObjectDocument = { fields?: Record<string, Record<string, unknown>> } & Record<string, unknown>;

function isDocument(value: unknown): value is ObjectDocument {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The undeclared key that marks a field the draft adds: present in the draft
 * overlay document, absent from the published one. An underscore-private
 * convention between this package and `@object-ui/plugin-form` (which spells
 * the same literal and draws a marked field disabled), never an authoring
 * key: the copy carrying it is client-side only and never written back. A
 * draft-preview reader that must keep such a name out of a data request reads
 * it here.
 */
export const DRAFT_ONLY_FIELD_KEY = '_draftOnly';

/** The names `schema` marks {@link DRAFT_ONLY_FIELD_KEY}. */
export function draftOnlyFieldNames(schema: unknown): string[] {
  if (!isDocument(schema) || !isDocument(schema.fields)) return [];
  return Object.entries(schema.fields)
    .filter(([, def]) => isDocument(def) && def[DRAFT_ONLY_FIELD_KEY] === true)
    .map(([name]) => name);
}

/**
 * The object definition a draft-preview reader draws: a copy of the published
 * document, plus each field only the draft overlay declares, with its draft
 * definition, marked {@link DRAFT_ONLY_FIELD_KEY} and without `required` /
 * `requiredWhen`: the form draws it disabled, so a requirement would refuse
 * the save over a field the viewer cannot fill. Fields the
 * published document declares keep their published definition, so what the
 * form validates and writes is what the data door accepts. The published
 * copy keeps the adapter's per-column sortability projection, which a spread
 * would drop. With no published document (a draft-only object) every overlay
 * field is draft-only; with no overlay document the published one is returned
 * as is. Neither input is touched.
 */
export function withDraftOnlyFields(published: unknown, overlay: unknown): unknown {
  if (!isDocument(overlay) || !isDocument(overlay.fields)) return published;
  const base: ObjectDocument = isDocument(published) ? published : overlay;
  const publishedFields = isDocument(published) && isDocument(published.fields) ? published.fields : {};
  const fields: Record<string, Record<string, unknown>> = { ...publishedFields };
  for (const [name, def] of Object.entries(overlay.fields)) {
    if (Object.prototype.hasOwnProperty.call(publishedFields, name)) continue;
    const { required: _required, requiredWhen: _requiredWhen, ...drawn } = def;
    fields[name] = { ...drawn, [DRAFT_ONLY_FIELD_KEY]: true };
  }
  return attachObjectSortability({ ...base, fields }, readObjectSortability(published));
}

/**
 * {@link withDraftOnlyFields} for one object: the overlay document
 * `readOverlay(name)` resolves, over the adapter's published read. A published
 * read that fails for any reason but absence fails this read, as it does
 * without preview; with no overlay document it is the adapter's read alone.
 */
export async function readDraftPreviewObjectSchema(
  adapter: SchemaReader,
  readOverlay: (objectName: string) => Promise<unknown>,
  objectName: string,
): Promise<unknown> {
  const overlay = await readOverlay(objectName);
  if (!isDocument(overlay)) return adapter.getObjectSchema(objectName);
  let published: unknown = null;
  try {
    published = await adapter.getObjectSchema(objectName);
  } catch (err) {
    if (!(err instanceof MetadataNotFoundError)) throw err;
  }
  return withDraftOnlyFields(published, overlay);
}

/** `data` without the `names` it carries; `data` itself when it carries none. */
function withoutNames(data: unknown, names: readonly string[] | undefined): unknown {
  if (!names || names.length === 0 || !isDocument(data)) return data;
  if (!names.some((name) => Object.prototype.hasOwnProperty.call(data, name))) return data;
  const out: Record<string, unknown> = { ...data };
  for (const name of names) delete out[name];
  return out;
}

/**
 * A proxy over `adapter` whose `getObjectSchema(name)` answers
 * {@link readDraftPreviewObjectSchema}, and whose `create` / `update` leave the
 * draft-only fields that answer named out of the record they send. Every
 * other member is the adapter's own, bound to it.
 */
export function createPreviewFormDataSource<T extends SchemaReader>(
  adapter: T,
  readOverlay: (objectName: string) => Promise<unknown>,
): T {
  const draftOnly = new Map<string, string[]>();
  const getObjectSchema = async (objectName: string): Promise<unknown> => {
    const schema = await readDraftPreviewObjectSchema(adapter, readOverlay, objectName);
    draftOnly.set(objectName, draftOnlyFieldNames(schema));
    return schema;
  };
  const writes: Record<string, (...args: unknown[]) => unknown> = {
    create: (resource, data, ...rest) =>
      (adapter as unknown as { create: (...a: unknown[]) => unknown })
        .create(resource, withoutNames(data, draftOnly.get(resource as string)), ...rest),
    update: (resource, id, data, ...rest) =>
      (adapter as unknown as { update: (...a: unknown[]) => unknown })
        .update(resource, id, withoutNames(data, draftOnly.get(resource as string)), ...rest),
  };
  // Bound once per member, so a reader that keys an effect on a method's
  // identity sees the same function on every access.
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === 'getObjectSchema') return getObjectSchema;
      if ((prop === 'create' || prop === 'update') && typeof Reflect.get(target, prop, target) === 'function') {
        return writes[prop];
      }
      const value = Reflect.get(target, prop, target);
      if (typeof value !== 'function') return value;
      let fn = bound.get(prop);
      if (!fn) {
        fn = (value as (...args: unknown[]) => unknown).bind(target);
        bound.set(prop, fn);
      }
      return fn;
    },
  });
}

/**
 * The data source a record form (the New/Edit page and the global modal)
 * reads its object definition through: `adapter` itself outside draft
 * preview, the {@link createPreviewFormDataSource} proxy inside it.
 */
export function usePreviewFormDataSource<T extends SchemaReader>(adapter: T | null | undefined): T | null | undefined {
  const previewDrafts = usePreviewDrafts();
  const { getItem } = useMetadata();
  return useMemo(() => {
    if (!previewDrafts || !adapter) return adapter;
    return createPreviewFormDataSource(adapter, (name) => getItem('object', name));
  }, [previewDrafts, adapter, getItem]);
}
