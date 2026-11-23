// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build a `Content-Disposition` header value that survives non-ASCII filenames.
 *
 * Emits both a sanitized ASCII `filename=` (legacy fallback) and the RFC 5987
 * `filename*=UTF-8''…` form that modern browsers prefer — so a download saves
 * under its real name instead of the opaque URL token. Called through
 * `served-bytes-policy.ts`, which decides the disposition for every door that
 * answers stored bytes (the local `_local/raw` route's header and the S3
 * adapter's `ResponseContentDisposition`); a door never picks it itself.
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
