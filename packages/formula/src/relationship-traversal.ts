// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Static analysis of the relationship hops an authored predicate names, so the
 * call site that owns a query engine can preload exactly those related fields
 * into the evaluation context BEFORE evaluation.
 *
 * ## Why analysis, and not a query function
 *
 * `os.lookup(...)` / `os.exists` / `os.count` were the shape of a declaration
 * that was never bound, and they stay removed: a predicate that reaches a row
 * during evaluation makes evaluation impure, and `stdlib.ts`'s purity invariant
 * (every registered function pure once `now` is pinned; `objectstack build`
 * byte-stable) is what keeps build artifacts reproducible. So the data is
 * PINNED BEFORE evaluation instead — the same discipline
 * `EvalContext.permissions` follows for `can()`, and the same one the engine
 * already follows when it resolves a master-detail header and hands it over.
 * This module is only the part that answers WHICH fields to pin; it performs no
 * I/O, holds no schema and reaches nothing.
 *
 * ## What "one hop" means here, mechanically
 *
 * `record.crm_account.type` is two member accesses on the `record` root: the
 * first names a reference-typed FIELD (`crm_account`), the second names a field
 * ON THE RELATED RECORD (`type`). Anything deeper is a second hop and is
 * reported, not silently truncated — truncating it would pin one hop and leave
 * the predicate to fault at `No such key` on the hop nobody loaded, which reads
 * to an author exactly like the bug this capability exists to remove.
 *
 * ## The conflict this module exists to make visible
 *
 * A reference field's stored value is an id. Hydrating it in place — the
 * platform's own `$expand` convention, which `REFERENCE_VALUE_TYPES` documents
 * as "the related record object in expanded form" — is what makes
 * `record.crm_account.type` resolve. But then a BARE `record.crm_account`
 * compares a map against a string, and CEL answers that comparison `false`
 * WITHOUT faulting. In a validation predicate, which expresses the FAILURE
 * condition, a silent `false` is a declared rule that silently stops firing.
 *
 * Measured on the platform's own CEL front end, an expression that both
 * traverses a reference field and uses it bare CANNOT work today: the traversal
 * faults with `No such key` on every row that reaches it. So refusing that
 * shape at authoring time removes nothing an author has working — it replaces a
 * per-row runtime fault with one loud, prescriptive refusal — which is why this
 * is reported as a conflict rather than resolved by a precedence rule.
 */

import { parseCelToAst } from './cel-engine';

/** The default scope root a record-scoped predicate traverses from. */
export const DEFAULT_TRAVERSAL_ROOT = 'record';

/**
 * What an expression asks of one scope root: which fields it reads through
 * (one hop), which it uses as a plain value, and which it reads through more
 * than one hop.
 */
export interface RelationshipTraversalAnalysis {
  /**
   * Field name → the related-record fields the expression names on it.
   * `record.crm_account.type` yields `crm_account -> { 'type' }`.
   */
  readonly traversals: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Fields the expression uses as a VALUE rather than as a traversal receiver —
   * `record.crm_account == 'acc_1'`, and also a method receiver such as
   * `record.name.startsWith('A')`, where the value is what the method reads.
   */
  readonly bareFields: ReadonlySet<string>;
  /**
   * Fields the expression reads through MORE than one hop
   * (`record.a.b.c`). One hop is the declared depth; these are reported so the
   * authoring layer can refuse them instead of pinning a prefix.
   */
  readonly multiHopFields: ReadonlySet<string>;
}

/** `{ op: 'id', args: '<root>' }` — a bare identifier node for `root`. */
function isRootId(node: unknown, root: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const { op, args } = node as { op?: unknown; args?: unknown };
  return op === 'id' && args === root;
}

/**
 * A member access on `node`, whatever spelling it was written in, or `null`.
 *
 * ⭐ All four spellings are recognised on purpose, because they are
 * interchangeable ways to read the same related column and a check that saw
 * only the plain one would be trivially side-stepped. That matters most for the
 * OPTIONAL forms: `has(...)`, `.?` and `[?]` read a missing key as an ordinary
 * `false`/default, so an author reaching for a null-safe spelling would have
 * turned "the acting user may not read this column" into a quiet non-firing
 * rule. The engine decides readability before evaluation precisely so the
 * verdict cannot depend on which operator was written — and this function is
 * what makes the analysis see every operator in the first place.
 *
 *  - `a.b`      → `{ op: '.',   args: [receiver, 'b'] }`
 *  - `a.?b`     → `{ op: '.?',  args: [receiver, 'b'] }`
 *  - `a['b']`   → `{ op: '[]',  args: [receiver, { op: 'value', args: 'b' }] }`
 *  - `a[?'b']`  → `{ op: '[?]', args: [receiver, { op: 'value', args: 'b' }] }`
 *
 * An index whose key is not a literal string (`a[someVar]`) names no field this
 * analysis can resolve, so it is not a member access here.
 */
const MEMBER_OPS = new Set(['.', '.?']);
const INDEX_OPS = new Set(['[]', '[?]']);

function asMember(node: unknown): { receiver: unknown; name: string } | null {
  if (!node || typeof node !== 'object') return null;
  const { op, args } = node as { op?: unknown; args?: unknown };
  if (typeof op !== 'string' || !Array.isArray(args) || args.length < 2) return null;
  if (MEMBER_OPS.has(op)) {
    const name = args[1];
    return typeof name === 'string' ? { receiver: args[0], name } : null;
  }
  if (INDEX_OPS.has(op)) {
    const key = args[1] as { op?: unknown; args?: unknown } | undefined;
    if (key && typeof key === 'object' && key.op === 'value' && typeof key.args === 'string') {
      return { receiver: args[0], name: key.args };
    }
  }
  return null;
}

/**
 * Analyse one authored CEL source for the hops it takes through `root`.
 *
 * Returns `null` when the source does not parse or blows the platform's bounds
 * — the caller already has a channel for that verdict (`compile()` /
 * `validateExpression`) and this function deliberately does not invent a second
 * one. An expression that parses but names no member of `root` yields an empty
 * analysis, which is the common case and costs the caller nothing.
 *
 * Reads the AST through {@link parseCelToAst} rather than a private
 * `new Environment()`, so "what parses" has exactly one answer across build,
 * lint and runtime — and so this analysis can never admit a shape the engine
 * would refuse to evaluate.
 */
export function analyzeRelationshipTraversals(
  source: string,
  root: string = DEFAULT_TRAVERSAL_ROOT,
): RelationshipTraversalAnalysis | null {
  const ast = parseCelToAst(source);
  if (ast == null) return null;

  const traversals = new Map<string, Set<string>>();
  const bareFields = new Set<string>();
  const multiHopFields = new Set<string>();

  // Member-access nodes reached AS THE RECEIVER of another member access are
  // traversals, not values. Collect those first so the value pass can exclude
  // them by identity rather than by re-deriving the shape.
  const traversalReceivers = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const outer = asMember(node);
    if (outer) {
      const inner = asMember(outer.receiver);
      if (inner && isRootId(inner.receiver, root)) {
        // root.<inner.name>.<outer.name> — one hop through `inner.name`.
        traversalReceivers.add(outer.receiver);
        let fields = traversals.get(inner.name);
        if (!fields) traversals.set(inner.name, (fields = new Set()));
        fields.add(outer.name);
      } else if (inner) {
        // Deeper than one hop: root.a.b.c reaches here as (root.a.b).c, whose
        // own receiver is itself a traversal. Attribute it to the FIRST field
        // so the refusal can name what the author wrote.
        const base = asMember(inner.receiver);
        if (base && isRootId(base.receiver, root)) multiHopFields.add(base.name);
      }
    }

    for (const value of Object.values(node as Record<string, unknown>)) walk(value);
  };
  walk(ast);

  // Second pass: every `root.<field>` node that was NOT consumed as a traversal
  // receiver is a value use.
  const walkValues = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walkValues(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const member = asMember(node);
    if (member && isRootId(member.receiver, root) && !traversalReceivers.has(node)) {
      bareFields.add(member.name);
    }
    for (const value of Object.values(node as Record<string, unknown>)) walkValues(value);
  };
  walkValues(ast);

  return { traversals, bareFields, multiHopFields };
}

/** Why a traversal the expression names cannot be served as written. */
export type TraversalConflictKind =
  /**
   * The same reference field is both traversed and used as a value. Hydrating
   * it serves the traversal and silently changes the value comparison, so the
   * expression is refused rather than served half-right.
   */
  | 'bare-and-traversed'
  /** Read through more than one hop; one hop is the declared depth. */
  | 'multi-hop';

/** One refusal-worthy finding about one field. */
export interface TraversalConflict {
  readonly field: string;
  readonly kind: TraversalConflictKind;
  /** Author-facing sentence: what is wrong and what to write instead. */
  readonly message: string;
}

/**
 * The conflicts in an analysis, judged against the caller's knowledge of which
 * fields are reference-typed.
 *
 * `isReferenceField` is a predicate rather than a field table because the two
 * callers hold that knowledge in different shapes — the authoring layer has
 * `fieldTypes`, the engine has the object registry — and neither should have to
 * build the other's structure to ask this question. A field the predicate does
 * not recognise as a reference is left entirely alone: `record.address.city` on
 * an object-valued field traverses today and must keep traversing.
 */
export function findTraversalConflicts(
  analysis: RelationshipTraversalAnalysis,
  isReferenceField: (field: string) => boolean,
  root: string = DEFAULT_TRAVERSAL_ROOT,
): TraversalConflict[] {
  const conflicts: TraversalConflict[] = [];

  for (const field of analysis.traversals.keys()) {
    if (!isReferenceField(field)) continue;
    if (!analysis.bareFields.has(field)) continue;
    conflicts.push({
      field,
      kind: 'bare-and-traversed',
      message:
        `\`${root}.${field}\` is read BOTH through the relationship `
        + `(\`${root}.${field}.<related field>\`) and as a plain value `
        + `(\`${root}.${field}\`) in the same expression. Reading through the `
        + `relationship resolves \`${root}.${field}\` to the related RECORD, so the `
        + `plain-value comparison would stop matching the stored id — silently. `
        + `Compare the id explicitly: write \`${root}.${field}.id\` for the value `
        + `comparison, and keep \`${root}.${field}.<related field>\` for the traversal.`,
    });
  }

  for (const field of analysis.multiHopFields) {
    if (!isReferenceField(field)) continue;
    conflicts.push({
      field,
      kind: 'multi-hop',
      message:
        `\`${root}.${field}\` is read through more than one relationship hop. `
        + `Predicates resolve ONE hop (\`${root}.${field}.<related field>\`); a `
        + `second hop is not loaded, so the expression would fault at evaluation `
        + `time and reject the write. Denormalise the value you need onto `
        + `\`${field}\`'s object, or read it in a hook instead.`,
    });
  }

  return conflicts;
}
