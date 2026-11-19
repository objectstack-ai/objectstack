// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0113 D1, as amended] A `required` field whose own `visibleWhen` reads a
 * `formula` field THE FORM CANNOT COMPUTE draws a WARNING where it is
 * authored.
 *
 * The server judges the requirement on every write from that predicate, with
 * each formula it reads computed over the record being written, the value a
 * read of that record would serve. The form computes the object's formulas
 * over the record being edited before it judges the predicate (`@object-ui/core`
 * `planObjectFormulas`), so for a formula it can compute the form and the
 * server judge the same value, and nothing is warned. They still part on a
 * formula the form cannot compute, and that is the one arm warned:
 *
 *  - **The write path cannot compute it either.** A formula that reads through
 *    a reference, calls `label()` or calls `current_user.can()`, or reads such
 *    a formula at any depth: the server cannot know the value a read serves,
 *    counts the predicate as SHOWN, and the field stays required on every
 *    write, so the condition never waives it. The engine's classifier is
 *    `unservableReason` in `@objectstack/objectql` (`engine-top-level.ts`);
 *    this reads the same three marks off the same sources (the member reader
 *    for reads and hops, `label(` as the engine's `planCallsOptionLabel`
 *    spells it, a `can` receiver call off the parse). A `can` call is the one
 *    the engine does compute on a write that picks a permission-gated option
 *    (that write resolves the permission map), so the message says the
 *    verdict for such a field can differ between writes.
 *  - **Only the form cannot compute it.** A formula that reads `os`, or reads
 *    such a formula: the server binds `os` from the acting user and the
 *    tenant and computes it, so it can waive the field on a record where the
 *    form, which binds no `os` for a formula, still shows it and keeps it
 *    required. The
 *    form's classifier is `planObjectFormulas` in `@object-ui/core`
 *    (`formulaRecord.ts`); `os` is read as it reads it, any bare `os` root.
 *
 * Either way a form that computes the object's formulas shows the field and
 * keeps it required; a check that holds no formula plan judges the formula
 * value last read instead, so it can hide the field or not demand it.
 *
 * Two more formulas the form cannot compute draw nothing. One that reads the
 * acting user is uncomputable only where nobody is signed in, and the
 * engine's fourth mark answers that write the same way (no acting user, logged
 * `no-acting-user`, counted as SHOWN); on every write that has a user both
 * compute it. And one served without its expression (a field-level-security
 * mask) is a per-reader fact the stack does not hold.
 *
 * A warning, never a refusal: the server accepts the field, and a predicate it
 * cannot evaluate keeps exactly the unconditional `required` the field had
 * before the amendment.
 */
import { analyzeRelationshipTraversals, collectCelRootIdentifiers, parseCelToAst } from '@objectstack/formula';
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

/** Does a source read the `os` root, which the form does not bind for a formula? */
function readsOs(source: string): boolean {
  const roots = collectCelRootIdentifiers(source);
  return roots.ok && roots.roots.includes('os');
}

/** Why the form cannot compute one formula, and whether the write path cannot either. */
interface Unservable {
  why: string;
  /** The write path cannot compute it either, so the server counts the predicate as SHOWN. */
  writePath: boolean;
}

/**
 * The warning for field `fname` of object `objectName`, or `undefined` when it
 * is not `required`, has no `visibleWhen`, or its `visibleWhen` reads no
 * formula field the form cannot compute. `fields` are the object's fields by
 * name, as served.
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

  // Why the form cannot compute a formula, walked through the formulas it
  // reads; memoised, and a formula on a cycle is not revisited. A mark the
  // write path shares outranks `os`, at any depth, as the engine judges it.
  const verdicts = new Map<string, Unservable | null>();
  const unservable = (name: string): Unservable | null => {
    const known = verdicts.get(name);
    if (known !== undefined) return known;
    verdicts.set(name, null);
    const expr = celSource(fields.get(name)?.expression);
    let verdict: Unservable | null = null;
    if (expr) {
      const reads = readsOf(expr, ['record']);
      const hops = reads ? [...reads.through].filter((f) => REFERENCE_VALUE_TYPES.has(String(fields.get(f)?.type))) : [];
      if (hops.length > 0) verdict = { why: `reads through ${hops.map((f) => `'${f}'`).join(', ')}`, writePath: true };
      else if (LABEL_CALL.test(expr)) verdict = { why: 'calls label()', writePath: true };
      else if (callsCan(expr)) verdict = { why: 'calls current_user.can()', writePath: true };
      else {
        const inner = [...(reads?.all ?? [])].filter(isFormula).flatMap((read) => {
          const v = unservable(read);
          return v ? [{ read, ...v }] : [];
        });
        const through = (via: (typeof inner)[number]): Unservable => ({
          why: `reads the formula '${via.read}', which ${via.why}`,
          writePath: via.writePath,
        });
        const blind = inner.find((v) => v.writePath);
        if (blind) verdict = through(blind);
        else if (readsOs(expr)) verdict = { why: 'reads `os`', writePath: false };
        else if (inner.length > 0) verdict = through(inner[0]);
      }
    }
    verdicts.set(name, verdict);
    return verdict;
  };
  const blocked = formulas.flatMap((f) => {
    const v = unservable(f);
    return v === null ? [] : [{ formula: f, ...v }];
  });
  // Every formula it reads the form computes as the server does: they agree.
  if (blocked.length === 0) return undefined;

  const writePath = blocked.filter((b) => b.writePath);
  const formOnly = blocked.filter((b) => !b.writePath);
  const list = (bs: typeof blocked) => bs.map((b) => `'${b.formula}' ${b.why}`).join('; ');
  let message =
    `Field '${fname}' is \`required\`, and its \`visibleWhen\` reads ` +
    `${blocked.length === 1 ? 'a formula field' : 'formula fields'} the form cannot compute ` +
    `over the record being edited (ADR-0113 D1).`;
  if (writePath.length > 0) {
    message +=
      ` ${list(writePath)}, which the write path does not compute either: the server counts the field as ` +
      `SHOWN on every write, so it stays required on every record and the condition never waives it.`;
    if (writePath.some((b) => b.why.includes('calls current_user.can()'))) {
      message +=
        ' (A `current_user.can()` call is computed on a write that picks a permission-gated option, which resolves ' +
        'the permission map, so on such a write the formula is judged on its value instead.)';
    }
  }
  if (formOnly.length > 0 && writePath.length > 0) {
    // The write path's mark decides the server's verdict: the predicate faults, so it is shown.
    message += ` ${list(formOnly)}: the form cannot compute that either.`;
  } else if (formOnly.length > 0) {
    message +=
      ` ${list(formOnly)}, which the server computes (it binds \`os\` from the acting user and the tenant): it judges the ` +
      `requirement on that value and can waive the field on a record where the form still demands it.`;
  }
  message +=
    ` A form that computes the object's formulas shows the field and keeps it required; a check that holds no ` +
    `formula plan (a form whose data source serves no object schema, for one) judges the formula value last ` +
    `read, none on a create, and can hide the field or not demand it.`;
  return { where: `object '${objectName}' · field '${fname}' visibleWhen`, message, source, severity: 'warning' };
}
