// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The right-hand-of-`==` POSITION, shared by every rule that judges it**
 * (#7696).
 *
 * On a metadata-editing form the console's evaluator
 * (`packages/app-shell/src/views/metadata-admin/predicate.ts`, objectui#4049)
 * resolves the LEFT side of `==` / `!=` through `resolveValue` and hands the
 * RIGHT side to `parseLiteral`. So the right-hand slot is a LITERAL slot: a
 * token sitting there is never resolved as a reference, whatever it is spelled
 * like. That single fact is read by three rules across two files, and #7696 was
 * filed because they read it differently and prescribed opposite fixes for one
 * token:
 *
 *  - `visibility-bare-identifier` (`validate-visibility-predicates.ts`, #6128)
 *    read a bare `active` as a dropped binding root and said, at `error`, write
 *    `<root>.active`.
 *  - `predicate-path-unrooted` (`validate-predicate-path-refs.ts`, #7010) said
 *    the same thing at `error` whenever the word also happens to be a schema
 *    key.
 *  - `predicate-rhs-path-shaped` (`validate-predicate-path-refs.ts`, #7659) read
 *    it as a literal missing its quotes and said, at `warning`, write
 *    `'active'`.
 *
 * The first two prescribe a spelling this gate itself REFUSES: `data.type ==
 * data.active` is a dotted chain on the right, which is `predicate-rhs-path-
 * shaped`'s `error` arm. An author who complies with the loud finding lands on
 * a louder one. That is the walk #7696 is about, and it is why the rooted
 * prescription is not "a different opinion" here — on this surface it is not a
 * spelling at all.
 *
 * {@link bareRhsOnlyIdentifiers} is the mechanism that stands the two
 * root-prescribing rules down for exactly this position, leaving
 * `predicate-rhs-path-shaped` as the single voice. It answers a narrow
 * question: which identifiers occur ONLY as the bare right operand of a
 * `==` / `!=`?
 *
 * ## Why "only", and why the set is deliberately small
 *
 * `status == active` must still be REFUSED — `status` is a genuine dropped root
 * on the left, and the fact that `active` is a literal says nothing about it.
 * So the suppression is per-identifier and per-occurrence: a name that appears
 * anywhere other than a bare right operand (`active == data.x`,
 * `data.a == active && active`) keeps its finding. The two callers add this set
 * to the names they treat as resolvable, which is the same conservative
 * direction `namespaceRoots` already takes in the sibling file — every name it
 * adds can only remove a finding, never create one.
 *
 * ## Where it deliberately stands nothing down
 *
 * Suppression is only safe where the replacement finding actually fires, so the
 * walk refuses to suppress anywhere `predicate-rhs-path-shaped` does not reach:
 *
 *  - **Inside a comprehension-macro body.** `equalitySites` in
 *    `validate-predicate-path-refs.ts` skips macro bodies (the interim
 *    evaluator supports no macros at all, so a comparison in there is not a
 *    statement about this subset), so an `==` in there produces no replacement.
 *    This walk descends into the body with suppression turned OFF, which files
 *    every identifier it finds there as "occurs elsewhere".
 *  - **A dotted chain on the right.** `data.a == data.b` is already the `error`
 *    arm and needs no reconciliation; only a BARE `id` node is collected.
 *  - **A surface the metadata-admin evaluator does not render.** That is the
 *    caller's condition, not this walk's — {@link schemaIdOf} is the test, and
 *    a runtime `*.view.ts` predicate (real CEL, where a path on the right is
 *    perfectly legal) never reaches it.
 */

type AnyRec = Record<string, unknown>;
type AstNode = { op?: string; args?: unknown };

function isNode(v: unknown): v is AstNode {
  return !!v && typeof v === 'object' && typeof (v as AstNode).op === 'string';
}

/** The comparison operators whose right side the metadata-admin evaluator parses as a literal. */
export const EQUALITY_OPS = new Set(['==', '!=']);

/**
 * CEL comprehension macros: the receiver-call forms that BIND their first
 * argument as a loop variable.
 */
export const COMPREHENSION_MACROS = new Set(['all', 'exists', 'exists_one', 'map', 'filter']);

/** The bare identifier name a node spells, or `null` when it is anything else. */
function bareId(node: unknown): string | null {
  if (!isNode(node)) return null;
  return node.op === 'id' && typeof node.args === 'string' ? node.args : null;
}

/**
 * Identifiers that occur ONLY as the bare right operand of a `==` / `!=`.
 *
 * `suppressible` is threaded rather than checked at the top because the answer
 * changes with DEPTH: inside a comprehension-macro body no equality produces a
 * `predicate-rhs-path-shaped` finding, so an identifier found there must count
 * as an ordinary occurrence even though it sits in a right-hand slot.
 */
export function bareRhsOnlyIdentifiers(ast: unknown): Set<string> {
  const rhs = new Set<string>();
  const elsewhere = new Set<string>();

  const walk = (node: unknown, suppressible: boolean): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child, suppressible);
      return;
    }
    if (!isNode(node)) return;
    const args = node.args;

    // A comprehension binds a loop variable and its body is out of the
    // replacement rule's reach — descend with suppression off. The RECEIVER is
    // an ordinary sub-expression and keeps the caller's mode.
    if (
      node.op === 'rcall' && Array.isArray(args) && typeof args[0] === 'string'
      && COMPREHENSION_MACROS.has(args[0])
    ) {
      walk(args[1], suppressible);
      walk(args[2], false);
      return;
    }

    if (
      typeof node.op === 'string' && EQUALITY_OPS.has(node.op)
      && Array.isArray(args) && args.length === 2
    ) {
      const right = suppressible ? bareId(args[1]) : null;
      walk(args[0], suppressible);
      if (right !== null) {
        rhs.add(right);
        return; // the right operand IS the suppressible occurrence — not "elsewhere"
      }
      walk(args[1], suppressible);
      return;
    }

    const name = bareId(node);
    if (name !== null) {
      elsewhere.add(name);
      return;
    }
    walk(args, suppressible);
  };

  walk(ast, true);
  for (const name of elsewhere) rhs.delete(name);
  return rhs;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The `schemaId` a form view resolves its row shape from, or `undefined` when
 * the view is not schema-bound. Read off `ViewDataSourceSchema`'s `schema`
 * member (`view.zod.ts:151-161`) — the shape `defineForm` writes.
 *
 * Shared rather than duplicated: it is the test for "the metadata-admin
 * evaluator renders this", which is the precondition BOTH the rule that
 * reports the right-hand position and the rules that stand down for it must
 * agree on. Two copies of it is exactly how one side starts suppressing on a
 * surface the other side has gone quiet on.
 */
export function schemaIdOf(view: AnyRec): string | undefined {
  const data = view.data;
  if (!isRec(data)) return undefined;
  if (data.provider !== 'schema') return undefined;
  return typeof data.schemaId === 'string' ? data.schemaId : undefined;
}
