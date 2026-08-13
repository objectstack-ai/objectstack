// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time semantic-role diagnostics (ADR-0085).
 *
 * The object-level semantic roles (`stageField`, `highlightFields` /
 * deprecated `compactLayout`, `fieldGroups` + `Field.group`) are pointers
 * into the object's own field map. A dangling pointer is Zod-valid but
 * silently inert at render time — the exact "parsed, unmarked, silently
 * inert" shape ADR-0078 prohibits — so the completeness lint flags it here,
 * uniformly for `os build`/`os validate`, MCP authoring and hand authors.
 *
 * All three rules are warnings, not errors: every consumer degrades
 * gracefully (an unknown `Field.group` renders in the ungrouped bucket, an
 * unknown highlight name is skipped, an unknown `stageField` falls back to
 * heuristics), so nothing is fully broken — but the author almost certainly
 * typo'd a name and should be told at author time, not discover it by
 * staring at an unchanged page.
 */

import { injectedColumnsFor, unprovisionedInjectedColumnsFor } from './system-fields.js';

export const FIELD_GROUP_UNDECLARED = 'field-group-undeclared';
export const FIELD_GROUP_EMPTY = 'field-group-empty';
export const FIELD_GROUP_SHADOWED = 'field-group-shadowed';
export const SEMANTIC_ROLE_FIELD_UNKNOWN = 'semantic-role-field-unknown';
export const SEMANTIC_ROLE_FIELD_UNPROVISIONED = 'semantic-role-field-unprovisioned';

export type SemanticRoleSeverity = 'error' | 'warning';

export interface SemanticRoleFinding {
  /** Always `warning` today — all three rules are advisory (see module note). */
  severity: SemanticRoleSeverity;
  /** Diagnostic rule id, e.g. `field-group-undeclared`. */
  rule: string;
  /** Human-readable location, e.g. `object "invoice"`. */
  where: string;
  /** Config path, e.g. `objects[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Validate every object's semantic-role pointers. Returns the list of
 * findings (empty = clean). Advisory only — the caller must never fail the
 * build on these alone.
 */
export function validateSemanticRoles(stack: AnyRec): SemanticRoleFinding[] {
  const findings: SemanticRoleFinding[] = [];

  const objects = asArray(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue; // tolerate junk entries
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const where = `object "${objName}"`;
    const path = `objects[${i}]`;

    const fields = (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields))
      ? (obj.fields as Record<string, AnyRec | undefined>)
      : {};
    // Declared fields UNION the system columns the platform injects on THIS
    // object (#5378). A semantic role pointing at an injected-only column
    // (`highlightFields: ['owner_id']`, `stageField: 'owner_id'`) is a live
    // pointer — the column exists at render time — so warning that it "is not a
    // field on this object" was a false finding, and one with teeth: it pushed
    // apps into re-declaring system columns just to silence it (hotcrm#548, 6
    // objects). Same conditional derivation the registry's `applySystemFields`
    // consumes, so `ownership: 'none'` still has no `owner_id` to point at and
    // still warns.
    //
    // Only the EXISTENCE question widens. `fields` itself stays declared-only
    // below, which is what the group rules (a/b/d) want: an injected column
    // carries no `group`, is filtered out of default layouts anyway
    // (`FIELD_GROUP_SYSTEM_FIELDS`), and must not count as a group member or a
    // title candidate.
    const fieldNames = new Set([...Object.keys(fields), ...injectedColumnsFor(obj)]);
    // [#8116] The provenance half of the same #5378 widening: on an ADR-0015
    // `external` object the injected anchors resolve — so rule (c) rightly
    // stays silent — but the platform provisions no storage behind them, so a
    // pointer at one drives its consumers (default columns, cards, previews,
    // the highlight strip, stage detection) off a column that is blank on
    // every record. Existence and provenance are different questions; the set
    // is empty everywhere except external objects, and an author-DECLARED
    // column of the same name is the author's and never in it.
    const unprovisioned = unprovisionedInjectedColumnsFor(obj);
    const unprovisionedPointer = (slot: string, entry: string): SemanticRoleFinding => ({
      severity: 'warning',
      rule: SEMANTIC_ROLE_FIELD_UNPROVISIONED,
      where,
      path: `${path}.${slot}`,
      message:
        `${objName}: ${slot} points at "${entry}", an injected system column with no storage ` +
        `behind it — this object is external (ADR-0015), so the platform registers the anchor ` +
        `but the remote schema owns the table and no column backs it. Every consumer renders ` +
        `it empty on every record.`,
      hint:
        `If the remote table really carries "${entry}", declare it in the object's own fields ` +
        `(mapped through the external binding's columnMap); otherwise point ${slot} at a real ` +
        `remote column.`,
    });

    // ── (a) Field.group → declared fieldGroups[].key ──
    const declaredGroups = new Set(
      (Array.isArray(obj.fieldGroups) ? obj.fieldGroups : [])
        .filter((g): g is AnyRec => !!g && typeof g === 'object')
        .map((g) => g.key)
        .filter((k): k is string => typeof k === 'string' && k.length > 0),
    );
    const referencedGroups = new Set<string>();
    for (const [fname, f] of Object.entries(fields)) {
      const g = f?.group;
      if (typeof g !== 'string' || g.length === 0) continue;
      referencedGroups.add(g);
      if (!declaredGroups.has(g)) {
        findings.push({
          severity: 'warning',
          rule: FIELD_GROUP_UNDECLARED,
          where,
          path: `${path}.fields.${fname}.group`,
          message:
            `${objName}.${fname}: group "${g}" is not declared in fieldGroups — ` +
            `the field renders in the ungrouped bucket, not under "${g}"`,
          hint:
            `Declare { key: '${g}', label: '…' } in ${objName}.fieldGroups, or fix ` +
            `the field's group reference. Group keys are snake_case and must match exactly.`,
        });
      }
    }

    // ── (b) declared group no field references ──
    for (const key of declaredGroups) {
      if (!referencedGroups.has(key)) {
        findings.push({
          severity: 'warning',
          rule: FIELD_GROUP_EMPTY,
          where,
          path: `${path}.fieldGroups`,
          message:
            `${objName}: fieldGroups declares "${key}" but no field references it — ` +
            `the group never renders`,
          hint:
            `Assign at least one field via group: '${key}', or remove the unused ` +
            `group declaration.`,
        });
      }
    }

    // ── (c) semantic-role pointers name real fields ──
    const stage = obj.stageField;
    if (typeof stage === 'string' && stage.length > 0 && !fieldNames.has(stage)) {
      findings.push({
        severity: 'warning',
        rule: SEMANTIC_ROLE_FIELD_UNKNOWN,
        where,
        path: `${path}.stageField`,
        message:
          `${objName}: stageField "${stage}" is not a field on this object — ` +
          `consumers fall back to heuristic stage detection`,
        hint:
          `Point stageField at an existing select/status field, or set ` +
          `stageField: false to declare the object has no linear lifecycle.`,
      });
    } else if (typeof stage === 'string' && unprovisioned.has(stage)) {
      findings.push(unprovisionedPointer('stageField', stage));
    }

    const highlights = Array.isArray(obj.highlightFields)
      ? obj.highlightFields
      : Array.isArray(obj.compactLayout) // deprecated alias (pre-normalization input)
        ? obj.compactLayout
        : [];
    for (const entry of highlights) {
      if (typeof entry !== 'string' || entry.length === 0) continue;
      if (fieldNames.has(entry)) {
        if (unprovisioned.has(entry)) findings.push(unprovisionedPointer('highlightFields', entry));
        continue;
      }
      findings.push({
        severity: 'warning',
        rule: SEMANTIC_ROLE_FIELD_UNKNOWN,
        where,
        path: `${path}.highlightFields`,
        message:
          `${objName}: highlightFields entry "${entry}" is not a field on this ` +
          `object — it is silently skipped by every consumer`,
        hint:
          `Fix the field name (highlightFields drives default columns, cards, ` +
          `previews and the detail highlight strip, in order).`,
      });
    }

    // ── (d) declared group fully shadowed by the detail highlight strip ──
    // Detail pages render the first 4 highlightFields as the top strip and
    // HIDE those fields from the details body; the record's title field is
    // the page H1 and never renders in the body either. A group whose every
    // visible member is covered by strip ∪ title therefore renders on FORMS
    // but silently never on detail pages — legal, but almost never what the
    // author pictured when they declared the group.
    const declaredStrings = highlights.filter(
      (h): h is string => typeof h === 'string' && h.length > 0,
    );
    if (declaredStrings.length > 0 && declaredGroups.size > 0) {
      // Mirror the renderer's title resolution: declared role first
      // (nameField, else the deprecated displayNameField), else the first
      // conventional display-field name present on the object.
      //
      // `primaryField` sat between those two until #6326 removed it. It is
      // declared nowhere in `packages/spec` — `ObjectSchema` rejects it with
      // `unrecognized_keys` — so the entry could never match on an object the
      // spec accepts, and reading it here advertised a title pointer authors
      // cannot write. `nameField` is ADR-0079's canonical one.
      const declaredTitle = [obj.nameField, obj.displayNameField]
        .find((v): v is string => typeof v === 'string' && v.length > 0 && fieldNames.has(v));
      const titleField = declaredTitle
        ?? ['name', 'full_name', 'title', 'subject', 'display_name'].find((c) => fieldNames.has(c));
      const stripSet = new Set(
        declaredStrings.filter((h) => h !== titleField).slice(0, 4),
      );
      const hiddenFromBody = new Set(stripSet);
      if (titleField) hiddenFromBody.add(titleField);

      for (const key of declaredGroups) {
        const members = Object.entries(fields)
          .filter(([, f]) => f?.group === key && f?.hidden !== true)
          .map(([fname]) => fname);
        if (members.length === 0) continue; // rule (b) already covers empty groups
        if (!members.every((m) => hiddenFromBody.has(m))) continue;
        findings.push({
          severity: 'warning',
          rule: FIELD_GROUP_SHADOWED,
          where,
          path: `${path}.fieldGroups`,
          message:
            `${objName}: every field in group "${key}" (${members.join(', ')}) is ` +
            `hoisted into the detail highlight strip (or is the record title) — ` +
            `the group renders on forms but never on detail pages`,
          hint:
            `Keep at least one non-highlighted field in "${key}", or remove the ` +
            `group if the strip already covers it. (Detail pages show the first ` +
            `4 highlightFields as the top strip and hide them from the body.)`,
        });
      }
    }
  }

  return findings;
}
