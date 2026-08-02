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

// ─── Uniqueness declarations ────────────────────────────────────────

export const UNIQUE_DOUBLE_DECLARATION = 'unique/double-declaration';

/** Is `unique` declared at all? Mirrors `isUniqueDeclared` in @objectstack/spec/data. */
function uniqueDeclared(u: unknown): boolean {
  return u === true || u === 'global';
}

/**
 * R10 — the same column carries BOTH a field-level `unique: true` and an
 * object-level single-column unique index (#3991).
 *
 * The two spellings are deliberately different (see `IndexSchema`): field-level
 * `unique: true` is tenant-scoped since #3696 — it materializes as
 * `(organization_id, col)`, unique *within* the tenant — while a declared index
 * is materialized over exactly the columns listed, i.e. platform-wide. Both are
 * legitimate on their own; together on one column they are never right:
 *
 *   - On a tenant-scoped object they CONTRADICT. The stricter one wins
 *     physically, so the global index enforces uniqueness and the tenant
 *     composite becomes a constraint nothing can ever trip. One of the two
 *     intents the author wrote is silently discarded.
 *   - On a tenancy-less object they are exactly REDUNDANT — both describe the
 *     same single-column unique index, under the same generated name.
 *
 * Tenancy is deliberately NOT inferred here: `organization_id` is injected by
 * the kernel at registration rather than authored, so an authoring-time guess
 * would be wrong half the time. The combination is worth flagging either way,
 * and the message names both readings so the author picks the one they meant.
 *
 * A field declared `unique: 'global'` is exempt: it already says
 * platform-wide, so the declared index restates the same intent rather than
 * contradicting it (still redundant, but not a silent loss of meaning).
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
    // (`['organization_id', 'email']`) is the explicit tenant-scoped spelling —
    // it agrees with the field-level default rather than fighting it.
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
      if (def.unique === 'global') continue; // already says platform-wide — no lost intent
      const idx = singleColumnUniqueIndexes.get(name);
      if (!idx) continue;
      const indexLabel = typeof idx?.name === 'string' && idx.name.trim() ? ` '${idx.name.trim()}'` : '';
      issues.push({
        severity: 'warning',
        rule: UNIQUE_DOUBLE_DECLARATION,
        message:
          `"${obj.name}.${name}" declares field-level \`unique: true\` AND a single-column unique index${indexLabel} on the same column. ` +
          `Since #3696 the field-level form is scoped per tenant — \`(tenant, ${name})\` — while a declared index is materialized ` +
          `over exactly its \`fields\`, i.e. platform-wide. On a tenant-scoped object the global index wins and the per-tenant ` +
          `constraint can never be reached; on a tenancy-less object the two are the same index declared twice. Either way one of ` +
          `the two declarations has no effect.`,
        path: `objects[${i}]`,
        fix:
          `Pick the intent: for platform-wide uniqueness set \`unique: 'global'\` on '${name}' and drop the duplicate index; ` +
          `for per-tenant uniqueness drop the index (the field-level declaration already builds the tenant composite), ` +
          `or spell the index out as \`fields: ['organization_id', '${name}']\` if you want it explicit.`,
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
  // R10 lives in its own exported function so `os build` can run that ONE rule
  // without pulling in the whole best-practice sweep (#3991).
  const issues: LintIssue[] = lintUniqueDeclarations(objects);
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
    const hasNameField =
      !!obj.primaryField ||
      !!obj.titleFormat ||
      fields.some((f) => NAME_LIKE_FIELDS.includes(f.name));
    if (fields.length > 0 && !hasNameField) {
      issues.push({
        severity: 'suggestion',
        rule: 'object/missing-name-field',
        message: `Object "${obj.name}" has no name/title field or primaryField — records will display as raw IDs`,
        path: `${objPath}.fields`,
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
