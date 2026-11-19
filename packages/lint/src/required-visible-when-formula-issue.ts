// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0113 D1, as amended] A `required` field whose own `visibleWhen` reads a
 * `formula` field draws a WARNING where it is authored.
 *
 * The server judges the requirement on every write from that predicate, with
 * each formula it reads computed over the record being written, the value a
 * read of that record would serve. Two things the author can see at build time:
 *
 *  - **The server's computed value decides.** The form computes the object's
 *    formulas over the record being edited before it judges the predicate
 *    (ADR-0113, as amended), so for a formula it can compute it judges what
 *    the server judges. A check that computes none, a wizard's final-submit
 *    check or a form whose data source serves no object schema, judges the
 *    formula value last read, none on a create, and can disagree with the
 *    server; the warning is the reminder that the server's value decides.
 *  - **Some formulas the write path cannot compute at all.** A formula that
 *    reads through a reference, calls `label()` or calls `current_user.can()`,
 *    or reads such a formula at any depth: the server cannot know the value a
 *    read serves, counts the predicate as SHOWN, and the field stays required
 *    on every write. The form cannot compute such a formula either: it shows
 *    the field and keeps it required. The engine's
 *    classifier is `unservableReason` in `@objectstack/objectql`
 *    (`engine-top-level.ts`); this reads the same three marks off the same
 *    sources (the member reader for reads and hops, `label(` as the engine's
 *    `planCallsOptionLabel` spells it, a `can` receiver call off the parse).
 *    A `can` call is the one the engine does compute on a write that picks a
 *    permission-gated option (that write resolves the permission map), so the
 *    message says the verdict for such a field can differ between writes.
 *    The engine's fourth mark, a formula that reads the acting user on a
 *    write with none (a system write, logged `no-acting-user`), draws no
 *    warning: such a formula is computed per writer on every write that has
 *    one, and the counts-as-shown fallback there is the strict direction.
 *
 * A warning, never a refusal: the server accepts the field, and a predicate it
 * cannot evaluate keeps exactly the unconditional `required` the field had
 * before the amendment.
 */
import { analyzeRelationshipTraversals, parseCelToAst } from '@objectstack/formula';
import { REFERENCE_VALUE_TYPES } from '@objectstack/spec/data';

type AnyRec = Record<string, unknown>;

/** One finding of the expression rule (an `ExprIssue`). */
export interface RequiredVisibleWhenFormulaIssue {
  where: string;
  message: string;
  source: string;
  severity: 'warning';
}

/** The CEL source of a string shorthand or a `cel` envelope; `undefined` otherwise. */
function celSource(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() ? raw : undefined;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as AnyRec;
    if (typeof rec.dialect === 'string' && rec.dialect !== 'cel') return undefined;
    if (typeof rec.source === 'string' && rec.source.trim()) return rec.source;
  }
  return undefined;
}

/** The fields a source reads as values or through, over `roots`; `null` when the reader cannot say. */
function readsOf(source: string, roots: readonly string[]): { all: Set<string>; through: Set<string> } | null {
  const all = new Set<string>();
  const through = new Set<string>();
  for (const root of roots) {
    const analysis = analyzeRelationshipTraversals(source, root);
    if (!analysis) return null;
    for (const name of analysis.bareFields) all.add(name);
    for (const name of analysis.traversals.keys()) {
      all.add(name);
      through.add(name);
    }
  }
  return { all, through };
}

/** A call of `label(`, spelled as the engine's `planCallsOptionLabel` reads it. */
const LABEL_CALL = /\blabel\s*\(/;

/** Does a cel-js AST hold a receiver call named `method` (`current_user.can(…)`)? */
function callsReceiverMethod(node: unknown, method: string): boolean {
  if (Array.isArray(node)) return node.some((child) => callsReceiverMethod(child, method));
  if (typeof node !== 'object' || node === null) return false;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (typeof op !== 'string') return false;
  if (op === 'rcall' && Array.isArray(args) && args[0] === method) return true;
  return callsReceiverMethod(args, method);
}

function callsCan(source: string): boolean {
  try {
    return callsReceiverMethod(parseCelToAst(source), 'can');
  } catch {
    return false;
  }
}

/**
 * The warning for field `fname` of object `objectName`, or `undefined` when it
 * is not `required`, has no `visibleWhen`, or its `visibleWhen` reads no
 * formula field. `fields` are the object's fields by name, as served.
 */
export function requiredVisibleWhenFormulaIssue(
  objectName: string,
  fname: string,
  def: AnyRec,
  fields: ReadonlyMap<string, AnyRec>,
): RequiredVisibleWhenFormulaIssue | undefined {
  if (def.required !== true) return undefined;
  const source = celSource(def.visibleWhen);
  if (!source) return undefined;
  const isFormula = (name: string) => fields.get(name)?.type === 'formula';
  const predicateReads = readsOf(source, ['record', 'previous']);
  if (!predicateReads) return undefined;
  const formulas = [...predicateReads.all].filter(isFormula).sort();
  if (formulas.length === 0) return undefined;

  // Why the write path cannot compute a formula, walked through the formulas
  // it reads; memoised, and a formula on a cycle is not revisited.
  const verdicts = new Map<string, string | null>();
  const unservable = (name: string): string | null => {
    const known = verdicts.get(name);
    if (known !== undefined) return known;
    verdicts.set(name, null);
    const expr = celSource(fields.get(name)?.expression);
    let why: string | null = null;
    if (expr) {
      const reads = readsOf(expr, ['record']);
      const hops = reads ? [...reads.through].filter((f) => REFERENCE_VALUE_TYPES.has(String(fields.get(f)?.type))) : [];
      if (hops.length > 0) why = `reads through ${hops.map((f) => `'${f}'`).join(', ')}`;
      else if (LABEL_CALL.test(expr)) why = 'calls label()';
      else if (callsCan(expr)) why = 'calls current_user.can()';
      else {
        for (const read of [...(reads?.all ?? [])].filter(isFormula)) {
          const inner = unservable(read);
          if (inner) {
            why = `reads the formula '${read}', which ${inner}`;
            break;
          }
        }
      }
    }
    verdicts.set(name, why);
    return why;
  };
  const blocked = formulas.flatMap((f) => {
    const why = unservable(f);
    return why === null ? [] : [`'${f}' ${why}`];
  });

  const named = formulas.map((f) => `'${f}'`).join(', ');
  let message =
    `Field '${fname}' is \`required\`, and its \`visibleWhen\` reads the formula field ${named}. A reminder: the ` +
    `server judges that requirement on the formula value it computes over the record being written (ADR-0113 D1). ` +
    `The form computes the same formula over the record being edited; a check that does not (a wizard's ` +
    `final-submit check, or a form whose data source serves no object schema) judges the value last read, none ` +
    `on a create, and can disagree with the server.`;
  if (blocked.length > 0) {
    message +=
      ` Worse, ${blocked.join('; ')}, which the write path does not compute: the server counts the field as SHOWN ` +
      `on every write, so it stays required on every record. The form cannot compute it either: it shows the ` +
      `field and keeps it required.`;
    if (blocked.some((b) => b.includes('calls current_user.can()'))) {
      message +=
        ' (A `current_user.can()` call is computed on a write that picks a permission-gated option, which resolves ' +
        'the permission map, so on such a write the formula is judged on its value instead.)';
    }
  }
  return { where: `object '${objectName}' · field '${fname}' visibleWhen`, message, source, severity: 'warning' };
}
