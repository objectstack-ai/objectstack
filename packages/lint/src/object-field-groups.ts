// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-group REFERENCE integrity — the cross-schema half of #13855.
 *
 * A layout section may name a declared field group instead of enumerating its
 * members: `{ group: 'contact_info' }` on a `record:details` section or on a
 * form view's `sections[]`. Membership and presentation are then derived from
 * the object's `fieldGroups` entry with that key (`deriveFieldGroupLayout`,
 * ADR-0085 §5).
 *
 * The key names something on a DIFFERENT schema, so the spec door deliberately
 * cannot answer whether it resolves — it takes any well-formed snake_case key,
 * exactly as `UserFilterFieldSchema.field` does (*"must exist — checked by
 * reference diagnostics"*). This module is that check's shared half: both
 * host rules ask one question of one index rather than growing two answers that
 * happen to agree.
 *
 * ## Why a dangling key must be reported at all
 *
 * `deriveFieldGroupLayout` resolves a section's members by looking the key up
 * among the object's declared groups. A key that matches nothing yields no
 * members, and since the reference form and the enumerated form are mutually
 * exclusive at parse, the section has no other member source — so the WHOLE
 * section silently disappears from the rendered page. That is the same
 * silent-skip consequence the two host rules' field-existence findings carry,
 * one grain up.
 *
 * ## Severity: `warning`, matching the family
 *
 * Both host rules declare `warning` for a dangling reference, for the reason
 * their module notes give: the consumer degrades (it skips what it cannot
 * resolve) rather than failing, and the `error` limb in
 * `validate-page-field-bindings` is reserved for a reference that reaches a
 * QUERY, where the silent result is indistinguishable from "there is no data".
 * A section that does not render is loud to look at and touches no query, so it
 * sits with its siblings rather than gating. (The judgement is stated here
 * rather than left implicit because it is a judgement — see the PR body for
 * #13855, where it is offered for contract review.)
 */

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (isRec(v)) return Object.entries(v).map(([name, def]) => ({ name, ...(isRec(def) ? def : {}) }));
  return [];
}

/**
 * object name → its DECLARED field-group keys.
 *
 * Declared, not derived: `deriveFieldGroupLayout` drops a group no visible field
 * joins, and a reference to a declared-but-empty group is a different (and
 * data-dependent) finding from a reference to a group that was never declared.
 * This index answers only the second question — the one with a closed oracle.
 *
 * `fieldGroups` is an ARRAY on `ObjectSchema`, and `asArray` additionally
 * resolves the name-keyed map shape that raw (non-`defineStack`) metadata can
 * carry, the same tolerance every other index in this package extends.
 */
export function indexObjectFieldGroups(stack: unknown): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  if (!isRec(stack)) return index;
  for (const obj of asArray(stack.objects)) {
    const name = strName(obj.name);
    if (!name) continue;
    const keys = new Set<string>();
    for (const group of asArray(obj.fieldGroups)) {
      // `asArray` supplies `name` for the map shape; the declared key spelling
      // is `key`, so read it first and fall back to the synthesized map key.
      const key = strName(group.key) ?? strName(group.name);
      if (key) keys.add(key);
    }
    index.set(name, keys);
  }
  return index;
}

/** One `section.group` reference, with the path that located it. */
export interface SectionGroupRef {
  /** The referenced field-group key, as authored. */
  key: string;
  /** Config path of the `group` key itself. */
  path: string;
}

/**
 * Pull `group` references out of a `sections`-shaped value.
 *
 * `sep` joins the index onto `basePath` the way the calling surface addresses
 * itself — `.` for metadata config paths, and the react surface's ` › ` if it
 * ever grows a section-bearing block.
 */
export function sectionGroupRefs(sections: unknown, basePath: string, sep = '.'): SectionGroupRef[] {
  if (!Array.isArray(sections)) return [];
  const out: SectionGroupRef[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!isRec(section)) continue;
    const key = strName(section.group);
    if (key) out.push({ key, path: `${basePath}[${i}]${sep}group` });
  }
  return out;
}

/** The finding shape both host rules already declare, structurally. */
export interface SectionGroupFinding {
  severity: 'warning';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/**
 * Check one batch of group references against `objectName`'s declared groups.
 *
 * Bails out when the object is not defined in this stack — it may come from
 * another installed package, and a group cannot be judged on a schema we cannot
 * see. That is the same skip {@link checkFieldRefs} takes, and for the same
 * reason: silence about an unknowable object beats a finding the author cannot
 * act on.
 */
export function checkSectionGroupRefs(
  refs: readonly SectionGroupRef[],
  objectName: string | undefined,
  objectFieldGroups: ReadonlyMap<string, Set<string>>,
  where: string,
  rule: string,
): SectionGroupFinding[] {
  const findings: SectionGroupFinding[] = [];
  if (!objectName) return findings;
  const declared = objectFieldGroups.get(objectName);
  if (!declared) return findings; // cross-package object — unknowable here
  for (const ref of refs) {
    if (declared.has(ref.key)) continue;
    findings.push({
      severity: 'warning',
      rule,
      where,
      path: ref.path,
      message:
        `section references field group "${ref.key}", which object "${objectName}" does not `
        + 'declare — the section inherits its members from that group, so it resolves to no '
        + 'fields and the whole section silently does not render',
      hint:
        `Fix the key, or declare it: \`fieldGroups: [{ key: '${ref.key}', label: '…' }]\` on `
        + `${objectName}, with each member field carrying \`group: '${ref.key}'\`. `
        + (declared.size > 0
          ? `Declared groups on ${objectName}: ${[...declared].sort().join(', ')}.`
          : `${objectName} declares no field groups at all, so no section on it can reference one `
            + 'yet — enumerate the members with `fields` until it does.'),
    });
  }
  return findings;
}
