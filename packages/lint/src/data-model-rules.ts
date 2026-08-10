// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Data-model best-practice lint rules.
 *
 * These rules encode the relationship / master-detail / roll-up conventions the
 * platform ships (see the objectstack-data and objectstack-ui skills, ADR-0035).
 * They run over the normalized object set and flag anti-patterns that an
 * author — human OR an AI generator — commonly produces. They are intentionally
 * heuristic: structural problems are `error`, likely-wrong choices are
 * `warning`, and "you probably want this" nudges are `suggestion`. None of them
 * block on a judgement call.
 *
 * The same rules double as the automated rubric for the metadata-generation
 * eval (see `score.ts`): a generated stack scores well exactly when it is
 * schema-valid AND lint-clean here.
 */

export type Severity = 'error' | 'warning' | 'suggestion';

export interface LintIssue {
  severity: Severity;
  rule: string;
  message: string;
  path: string;
  fix?: string;
}

// ─── Heuristics ─────────────────────────────────────────────────────

const RELATIONSHIP_TYPES = new Set(['lookup', 'master_detail']);
const NUMERIC_TYPES = new Set([
  'number', 'currency', 'integer', 'decimal', 'percent', 'float', 'double',
]);
const OPTION_FIELD_TYPES = new Set(['select', 'multiselect', 'radio', 'enum']);
/**
 * Field names that give an object a title FACE, for R9
 * (`object/missing-name-field`).
 *
 * DIVERGES from spec's `NAME_ISH_EXACT`
 * (`packages/spec/src/data/display-name.ts`) by exactly one entry: `code`. That
 * difference is INTENTIONAL — the maintainer ruled on 2026-08-10 (#6734) to
 * keep both sets as they are and write the gap down in both places rather than
 * converge them. The two sets answer different questions:
 *
 *   - R9 asks the LOOSER **"will records be anonymous?"** — is there anything
 *     here a human could read instead of a raw id? A `code` clears that bar, so
 *     it counts as a title face and is listed below.
 *   - ADR-0079 derivation (`resolveDisplayField`) asks **"what IS the title?"**
 *     — which field to PICK as the primary. A `code` is an identifier, not a
 *     title, so spec deliberately omits it from tier 1 (name-ish exact) and
 *     tier 2 (name-ish affix). A `code`-only object can still be derived at
 *     tier 3 ("first title-eligible field by declaration order") — by a
 *     different rule and a different priority, so the two are not equivalent
 *     even where they agree on the outcome.
 *
 * Nothing user-visible turns on the gap: R9 is `severity: 'suggestion'` and
 * ADR-0079's `Record #<id>` floor means no object ships without a title either
 * way. Do not "fix" either set into the other without a ruling that supersedes
 * the one above.
 */
const NAME_LIKE_FIELDS = ['name', 'title', 'subject', 'label', 'full_name', 'display_name', 'code'];

/** Child object names that read as line-items / composition (entered with the parent). */
const LINE_ITEM_RE = /_(line|lines|line_item|line_items|item|items|detail|details|entry|entries)$/;
/** Child object names that read as associations (comments/audit/activity — NOT line items). */
const ASSOCIATION_TOKENS = [
  'comment', 'attachment', 'note', 'log', 'audit', 'activity', 'activities',
  'history', 'event', 'reaction', 'like', 'mention', 'notification', 'message',
];

function isLineItemName(name: string): boolean {
  return LINE_ITEM_RE.test(name);
}

function isAssociationName(name: string): boolean {
  const lc = name.toLowerCase();
  return ASSOCIATION_TOKENS.some((t) => lc === t || lc.endsWith(`_${t}`) || lc.endsWith(`_${t}s`));
}

interface FieldEntry {
  name: string;
  def: any;
}

function fieldEntries(fields: any): FieldEntry[] {
  if (!fields) return [];
  if (Array.isArray(fields)) {
    return fields.filter((f) => f && f.name != null).map((f) => ({ name: String(f.name), def: f }));
  }
  return Object.entries<any>(fields).map(([name, def]) => ({ name, def }));
}

function refOf(def: any): string | undefined {
  return def?.reference || def?.reference_to;
}

// ─── Uniqueness declarations (ADR-0120) ─────────────────────────────

export const UNIQUE_DOUBLE_DECLARATION = 'unique/double-declaration';
export const UNIQUE_UNSCOPED_DECLARED_INDEX = 'unique/unscoped-declared-index';
export const UNIQUE_LEGACY_ORGANIZATION_COMPOSITE = 'unique/legacy-organization-composite';

/**
 * The organization column, as an AUTHOR would have spelled it.
 *
 * `organization_id` is kernel-injected at registration, not authored — which is
 * exactly why an author who typed it into an index's `fields` was hand-writing
 * the per-organization composite the vocabulary now has a word for (ADR-0120
 * S6). An object may declare a different column via `tenancy.tenantField`; that
 * spelling is honored here for the same reason.
 */
function authoredTenantColumn(obj: any): string {
  const declared = obj?.tenancy?.tenantField;
  return typeof declared === 'string' && declared.trim() ? declared.trim() : 'organization_id';
}

/** Is `unique` declared at all? Mirrors `isUniqueDeclared` in @objectstack/spec/data. */
function uniqueDeclared(u: unknown): boolean {
  return u === true || u === 'global' || u === 'organization';
}

/**
 * Which boundary does a FIELD-level `unique` ask for? Bare `true` is the
 * positional synonym of `'organization'` (#3696, ADR-0120 D1 — valid
 * indefinitely).
 */
function fieldUniqueScope(u: unknown): 'organization' | 'global' {
  return u === 'global' ? 'global' : 'organization';
}

/**
 * Which boundary does a DECLARED-index `unique` ask for? Bare `true` is the
 * DEPRECATED positional spelling of `'global'` (verbatim columns — today's
 * behavior; warned by `unique/unscoped-declared-index`, rejected at protocol
 * 18, #5082). `'organization'` asks for the NULL-safe organization key part
 * to be prepended at registration (ADR-0120 D1/D3).
 */
function indexUniqueScope(u: unknown): 'organization' | 'global' {
  return u === 'organization' ? 'organization' : 'global';
}

/**
 * R11 (ADR-0120 D5a) — a declared index carries bare `unique: true`: the one
 * spelling whose scope is unstated.
 *
 * Positional intent is the #4986 trap: an author writes
 * `indexes: [{ fields: ['name'], unique: true }]` on an organization-scoped
 * object, intends "unique per organization", and silently gets
 * installation-wide. This rule fires on the SPELLING alone — deliberately no
 * tenancy or posture inference (`organization_id` is kernel-injected at
 * registration, not authored, so an authoring-time guess would be wrong half
 * the time; that dead end is documented on #4698). Both replacement words are
 * checkable at authoring time, which is what makes this the first gate in the
 * #4986 saga that can actually run here.
 *
 * 17.x: warning. Protocol 18 rejects the spelling at validate/publish (#5082).
 * Advisory — never fails a build in 17.x.
 *
 * Wiring: own AUTHORING_RULES entry (validate/build), and `lintDataModel`
 * calls it for `os lint` — each command reports each finding exactly once.
 */
export function lintUnscopedDeclaredIndexes(objects: any[]): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!Array.isArray(objects) || objects.length === 0) return issues;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj?.name) continue;
    const declaredIndexes = Array.isArray(obj.indexes) ? obj.indexes : [];
    for (let j = 0; j < declaredIndexes.length; j++) {
      const idx = declaredIndexes[j];
      if (idx?.unique !== true) continue; // fires on the bare spelling only
      const cols = Array.isArray(idx?.fields)
        ? idx.fields.filter((f: unknown) => typeof f === 'string').join(', ')
        : '';
      const indexLabel = typeof idx?.name === 'string' && idx.name.trim() ? ` '${idx.name.trim()}'` : '';
      issues.push({
        severity: 'warning',
        rule: UNIQUE_UNSCOPED_DECLARED_INDEX,
        message:
          `"${obj.name}" declares index${indexLabel} [${cols}] with bare \`unique: true\` — a unique index whose scope is ` +
          `unstated (ADR-0120). Today the bare spelling materializes over exactly its \`fields\`, i.e. installation-wide; ` +
          `an author who meant "unique per organization" gets no per-organization constraint and no error. ` +
          `Protocol 18 rejects this spelling (#5082).`,
        path: `objects[${i}].indexes[${j}]`,
        fix:
          `State the scope: \`unique: 'global'\` (installation-wide — exactly today's behavior) or ` +
          `\`unique: 'organization'\` (one holder per organization — the driver prepends the NULL-safe ` +
          `organization key part at registration).`,
      });
    }
  }
  return issues;
}

/**
 * R10 (ADR-0120 D5b) — the same single column carries BOTH a field-level
 * `unique` and a declared single-column unique index (#3991), judged in the
 * scope vocabulary. Each side states (or positionally implies) a boundary —
 * field: `true`/`'organization'` = per-organization, `'global'` =
 * installation-wide; declared index: `'global'` (or bare `true`, its
 * deprecated spelling) = installation-wide, `'organization'` =
 * per-organization — giving four quadrants:
 *
 *   - Different scopes (field per-organization × index `'global'`, or field
 *     `'global'` × index `'organization'`): CONTRADICTION. The installation-wide
 *     index is physically stricter and wins; the per-organization constraint
 *     can never be tripped. One declared intent is silently dead.
 *   - Same scope (both per-organization, or both installation-wide):
 *     REDUNDANCY — the same index declared twice.
 *
 * Tenancy is deliberately NOT inferred here — the quadrants are judged from
 * the two spellings alone, which is exactly what the vocabulary buys
 * (pre-ADR-0120, the contradiction quadrant could only be described
 * conditionally on unknowable tenancy).
 *
 * A composite declared index (`['organization_id', 'email']`) stays exempt:
 * it is the legacy hand-written organization spelling and agrees with the
 * field-level default (its `'organization'` respelling nudge is ADR-0120 D5c,
 * a separate wave).
 *
 * Advisory. The resulting stack is well-defined — the cost is an intent that
 * never takes effect, not a broken artifact — so this never fails a build.
 */
export function lintUniqueDeclarations(objects: any[]): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!Array.isArray(objects) || objects.length === 0) return issues;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj?.name) continue;
    const declaredIndexes = Array.isArray(obj.indexes) ? obj.indexes : [];
    if (declaredIndexes.length === 0) continue;

    // Columns covered by a declared SINGLE-column unique index. A composite
    // (`['organization_id', 'email']`) is the legacy hand-written organization
    // spelling — it agrees with the field-level default rather than fighting it.
    const singleColumnUniqueIndexes = new Map<string, any>();
    for (const idx of declaredIndexes) {
      if (!uniqueDeclared(idx?.unique)) continue;
      const cols = Array.isArray(idx?.fields) ? idx.fields.filter((f: unknown) => typeof f === 'string') : [];
      if (cols.length !== 1) continue;
      if (!singleColumnUniqueIndexes.has(cols[0])) singleColumnUniqueIndexes.set(cols[0], idx);
    }
    if (singleColumnUniqueIndexes.size === 0) continue;

    for (const { name, def } of fieldEntries(obj.fields)) {
      if (!uniqueDeclared(def?.unique)) continue;
      const idx = singleColumnUniqueIndexes.get(name);
      if (!idx) continue;

      const fScope = fieldUniqueScope(def.unique);
      const iScope = indexUniqueScope(idx.unique);
      const indexLabel = typeof idx?.name === 'string' && idx.name.trim() ? ` '${idx.name.trim()}'` : '';
      const fieldSpelling = `\`unique: ${typeof def.unique === 'string' ? `'${def.unique}'` : def.unique}\``;
      const indexSpelling = `\`unique: ${typeof idx.unique === 'string' ? `'${idx.unique}'` : idx.unique}\``;

      let message: string;
      let fix: string;
      if (fScope === iScope) {
        // Same scope on both sides — the same index declared twice.
        const boundary = fScope === 'global' ? 'installation-wide' : 'per-organization';
        message =
          `"${obj.name}.${name}" declares field-level ${fieldSpelling} AND a single-column unique index${indexLabel} ` +
          `(${indexSpelling}) on the same column. Both ask for the same ${boundary} boundary — the same unique ` +
          `index declared twice (ADR-0120 D5b). Redundant, not contradictory: drop one so the intent has a single home.`;
        fix =
          fScope === 'global'
            ? `Keep ONE spelling of installation-wide uniqueness: \`unique: 'global'\` on '${name}', or the declared index — not both.`
            : `Keep ONE spelling of per-organization uniqueness: \`unique: 'organization'\` on '${name}' (preferred), or the declared \`'organization'\` index — not both.`;
      } else {
        // Different scopes — the installation-wide side is physically stricter
        // and wins; the per-organization intent is dead on arrival.
        const globalSide = fScope === 'global' ? `field-level ${fieldSpelling}` : `declared index${indexLabel} (${indexSpelling})`;
        const orgSide = fScope === 'global' ? `declared index${indexLabel} (${indexSpelling})` : `field-level ${fieldSpelling}`;
        message =
          `"${obj.name}.${name}" declares an installation-wide unique (${globalSide}) AND a per-organization unique ` +
          `(${orgSide}) on the same column — the two scopes CONTRADICT (ADR-0120 D5b). The installation-wide index is ` +
          `physically stricter and wins; the per-organization constraint can never be tripped, so one of the two ` +
          `intents you wrote is silently dead.`;
        fix =
          `Pick ONE scope and say it once: for installation-wide uniqueness keep \`unique: 'global'\` and drop the ` +
          `per-organization declaration; for per-organization uniqueness set \`unique: 'organization'\` (field-level on ` +
          `'${name}', or on the declared index) and drop the installation-wide one.`;
      }

      issues.push({
        severity: 'warning',
        rule: UNIQUE_DOUBLE_DECLARATION,
        message,
        path: `objects[${i}]`,
        fix,
      });
    }
  }
  return issues;
}

/**
 * R12 (ADR-0120 D5c) — a declared unique index whose column list CONTAINS the
 * organization column: the hand-written per-organization composite (S6),
 * predating the vocabulary that can now say so.
 *
 * Why this is worth a nudge rather than left alone. The legacy spelling
 * `{ fields: ['organization_id', 'name'], unique: true }` says "per
 * organization" to a reader and materializes as a plain composite — and SQL
 * UNIQUE is NULL-distinct, so on every row where the organization column is
 * NULL it enforces **nothing** (#5030, measured). On a single-organization
 * deployment that is *every* row. The `'organization'` respelling is what closes
 * that hole: the driver makes the LISTED organization column NULL-safe in place
 * (`COALESCE(organization_id, '__global__')`), so the NULL rows become one
 * platform bucket that is unique among themselves.
 *
 * **Advisory, and deliberately no auto-fix.** ADR-0120 D5c is explicit that the
 * legacy spelling stays valid and unmigrated forever if untouched — zero forced
 * drift. Opting in is a real physical tightening that goes through the D4
 * ceremony (a `recreate_index` gated by the duplicate pre-flight probe), because
 * the rows the void constraint admitted may still be there. Fixing this on the
 * author's behalf would schedule that migration without asking.
 *
 * Not fired for `unique: 'organization'` — that IS the respelling — nor for a
 * unique declared on the organization column ALONE, which is not a composite and
 * has no per-organization reading to recover.
 */
export function lintLegacyOrganizationComposites(objects: any[]): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!Array.isArray(objects) || objects.length === 0) return issues;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj?.name) continue;
    const tenantColumn = authoredTenantColumn(obj);
    const declaredIndexes = Array.isArray(obj.indexes) ? obj.indexes : [];

    for (let j = 0; j < declaredIndexes.length; j++) {
      const idx = declaredIndexes[j];
      // Already the target spelling, or not a unique at all.
      if (!uniqueDeclared(idx?.unique) || idx.unique === 'organization') continue;
      const cols = Array.isArray(idx?.fields)
        ? idx.fields.filter((f: unknown) => typeof f === 'string')
        : [];
      if (cols.length < 2) continue; // a lone organization column is not a composite
      if (!cols.includes(tenantColumn)) continue;

      const indexLabel = typeof idx?.name === 'string' && idx.name.trim() ? ` '${idx.name.trim()}'` : '';
      const spelling = `\`unique: ${typeof idx.unique === 'string' ? `'${idx.unique}'` : idx.unique}\``;
      const rest = cols.filter((c: string) => c !== tenantColumn);
      issues.push({
        severity: 'warning',
        rule: UNIQUE_LEGACY_ORGANIZATION_COMPOSITE,
        message:
          `"${obj.name}" declares index${indexLabel} [${cols.join(', ')}] with ${spelling} and lists the organization ` +
          `column '${tenantColumn}' itself — the hand-written per-organization composite that predates the scope ` +
          `vocabulary (ADR-0120 S6). It reads as "unique per organization" but materializes as a plain composite, and ` +
          `SQL UNIQUE is NULL-distinct: on every row whose '${tenantColumn}' is NULL it enforces nothing (#5030) — which ` +
          `on a single-organization deployment is every row.`,
        path: `objects[${i}].indexes[${j}]`,
        fix:
          `State the scope instead: \`unique: 'organization'\` on this index (keep \`fields\` exactly as they are — the ` +
          `driver makes the listed '${tenantColumn}' NULL-safe in place rather than prepending a second organization key ` +
          `part). ${rest.length > 0 ? `The constraint then really is "one ${rest.join(' + ')} per organization". ` : ''}` +
          `Opting in is a physical tightening: it surfaces as a \`recreate_index\` drift op gated by the duplicate ` +
          `pre-flight probe (ADR-0120 D4), so pre-existing duplicate NULL-organization rows block it with a report ` +
          `rather than failing a boot. Leaving it as-is stays valid indefinitely and forces no drift.`,
      });
    }
  }
  return issues;
}

// ─── Rule engine ────────────────────────────────────────────────────

/**
 * Lint the relationship / data-modeling conventions across the full object set.
 * Pure and deterministic — safe to call from both the `lint` command and the
 * metadata-generation scorer.
 */
export function lintDataModel(objects: any[]): LintIssue[] {
  // R10/R11/R12 live in their own exported functions so `os validate`/`os build`
  // can run those rules without pulling in the whole best-practice sweep
  // (#3991, ADR-0120 D5a/D5b/D5c) — here `os lint` picks all three up.
  const issues: LintIssue[] = [
    ...lintUnscopedDeclaredIndexes(objects),
    ...lintUniqueDeclarations(objects),
    ...lintLegacyOrganizationComposites(objects),
  ];
  if (!Array.isArray(objects) || objects.length === 0) return issues;

  // Index: parent object name → child relationships pointing at it.
  const childrenByParent: Record<string, Array<{ child: any; fieldName: string; def: any }>> = {};
  for (const child of objects) {
    if (!child?.name) continue;
    for (const { name: fieldName, def } of fieldEntries(child.fields)) {
      if (!RELATIONSHIP_TYPES.has(def?.type)) continue;
      const parent = refOf(def);
      if (!parent) continue;
      (childrenByParent[parent] ||= []).push({ child, fieldName, def });
    }
  }

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj?.name) continue;
    const objPath = `objects[${i}]`;
    const fields = fieldEntries(obj.fields);

    // R9 — object should have a derivable display/primary field.
    //
    // `nameField` is ADR-0079's canonical primary-title pointer, so an object
    // that declares one HAS a title face. `titleFormat` is deliberately NOT one:
    // the same ADR retires it (it is a render-only template the server can
    // neither return nor query), `validate-record-title.ts` reports every
    // declaration of it as `title-format-retired` and steers the author to
    // `nameField`, and the shared spec predicate `objectTitleCompleteness`
    // (packages/spec/src/data/display-name.ts) never reads it either.
    //
    // Reading `titleFormat` while ignoring `nameField` made this rule
    // contradict its own package (#6108): an author who followed the platform's
    // own migration advice earned a "records will display as raw IDs"
    // suggestion, while one who kept the retired key did not. The name-like
    // derivation is unchanged.
    //
    // A third limb, `!!obj.primaryField`, was REMOVED here in #6326. That key
    // is declared nowhere in `packages/spec`: measured on 17.0.0-rc.5,
    // `ObjectSchema.safeParse` reports `unrecognized_keys: ['primaryField']`
    // and `ObjectSchema.create()` rejects it outright, so the limb could never
    // be true for an object the spec accepts — a #4984-family dead branch that
    // nonetheless read as a title face here, in `validate-semantic-roles` and
    // in the objectstack-data skill doc. The maintainer ruled remove, not
    // declare: `nameField` is ADR-0079's one canonical title pointer and a
    // second parallel pointer contradicts "one Zod source per metadata type"
    // (Prime Directive #7). Do not reintroduce it as a tolerated alias — a
    // consumer-side `??` for a key the producer rejects is exactly the second
    // de-facto contract Prime Directive #12 bans.
    const hasNameField =
      !!obj.nameField ||
      fields.some((f) => NAME_LIKE_FIELDS.includes(f.name));
    if (fields.length > 0 && !hasNameField) {
      issues.push({
        severity: 'suggestion',
        rule: 'object/missing-name-field',
        message: `Object "${obj.name}" has no nameField and no name-like field — records will display as raw IDs`,
        path: `${objPath}.fields`,
        fix:
          `Set \`nameField: '<field>'\` — ADR-0079's canonical primary-title pointer — to a stored ` +
          `text/autonumber field, or to a formula field with \`returnType: 'text'\` for a composite ` +
          `title. A \`titleFormat\` template does NOT count: it is retired (ADR-0079) and render-only, ` +
          `so the server can neither return nor query the title it renders.`,
      });
    }

    for (const { name: fieldName, def } of fields) {
      if (!def || typeof def !== 'object') continue;
      const fieldPath = `${objPath}.fields.${fieldName}`;
      const type = def.type;

      // R8 — option fields need options (or an options source).
      if (OPTION_FIELD_TYPES.has(type)) {
        const hasOptions =
          (Array.isArray(def.options) && def.options.length > 0) ||
          !!def.optionsFrom || !!def.dataSource || !!def.reference;
        if (!hasOptions) {
          issues.push({
            severity: 'warning',
            rule: 'field/select-missing-options',
            message: `${type} field "${obj.name}.${fieldName}" has no options`,
            path: `${fieldPath}.options`,
          });
        }
      }

      if (!RELATIONSHIP_TYPES.has(type)) continue;
      const parent = refOf(def);

      // R1 — relationship fields must declare a reference target.
      if (!parent) {
        issues.push({
          severity: 'error',
          rule: 'relationship/missing-reference',
          message: `${type} field "${obj.name}.${fieldName}" is missing a reference target`,
          path: `${fieldPath}.reference`,
        });
        continue;
      }

      if (type === 'master_detail') {
        // R2 — master-detail children should require their parent.
        if (def.required !== true) {
          issues.push({
            severity: 'warning',
            rule: 'relationship/master-detail-required',
            message: `master_detail "${obj.name}.${fieldName}" → ${parent} should be required (a detail record cannot exist without its master)`,
            path: `${fieldPath}.required`,
            fix: 'required: true',
          });
        }
        // R3 — be explicit about cascade behaviour.
        if (def.deleteBehavior === undefined) {
          issues.push({
            severity: 'suggestion',
            rule: 'relationship/delete-behavior',
            message: `master_detail "${obj.name}.${fieldName}" → ${parent} should declare deleteBehavior (cascade/restrict/set_null)`,
            path: `${fieldPath}.deleteBehavior`,
            fix: "deleteBehavior: 'cascade'",
          });
        }
        // R5 — line-item children are usually entered inline with the parent.
        if (isLineItemName(obj.name) && def.inlineEdit !== true) {
          issues.push({
            severity: 'suggestion',
            rule: 'relationship/line-items-inline-edit',
            message: `"${obj.name}" looks like line items of ${parent}; consider inlineEdit: true on "${fieldName}" so it is entered inline within the ${parent} form`,
            path: `${fieldPath}.inlineEdit`,
            fix: 'inlineEdit: true',
          });
        }
      }

      // R4 — a line-item-shaped child should usually be master_detail, not lookup.
      if (type === 'lookup' && isLineItemName(obj.name)) {
        issues.push({
          severity: 'suggestion',
          rule: 'relationship/line-item-should-be-master-detail',
          message: `"${obj.name}" looks like line items of ${parent} but uses lookup; master_detail gives ownership + cascade + roll-ups`,
          path: `${fieldPath}.type`,
          fix: "type: 'master_detail'",
        });
      }

      // R6 — associations should NOT be inlined into the parent's entry form.
      if (def.inlineEdit === true && isAssociationName(obj.name)) {
        issues.push({
          severity: 'warning',
          rule: 'relationship/association-inline-edit',
          message: `"${obj.name}" is an association (comments/audit/activity), not line items — inlineEdit clutters the ${parent} entry form; surface it as a detail-page related list instead`,
          path: `${fieldPath}.inlineEdit`,
          fix: 'remove inlineEdit (use relatedList on the detail page)',
        });
      }
    }

    // R7 — a parent of master_detail children with numeric fields should roll one up.
    const children = childrenByParent[obj.name] || [];
    const summaryChildObjects = new Set(
      fields
        .filter((f) => f.def?.type === 'summary')
        .map((f) => f.def?.summaryOperations?.object || f.def?.reference)
        .filter(Boolean),
    );
    const seenSuggestedChild = new Set<string>();
    for (const { child, def } of children) {
      if (def?.type !== 'master_detail') continue;
      if (!child?.name || seenSuggestedChild.has(child.name)) continue;
      if (summaryChildObjects.has(child.name)) continue;
      // Only nudge when the child actually has something worth aggregating.
      const numericChildField = fieldEntries(child.fields).find((f) => NUMERIC_TYPES.has(f.def?.type));
      if (!numericChildField) continue;
      seenSuggestedChild.add(child.name);
      issues.push({
        severity: 'suggestion',
        rule: 'rollup/missing-summary',
        message: `"${obj.name}" owns "${child.name}" (master_detail) with numeric field "${numericChildField.name}" but has no roll-up summary; consider a summary field (count/sum) on ${obj.name}`,
        path: `${objPath}.fields`,
        fix: `summary field aggregating ${child.name}.${numericChildField.name}`,
      });
    }
  }

  return issues;
}
