// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build a `Content-Disposition` header value that survives non-ASCII filenames.
 *
 * Emits both a sanitized ASCII `filename=` (legacy fallback) and the RFC 5987
 * `filename*=UTF-8''…` form that modern browsers prefer — so a download saves
 * under its real name instead of the opaque URL token. Used by the local
 * adapter's `_local/raw` route (header) and the S3 adapter's
 * `ResponseContentDisposition` (baked into the signed URL).
 */
export function contentDispositionValue(
  filename: string,
  type: 'inline' | 'attachment' = 'inline',
): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
