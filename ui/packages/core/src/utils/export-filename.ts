/**
 * Download filename builder for data exports (csv / xlsx / json).
 *
 * Exports used to download as `<objectApiName>.<ext>` (e.g. `contracts.csv`),
 * which reads poorly for end users and silently collides in the Downloads
 * folder. This builds `<base>-<YYYYMMDD>-<HHMMSS>.<ext>` where the base falls
 * back through: explicit configured prefix (`exportOptions.fileNamePrefix`) →
 * translated object label (e.g. 合同) → object API name → 'export'.
 */

/** Windows-reserved + control characters that cannot appear in a filename. */
// The control-char range in the class is matched deliberately (illegal in
// filenames, must be stripped), so no-control-regex is intentionally disabled.
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Longest base we emit — keeps the full name comfortably under OS limits. */
const MAX_BASE_LENGTH = 80;

/**
 * Sanitize a candidate base name for cross-platform filesystem safety while
 * keeping non-ASCII letters (e.g. Chinese object labels) intact. Returns an
 * empty string when nothing usable survives, so callers can fall through.
 */
export function sanitizeFileNameBase(raw: string | undefined | null): string {
  if (!raw) return '';
  return String(raw)
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/_{2,}/g, '_')
    // Leading/trailing dots, underscores and spaces are dropped: Windows
    // strips trailing dots/spaces, and a leading dot hides the file on unix.
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .slice(0, MAX_BASE_LENGTH);
}

export interface ExportFileNameParts {
  /** Explicit prefix from view config (`exportOptions.fileNamePrefix`) — wins when set. */
  prefix?: string;
  /** Human-readable (translated) object label — the preferred base. */
  label?: string;
  /** Object API name — fallback when no label is available. */
  objectName?: string;
  /**
   * Active list-view label (e.g. `In Progress`), appended after the object
   * base so exports from different saved views don't read identically.
   * Skipped when it duplicates the base, and not appended to an explicit
   * `prefix` (configured prefixes are authoritative as-is).
   */
  viewLabel?: string;
}

/**
 * Build `<base>-<YYYYMMDD>-<HHMMSS>.<ext>` in the user's local time, e.g.
 * `合同-进行中-20260714-153045.xlsx`. The timestamp keeps repeated exports of
 * the same object distinct and sortable.
 */
export function buildExportFileName(
  ext: string,
  parts: ExportFileNameParts = {},
  now: Date = new Date(),
): string {
  const prefix = sanitizeFileNameBase(parts.prefix);
  let base =
    prefix ||
    sanitizeFileNameBase(parts.label) ||
    sanitizeFileNameBase(parts.objectName) ||
    'export';
  const view = sanitizeFileNameBase(parts.viewLabel);
  if (!prefix && view && view.toLowerCase() !== base.toLowerCase()) {
    base = `${base}-${view}`.slice(0, MAX_BASE_LENGTH);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${base}-${stamp}.${ext}`;
}
