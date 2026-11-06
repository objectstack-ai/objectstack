// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A roll-up summary field a permission set can read, over child data the same
 * set cannot read.
 *
 * | Rule                                         | Severity | Arm                                   |
 * |----------------------------------------------|----------|---------------------------------------|
 * | security-rollup-source-unreadable            | warning  | the set hides the aggregated child field (`readable: false`), or grants no read on the child object |
 * | security-rollup-source-row-scoped            | info     | the set reads the child, but a row-level policy narrows WHICH child rows it reads |
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
 * { readable: false }` on the set — which is what the hint names.
 *
 * ## What is judged, per (permission set × summary field)
 *
 * Judged only when the set can read the summary column at all:
 *
 *  1. it grants read on the parent object — its own entry for the object,
 *     otherwise its `'*'` entry ({@link grantFor}); and
 *  2. its own field entry does not hide the column (`readable: false`), or its
 *     super-user bypass on the parent makes that mask inert. A set with NO
 *     entry for the column passes through as readable, which is what the field
 *     merge does with an absent key.
 *
 * Then, over the child object `summaryOperations.object` names:
 *
 *  - a set holding View All / Modify All on the child reads every row and
 *    every field of it — nothing to report;
 *  - no read grant on the child ⇒ `security-rollup-source-unreadable`;
 *  - `readable: false` on `summaryOperations.field` ⇒ the same id. A `count`
 *    reads no value, so its `field` is never judged (R13's reading);
 *  - otherwise, a row-level policy that scopes the set's reads of the child ⇒
 *    `security-rollup-source-row-scoped` (see below).
 *
 * One finding per pair: an unreadable object subsumes its fields and its rows.
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
 * what their union grants — so a finding describes what the set itself grants.
 *
 * Pure `(stack) => Finding[]`, registered `input: 'parsed'`; every key it
 * reads is one the spec declares, so the normalized stack `os lint` hands it
 * answers the same.
 */

import { objectPermissionGrants, type EffectiveObjectPermission } from '@objectstack/spec/security';
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

/** The RLS operations a read is matched against (`RLSCompiler.getApplicablePolicies`). */
const READ_CLASS_RLS_OPERATIONS: ReadonlySet<string> = new Set(['select', 'all']);

/** One `summary` field whose child object this stack defines. */
interface SummaryDescriptor {
  parent: string;
  parentPrivate: boolean;
  field: string;
  child: string;
  childObject: AnyRec;
  childPrivate: boolean;
  /** The aggregated child field; absent on a `count`, which reads no value. */
  childField?: string;
}

/** `access.default: 'private'` — the posture the `'*'` wildcard does not cover (ADR-0066 D2). */
function isPrivatePosture(obj: AnyRec): boolean {
  const access = obj.access;
  return isRec(access) && access.default === 'private';
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

/** The read-class row policy the set's reads of `child` meet, if any (see the docblock's "Row scoping"). */
function readScopingPolicy(
  set: AnyRec,
  d: SummaryDescriptor,
): { kind: 'policy' | 'default'; name: string; positions: string[] } | undefined {
  const applicable = recordsOf(set.rowLevelSecurity).filter(
    (p) =>
      p.enabled !== false &&
      (p.object === d.child || p.object === '*') &&
      READ_CLASS_RLS_OPERATIONS.has(String(p.operation ?? '')),
  );
  const positionsOf = (p: AnyRec) =>
    Array.isArray(p.positions) ? p.positions.filter((x): x is string => typeof x === 'string' && x !== '') : [];
  const scoping = applicable.find((p) => nonBlank(p.using));
  if (scoping) {
    return { kind: 'policy', name: nonBlank(scoping.name) ? scoping.name : '(unnamed)', positions: positionsOf(scoping) };
  }
  if (applicable.length > 0) return undefined; // a held read-class policy displaces the object's default
  const scope = d.childObject.defaultRowScope;
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

function summaryDescriptors(stack: AnyRec): SummaryDescriptor[] {
  const served = objectsAsServed(stack).objects;
  const byName = new Map<string, AnyRec>();
  for (const o of served) {
    if (nonBlank(o.name) && !byName.has(o.name)) byName.set(o.name, o);
  }
  const out: SummaryDescriptor[] = [];
  for (const obj of served) {
    if (!nonBlank(obj.name)) continue;
    for (const { name, ...def } of recordsOf(obj.fields)) {
      if (def.type !== 'summary' || !nonBlank(name)) continue;
      const ops = isRec(def.summaryOperations) ? def.summaryOperations : undefined;
      const child = ops?.object;
      if (!nonBlank(child)) continue;
      const childObject = byName.get(child);
      if (!childObject) continue; // not this stack's object — not judged
      const fn = String(ops?.function ?? '');
      out.push({
        parent: obj.name,
        parentPrivate: isPrivatePosture(obj),
        field: name,
        child,
        childObject,
        childPrivate: isPrivatePosture(childObject),
        childField: fn !== 'count' && nonBlank(ops?.field) ? ops.field : undefined,
      });
    }
  }
  return out;
}

const ROLLUP_SEMANTICS =
  'a roll-up aggregates the whole child collection and follows only the parent field\'s own permissions';

/**
 * `"invoice.total" summarizes "invoice_line.amount"` / `"invoice.line_count" counts "invoice_line" records`;
 * with `everyRow`, `… over every "invoice_line" row` / `… counts every "invoice_line" row`.
 */
function rollupPhrase(d: SummaryDescriptor, everyRow = false): string {
  const column = `"${d.parent}.${d.field}"`;
  if (d.childField) {
    return `${column} summarizes "${d.child}.${d.childField}"` + (everyRow ? ` over every "${d.child}" row` : '');
  }
  return everyRow ? `${column} counts every "${d.child}" row` : `${column} counts "${d.child}" records`;
}

function hintFor(set: AnyRec, d: SummaryDescriptor): string {
  const column = `${d.parent}.${d.field}`;
  if (holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, d.parent, 'view')) {
    return (
      `"${column}" cannot be hidden from this set while it holds View All or Modify All on "${d.parent}"; ` +
      `remove that bit and set fields["${column}"]: { readable: false } if its value should not be visible`
    );
  }
  return `Hide "${column}" for this set with fields["${column}"]: { readable: false } if its value should not be visible`;
}

export function validateRollupSourceVisibility(stack: AnyRec): RollupSourceVisibilityFinding[] {
  const findings: RollupSourceVisibilityFinding[] = [];
  if (!isRec(stack)) return findings;
  const summaries = summaryDescriptors(stack);
  if (summaries.length === 0) return findings;

  recordsOf(stack.permissions).forEach((set, i) => {
    const setName = nonBlank(set.name) ? set.name : `(permission set ${i})`;
    for (const d of summaries) {
      // Can the set read the summary column at all?
      if (!objectPermissionGrants(grantFor(set, d.parent, d.parentPrivate), 'allowRead')) continue;
      if (fieldHidden(set, d.parent, d.field)) continue;

      // A super-user bypass on the child reads every row and every field of it.
      if (holdsSuperuserBypass(set as { objects?: Record<string, unknown> }, d.child, 'view')) continue;

      const column = `${d.parent}.${d.field}`;
      const where = `permission set "${setName}" · summary field "${column}"`;
      const path = `permissions[${i}].fields["${column}"]`;
      const hint = hintFor(set, d);

      if (!objectPermissionGrants(grantFor(set, d.child, d.childPrivate), 'allowRead')) {
        findings.push({
          severity: 'warning',
          rule: SECURITY_ROLLUP_SOURCE_UNREADABLE,
          where,
          path,
          message:
            `${rollupPhrase(d)}, and permission set "${setName}" cannot read object "${d.child}"; ` +
            ROLLUP_SEMANTICS,
          hint,
        });
        continue;
      }

      if (d.childField && fieldHidden(set, d.child, d.childField)) {
        findings.push({
          severity: 'warning',
          rule: SECURITY_ROLLUP_SOURCE_UNREADABLE,
          where,
          path,
          message: `${rollupPhrase(d)}, which permission set "${setName}" cannot read; ${ROLLUP_SEMANTICS}`,
          hint,
        });
        continue;
      }

      const scoping = readScopingPolicy(set, d);
      if (!scoping) continue;
      const by =
        scoping.kind === 'policy'
          ? `row-level policy "${scoping.name}"`
          : `the default row scope${scoping.name ? ` "${scoping.name}"` : ''} of object "${d.child}"`;
      const forHolders = scoping.positions.length > 0 ? ` (for holders of ${scoping.positions.join(', ')})` : '';
      findings.push({
        severity: 'info',
        rule: SECURITY_ROLLUP_SOURCE_ROW_SCOPED,
        where,
        path,
        message:
          `${rollupPhrase(d, true)}, while ${by} narrows the rows permission set ` +
          `"${setName}" reads${forHolders}; ${ROLLUP_SEMANTICS}`,
        hint,
      });
    }
  });
  return findings;
}
