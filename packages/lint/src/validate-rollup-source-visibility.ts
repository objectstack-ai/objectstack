// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A roll-up summary field a permission set can read, over child data the same
 * set cannot read.
 *
 * | Rule                                         | Severity | Arm                                   |
 * |----------------------------------------------|----------|---------------------------------------|
 * | security-rollup-source-unreadable            | warning  | the set cannot read the child object, the aggregated child field, or a child field the roll-up's `filter` tests |
 * | security-rollup-source-row-scoped            | info     | the set reads all of those, but a row-level policy narrows WHICH child rows it reads |
 *
 * ## The rule it tells the author about
 *
 * A `summary` field is a stored column on the parent. The engine recomputes it
 * system-elevated, over the WHOLE child collection, after every child write
 * (`engine-summaries-and-expansion.ts`, "Why the recompute is system-elevated"),
 * and on read the column answers only to the PARENT field's own field-level
 * security (`content/docs/data-modeling/fields.mdx`, the roll-up section;
 * ADR-0035 "Server-side rollup"). That is the documented semantics, and they
 * stay: a roll-up is a property of the parent, never of one reader's view of
 * the children. So a set that cannot read `invoice_line.amount`, or cannot read
 * `invoice_line` at all, or reads only some of its rows, still reads
 * `invoice.total` — the sum over every line. Nothing in the set's declaration
 * says so, and the author who wrote the field mask is the one who expects it to
 * hold. This rule is where they are told, at the moment they configure it.
 *
 * Advisory on purpose: the pair is legal and is often meant (an order total
 * visible to staff who may not see line costs). The remedy, when it is not
 * meant, is the parent field's own mask — `fields["invoice.total"]:
 * { readable: false }` on the set — which is what the hint names, together with
 * its reach: the field merge (`getFieldPermissions`) lets only DECLARING sets
 * vote, so that entry hides the column from every holder of the set, and a
 * co-held set with no entry for it casts no vote that would restore it.
 *
 * ## "Can read", as the runtime decides it
 *
 * Three gates decide whether a set reads an object or a field, and the rule
 * folds all three, on both sides of the roll-up:
 *
 *  - the object grant: the set's own entry for the object, otherwise its `'*'`
 *    entry, which covers a `private` object only when it carries View All /
 *    Modify All ({@link grantFor}, `resolveObjectPermission`);
 *  - the field entry: `readable: false` hides the field, unless the set's
 *    View All / Modify All on the object votes every field readable
 *    (ADR-0066 D2 ⑧ as amended). No entry ⇒ readable, as the merge does with an
 *    absent key ({@link fieldHidden});
 *  - the capability gate (ADR-0066 D3): an object's `requiredPermissions` —
 *    the `string[]` form, or the `read` bucket of the per-operation map
 *    (`requiredCapsForOperation(…, 'find')`) — refuses the read
 *    (`objectReadAdmission`, step 4), and a field's `requiredPermissions` hides
 *    the field (`foldFieldRequiredPermissions`), unless the set's
 *    `systemPermissions` hold EVERY listed capability. View All / Modify All
 *    lifts neither: the object gate runs whatever the grants, and the field fold
 *    runs after the super-user vote ({@link missingCapabilities}).
 *
 * ## What is judged, per (permission set × summary field)
 *
 * Judged only when the set can read the summary column at all: it reads the
 * parent object (grant and capability gate) and the summary field (entry and
 * capability gate). A set that cannot see the column learns nothing from it.
 *
 * Then, over the child object `summaryOperations.object` names, in order, one
 * finding per pair:
 *
 *  1. the set cannot read the child object ⇒ `security-rollup-source-unreadable`;
 *  2. it cannot read `summaryOperations.field` ⇒ the same id. A `count` reads no
 *     value, so its `field` is never judged (R13's reading);
 *  3. it cannot read a child field `summaryOperations.filter` tests ⇒ the same
 *     id: a filtered count or sum over a predicate on a field tells its reader
 *     something about that field. Each top-level field key of the filter is
 *     judged, in every authored shape ({@link walkFilterFieldKeys}); a dotted
 *     key reads through a lookup into another object and is not judged;
 *  4. otherwise, a row-level policy that scopes the set's reads of the child ⇒
 *     `security-rollup-source-row-scoped` (see below).
 *
 * ## Row scoping — what is decidable statically, and what is not
 *
 * The `info` arm reads the two row-policy sources the security plugin
 * collects for a caller's read of the child:
 *
 *  - the set's own `rowLevelSecurity[]` entries that apply to a read of the
 *    child — not `enabled: false`, `object` the child or `'*'`, `operation`
 *    `select` or `all` (`RLSCompiler.getApplicablePolicies`) — with a
 *    non-blank `using`, the read predicate;
 *  - otherwise the child's own `defaultRowScope`, which the plugin applies when
 *    the caller's held sets carry no read-class policy for the object
 *    (`object-default-row-scope.ts`), judged here against this set alone.
 *
 * A set holding View All / Modify All on the child skips both only where the
 * child's posture lets the read filter short-circuit business row security
 * (`security-plugin-rls-filter.ts`, `posturePermits`): a `private` child, a
 * child with tenancy off (`tenancy.enabled: false` or
 * `systemFields.tenant: false`), or an auth-managed one
 * (`managedBy: 'better-auth'`). On any other child the bypass bit narrows
 * nothing away, so the set's policies still apply and are judged.
 *
 * Both are about the policy's PRESENCE, never its predicate: whether a given
 * `using` admits every row the roll-up reads is a question about data, so the
 * arm stays a note. A policy's `positions` domain narrows it to some holders,
 * which the message names. Record sharing is not read: an object's
 * `sharingModel` / `readScope` depth also narrows reads, but on almost every
 * `private` child it does, so a note there would fire on the ordinary shape.
 *
 * ## Silence, never a guess
 *
 * A child object this stack does not define (another package's, or one that
 * arrives later — R13's "The child object" section) is not judged: its posture
 * cannot be read. Each set is judged on its own — a holder of two sets reads
 * what their union grants, capabilities included — so a finding describes what
 * the set itself grants.
 *
 * Pure `(stack) => Finding[]`, registered `input: 'parsed'`; every key it
 * reads is one the spec declares, so the normalized stack `os lint` hands it
 * answers the same.
 */

import { objectPermissionGrants, type EffectiveObjectPermission } from '@objectstack/spec/security';
import { walkFilterFieldKeys } from './filter-walk.js';
import { objectsAsServed, recordsOf } from './object-graph.js';
import { holdsSuperuserBypass } from './validate-security-posture.js';

export const SECURITY_ROLLUP_SOURCE_UNREADABLE = 'security-rollup-source-unreadable';
export const SECURITY_ROLLUP_SOURCE_ROW_SCOPED = 'security-rollup-source-row-scoped';

export type RollupSourceVisibilitySeverity = 'warning' | 'info';

export interface RollupSourceVisibilityFinding {
  severity: RollupSourceVisibilitySeverity;
  /** `security-rollup-source-unreadable` or `security-rollup-source-row-scoped`. */
  rule: string;
  /** e.g. `permission set "warehouse_staff" · summary field "invoice.total"`. */
  where: string;
  /** The set's field entry for the summary column, where the remedy is written. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(nonBlank) : []);

/** The RLS operations a read is matched against (`RLSCompiler.getApplicablePolicies`). */
const READ_CLASS_RLS_OPERATIONS: ReadonlySet<string> = new Set(['select', 'all']);

/** One object as the rule reads it: its posture, and its fields by name. */
interface ObjectView {
  name: string;
  def: AnyRec;
  isPrivate: boolean;
  fields: Map<string, AnyRec>;
}

/** One `summary` field whose child object this stack defines. */
interface SummaryDescriptor {
  parent: ObjectView;
  field: string;
  child: ObjectView;
  /** The aggregated child field; absent on a `count`, which reads no value. */
  childField?: string;
  /** The child fields `summaryOperations.filter` tests, top-level keys only, without `childField`. */
  filterFields: string[];
}

/** `access.default: 'private'` — the posture the `'*'` wildcard does not cover (ADR-0066 D2). */
function isPrivatePosture(obj: AnyRec): boolean {
  const access = obj.access;
  return isRec(access) && access.default === 'private';
}

/**
 * The posture on which a super-user's read skips business row security
 * (`posturePermits` in plugin-security's `security-plugin-rls-filter.ts`):
 * private access, tenancy off, or an auth-managed table.
 */
function postureSkipsRowSecurityForSuperuser(obj: ObjectView): boolean {
  const { def } = obj;
  return (
    obj.isPrivate ||
    (isRec(def.tenancy) && def.tenancy.enabled === false) ||
    (isRec(def.systemFields) && def.systemFields.tenant === false) ||
    def.managedBy === 'better-auth'
  );
}

/**
 * The set's own object permission for `objectName`, the way the runtime
 * resolves it (`resolveObjectPermission` in plugin-security's
 * `permission-evaluator.ts`): the explicit entry when the set has one,
 * otherwise its `'*'` entry — which covers a `private` object only when it
 * carries the super-user bypass. A lookup, never a merge.
 */
function grantFor(set: AnyRec, objectName: string, isPrivate: boolean): EffectiveObjectPermission | undefined {
  const objects = isRec(set.objects) ? set.objects : undefined;
  if (!objects) return undefined;
  const explicit = objects[objectName];
  if (isRec(explicit)) return explicit as EffectiveObjectPermission;
  const wild = objects['*'];
  if (!isRec(wild)) return undefined;
  if (!isPrivate) return wild as EffectiveObjectPermission;
  return wild.viewAllRecords === true || wild.modifyAllRecords === true ? (wild as EffectiveObjectPermission) : undefined;
}

/**
 * Does the set's own field entry hide `objectName.fieldName`? `readable: false`
 * hides it unless the set's super-user bypass on the object votes every field
 * readable (ADR-0066 D2 ⑧ as amended). No entry ⇒ not hidden.
 */
function fieldHidden(set: AnyRec, objectName: string, fieldName: string): boolean {
  const fields = isRec(set.fields) ? set.fields : undefined;
  const entry = fields?.[`${objectName}.${fieldName}`];
  if (!isRec(entry) || entry.readable !== false) return false;
  return !holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, objectName, 'view');
}

/**
 * [ADR-0066 D3] The capabilities in `required` the set's own
 * `systemPermissions` do not hold — empty when the gate passes. An AND-gate:
 * every listed capability must be held (`getSystemPermissions`, then
 * `caps.every(held.has)`). The super-user bits do not enter it.
 */
function missingCapabilities(set: AnyRec, required: readonly string[]): string[] {
  if (required.length === 0) return [];
  const held = new Set(strings(set.systemPermissions));
  return [...new Set(required)].filter((c) => !held.has(c));
}

/**
 * The capabilities an object read requires: the `string[]` form gates every
 * operation; the per-operation map gates a read through its `read` bucket
 * (`normalizeRequiredPermissions` + `requiredCapsForOperation(…, 'find')`).
 */
function objectReadCapabilities(obj: ObjectView): string[] {
  const rp = obj.def.requiredPermissions;
  if (Array.isArray(rp)) return strings(rp);
  if (isRec(rp)) return strings(rp.read);
  return [];
}

/** A field's `requiredPermissions` (`fieldRequiredPermissions` in the object's security meta). */
function fieldCapabilities(obj: ObjectView, fieldName: string): string[] {
  return strings(obj.fields.get(fieldName)?.requiredPermissions);
}

/** Why the set cannot read something, or `undefined` when it can. */
type Unreadable = { cause: 'grant' } | { cause: 'hidden' } | { cause: 'capability'; missing: string[] };

function objectUnreadable(set: AnyRec, obj: ObjectView): Unreadable | undefined {
  if (!objectPermissionGrants(grantFor(set, obj.name, obj.isPrivate), 'allowRead')) return { cause: 'grant' };
  const missing = missingCapabilities(set, objectReadCapabilities(obj));
  return missing.length > 0 ? { cause: 'capability', missing } : undefined;
}

function fieldUnreadable(set: AnyRec, obj: ObjectView, fieldName: string): Unreadable | undefined {
  if (fieldHidden(set, obj.name, fieldName)) return { cause: 'hidden' };
  const missing = missingCapabilities(set, fieldCapabilities(obj, fieldName));
  return missing.length > 0 ? { cause: 'capability', missing } : undefined;
}

/** `` without capability "a"`` / `` without capabilities "a" and "b"``, or `''`. */
function withoutPhrase(u: Unreadable): string {
  if (u.cause !== 'capability') return '';
  const quoted = u.missing.map((c) => `"${c}"`);
  if (quoted.length === 1) return ` without capability ${quoted[0]}`;
  return ` without capabilities ${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** The read-class row policy the set's reads of `child` meet, if any (see the docblock's "Row scoping"). */
function readScopingPolicy(
  set: AnyRec,
  d: SummaryDescriptor,
): { kind: 'policy' | 'default'; name: string; positions: string[] } | undefined {
  const applicable = recordsOf(set.rowLevelSecurity).filter(
    (p) =>
      p.enabled !== false &&
      (p.object === d.child.name || p.object === '*') &&
      READ_CLASS_RLS_OPERATIONS.has(String(p.operation ?? '')),
  );
  const positionsOf = (p: AnyRec) =>
    Array.isArray(p.positions) ? p.positions.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  const scoping = applicable.find((p) => nonBlank(p.using));
  if (scoping) {
    return { kind: 'policy', name: nonBlank(scoping.name) ? scoping.name : '(unnamed)', positions: positionsOf(scoping) };
  }
  if (applicable.length > 0) return undefined; // a held read-class policy displaces the object's default
  const scope = d.child.def.defaultRowScope;
  if (
    isRec(scope) &&
    scope.enabled !== false &&
    READ_CLASS_RLS_OPERATIONS.has(String(scope.operation ?? '')) &&
    nonBlank(scope.using)
  ) {
    return { kind: 'default', name: nonBlank(scope.name) ? scope.name : '', positions: positionsOf(scope) };
  }
  return undefined;
}

function objectView(obj: AnyRec & { name: string }): ObjectView {
  const fields = new Map<string, AnyRec>();
  for (const f of recordsOf(obj.fields)) {
    if (nonBlank(f.name) && !fields.has(f.name)) fields.set(f.name, f);
  }
  return { name: obj.name, def: obj, isPrivate: isPrivatePosture(obj), fields };
}

/** The top-level child field keys a roll-up's `filter` tests, in authored order, de-duplicated. */
function filterFieldKeys(filter: unknown): string[] {
  const out = new Set<string>();
  if (filter === undefined || filter === null) return [];
  walkFilterFieldKeys(filter, 'filter', ({ field }) => {
    if (nonBlank(field) && !field.includes('.')) out.add(field);
  });
  return [...out];
}

function summaryDescriptors(stack: AnyRec): SummaryDescriptor[] {
  const served = objectsAsServed(stack).objects;
  const byName = new Map<string, ObjectView>();
  for (const o of served) {
    if (nonBlank(o.name) && !byName.has(o.name)) byName.set(o.name, objectView(o as AnyRec & { name: string }));
  }
  const out: SummaryDescriptor[] = [];
  for (const parent of byName.values()) {
    for (const [name, def] of parent.fields) {
      if (def.type !== 'summary') continue;
      const ops = isRec(def.summaryOperations) ? def.summaryOperations : undefined;
      const childName = ops?.object;
      if (!nonBlank(childName)) continue;
      const child = byName.get(childName);
      if (!child) continue; // not this stack's object — not judged
      const fn = String(ops?.function ?? '');
      const childField = fn !== 'count' && nonBlank(ops?.field) ? ops.field : undefined;
      out.push({
        parent,
        field: name,
        child,
        childField,
        filterFields: filterFieldKeys(ops?.filter).filter((f) => f !== childField),
      });
    }
  }
  return out;
}

const ROLLUP_SEMANTICS =
  'a roll-up aggregates the whole child collection and follows only the parent field\'s own permissions';

/**
 * `"invoice.total" summarizes "invoice_line.amount"` / `"invoice.line_count" counts "invoice_line" records`;
 * with `everyRow`, `… over every "invoice_line" row` / `… counts every "invoice_line" row`;
 * with `filteredOn`, `… over rows filtered on "invoice_line.band"` / `… records filtered on "invoice_line.band"`.
 */
function rollupPhrase(d: SummaryDescriptor, opts: { everyRow?: boolean; filteredOn?: string } = {}): string {
  const column = `"${d.parent.name}.${d.field}"`;
  const child = d.child.name;
  const filtered = opts.filteredOn ? ` filtered on "${child}.${opts.filteredOn}"` : '';
  if (d.childField) {
    const rows = opts.everyRow ? ` over every "${child}" row` : opts.filteredOn ? ` over rows${filtered}` : '';
    return `${column} summarizes "${child}.${d.childField}"${rows}`;
  }
  return opts.everyRow ? `${column} counts every "${child}" row` : `${column} counts "${child}" records${filtered}`;
}

/**
 * The remedy, with its reach: in the field merge only DECLARING sets vote, so
 * `readable: false` on this set hides the column from every holder of the set,
 * and only an entry with `readable: true` (or View All / Modify All on the
 * parent) in a co-held set restores it.
 */
function hintFor(set: AnyRec, d: SummaryDescriptor): string {
  const column = `${d.parent.name}.${d.field}`;
  const entry = `fields["${column}"]: { readable: false }`;
  const reach =
    `That hides "${column}" from every holder of the set, and a co-held set with no entry for it does not ` +
    `restore it (View All or Modify All on "${d.parent.name}" does); to keep it for some holders, declare ` +
    `fields["${column}"]: { readable: true } in the sets they hold`;
  if (holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, d.parent.name, 'view')) {
    return (
      `If its value should not be visible to this set, first remove View All and Modify All on ` +
      `"${d.parent.name}" from it, since ${entry} does not hide a field from a set holding either, then set ` +
      `${entry} on it. ${reach}`
    );
  }
  return `If its value should not be visible to this set, set ${entry} on it. ${reach}`;
}

export function validateRollupSourceVisibility(stack: AnyRec): RollupSourceVisibilityFinding[] {
  const findings: RollupSourceVisibilityFinding[] = [];
  if (!isRec(stack)) return findings;
  const summaries = summaryDescriptors(stack);
  if (summaries.length === 0) return findings;

  recordsOf(stack.permissions).forEach((set, i) => {
    const setName = nonBlank(set.name) ? set.name : `(permission set ${i})`;
    for (const d of summaries) {
      // Can the set see the summary column at all? If not, it learns nothing from it.
      if (objectUnreadable(set, d.parent) || fieldUnreadable(set, d.parent, d.field)) continue;

      const column = `${d.parent.name}.${d.field}`;
      const unreadable = (message: string): RollupSourceVisibilityFinding => ({
        severity: 'warning',
        rule: SECURITY_ROLLUP_SOURCE_UNREADABLE,
        where: `permission set "${setName}" · summary field "${column}"`,
        path: `permissions[${i}].fields["${column}"]`,
        message: `${message}; ${ROLLUP_SEMANTICS}`,
        hint: hintFor(set, d),
      });

      const objectGate = objectUnreadable(set, d.child);
      if (objectGate) {
        findings.push(
          unreadable(
            `${rollupPhrase(d)}, and permission set "${setName}" cannot read object "${d.child.name}"` +
              withoutPhrase(objectGate),
          ),
        );
        continue;
      }

      const valueGate = d.childField ? fieldUnreadable(set, d.child, d.childField) : undefined;
      if (valueGate) {
        findings.push(
          unreadable(`${rollupPhrase(d)}, which permission set "${setName}" cannot read${withoutPhrase(valueGate)}`),
        );
        continue;
      }

      let filterFinding: RollupSourceVisibilityFinding | undefined;
      for (const f of d.filterFields) {
        const gate = fieldUnreadable(set, d.child, f);
        if (!gate) continue;
        filterFinding = unreadable(
          `${rollupPhrase(d, { filteredOn: f })}, which permission set "${setName}" cannot read${withoutPhrase(gate)}`,
        );
        break;
      }
      if (filterFinding) {
        findings.push(filterFinding);
        continue;
      }

      // A super-user read skips business row security only where the child's posture permits it.
      if (
        postureSkipsRowSecurityForSuperuser(d.child) &&
        holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, d.child.name, 'view')
      ) {
        continue;
      }
      const scoping = readScopingPolicy(set, d);
      if (!scoping) continue;
      const by =
        scoping.kind === 'policy'
          ? `row-level policy "${scoping.name}"`
          : `the default row scope${scoping.name ? ` "${scoping.name}"` : ''} of object "${d.child.name}"`;
      const forHolders = scoping.positions.length > 0 ? ` (for holders of ${scoping.positions.join(', ')})` : '';
      findings.push({
        severity: 'info',
        rule: SECURITY_ROLLUP_SOURCE_ROW_SCOPED,
        where: `permission set "${setName}" · summary field "${column}"`,
        path: `permissions[${i}].fields["${column}"]`,
        message:
          `${rollupPhrase(d, { everyRow: true })}, while ${by} narrows the rows permission set ` +
          `"${setName}" reads${forHolders}; ${ROLLUP_SEMANTICS}`,
        hint: hintFor(set, d),
      });
    }
  });
  return findings;
}
