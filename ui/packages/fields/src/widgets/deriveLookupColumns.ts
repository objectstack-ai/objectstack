import type { LookupColumnDef } from '@object-ui/types';
import { isSystemManagedField } from '@object-ui/types';

/**
 * Field types that don't render usefully as a compact picker column (large
 * blobs, media, geometry, free-form text). Kept out of auto-derived columns.
 */
const NON_TABULAR_TYPES = new Set<string>([
  'json', 'object', 'grid', 'html', 'richtext', 'markdown', 'code',
  'image', 'file', 'avatar', 'vector', 'location', 'geometry',
  'textarea', 'secret', 'password', 'encrypted',
]);

export interface DeriveColumnsOptions {
  /** Primary display field — always the leading column. */
  displayField: string;
  /** Maximum number of columns to derive (including the display field). */
  max?: number;
}

interface ObjectSchemaLike {
  fields?: Record<string, { type?: string; label?: string; hidden?: boolean; system?: boolean }>;
  /**
   * ADR-0085 semantic role: the object's most important fields. The single
   * source for "how to list this object" — shared with the detail-page related
   * list — so a lookup picker and a related list of the same object agree on
   * columns with zero per-surface config.
   */
  highlightFields?: unknown;
  /** Object-level "fields to display in search result cards" (legacy spec metadata). */
  displayFields?: unknown;
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Derive sensible Record Picker columns from a referenced object's schema when
 * a lookup field declares no explicit `lookupColumns`.
 *
 * Priority:
 *   1. The referenced object's ADR-0085 `highlightFields` — the canonical
 *      "how to list this object" set, shared with the detail-page related list.
 *   2. Else the object's legacy `displayFields` search-card shape.
 *   3. Otherwise the display field plus the next few business fields in
 *      declaration order, skipping system/audit fields and heavy non-tabular
 *      types.
 *
 * The result gives every lookup a multi-column, disambiguating picker with zero
 * field-level configuration. Column `type` is carried through so the picker can
 * render currency / select / date cells via the shared cell renderer.
 *
 * Returns an empty array when no usable schema is available, in which case the
 * caller should fall back to the single display-field column.
 */
export function deriveLookupColumns(
  objectSchema: ObjectSchemaLike | null | undefined,
  { displayField, max = 4 }: DeriveColumnsOptions,
): LookupColumnDef[] {
  const fields = objectSchema?.fields ?? {};
  const fieldDef = (name: string) => fields[name] ?? {};
  const toCol = (name: string): LookupColumnDef => {
    const f = fieldDef(name);
    return { field: name, ...(f.label ? { label: f.label } : {}), ...(f.type ? { type: f.type } : {}) };
  };

  if (Object.keys(fields).length === 0) return [];

  // 1 & 2. Honour a declared column list — `highlightFields` (ADR-0085
  // canonical, shared with the related list) first, then the legacy
  // `displayFields` search-card list. The display field always leads.
  const fromDeclaredList = (list: unknown): LookupColumnDef[] | null => {
    if (!Array.isArray(list) || list.length === 0) return null;
    const names = (list as unknown[]).filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    );
    const ordered = dedupe([displayField, ...names.filter((n) => n !== displayField)]);
    return ordered.slice(0, max).map(toCol);
  };
  const fromHighlights = fromDeclaredList(objectSchema?.highlightFields);
  if (fromHighlights) return fromHighlights;
  const fromDisplay = fromDeclaredList(objectSchema?.displayFields);
  if (fromDisplay) return fromDisplay;

  // 3. Derive from the field set in declaration order.
  const candidates = Object.keys(fields).filter((name) => {
    if (name === displayField) return false;
    const f = fieldDef(name);
    // Skip framework-managed system/audit/ownership columns (incl. owner_id) —
    // they carry no disambiguating value in a record picker.
    if (isSystemManagedField(name, f)) return false;
    if (f.hidden) return false;
    if (f.type && NON_TABULAR_TYPES.has(f.type)) return false;
    return true;
  });

  const ordered = dedupe([displayField, ...candidates]);
  return ordered.slice(0, max).map(toCol);
}
