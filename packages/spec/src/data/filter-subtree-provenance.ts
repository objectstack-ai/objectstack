// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220, A of the #7929 maintainer ruling 2026-08-12 — 「接受你的全部建议。」,
 * adopting "B now, A next"] FILTER-SUBTREE provenance — the spec-declared mark
 * saying *who authored this predicate subtree*, set where a read scope is
 * merged into a caller's `where` and consumed where a refusal decides what its
 * message may name.
 *
 * ## The problem this declares an answer to
 *
 * B (#8198) made `driver-sql`'s cross-field `{ $field }` refusal withhold its
 * operands from EVERY caller, because the predicate reaches the driver as a
 * bare `FilterCondition` with nothing marking which subtree the caller did not
 * write — an administrator's CEL sharing/permission rule and the author's own
 * filter are indistinguishable there. The accepted cost was the author's own
 * diagnostic. This module is the mark that gives it back: the two read-scope
 * merge boundaries (`plugin-security`'s CRUD injection,
 * `service-analytics`' `ObjectQLStrategy.withReadScope`) stamp each side of
 * the merge, and the driver's refusal discloses its full diagnostic only for a
 * subtree positively marked `'author'`.
 *
 * ## ⚠️ The fail direction is CLOSED, and it is load-bearing
 *
 * **Unmarked or ambiguous ⇒ withheld.** The mark is permission to *reveal*,
 * never a requirement to prove secrecy. Every degradation in this module is
 * designed to land on the withholding branch:
 *
 *  - the mark lives under a SYMBOL key, so `JSON.stringify`, `{ ...spread }`
 *    of enumerable keys only, structured clone and the wire all DROP it — a
 *    filter that crossed a serialization boundary arrives unmarked and is
 *    withheld;
 *  - {@link markFilterSubtreeProvenance} never overwrites an existing mark and
 *    silently no-ops on a frozen or non-object subtree — a subtree that could
 *    not be marked stays unmarked and is withheld;
 *  - {@link filterSubtreeProvenanceOf} answers `null` for any value that is
 *    not exactly one of the two declared literals — a corrupted mark is
 *    withheld;
 *  - {@link resolveFilterSubtreeProvenance} answers `null` for a node it
 *    cannot find under the root, and for a node reachable under conflicting
 *    effective marks — an ambiguous position is withheld.
 *
 * A consumer must treat `null` exactly as it treats `'policy'`. Any design
 * where "the mark is missing" lands on the disclosing branch re-opens the
 * #7929 disclosure — including the sentence naming which column is the
 * object's tenant-isolation column — and was rejected by the ruling this
 * module implements.
 *
 * ## Why a symbol on the subtree, not a slot beside it
 *
 * The predicate crosses two package boundaries by REFERENCE (`QueryAST.where`
 * → engine middleware → `DriverQuery.where`), and the merge produces one tree
 * whose ARMS have different provenance — `{ $and: [authorWhere, scope] }`. A
 * parallel slot on {@link import('../contracts/data-driver').DriverQuery}
 * would have to describe subtree positions from outside the tree and would
 * break the moment any layer re-shaped the filter; a mark ON the subtree
 * travels with it, and is dropped by exactly the operations that would have
 * invalidated a positional description (copy, serialize, rewrite) — which is
 * the fail-closed direction above, by construction. `Symbol.for` (the global
 * registry) rather than a module-local symbol so a duplicated copy of this
 * package resolves the same key — the same choice `driver-sql` made for its
 * withheld-diagnostic carrier.
 *
 * ## Why this is a separate mechanism from injected-column provenance (#7865)
 *
 * `injected-system-column-provenance.ts` answers a question about METADATA at
 * rest — "is this column on this object document actually provisioned by the
 * platform?" — derived from document-declared keys, stable for the life of the
 * document. This module answers a question about one QUERY VALUE in flight —
 * "who authored this predicate subtree?" — knowable only at the merge moment,
 * by the code doing the merging, and meaningless once the query is done. One
 * is a derivation over declared state; the other is an attestation attached at
 * a boundary. Folding them into one mechanism would give the column verdict a
 * mutable runtime carrier it must not have, and the filter mark a document
 * derivation it cannot have.
 *
 * Like everything in this directory the module is tolerant of bare, un-parsed
 * input: every function accepts `unknown` and degrades toward `null`.
 */

/**
 * Who authored a predicate subtree.
 *
 *  - `'author'` — the caller's own predicate: the merge boundary attests the
 *    caller wrote (or could read back) every name in it. A refusal raised from
 *    inside it may carry its full diagnostic — the operands, the operator, the
 *    list index, the boundary reason.
 *  - `'policy'` — injected policy the caller never wrote (an RLS / sharing /
 *    tenant read scope). A refusal raised from inside it keeps the #7929
 *    redaction: identity (`INVALID_FILTER` / 400) and capability statement on
 *    the wire, operands in the server log.
 *
 * There is deliberately no third literal for "unknown": absence of the mark IS
 * that state, and it withholds. Declaring it as a value would invite a
 * boundary to stamp uncertainty as if it were information.
 */
export type FilterSubtreeProvenance = 'author' | 'policy';

/**
 * The symbol key the mark lives under on a `FilterCondition` subtree.
 *
 * Exported for one purpose: so a consumer that must read the mark where the
 * helpers cannot be imported (a duplicated package instance) can resolve the
 * same key via `Symbol.for`. Everything else goes through
 * {@link markFilterSubtreeProvenance} / {@link filterSubtreeProvenanceOf}.
 */
export const FILTER_SUBTREE_PROVENANCE: symbol = Symbol.for(
  'objectstack.filter.subtreeProvenance',
);

/**
 * Stamp `provenance` on one filter subtree, in place, and return it.
 *
 * The mark is non-enumerable (invisible to `Object.keys`, `JSON.stringify`,
 * spread of a rest pattern's enumerable copy, and every schema that walks own
 * enumerable keys — a Zod `strictObject` neither sees nor rejects it) and
 * non-writable (a later actor cannot flip a policy subtree to `'author'`).
 *
 * **First mark wins.** A subtree already carrying a valid mark is returned
 * unchanged: the actor closest to the subtree's creation is the one that knows
 * its provenance, and letting a later, more distant actor overwrite that would
 * let a generic boundary re-vouch a policy predicate as the caller's. Marking
 * is therefore idempotent.
 *
 * ## ⚠️ Idempotent is NOT "safe to reuse across requests"
 *
 * This paragraph used to end by calling the mark *"safe on filter objects that
 * are reused across requests (view metadata, cached scopes): the
 * classification of one subtree does not change between requests"*. The
 * #8794 survey measured that claim and it is true in ONE direction only; the
 * correction is pinned by `filter-subtree-provenance.test.ts` (#8836). The
 * claim holds where provenance is **intrinsic** to the subtree, and a caller's
 * `where` is the half where it is not:
 *
 *  - a `'policy'` scope IS intrinsically policy — the platform's predicate in
 *    every request — so a stale `'policy'` mark is still correct next request,
 *    and first-mark-wins is what stops a distant boundary re-vouching it. This
 *    is the direction the rule was written for, and it degrades toward
 *    WITHHOLDING;
 *  - a caller's `where` is **contextual** — the same object is the caller's own
 *    predicate in one request and not in another. A stale `'author'` mark
 *    degrades toward DISCLOSING, and because first-mark-wins is absolute the
 *    corrective `'policy'` stamp a later boundary would apply is a silent
 *    no-op — the already-marked guard below returns the subtree unchanged.
 *    Nothing downstream can repair it either: the mark is non-writable and
 *    non-configurable.
 *
 * So "the classification does not change between requests" is an assumption
 * about the CALLER POPULATION, not a property of this mark. The invariant the
 * design actually rests on is:
 *
 * > no filter object that can be vouched `'author'` may outlive the request
 * > that vouched it.
 *
 * It holds across every in-repo caller today — enumerated with controls in
 * #8794 — and it holds *incidentally*: every caller in a markable position
 * (`options.where` itself, or an arm of a pure `$and` root) happens to build
 * its filter fresh per request. This module does not and cannot enforce it,
 * because "the request" is not a concept it can see. What is enforced is that
 * the cost of breaking it stays visible: the pin test asserts the disclosure a
 * reused vouchable object produces, and its fresh-object control.
 *
 * Fail-closed by silence: a non-object subtree, a frozen/sealed one, or any
 * `defineProperty` refusal leaves the subtree unmarked — and unmarked is
 * withheld. No error escapes this function; a boundary must never fail its
 * merge because a mark could not be attached.
 */
export function markFilterSubtreeProvenance<T>(
  subtree: T,
  provenance: FilterSubtreeProvenance,
): T {
  if (subtree === null || typeof subtree !== 'object') return subtree;
  if (provenance !== 'author' && provenance !== 'policy') return subtree;
  if (filterSubtreeProvenanceOf(subtree) !== null) return subtree;
  try {
    Object.defineProperty(subtree, FILTER_SUBTREE_PROVENANCE, {
      value: provenance,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  } catch {
    // Frozen / sealed / exotic object: stays unmarked, which withholds.
  }
  return subtree;
}

/**
 * The mark carried by THIS node (own key only — no inheritance), or `null`.
 *
 * `null` covers every degraded shape by design: no mark, a mark whose value is
 * not one of the two declared literals, a non-object. Inheritance from an
 * enclosing subtree is position-dependent and belongs to
 * {@link resolveFilterSubtreeProvenance}, which knows the root.
 */
export function filterSubtreeProvenanceOf(node: unknown): FilterSubtreeProvenance | null {
  if (node === null || (typeof node !== 'object' && typeof node !== 'function')) return null;
  const value = (node as Record<symbol, unknown>)[FILTER_SUBTREE_PROVENANCE];
  return value === 'author' || value === 'policy' ? value : null;
}

/**
 * The EFFECTIVE provenance of `target` as it sits inside `root` — the verdict
 * a refusal consumer asks for — or `null` when no disclosure-grade answer
 * exists.
 *
 * Effective means positional: the innermost mark on the ancestor chain from
 * `root` down to `target` (inclusive of both ends) wins, so a subtree marked
 * `'policy'` inside a tree whose root a boundary vouched as `'author'` stays
 * policy, and an unmarked comparand inside a marked author arm is the
 * author's. `target` is located by object IDENTITY — the reference the refusal
 * site held — never by structural equality: two byte-identical predicates with
 * different authors are exactly the case this module exists to tell apart.
 *
 * Answers `null` — which a consumer must treat as `'policy'` (withheld) — for:
 *
 *  - `target` not reachable from `root` (the tree was rewritten between merge
 *    and refusal, or the refusal site attached a node from a rewritten copy);
 *  - `target` reachable, but no mark anywhere on any path to it (no boundary
 *    ever vouched);
 *  - `target` reachable under MULTIPLE paths whose effective marks disagree
 *    (one subtree object aliased into both an author arm and a policy arm —
 *    ambiguous, so withheld).
 *
 * The walk visits plain objects and arrays only (the shapes
 * `FilterConditionSchema` declares), tracks the current path to terminate on a
 * cyclic input, and never throws.
 */
export function resolveFilterSubtreeProvenance(
  root: unknown,
  target: unknown,
): FilterSubtreeProvenance | null {
  if (root === null || typeof root !== 'object') return null;
  if (target === null || typeof target !== 'object') return null;

  const verdicts = new Set<FilterSubtreeProvenance | null>();
  const onPath = new Set<object>();

  const visit = (node: unknown, inherited: FilterSubtreeProvenance | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (onPath.has(node)) return; // cyclic input — stop this path
    const effective = filterSubtreeProvenanceOf(node) ?? inherited;
    if (node === target) {
      verdicts.add(effective);
      // A node cannot contain itself as a descendant with a DIFFERENT verdict
      // unless aliased elsewhere, which the sibling walks below still find.
      return;
    }
    if (!isWalkable(node)) return;
    onPath.add(node);
    if (Array.isArray(node)) {
      for (const element of node) visit(element, effective);
    } else {
      for (const value of Object.values(node)) visit(value, effective);
    }
    onPath.delete(node);
  };

  visit(root, null);

  if (verdicts.size !== 1) return null; // unreachable, or conflicting paths
  const verdict = verdicts.values().next().value;
  return verdict ?? null;
}

/**
 * The shapes the resolver descends into: arrays, and plain objects (prototype
 * `Object.prototype` or `null`) — the same node test `filter-verdict.ts`
 * applies, for the same reason: a `Date`, `Map` or class instance in a
 * comparand position holds no filter subtree, and walking one would read
 * semantics into a shape the Filter Protocol does not declare.
 */
function isWalkable(node: object): boolean {
  if (Array.isArray(node)) return true;
  const proto = Object.getPrototypeOf(node);
  return proto === Object.prototype || proto === null;
}
