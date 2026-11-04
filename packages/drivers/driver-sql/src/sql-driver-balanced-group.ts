// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `$and` / `$or` group's members, emitted so the expression tree the
 * database parses stays shallow however many members the group has.
 *
 * ## Why the shape of the SQL text matters
 *
 * SQL's `AND` and `OR` are binary and left-associative, so a flat group
 * `(a) OR (b) OR (c) OR …` of N members parses as `((a OR b) OR c) OR …`: an
 * expression tree N levels deep. SQLite refuses a tree deeper than its
 * `SQLITE_LIMIT_EXPR_DEPTH` at prepare time ("Expression tree is too large
 * (maximum depth N)"): 1000 by default, and a hosted libSQL server is
 * configured lower — measured at 100. A group whose member count grows with
 * the deployment (the parent-record read gates OR one `ReadableIds` branch per
 * registered parent object) therefore turns every read of that object into a
 * refusal once the deployment registers enough objects, and only on the
 * backends with the lower limit.
 *
 * Parenthesised sub-groups are separate subtrees, so splitting a large group
 * in two halves and each half again keeps the depth logarithmic in N:
 * `((a OR b) OR (c OR d))`. AND and OR are associative and commutative over
 * SQL's three-valued logic, so the regrouped expression selects exactly the
 * rows the flat one does, on every dialect.
 *
 * ## What stays as it was
 *
 * A group of at most {@link FLAT_GROUP_MAX_MEMBERS} members is emitted flat,
 * byte-identical to the SQL the compiler always wrote, so every ordinary
 * filter keeps its text. Above that, the group is halved recursively until
 * each part fits: the members keep their order, and the depth a group of N
 * members adds is at most `FLAT_GROUP_MAX_MEMBERS - 1 + ceil(log2(N / FLAT_GROUP_MAX_MEMBERS))`.
 */

/** Members a group may hold and still be emitted flat, as it always was. */
export const FLAT_GROUP_MAX_MEMBERS = 8;

/**
 * Emit `members` into `qb`, each attached with `attach` (`'where'` ANDs them,
 * `'orWhere'` ORs them) through `emit`, regrouped into balanced parenthesised
 * halves when there are more than {@link FLAT_GROUP_MAX_MEMBERS}.
 *
 * Every member reaches `emit` exactly once, in order, and every sub-builder
 * opened here receives at least one member, so no group is ever empty.
 */
export function emitBalancedGroup<B, M>(
  qb: B,
  members: readonly M[],
  attach: 'where' | 'orWhere',
  emit: (subQb: B, member: M) => void,
): void {
  const into = qb as unknown as Record<'where' | 'orWhere', (cb: (subQb: B) => void) => unknown>;
  if (members.length <= FLAT_GROUP_MAX_MEMBERS) {
    for (const member of members) into[attach]((subQb) => emit(subQb, member));
    return;
  }
  const half = Math.ceil(members.length / 2);
  into[attach]((subQb) => emitBalancedGroup(subQb, members.slice(0, half), attach, emit));
  into[attach]((subQb) => emitBalancedGroup(subQb, members.slice(half), attach, emit));
}

/**
 * [cloud#3485] The same regrouping, for a compiler that writes SQL TEXT rather
 * than driving a query builder: `TursoDriver`'s remote face
 * (`RemoteTransport`), which compiles every hosted environment's reads itself
 * and so never passed through {@link emitBalancedGroup}. One rule, both faces:
 * a second copy of it in that package is how the two would drift.
 *
 * `members` are the group's compiled members, each a self-contained boolean
 * fragment the caller has already parenthesised; `joiner` is the operator the
 * group's members are joined with. At most {@link FLAT_GROUP_MAX_MEMBERS}
 * members are joined flat, byte-identical to `members.join(joiner)`; above that
 * the two halves are joined once, each in its own parentheses, recursively.
 *
 * The members keep their order, so the bind values a caller collected in
 * member order still line up with the placeholders the text holds. An empty
 * list joins to `''`: the caller decides what an empty group means.
 */
export function joinBalancedGroup(members: readonly string[], joiner: ' AND ' | ' OR '): string {
  if (members.length <= FLAT_GROUP_MAX_MEMBERS) return members.join(joiner);
  const half = Math.ceil(members.length / 2);
  return (
    `(${joinBalancedGroup(members.slice(0, half), joiner)})` +
    joiner +
    `(${joinBalancedGroup(members.slice(half), joiner)})`
  );
}
