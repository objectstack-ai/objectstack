// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-group layout derivation — the single source of the `fieldGroups`
 * rendering semantics (ADR-0085 §5).
 *
 * An object's `fieldGroups` + each field's `Field.group` membership are a
 * cross-surface semantic role: forms, detail pages, drawers and the designer
 * all render the SAME grouping. The rules live here — a pure, dependency-free
 * helper next to the schema that defines the keys (the ADR-0078 §2
 * shared-predicate pattern) — so renderers consume one implementation instead
 * of re-deriving it (two near-identical copies in `@object-ui` predate this
 * module and are retired by it).
 *
 * Rules (per the ObjectFieldGroupSchema contract):
 *   - sections come back in declared-group order;
 *   - declared groups no visible field references are dropped;
 *   - fields without a (declared) group collect into a trailing untitled
 *     bucket, preserving field declaration order — EXCEPT audit/system
 *     fields, which only surface when an author EXPLICITLY groups them
 *     (explicit listing wins, same as authored page sections);
 *   - hidden fields never surface;
 *   - `collapse` passes through (deprecated `defaultExpanded` /
 *     `collapsible`+`collapsed` aliases are honoured for pre-ADR-0085
 *     metadata that reaches consumers un-normalized, e.g. bare DB rows);
 *   - `visibleWhen` passes through verbatim (bare CEL string or Expression
 *     envelope — the ADR-0049 re-introduction with enforcement): EVALUATION
 *     is the renderer's section-gating contract (FALSE hides the whole
 *     group, header included, fail-closed), not this helper's — grouping is
 *     static layout, visibility is per-record state.
 *
 * Returns `null` when grouping does not apply — no declared groups, or no
 * visible field references one — so callers fall back to their existing
 * flat/auto layout.
 */

/**
 * The field-group KEY grammar — lowercase snake_case, one declaration.
 *
 * Declared here rather than inline on `ObjectFieldGroupSchema.key` because the
 * key is now written on TWO surfaces: the group that DECLARES it
 * (`ObjectFieldGroupSchema.key`) and the layout sections that REFERENCE it
 * (`FormSectionSchema.group`, `RecordDetailsProps.sections[].group` — #13855).
 * Two spellings of one grammar is the failure `identifiers.zod.ts` records from
 * the other side: the reference surface would accept a key the declaring
 * surface refuses, so the reference could never resolve and the section would
 * render nothing with nothing reported. This module is the ADR-0085 §5 single
 * source for the grouping semantics, so it is where the key's shape belongs.
 */
export const FIELD_GROUP_KEY_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** Collapse behaviour of a derived section (mirrors ObjectFieldGroupSchema.collapse). */
export type FieldGroupCollapse = 'none' | 'expanded' | 'collapsed';

/**
 * Carried section predicate (mirrors `ObjectFieldGroupSchema.visibleWhen`):
 * a bare CEL string (author/bare-DB form) or an Expression envelope
 * (`{ dialect, source, … }`, the post-parse form). Passed through verbatim —
 * the renderer's section-gating contract evaluates it; this module only
 * carries it. Structural on purpose: the helper stays dependency-free and
 * tolerant of un-parsed metadata, same as its `collapse`-alias handling.
 */
export type FieldGroupVisibleWhen = string | { readonly [key: string]: unknown };

/** One derived section. `key` is absent on the trailing ungrouped bucket. */
export interface FieldGroupSection {
  /** Group machine key; i18n anchor (`…objects.{obj}._sections.{key}.label`). Absent = ungrouped bucket. */
  key?: string;
  /** Group display label (default text; i18n overrides at render time). */
  label?: string;
  /** Optional icon name declared on the group. */
  icon?: string;
  /** Optional description declared on the group. */
  description?: string;
  /** Collapse behaviour; 'none' when the group declared nothing. */
  collapse: FieldGroupCollapse;
  /** Section visibility predicate, passed through verbatim; absent = always visible. Never present on the ungrouped bucket. */
  visibleWhen?: FieldGroupVisibleWhen;
  /** Member field NAMES in field-declaration order. Renderers resolve defs themselves. */
  fields: string[];
}

/**
 * The audit-provenance family: the four columns `applySystemFields`
 * (`@objectstack/objectql` registry) auto-injects on every audit-tracked
 * business object, in injection order.
 *
 * THE canonical declaration (#3786). Before it existed this four-name list was
 * hand-copied at least four times across two repos — the registry's injection
 * if-chain, the rule-validator's `preserveAudit` allowlist, and two objectui
 * render surfaces — each under a comment asking to be kept in sync with one of
 * the others. The registry's injection table and the rule-validator now derive
 * from this tuple (with `satisfies` making an undeclared member a compile
 * error); objectui's `AUDIT_FIELD_BY_ROLE` pins itself to the superset below
 * by subset assertion.
 */
export const AUDIT_PROVENANCE_FIELDS = Object.freeze([
  'created_at', 'created_by', 'updated_at', 'updated_by',
] as const);

/** One audit-provenance column name. */
export type AuditProvenanceField = (typeof AUDIT_PROVENANCE_FIELDS)[number];

/**
 * Audit/system fields excluded from the derived UNGROUPED bucket (they carry
 * no business meaning in a default layout). A field an author explicitly
 * assigns to a group is kept. Exported so renderers filtering flat layouts
 * agree with the derivation.
 *
 * The audit prefix derives from {@link AUDIT_PROVENANCE_FIELDS} — one
 * declaration even inside this file.
 */
export const FIELD_GROUP_SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  ...AUDIT_PROVENANCE_FIELDS,
  'organization_id', 'tenant_id', 'is_deleted', 'deleted_at',
]);

type AnyRec = Record<string, unknown>;

/** Normalize one declared group entry; null for malformed/keyless entries. */
function readGroup(g: unknown): { key: string; label?: string; icon?: string; description?: string; collapse: FieldGroupCollapse; visibleWhen?: FieldGroupVisibleWhen } | null {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const grp = g as AnyRec;
  if (typeof grp.key !== 'string' || grp.key.length === 0) return null;
  // Tolerant passthrough, same posture as the collapse aliases below: a bare
  // CEL string or an Expression envelope rides through; any other shape is
  // dropped rather than handed to a renderer as a malformed predicate (which
  // would fail-closed and hide the group for a value that was never a
  // predicate at all).
  const vw = grp.visibleWhen;
  const visibleWhen: FieldGroupVisibleWhen | undefined =
    (typeof vw === 'string' && vw.length > 0) || (typeof vw === 'object' && vw !== null && !Array.isArray(vw))
      ? (vw as FieldGroupVisibleWhen)
      : undefined;
  let collapse: FieldGroupCollapse = 'none';
  if (grp.collapse === 'expanded' || grp.collapse === 'collapsed' || grp.collapse === 'none') {
    collapse = grp.collapse;
  } else if (typeof grp.collapsible === 'boolean' || typeof grp.collapsed === 'boolean') {
    // Deprecated UI-dialect pair (pre-ADR-0085 designer metadata).
    collapse = grp.collapsed === true ? 'collapsed' : grp.collapsible === true ? 'expanded' : 'none';
  } else if (typeof grp.defaultExpanded === 'boolean') {
    // Deprecated spec flag.
    collapse = grp.defaultExpanded ? 'expanded' : 'collapsed';
  }
  return {
    key: grp.key,
    label: typeof grp.label === 'string' ? grp.label : undefined,
    icon: typeof grp.icon === 'string' ? grp.icon : undefined,
    description: typeof grp.description === 'string' ? grp.description : undefined,
    collapse,
    ...(visibleWhen !== undefined ? { visibleWhen } : {}),
  };
}

/**
 * Derive the grouped layout for an object definition (or any bare metadata
 * record shaped like one — the helper is deliberately tolerant of
 * un-parsed/legacy input so every consumer can call it).
 */
export function deriveFieldGroupLayout(def: unknown): FieldGroupSection[] | null {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return null;
  const obj = def as AnyRec;

  const declared = (Array.isArray(obj.fieldGroups) ? obj.fieldGroups : [])
    .map(readGroup)
    .filter((g): g is NonNullable<ReturnType<typeof readGroup>> => g !== null);
  if (declared.length === 0) return null;

  const declaredKeys = new Set(declared.map((g) => g.key));
  const fields = (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields))
    ? (obj.fields as Record<string, AnyRec | undefined>)
    : {};

  const buckets = new Map<string, string[]>();
  for (const g of declared) buckets.set(g.key, []);
  const ungrouped: string[] = [];
  let anyGrouped = false;
  for (const [name, f] of Object.entries(fields)) {
    if (f?.hidden === true) continue;
    const g = typeof f?.group === 'string' && declaredKeys.has(f.group) ? (f.group as string) : null;
    if (g) {
      buckets.get(g)!.push(name);
      anyGrouped = true;
    } else if (!FIELD_GROUP_SYSTEM_FIELDS.has(name)) {
      ungrouped.push(name);
    }
  }
  // No visible field references a declared group → grouping doesn't apply.
  if (!anyGrouped) return null;

  const sections: FieldGroupSection[] = [];
  for (const g of declared) {
    const names = buckets.get(g.key)!;
    if (names.length === 0) continue; // declared-but-empty groups are dropped
    sections.push({
      key: g.key,
      label: g.label ?? g.key,
      ...(g.icon !== undefined ? { icon: g.icon } : {}),
      ...(g.description !== undefined ? { description: g.description } : {}),
      collapse: g.collapse,
      ...(g.visibleWhen !== undefined ? { visibleWhen: g.visibleWhen } : {}),
      fields: names,
    });
  }
  // Trailing untitled bucket: ungrouped fields render flat (no key/label →
  // renderers show no card chrome) after the declared groups.
  if (ungrouped.length > 0) {
    sections.push({ collapse: 'none', fields: ungrouped });
  }
  return sections.length > 0 ? sections : null;
}
