/**
 * File field value shapes (ObjectStack ADR-0104 D3 wave 2).
 *
 * A `file`/`image`/`avatar`/`video`/`audio` field value reaches the UI in one
 * of three forms, and every widget that renders one has to cope with all
 * three — so the rules live here once rather than being re-derived per widget.
 *
 *  1. **Reference** — a bare `sys_file` id string. The form the backend stores
 *     once file-as-reference is adopted.
 *  2. **Expanded** — `{ id, name, size, mimeType, url }`, what the read path
 *     returns after resolving a stored reference. Note `mimeType`: this comes
 *     from the platform's spec-owned `FileValueSchema` and is **camelCase**.
 *  3. **Legacy inline blob** — `{ file_id?, name, original_name, size,
 *     mime_type, url }`, the pre-reference shape this package used to build
 *     itself, with **snake_case** `mime_type`.
 *
 * That casing split is the whole reason this module exists: a widget reading
 * only `mime_type` silently stops recognising images the moment the backend
 * starts returning the expanded form, and the failure looks like "thumbnails
 * disappeared" rather than anything pointing at a value shape.
 *
 * ## Submitting
 *
 * A completed upload is submitted as the **bare `sys_file` id** the adapter
 * surfaced in `meta.fileId` — the reference form, and the only form the stored
 * contract admits (`valueSchemaFor(field, 'stored')` is the id-only
 * `FileReferenceIdValueSchema` since spec `17.0.0`; ADR-0104's 2026-09-05
 * addendum fixes the physical column to a string column holding that bare id).
 * When no `fileId` came back — the object-URL default `useUpload()` falls open
 * to, an S3/Azure-style adapter that mints no `sys_file` row, a custom adapter
 * that dropped it — the submit is **refused** with {@link UploadIncompleteError}
 * and ⛔ no inline blob is sent: the legacy `{ name, original_name, size,
 * mime_type, url }` object is a shape no deployment's stored contract accepts
 * (admitted warn-first only on a deployment that has not yet verified its
 * file-as-reference migration, rejected with `invalid_type` everywhere else),
 * so sending it turned an upload into a save refused by the backend
 * (objectui#7699). ADR-0104's dual-read window is a READ rule: a legacy blob
 * already on a record still renders through `readFileValue`; nothing here
 * writes a new one. Action params already POST a bare fileId; record field
 * values are on the same contract.
 */

import { isFileIdToken } from '@objectstack/spec/data';
// Deliberately from a module the package barrel does not re-export: the
// published surface this card adds is `FileValueView.metadataRefused` alone.
import { isFileRefusedValue } from './file-refused.js';

/** A file value normalised for rendering, whatever form it arrived in. */
export interface FileValueView {
  /** `sys_file` id, when the value carries one. */
  id?: string;
  /**
   * Best available display name: the value's own, else the caller's
   * `fallbackName`. Empty only when the caller passed an empty fallback to ask
   * for "no name" (the image cell does, so a nameless image reaches its
   * translated alt — objectui#10493).
   */
  name: string;
  /** Resolvable URL, when the value carries one. A bare reference does not. */
  url?: string;
  size?: number;
  mimeType?: string;
  /**
   * `true` when the value is the platform's refused marker
   * `{ id, metadataRefused: true }` (`FileRefusedValueSchema`): the reader may
   * read the record but not this file's `sys_file` metadata, so no name, size,
   * MIME type or URL was served. The view still carries `id` and the
   * id-derived `url` — the download endpoint judges its own access and may
   * answer `403 FILE_DOWNLOAD_DENIED` — but a renderer draws a restricted
   * state rather than a generic file chip, and never attempts a thumbnail
   * (objectui#12339). Absent on every other form.
   */
  metadataRefused?: true;
  /** The value as it arrived, so callers can pass it through untouched. */
  raw: unknown;
}

/**
 * A minted file id: uuid/nanoid-shaped, and crucially not a URL — a URL always
 * carries `:`, `/` or `.`, so it can never match.
 *
 * This IS the platform's arbiter now, not a mirror of it (objectui#3161,
 * objectstack#4115 ledger batch 7). The declaration that stood here said it
 * "mirrors the platform's `isFileIdToken`" while being a character-for-character
 * copy of that function's body under that function's own name — the shape
 * objectui#3003 argued about and objectui#3169 caught again in
 * `isAggregatedViewContainer`: every value test and every behaviour test passes
 * against a faithful copy, so reference identity is the only check that can tell
 * a re-export from a fork. It is asserted in
 * `__tests__/spec-symbol-batch7.test.ts`.
 *
 * Why it matters that this one is shared rather than duplicated: the regex is a
 * WIRE decision. Widening it server-side (say, ids grow past 64 chars) while a
 * copy here keeps the old bound turns every new id into "not a reference", and
 * `fileValueForSubmit` then refuses every upload as incomplete — loud, but
 * pointing at the adapter while the cause is a regex two packages away.
 */
export { isFileIdToken };

/**
 * The `sys_file` id a value refers to, or `undefined`.
 *
 * `file_id ?? id` matches the rule `serializeParamValues` already applies to
 * action params — one extraction rule for both surfaces.
 */
export function fileIdOf(value: unknown): string | undefined {
  if (isFileIdToken(value)) return value;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const id = o.file_id ?? o.id;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

/**
 * The stable download endpoint a bare `sys_file` id resolves to.
 *
 * `createObjectStackUploadAdapter` stores exactly this URL (`${basePath}/files/
 * :id`, default base `/api/v1/storage`) as a completed upload's value, and the
 * endpoint 302-redirects to a freshly-signed short-lived URL on every request —
 * so it can be used directly as an `<img src>`. Building it here means a value
 * still in its bare-reference form (the backend read path didn't expand it —
 * seen on the edit-form data path, objectui image thumbnails rendering broken)
 * resolves to a real URL instead of an empty `src`.
 */
export const FILE_STORAGE_BASE_PATH = '/api/v1/storage';

/** The stable download URL for a `sys_file` id. */
export function fileUrlFromId(id: string): string {
  return `${FILE_STORAGE_BASE_PATH}/files/${encodeURIComponent(id)}`;
}

/**
 * Last path segment of a URL, used as a display name of last resort, or
 * `undefined` when the URL carries no file name at all.
 *
 * A `data:` URI has no path: its "last segment" is the MIME tail plus the
 * payload (`png;base64,…`, or a payload fragment when the base64 holds a `/`),
 * which named an image cell's `<img>` with kilobytes of base64 — every
 * signature is one (objectui#10493). It names nothing, so the caller's
 * fallback applies. The scheme is matched case-insensitively, as URL schemes
 * are.
 *
 * A segment that is not a valid percent-encoding (a bare `%`, as in
 * `100%.png`, or `%zz`) names the file by its raw segment (objectui#10614).
 * `FileValueSchema.url` is a plain string, so such a value is contract-valid,
 * and `decodeURIComponent` throws `URIError` on it. Before this guard that
 * throw escaped `readFileValue` during render, so one such value took down
 * every face that reads it: the nearest error boundary replaced the whole
 * table or gallery, valid rows included. The guard lives here, once, because
 * every caller reaches the decode through this helper; a valid escape
 * (`report%20q3.pdf`) still decodes as before.
 */
function nameFromUrl(url: string): string | undefined {
  if (/^data:/i.test(url)) return undefined;
  const path = url.split(/[?#]/)[0] ?? url;
  const seg = path.split('/').filter(Boolean).pop();
  if (!seg) return url;
  try {
    return decodeURIComponent(seg);
  } catch (err) {
    if (err instanceof URIError) return seg;
    throw err;
  }
}

/**
 * Normalise one file value for display.
 *
 * @param fallbackName shown when the value carries no usable name — pass a
 *   translated string so the widget stays localised.
 */
export function readFileValue(value: unknown, fallbackName = 'File'): FileValueView {
  if (value == null) return { name: fallbackName, raw: value };

  if (typeof value === 'string') {
    // A bare id carries no name of its own (the backend expands it on read),
    // but its URL is derivable from the stable download endpoint — so a value
    // the read path left as a bare reference still renders a thumbnail instead
    // of a broken `<img src="">`.
    if (isFileIdToken(value)) return { id: value, name: fallbackName, url: fileUrlFromId(value), raw: value };
    // Otherwise it is a URL (legacy external link, data:, blob:).
    return { url: value, name: nameFromUrl(value) ?? fallbackName, raw: value };
  }

  if (typeof value === 'object') {
    // The refused marker (objectui#12339): the id the record holds and nothing
    // else. Its URL is derived from the id exactly as for a bare reference, and
    // it is flagged so a renderer can say "restricted" instead of drawing the
    // fallback name as if it were an ordinary file. No `mimeType`: none was
    // served, so no thumbnail can be attempted.
    if (isFileRefusedValue(value)) {
      return {
        id: value.id,
        name: fallbackName,
        url: fileUrlFromId(value.id),
        metadataRefused: true,
        raw: value,
      };
    }
    const o = value as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const id = fileIdOf(o);
    // An object shape that carries an id but not its URL (a partially-expanded
    // reference) still resolves to the stable endpoint, same as a bare id.
    const url = str(o.url) ?? (id ? fileUrlFromId(id) : undefined);
    const name =
      str(o.name) ??
      str(o.original_name) ??
      (str(o.url) ? nameFromUrl(str(o.url) as string) : undefined) ??
      fallbackName;
    return {
      id,
      name,
      url,
      size: typeof o.size === 'number' ? o.size : undefined,
      // Expanded form is camelCase, legacy blob is snake_case — accept both.
      mimeType: str(o.mimeType) ?? str(o.mime_type),
      raw: value,
    };
  }

  return { name: fallbackName, raw: value };
}

/** Normalise a field value (single or `multiple`) to an array of views. */
export function readFileValues(value: unknown, fallbackName = 'File'): FileValueView[] {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.filter((v) => v != null).map((v) => readFileValue(v, fallbackName));
}

/** Does this value look like an image, by MIME type? */
export function isImageValue(view: FileValueView): boolean {
  return (view.mimeType ?? '').startsWith('image/');
}

/** The subset of an upload result these helpers read. */
export interface UploadResultLike {
  url: string;
  name: string;
  size: number;
  mimeType: string;
  meta?: Record<string, unknown>;
}

/**
 * A completed upload that surfaced no `sys_file` id, refused at the point of
 * submit (objectui#7699).
 *
 * The adapter reported success, so this is not a transport failure and the
 * widgets do not quote an adapter message for it: what the user needs to know
 * is that the field was NOT changed. Named — `name` and `code` — so a caller
 * can tell it from a thrown network error without reading the message, and
 * carrying the file's name so a host that reports it can say which pick.
 */
export class UploadIncompleteError extends Error {
  readonly code = 'UPLOAD_INCOMPLETE' as const;
  /** The pick's own name when the caller knew it, else the adapter's stored object name. */
  readonly fileName: string;

  constructor(fileName: string) {
    super(
      `upload of "${fileName}" did not complete: the upload adapter returned no sys_file id ` +
        '(meta.fileId), so nothing was submitted',
    );
    this.name = 'UploadIncompleteError';
    this.fileName = fileName;
  }
}

/**
 * What to store in the field for a completed upload: the bare `sys_file` id
 * the adapter surfaced in `meta.fileId` — the reference form, the only form
 * the stored contract admits.
 *
 * Throws {@link UploadIncompleteError} when the adapter surfaced no id-shaped
 * `fileId`. ⛔ There is no fallback: the inline blob this function used to
 * build in that case (`{ name, original_name, size, mime_type, url }`) is a
 * shape no deployment's stored contract accepts, and a client that sent it
 * turned a successful-looking upload into a save the backend refused (see the
 * module header's "Submitting"). The callers catch the refusal per pick and
 * render it in the same error row a transport failure lands in.
 *
 * @param originalName the pick's own file name, used to name the refusal;
 *   the adapter's stored object name stands in when the caller has none.
 */
export function fileValueForSubmit(result: UploadResultLike, originalName?: string): string {
  const fileId = (result.meta as { fileId?: unknown } | undefined)?.fileId;
  if (isFileIdToken(fileId)) return fileId;
  throw new UploadIncompleteError(originalName ?? result.name);
}

/**
 * The display view of a just-completed upload.
 *
 * Submitting a bare id means the field value no longer carries the name, size
 * or URL needed to render it, and the enriched form only comes back on the next
 * read. Widgets keep these views keyed by id so an upload appears immediately
 * instead of showing a bare token until a refetch.
 */
export function uploadResultView(result: UploadResultLike, originalName?: string): FileValueView {
  const id = isFileIdToken((result.meta as { fileId?: unknown } | undefined)?.fileId)
    ? ((result.meta as { fileId?: string }).fileId as string)
    : undefined;
  return {
    id,
    name: result.name || originalName || 'File',
    url: result.url,
    size: result.size,
    mimeType: result.mimeType,
    raw: result,
  };
}

/**
 * Merge locally-known upload views over a field value's own views, matched by
 * id. A value that is still a bare reference picks up the name/URL captured at
 * upload time; anything already enriched by the backend is left alone.
 */
export function withRecentUploads(
  views: FileValueView[],
  recent: Record<string, FileValueView>,
): FileValueView[] {
  if (Object.keys(recent).length === 0) return views;
  return views.map((v) => {
    const known = v.id ? recent[v.id] : undefined;
    if (!known) return v;
    // A value the backend already expanded carries its own URL on the raw
    // object — leave that alone. A bare reference (string id, or an id-only
    // object) has only the synthetic download URL `readFileValue` derived, so
    // the just-uploaded name/mimeType still fills in.
    const rawHasOwnUrl =
      !!v.raw &&
      typeof v.raw === 'object' &&
      typeof (v.raw as Record<string, unknown>).url === 'string' &&
      !!(v.raw as Record<string, unknown>).url;
    return rawHasOwnUrl ? v : { ...known, raw: v.raw };
  });
}
