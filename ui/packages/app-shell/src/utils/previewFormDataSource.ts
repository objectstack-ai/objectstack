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
 * the published object the data door validates against, so it reaches the
 * form `readonly: true`: drawn with its draft definition, not editable, and
 * left out of every create and update by the form's shared write sanitizer,
 * which skips read-only fields (a declared default included). Every member
 * other than `getObjectSchema` is the adapter's own, bound to it, so a write
 * goes out as it does without preview.
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
 * overlay document, absent from the published one. Client-side only (the copy
 * carrying it is never written back); a draft-preview reader that must keep
 * such a name out of a data request reads it here.
 */
export const DRAFT_ONLY_FIELD_KEY = '_draftOnly';

/**
 * The object definition a draft-preview reader draws: a copy of the published
 * document, plus each field only the draft overlay declares, with its draft
 * definition, `readonly: true` and {@link DRAFT_ONLY_FIELD_KEY}. Fields the
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
    fields[name] = { ...def, readonly: true, [DRAFT_ONLY_FIELD_KEY]: true };
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

/**
 * A proxy over `adapter` whose `getObjectSchema(name)` answers
 * {@link readDraftPreviewObjectSchema}. Every other member is the adapter's
 * own, bound to it.
 */
export function createPreviewFormDataSource<T extends SchemaReader>(
  adapter: T,
  readOverlay: (objectName: string) => Promise<unknown>,
): T {
  const getObjectSchema = (objectName: string): Promise<unknown> =>
    readDraftPreviewObjectSchema(adapter, readOverlay, objectName);
  // Bound once per member, so a reader that keys an effect on a method's
  // identity sees the same function on every access.
  const bound = new Map<PropertyKey, unknown>();
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === 'getObjectSchema') return getObjectSchema;
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
