/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The object's `formula` fields computed over the record a form is editing,
 * so a field rule that reads one is judged on the value it would have once the
 * record is written — not on the value last read (an edit), nor on nothing (a
 * create).
 *
 * A `formula` is never on the write path: it is computed on read and has no
 * column. The server judges a required field's `visibleWhen` that reads one on
 * the value a read of the written record would serve (objectql's
 * `formulaValuesFor`, ADR-0113 D1 as amended). A form that kept judging the
 * value it last read hid a required field the server then required, and the
 * user could not save. This module is the form's half of that judgement, over
 * the SAME canonical engine (`@objectstack/formula`'s `ExpressionEngine`,
 * ui ADR-0036) and the same read order (`formulaReadOrder`).
 *
 * Two kinds of formula that does not compute, answered as the server answers
 * them:
 *
 * - **A fault a read shares** — an operator over an empty operand, an
 *   undeclared key, a cycle, a traversal no read can serve: the formula reads
 *   `null`, and a predicate over it is judged on that `null`.
 * - **Unservable** — the form cannot know the value a read would serve: the
 *   formula reads through a reference (no related record is read here), calls
 *   `label()` (no option label is read here), or reads a scope root other than
 *   `record` (the form binds no user, organization or `previous` for a
 *   formula, so `current_user.can()` lands here too); its expression is not
 *   served to this reader at all (a field-level-security mask deletes an
 *   expression naming a field the reader cannot see); or it reads such a
 *   formula at any depth. {@link ObjectFormulaPlan.unservableReadsOf} names
 *   them, and the form treats a `visibleWhen` reading one as SHOWN — the
 *   server counts the same predicate as shown.
 *
 * The client set of unservable formulas is the server's plus the roots it
 * cannot bind: a formula the server can compute and this form cannot is shown,
 * never hidden, so the form is never stricter than the server (ADR-0124).
 */
import {
  ExpressionEngine,
  SCOPE_ROOTS,
  analyzeRelationshipTraversals,
  collectCelRootIdentifiers,
  findTraversalConflicts,
  formulaReadOrder,
  isUnparseableDate,
} from '@objectstack/formula';
import type { Expression } from '@objectstack/spec';
import { referenceTargetOf } from '@objectstack/spec/data';

import type { FieldRulePredicate } from './fieldRules.js';

/** What the plan reads off one served object field. */
interface ServedFieldDef {
  type?: unknown;
  expression?: unknown;
  scale?: unknown;
}

interface PlanEntry {
  name: string;
  expression: Expression;
  /** The `record.<field>` names it reads, or `null` when the member reader cannot say. */
  reads: ReadonlySet<string> | null;
  scale?: number;
  /** A fault a read shares, decided before evaluation: it reads `null`. */
  nullReason?: string;
}

/** The object's formulas, planned once per served object. */
export interface ObjectFormulaPlan {
  /** Every formula field the object serves, in the order they are computed. */
  readonly order: readonly string[];
  /** Formula field → why the form cannot compute the value a read would serve. */
  readonly unservable: ReadonlyMap<string, string>;
  /**
   * A copy of `record` with every computable formula written onto it, each
   * after the formulas it reads. An unservable formula keeps whatever value
   * `record` holds for it. `record` itself is never mutated.
   */
  compute(record: Record<string, unknown>): Record<string, unknown>;
  /**
   * The unservable formulas `pred` reads — through `record` or `previous` —
   * each with its reason, in read order. Empty when it reads none. A predicate
   * whose reads cannot be named counts as reading every formula, as the
   * server's `formulaReadsOf` counts it.
   */
  unservableReadsOf(pred: FieldRulePredicate | null | undefined): Array<[name: string, reason: string]>;
}

/**
 * `toFixed`'s domain limit, as the read path's rounding bounds it
 * (objectql `formulaRoundingScale`): past it the call throws.
 */
const MAX_FORMULA_SCALE = 100;

function roundingScale(def: ServedFieldDef): number | undefined {
  const scale = def.scale;
  if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 0) return undefined;
  return scale <= MAX_FORMULA_SCALE ? scale : undefined;
}

/** The read path's rounding (objectql `roundFormulaValue`): numbers only, no `-0`. */
function roundValue(value: unknown, scale: number | undefined): unknown {
  if (scale === undefined || typeof value !== 'number' || !Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(scale));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** objectql's `planCallsOptionLabel` test, on one source. */
const LABEL_CALL = /\blabel\s*\(/;

/** Scope roots a formula may name that the form does not bind for it. */
const UNBOUND_ROOTS: ReadonlySet<string> = new Set(
  [...SCOPE_ROOTS, 'current_user'].filter((root) => root !== 'record'),
);

function toExpression(value: unknown): Expression | undefined {
  if (typeof value === 'string') return value.trim() ? { dialect: 'cel', source: value } : undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { dialect, source } = value as { dialect?: unknown; source?: unknown };
    if (typeof source !== 'string' || !source.trim()) return undefined;
    return { dialect: (typeof dialect === 'string' ? dialect : 'cel') as Expression['dialect'], source };
  }
  return undefined;
}

function celSource(expr: Expression): string | undefined {
  if (expr.dialect !== undefined && expr.dialect !== 'cel') return undefined;
  return typeof expr.source === 'string' ? expr.source : undefined;
}

/** The served object's fields as a name → definition map (a list is keyed by `name`). */
function fieldMap(fields: unknown): Record<string, ServedFieldDef> | undefined {
  if (Array.isArray(fields)) {
    const out: Record<string, ServedFieldDef> = {};
    for (const def of fields) {
      const name = (def as { name?: unknown } | null)?.name;
      if (typeof name === 'string' && name) out[name] = def as ServedFieldDef;
    }
    return out;
  }
  if (fields && typeof fields === 'object') return fields as Record<string, ServedFieldDef>;
  return undefined;
}

function isReferenceField(def: ServedFieldDef | undefined): boolean {
  try {
    return !!referenceTargetOf(def);
  } catch {
    // An unreadable `reference` carrier: the read path cannot plan it either.
    return false;
  }
}

/**
 * Plan the object's formula fields for {@link ObjectFormulaPlan.compute}, or
 * `undefined` when the served object declares none. `fields` is the served
 * object's `fields` (a map, or a list of definitions carrying `name`).
 */
export function planObjectFormulas(fields: unknown): ObjectFormulaPlan | undefined {
  const defs = fieldMap(fields);
  if (!defs) return undefined;
  const formulaNames = Object.keys(defs).filter((name) => defs[name]?.type === 'formula');
  if (formulaNames.length === 0) return undefined;

  const unservable = new Map<string, string>();
  const entries = new Map<string, PlanEntry>();
  for (const name of formulaNames) {
    const def = defs[name];
    const expression = toExpression(def.expression);
    if (!expression) {
      unservable.set(name, 'has no expression served to this reader');
      continue;
    }
    const entry: PlanEntry = { name, expression, reads: null, scale: roundingScale(def) };
    entries.set(name, entry);
    const source = celSource(expression);
    if (source === undefined) continue;
    const analysis = analyzeRelationshipTraversals(source);
    // Does not parse: it evaluates to a fault, and so to `null`.
    if (!analysis) continue;
    entry.reads = new Set([...analysis.bareFields, ...analysis.traversals.keys()]);
    const conflicts = findTraversalConflicts(analysis, (field) => isReferenceField(defs[field]), 'record', 'formula');
    if (conflicts.length > 0) {
      entry.nullReason = conflicts.map((c) => c.message).join(' ');
      continue;
    }
    const hops = [...analysis.traversals.keys()].filter((field) => isReferenceField(defs[field]));
    if (hops.length > 0) {
      unservable.set(name, `reads through ${hops.map((f) => `'${f}'`).join(', ')}, a reference the form does not follow`);
      continue;
    }
    if (LABEL_CALL.test(source)) {
      unservable.set(name, 'calls label(), which the form does not answer');
      continue;
    }
    const roots = collectCelRootIdentifiers(source);
    const unbound = roots.ok ? roots.roots.filter((root) => UNBOUND_ROOTS.has(root)) : [];
    if (unbound.length > 0) {
      unservable.set(name, `reads ${unbound.map((r) => `'${r}'`).join(', ')}, which the form does not bind for a formula`);
    }
  }

  // The read order: each formula after the formulas it reads (objectql's
  // `orderFormulaPlan`), and the formulas on a cycle, which read `null`.
  const formulaReads = new Map<string, string[]>();
  for (const entry of entries.values()) {
    formulaReads.set(entry.name, [...(entry.reads ?? [])].filter((name) => entries.has(name)));
  }
  let order = [...entries.keys()];
  if ([...formulaReads.values()].some((reads) => reads.length > 0)) {
    const ordered = formulaReadOrder(formulaReads);
    order = ordered.order;
    for (const [name, message] of ordered.cycles) entries.get(name)!.nullReason = message;
  }

  // In read order, so a formula's reads are judged before it (objectql's
  // `unservableReason`): reading an unservable formula is unservable too, and
  // a formula whose reads cannot be named counts as reading every one.
  for (const name of order) {
    if (unservable.has(name) || unservable.size === 0) continue;
    const reads = entries.get(name)!.reads;
    const via = reads === null ? [...unservable.keys()][0] : [...reads].find((read) => unservable.has(read));
    if (via !== undefined) unservable.set(name, `reads the formula '${via}', which ${unservable.get(via)}`);
  }

  const computed = order.map((name) => entries.get(name)!).filter((entry) => !unservable.has(entry.name));
  const allOrder = [...order, ...formulaNames.filter((name) => !entries.has(name))];

  return {
    order: allOrder,
    unservable,
    compute(record) {
      const copy: Record<string, unknown> = { ...record };
      if (computed.length === 0) return copy;
      const now = new Date();
      for (const entry of computed) {
        if (entry.nullReason !== undefined) {
          copy[entry.name] = null;
          continue;
        }
        let value: unknown = null;
        try {
          const res = ExpressionEngine.evaluate(entry.expression, { now, record: copy });
          if (res.ok && !isUnparseableDate(res.value)) value = roundValue(res.value, entry.scale);
        } catch {
          value = null;
        }
        copy[entry.name] = value;
      }
      return copy;
    },
    unservableReadsOf(pred) {
      if (pred == null || unservable.size === 0) return [];
      const expr = toExpression(pred);
      const source = expr ? celSource(expr) : undefined;
      let reads: Set<string> | null = null;
      if (source !== undefined) {
        reads = new Set<string>();
        for (const root of ['record', 'previous']) {
          const analysis = analyzeRelationshipTraversals(source, root);
          if (!analysis) {
            reads = null;
            break;
          }
          for (const name of analysis.bareFields) reads.add(name);
          for (const name of analysis.traversals.keys()) reads.add(name);
        }
      }
      return allOrder
        .filter((name) => unservable.has(name) && (reads === null || reads.has(name)))
        .map((name) => [name, unservable.get(name)!] as [string, string]);
    },
  };
}
