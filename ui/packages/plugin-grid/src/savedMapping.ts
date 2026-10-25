// A registered server-side import `mapping` artifact (objectstack-ai/objectstack#2611), fetched
// via the data source and offered in the import wizard as a reusable, governed
// alternative to hand-building the column mapping. The server owns the rename +
// transform pipeline; the wizard only picks a mapping by name and previews it.

export interface SavedMappingEntry {
  source: string | string[];
  target: string | string[];
  transform?: 'none' | 'constant' | 'lookup' | 'split' | 'join' | 'map' | string;
  params?: {
    value?: unknown;
    valueMap?: Record<string, unknown>;
    separator?: string;
  };
}

export interface SavedMapping {
  name: string;
  label?: string;
  targetObject: string;
  sourceFormat?: 'csv' | 'json' | 'xml' | 'sql';
  fieldMapping: SavedMappingEntry[];
  mode?: 'insert' | 'update' | 'upsert';
  upsertKey?: string[];
}

/** Narrow an unknown metadata item to a usable SavedMapping (defensive against
 *  older/looser server payloads). Returns null when it isn't a real mapping. */
export function asSavedMapping(item: unknown): SavedMapping | null {
  if (!item || typeof item !== 'object') return null;
  const m = item as Record<string, unknown>;
  if (typeof m.name !== 'string' || typeof m.targetObject !== 'string') return null;
  if (!Array.isArray(m.fieldMapping)) return null;
  return m as unknown as SavedMapping;
}

/**
 * Rows keyed by SOURCE header name (every column, raw text, corrections
 * applied) — the shape the server's named-mapping import path expects, since
 * IT applies the artifact's fieldMapping (rename + transforms) authoritatively.
 * Deliberately NOT pre-mapped to field names on the client (that would be a
 * second, drifting dialect of the server's mapping logic).
 */
export function buildSourceRows(
  headers: string[],
  rows: string[][],
  corrections: Record<number, Record<number, string>>,
): Array<Record<string, string>> {
  return rows.map((original, i) => {
    const fixes = corrections[i];
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = fixes && fixes[idx] !== undefined ? fixes[idx] : (original[idx] ?? '');
      out[h] = v;
    });
    return out;
  });
}

/**
 * A read-only, display-friendly view of what a mapping does — one row per
 * fieldMapping entry: `source → target (transform)`. Used to show the user the
 * chosen mapping without re-implementing any transform on the client.
 */
export function summarizeSavedMapping(
  m: SavedMapping,
): Array<{ source: string; target: string; transform: string }> {
  return (m.fieldMapping ?? []).map((e) => ({
    source: Array.isArray(e.source) ? e.source.join(' + ') : e.source,
    target: Array.isArray(e.target) ? e.target.join(', ') : e.target,
    transform: e.transform && e.transform !== 'none' ? e.transform : '',
  }));
}

/**
 * Best-effort index map (CSV column index → target field) for the PREVIEW only
 * — single-source rename entries whose source header is present in the file.
 * Multi-source (join) and constant entries have no single source column and
 * are omitted from the preview grid (the summary table names them instead).
 */
export function savedMappingToDisplayIndexMap(
  m: SavedMapping,
  headers: string[],
): Record<number, string> {
  const headerIndex = new Map<string, number>();
  headers.forEach((h, idx) => { if (h) headerIndex.set(h.trim().toLowerCase(), idx); });
  const out: Record<number, string> = {};
  for (const e of m.fieldMapping ?? []) {
    if (Array.isArray(e.source) || Array.isArray(e.target)) continue; // join / split
    if (e.transform === 'constant') continue; // no source column
    const idx = headerIndex.get(String(e.source).trim().toLowerCase());
    if (idx !== undefined) out[idx] = String(e.target);
  }
  return out;
}
