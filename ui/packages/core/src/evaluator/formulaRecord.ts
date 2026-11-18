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
 *   `label()` (no option label is read here), or calls `current_user.can()`
 *   (no permission map is bound for a formula); it reads the acting user
 *   (`current_user`, `user`, `ctx`) and the form holds none; it reads `os`
 *   (the server binds `os.org` from the tenant, which the form does not
 *   hold) or any other scope root but `record`; its expression is not served
 *   to this reader at all (a field-level-security mask deletes an expression
 *   naming a field the reader cannot see); or it reads such a formula at any
 *   depth. {@link ObjectFormulaPlan.unservableReadsOf} names them, and the
 *   form treats a `visibleWhen` reading one as SHOWN, as the server counts a
 *   predicate reading one of its own unservable formulas.
 *
 * The acting user is bound as the server binds it (objectql
 * `applyFormulaPlan`): the caller's `id` and `positions` only, through the
 * engine's own `EvalUser` factory, so `current_user.id`,
 * `'x' in current_user.positions` and `current_user.isPlatformAdmin` compute
 * as they do on the server, and a member the server does not bind
 * (`current_user.name`, `current_user.email`) faults to `null` on both sides.
 * The form takes it from its predicate scope (`current_user` there).
 *
 * Every formula the form computes, it computes as the server does. Where the
 * form cannot, the field is shown and keeps its `required` flag. That is
 * stricter than the server in two places: a formula the server computes and
 * the form does not (one reading `os`, or calling `current_user.can()` on a
 * write that resolved a permission map), and a formula reading a root
 * neither side binds (`previous`, `vars`, …), which the server reads as
 * `null`. The server stays the authority on the write.
 */
import {
  ExpressionEngine,
  SCOPE_ROOTS,
  analyzeRelationshipTraversals,
  collectCelRootIdentifiers,
  findTraversalConflicts,
  formulaReadOrder,
  isUnparseableDate,
  parseCelToAst,
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

/**
 * The roots that name the acting user and that the form binds when it holds
 * one: objectql's `USER_SCOPE_ROOTS` minus `os`, whose `os.org` the form
 * cannot bind.
 */
const USER_ROOTS: ReadonlySet<string> = new Set(['current_user', 'user', 'ctx']);

/** Every scope root but `record`: the form binds none of them unless {@link USER_ROOTS} says so. */
const NON_RECORD_ROOTS: ReadonlySet<string> = new Set(
  [...SCOPE_ROOTS, 'current_user'].filter((root) => root !== 'record'),
);

/** The acting user as the server's formula pass binds it (objectql `applyFormulaPlan`). */
type FormulaUser = {
  id: string;
  positions: string[];
};

/**
 * The acting user out of a predicate scope's `current_user`, or `undefined`
 * when it holds none: no `current_user`, or one without an id (the signed-out
 * visitor's `id: null`). Only `id` and `positions` are kept, the two the
 * server binds.
 */
function formulaUserOf(scope: Readonly<Record<string, unknown>> | null | undefined): FormulaUser | undefined {
  const user = scope?.current_user as { id?: unknown; positions?: unknown } | null | undefined;
  if (!user || typeof user !== 'object') return undefined;
  const id = typeof user.id === 'number' ? String(user.id) : user.id;
  if (typeof id !== 'string' || !id) return undefined;
  const positions = Array.isArray(user.positions)
    ? user.positions.filter((p): p is string => typeof p === 'string')
    : [];
  return { id, positions };
}

/** objectql's `readsPermissionPredicate`: a receiver call named `can` anywhere in the AST. */
function callsReceiverMethod(node: unknown, method: string): boolean {
  if (Array.isArray(node)) return node.some((child) => callsReceiverMethod(child, method));
  if (typeof node !== 'object' || node === null) return false;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (typeof op !== 'string') return false;
  if (op === 'rcall' && Array.isArray(args) && args[0] === method) return true;
  return callsReceiverMethod(args, method);
}

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
 * `scope` is the form's predicate scope: its `current_user` is the acting
 * user the formulas are computed for. Without one, a formula reading the
 * acting user is unservable.
 */
export function planObjectFormulas(
  fields: unknown,
  scope?: Readonly<Record<string, unknown>> | null,
): ObjectFormulaPlan | undefined {
  const defs = fieldMap(fields);
  if (!defs) return undefined;
  const formulaNames = Object.keys(defs).filter((name) => defs[name]?.type === 'formula');
  if (formulaNames.length === 0) return undefined;
  const user = formulaUserOf(scope);

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
    if (callsReceiverMethod(parseCelToAst(source), 'can')) {
      unservable.set(name, 'calls current_user.can(), which the form does not answer for a formula');
      continue;
    }
    const roots = collectCelRootIdentifiers(source);
    const unbound = roots.ok
      ? roots.roots.filter((root) => NON_RECORD_ROOTS.has(root) && !(user && USER_ROOTS.has(root)))
      : [];
    if (unbound.length > 0) {
      const names = unbound.map((r) => `'${r}'`).join(', ');
      unservable.set(
        name,
        unbound.every((root) => USER_ROOTS.has(root))
          ? `reads the acting user (${names}), and the form holds none`
          : `reads ${names}, which the form does not bind for a formula`,
      );
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
          const res = ExpressionEngine.evaluate(entry.expression, user ? { now, user, record: copy } : { now, record: copy });
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
