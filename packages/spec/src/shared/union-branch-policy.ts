// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The union-branch selection policy — ONE implementation, two walks (#8318).
 *
 * ## What lives here, and why it is here rather than in each walk
 *
 * When a `z.union` rejects a value, zod folds every branch's issues into ONE
 * top-level `invalid_union` whose own message is the literal `"Invalid input"`.
 * Something has to decide *which* branches actually explain the failure, or the
 * author gets one mistake reported once per member ("N branches, N times the
 * noise"). That decision — drop kind-mismatch-only branches, rank by fewest
 * issues, break ties on `unrecognized_keys` then declaration order, cap the
 * result — is a POLICY, not a rendering detail: the same body must get the same
 * verdict whether the author published from the terminal or POSTed to the API
 * (#5014). Its two consumers are one directory apart:
 *
 * - `../shared/error-map.zod.ts` — `formatZodIssue`'s prose renderer (#4971),
 *   indented `✗ path: message` lines for a terminal;
 * - `../api/zod-issues-to-fields.ts` — the ADR-0114 D3 wire mapper (#8124),
 *   `{field, code, message}` entries for a JSON error envelope.
 *
 * Until #8318 each carried its own copy of the ranking, the two limits and
 * {@link CONTAINER_ISSUE_CODES}, bound to move together by their module headers
 * and by nothing mechanical. `packages/spec/src/shared/union-branch-policy.parity.test.ts`
 * is that mechanical enforcement, and this module is what makes it structural:
 * a verdict can no longer drift on one side, because there is only one side.
 *
 * ## What deliberately does NOT live here
 *
 * The two **walks** stay separate implementations. They differ in more than
 * formatting — the renderer emits a trailing "… and N more branches rejected
 * this value" line that the wire deliberately omits (a `fields[]` entry must
 * name a real field and carry a catalog code; an omission note has neither),
 * their de-duplication keys differ, and only the mapper maps codes to the
 * ADR-0114 catalog. Merging them would trade a shared verdict for a shared
 * output format, which is not what either consumer wants.
 *
 * ## ⛔ Package-internal — NOT a public export
 *
 * This module is reachable only from inside `@objectstack/spec` and is
 * deliberately absent from `shared/index.ts` and from the root barrel: it is
 * machinery two sibling modules need, not a contract anyone should author
 * against (the #4001 pitfall — do not export internals only these modules
 * need). `api-surface/` and `export-origins/` must not move for it. A third
 * consumer OUTSIDE this package (`packages/metadata-protocol/src/protocol.ts`
 * carries its own copy of the same ranking) is therefore not served by this
 * module today; sharing with it is a public-surface decision, not a refactor.
 */

/**
 * As much of a zod issue as branch SELECTION reads.
 *
 * Both fields are `unknown` and optional on purpose: the wire mapper receives
 * issue objects it has not type-checked (`zodIssuesToFields` takes `unknown`
 * and tolerates junk by contract), while the renderer's own `ZodIssueMinimal`
 * — `path: PropertyKey[]`, `code?: string` — is assignable to this, so both
 * pass their real types through {@link selectUnionBranches} unchanged.
 */
export interface UnionBranchIssue {
  readonly path?: unknown;
  readonly code?: unknown;
}

/**
 * How many levels of nested issues are expanded below a top-level issue —
 * `invalid_union` branches and, since #5389, `invalid_key` / `invalid_element`
 * container issues alike. Both nest (a union member that is itself a union —
 * `StateMachine → on.GO → actions[0]` is two levels in this repo today; a
 * record whose value schema is a union is another), and a union level can
 * render several branches, so the expansion is bounded rather than left to the
 * shape of whatever the author typed.
 *
 * Read by both walks; it bounds the DESCENT, which is why it lives beside the
 * selection rather than inside it.
 */
export const NESTED_EXPANSION_DEPTH_LIMIT = 3;

/**
 * How many equally-informative branches are kept at one level.
 *
 * The renderer prints them and then says how many it dropped; the wire emits
 * them and says nothing. Both keep the same ones — that is the point.
 */
export const UNION_BRANCH_SELECTION_LIMIT = 3;

/**
 * [#5389] The issue codes that hang their real diagnosis on `issue.issues`
 * rather than on `invalid_union`'s `issue.errors`.
 *
 * Zod raises these when a CONTAINER's inner schema rejects a key or an element
 * that cannot be addressed by a path segment:
 *
 * - `invalid_key` — `z.record(K, V)`'s **key** schema rejected a key, and
 *   `z.map(K, V)`'s key schema rejected a non-`PropertyKey` key;
 * - `invalid_element` — `z.map(K, V)`'s **value** schema rejected the value
 *   under a non-`PropertyKey` key.
 *
 * In both cases the issue's own `message` is a bare wrapper ("Invalid key in
 * record") and everything the author needs sits one level down, exactly as
 * `invalid_union` hides a branch's prescription in `errors` (#4971).
 *
 * ⚠️ These issues are NOT ranked. A union's branches are competing
 * *candidates*, so they are selected between; a container has one inner schema,
 * so every issue it produced is a true statement about the value and dropping
 * any would be dropping a real diagnosis. The codes live here because both
 * walks must descend the same set, not because the set feeds
 * {@link selectUnionBranches}.
 */
export const CONTAINER_ISSUE_CODES: ReadonlySet<string> = new Set([
  'invalid_key',
  'invalid_element',
]);

/**
 * A zod issue path, normalised to the array zod always produces.
 *
 * The normalisation is the wire mapper's, adopted for both walks by #8318: it
 * reads a missing or non-array `path` as the root rather than trusting a
 * declared type its caller may not have honoured. For every input zod itself
 * produces — and for every value satisfying the renderer's `ZodIssueMinimal`,
 * whose `path` is a required array — this is byte-identical to reading
 * `issue.path.length` directly. It differs only for issue objects that violate
 * that type, where the renderer previously threw on the spread a few lines
 * later; a shared policy cannot have two readings of "the branch root", and the
 * tolerant one is the reading already shipped and pinned on the wire side.
 */
export function unionIssuePath(issue: UnionBranchIssue | undefined): Array<string | number> {
  return Array.isArray(issue?.path) ? (issue.path as Array<string | number>) : [];
}

/**
 * True when a branch only complains that the value is the wrong *kind* at the
 * branch root — `expected string, received object` for the string member of
 * `z.union([z.string(), SomeObject])`.
 *
 * Such a branch carries no prescription: the author never intended it, and
 * surfacing it is the "N branches, N times the noise" failure that made
 * `view.zod.ts`'s `submitBehavior` reach for `discriminatedUnion`. An empty
 * branch (the `invalid_union` "matched multiple" variant carries `errors: []`)
 * counts as uninformative too — `every` on an empty list is `true`.
 */
export function isKindMismatchOnly(issues: readonly UnionBranchIssue[]): boolean {
  return issues.every(
    (issue) =>
      unionIssuePath(issue).length === 0
      && (issue?.code === 'invalid_type' || issue?.code === 'invalid_value'),
  );
}

/** True when a branch carries the #4001 campaign's unknown-key prescription. */
export function carriesUnknownKey(issues: readonly UnionBranchIssue[]): boolean {
  return issues.some((issue) => issue?.code === 'unrecognized_keys');
}

/**
 * Pick the branch(es) of a failed union whose issues actually explain the
 * failure.
 *
 * Ranking, in order:
 *
 * 1. **Kind-mismatch-only branches are dropped entirely** (see
 *    {@link isKindMismatchOnly}). If *every* branch is one — a plain
 *    `z.union([z.string(), z.number()])` handed an object — nothing is
 *    selected and the union surfaces exactly as it always has.
 * 2. **Fewest issues wins.** The branch the author was closest to hitting
 *    complains least: given `z.union([A, B, C])` of strict objects and one
 *    mistyped key, the intended member reports *only* that key while the other
 *    two also report a wrong discriminator and their own missing requireds. So
 *    "fewest" is what keeps a single unknown key from being reported once per
 *    branch.
 * 3. **A branch carrying `unrecognized_keys` breaks a tie**, because that is
 *    where the curated prose lives.
 * 4. Declaration order breaks what remains, so the output is deterministic.
 *
 * Branches that tie at the top are *all* selected (capped at
 * {@link UNION_BRANCH_SELECTION_LIMIT}): when two shapes explain the failure
 * equally well, privileging the first one by accident of declaration order
 * would be a lie about which shape was expected.
 *
 * `omitted` is how many tied branches the cap dropped. The prose renderer turns
 * it into a trailing "… and N more branches rejected this value" line; the wire
 * mapper ignores it, because that line is a rendering affordance and a
 * `fields[]` entry has nowhere to put it (ADR-0114: every entry names a real
 * field and carries a catalog code). One selection, two dispositions of the
 * same number — which is why it is returned rather than assumed.
 *
 * The element type is passed through, so each caller keeps its own issue type:
 * the renderer gets `ZodIssueMinimal[]` back, the mapper gets its `any[]`.
 */
export function selectUnionBranches<T extends UnionBranchIssue>(
  branches: readonly (readonly T[])[],
): { selected: readonly (readonly T[])[]; omitted: number } {
  const informative = branches
    .map((issues, index) => ({ issues, index }))
    .filter((branch) => !isKindMismatchOnly(branch.issues));

  if (informative.length === 0) return { selected: [], omitted: 0 };

  const rank = (branch: { issues: readonly T[] }): [number, number] => [
    branch.issues.length,
    carriesUnknownKey(branch.issues) ? 0 : 1,
  ];

  const sorted = [...informative].sort((a, b) => {
    const [aCount, aKeys] = rank(a);
    const [bCount, bKeys] = rank(b);
    return aCount - bCount || aKeys - bKeys || a.index - b.index;
  });

  const [bestCount, bestKeys] = rank(sorted[0]!);
  const tied = sorted.filter((branch) => {
    const [count, keys] = rank(branch);
    return count === bestCount && keys === bestKeys;
  });

  return {
    selected: tied.slice(0, UNION_BRANCH_SELECTION_LIMIT).map((branch) => branch.issues),
    omitted: Math.max(0, tied.length - UNION_BRANCH_SELECTION_LIMIT),
  };
}
