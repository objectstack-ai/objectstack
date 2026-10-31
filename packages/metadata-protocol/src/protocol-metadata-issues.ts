// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the metadata issue entry and the Zod-issue walk that turns a parse failure into located metadata issues.
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */

/**
 * One entry of the `422 INVALID_METADATA` envelope's `issues[]` — the shape
 * Studio's designer keys on to highlight the offending form control.
 *
 * `code` is zod's OWN issue code, passed through verbatim. That is deliberately
 * NOT the ADR-0114 `fields[]` catalog the data surface speaks: this envelope is
 * a metadata-authoring diagnostic, its consumers already read raw zod codes, and
 * aligning the two vocabularies is a separate decision (#5364).
 */
export interface MetadataIssueEntry {
    path: string;
    message: string;
    code: string | undefined;
}

/**
 * How many levels of nested issues are expanded below a top-level issue, and
 * how many equally-informative branches are emitted at one level.
 *
 * Both bounds — and the whole selection policy below — are the ones
 * `formatZodError` landed for the CLI/spec side of this defect (#4971,
 * `spec/src/shared/error-map.zod.ts`) and `zodIssuesToFields` landed for the
 * REST wire (#5014, `rest/src/rest-server.ts`). This is the THIRD copy: spec
 * exports only the STRING renderer and rest's version emits ADR-0114
 * `{field, code}` catalog entries, while this envelope is
 * `{path, message, code}` with zod's raw code. The *verdict* must match all the
 * same, or one mistake gets three different prescriptions depending on whether
 * the author published from the terminal, POSTed to the data API, or saved from
 * Studio (#5364).
 *
 * [#8783] The depth bound is named for what it bounds — nesting — and not for
 * `invalid_union`, because it now bounds the container descent below as well.
 * The spec pair renamed the same constant for the same reason when #8318
 * extracted it (`NESTED_EXPANSION_DEPTH_LIMIT` in
 * `spec/src/shared/union-branch-policy.ts`); the value is the same 3, and it
 * has to be, for the reason in the paragraph above.
 */
const NESTED_EXPANSION_DEPTH_LIMIT = 3;
const UNION_BRANCH_EMIT_LIMIT = 3;

/**
 * [#5389/#8783] The issue codes that hang their real diagnosis on
 * `issue.issues` rather than on `invalid_union`'s `issue.errors`.
 *
 * Zod raises these when a CONTAINER's inner schema rejects a key or an element
 * that cannot be addressed by a path segment:
 *
 * - `invalid_key` — `z.record(K, V)`'s **key** schema rejected a key, and
 *   `z.map(K, V)`'s key schema rejected a non-`PropertyKey` key;
 * - `invalid_element` — `z.map(K, V)`'s **value** schema rejected the value
 *   under a non-`PropertyKey` key.
 *
 * In both cases the issue's own `message` is a bare wrapper (`"Invalid key in
 * record"`) and everything the author needs sits one level down, exactly as
 * `invalid_union` hides a branch's prescription in `errors` (#4971). Without
 * the descent this envelope stopped at the wrapper while the other two walks
 * descended, so the single most-authored metadata type's commonest authoring
 * mistake — `ObjectSchema.fields` is a record whose KEY schema carries the
 * snake_case rule (`spec/src/data/object.zod.ts`) — reached Studio as
 * `{path: 'fields.firstName', code: 'invalid_key', message: 'Invalid key in
 * record'}` with the sentence naming the rule dropped (#8783).
 *
 * ⚠️ These issues are NOT ranked, and that is the one structural difference
 * from the union descent below. A union's branches are competing *candidates*,
 * so they are selected between; a container has one inner schema, so every
 * issue it produced is a true statement about the value and dropping any would
 * be dropping a real diagnosis. Hence the plain loop rather than
 * {@link selectUnionBranches}.
 *
 * ⛔ Deliberately a local declaration, not an import. `spec`'s
 * `CONTAINER_ISSUE_CODES` is package-internal by decision (the #4001 export
 * pitfall) and reaching for it would be #8660's option 2 — a public-surface
 * decision this change does not make. `union-branch-policy.cross-package-parity.test.ts`
 * §1 is the tripwire that keeps that decision explicit, and §5 there pins this
 * set's *behaviour* against both spec walks.
 */
const CONTAINER_ISSUE_CODES: ReadonlySet<string> = new Set(['invalid_key', 'invalid_element']);

/**
 * A zod issue, as much of it as the expansion reads.
 *
 * `errors` exists only on `invalid_union`: one issue list **per union branch**,
 * with each branch's paths RELATIVE to the union issue's own path. Zod raises a
 * single `invalid_union` issue whose own `message` is the literal
 * `"Invalid input"`, so everything a failing branch has to say lives down there.
 *
 * `issues` is the container equivalent (#8783), carried by the
 * {@link CONTAINER_ISSUE_CODES}: the one issue list the failing key/element
 * schema produced, with paths relative to this issue's own — the same
 * relationship `errors` has, spelled with a different property name and without
 * the per-branch nesting, because a container has one inner schema rather than
 * N alternatives.
 */
interface ZodIssueLike {
    path?: unknown;
    message?: unknown;
    code?: unknown;
    errors?: unknown;
    issues?: unknown;
}

/** A zod issue path, normalised to the array zod always produces. */
function issuePathOf(issue: ZodIssueLike): Array<string | number> {
    return Array.isArray(issue?.path) ? (issue.path as Array<string | number>) : [];
}

/**
 * True when a branch only complains that the value is the wrong *kind* at the
 * branch root — `expected string, received object` for the string member of
 * `z.union([z.string(), SomeObject])`.
 *
 * Such a branch carries no prescription: the author never intended it, and
 * emitting it is the "N branches, N times the noise" failure. An empty branch
 * (zod's "matched multiple" variant carries `errors: []`) counts as
 * uninformative too — `every` on an empty list is `true`.
 */
function isKindMismatchOnly(issues: readonly ZodIssueLike[]): boolean {
    return issues.every(
        (issue) =>
            issuePathOf(issue).length === 0
            && (issue?.code === 'invalid_type' || issue?.code === 'invalid_value'),
    );
}

/** True when a branch carries the #4001 campaign's unknown-key prescription. */
function carriesUnknownKey(issues: readonly ZodIssueLike[]): boolean {
    return issues.some((issue) => issue?.code === 'unrecognized_keys');
}

/**
 * Pick the branch(es) of a failed union whose issues actually explain the
 * failure. Ranking, in order (identical to `selectUnionBranches` in
 * `spec/src/shared/error-map.zod.ts` and `rest/src/rest-server.ts`):
 *
 * 1. **Kind-mismatch-only branches are dropped entirely.** If *every* branch is
 *    one — a plain `z.union([z.string(), z.number()])` handed an object —
 *    nothing is selected and the union reports exactly what it always has.
 * 2. **Fewest issues wins.** The branch the author was closest to hitting
 *    complains least, so "fewest" is what keeps ONE unknown key from arriving as
 *    N `issues[]` entries, one per branch.
 * 3. **A branch carrying `unrecognized_keys` breaks a tie**, because that is
 *    where the curated prose lives.
 * 4. Declaration order breaks what remains, so the envelope is deterministic.
 *
 * Branches that tie at the top are all emitted (capped): when two shapes explain
 * the failure equally well, privileging the first by accident of declaration
 * order would be a lie about which shape was expected.
 */
function selectUnionBranches(
    branches: readonly (readonly ZodIssueLike[])[],
): readonly (readonly ZodIssueLike[])[] {
    const informative = branches
        .map((issues, index) => ({ issues, index }))
        .filter((branch) => !isKindMismatchOnly(branch.issues));
    if (informative.length === 0) return [];

    const rank = (branch: { issues: readonly ZodIssueLike[] }): [number, number] => [
        branch.issues.length,
        carriesUnknownKey(branch.issues) ? 0 : 1,
    ];

    const sorted = [...informative].sort((a, b) => {
        const [aCount, aKeys] = rank(a);
        const [bCount, bKeys] = rank(b);
        return aCount - bCount || aKeys - bKeys || a.index - b.index;
    });

    const [bestCount, bestKeys] = rank(sorted[0]!);
    return sorted
        .filter((branch) => {
            const [count, keys] = rank(branch);
            return count === bestCount && keys === bestKeys;
        })
        .slice(0, UNION_BRANCH_EMIT_LIMIT)
        .map((branch) => branch.issues);
}

/**
 * One issue → its `issues[]` entries, appended to `out`.
 *
 * An ordinary issue is one entry. An `invalid_union` is its own entry (zod's
 * bare `"Invalid input"`) FOLLOWED by the entries of the branches that explain
 * it, with `path` resolved against the union's own — branch paths are RELATIVE
 * to it, which is the trap #5014 paid for: a branch issue's `path` names a slot
 * inside the union member, not inside the document.
 *
 * [#8783] A {@link CONTAINER_ISSUE_CODES} issue descends the same way and for
 * the same reason, into `issue.issues` instead of `issue.errors`, with two
 * differences: nothing is ranked (a container has one inner schema, so every
 * issue it raised is true — see the note on the code set), and the descent is
 * only taken when the issue's own code says the payload is a container's. That
 * second half is what keeps this targeted: an `issues` array hanging off any
 * other code is left alone, so the walk did not become "descend whatever
 * nests".
 *
 * The wrapper's entry is kept rather than replaced — for the union and the
 * container alike: it is the only entry naming the slot the client sent,
 * existing consumers already read it, and when nothing below is informative it
 * is still the whole answer. So the expansion is strictly ADDITIVE — no entry
 * that shipped before this changed is gone or renumbered, only newly
 * accompanied. Both spec walks were measured to do the same before #8783 copied
 * them (`formatZodIssue` prints the wrapper line then the indented detail;
 * `zodIssuesToFields` emits the `invalid_shape` wrapper then the detail entry).
 *
 * `seen` de-duplicates entries *within one top-level issue*: two branches that
 * reject the same key with the same words say it once. Expanded entries — union
 * and container heads alike — are exempt, since two same-path wrapper entries
 * can head genuinely different sub-trees.
 *
 * Deliberate divergence from the spec-side renderer: where it prints a trailing
 * "… and N more branches rejected this value", this emits nothing. That line is
 * a rendering affordance for a terminal; an `issues[]` entry is a machine-read
 * record that must name a slot and carry a code, and the omission note has
 * neither.
 */
function collectMetadataIssues(
    issue: ZodIssueLike,
    parentPath: Array<string | number>,
    depth: number,
    seen: Set<string>,
    out: MetadataIssueEntry[],
): void {
    const path = [...parentPath, ...issuePathOf(issue)];
    const branches: readonly (readonly ZodIssueLike[])[] =
        issue?.code === 'invalid_union' && Array.isArray(issue?.errors)
            ? (issue.errors as unknown[]).filter(
                (branch): branch is ZodIssueLike[] => Array.isArray(branch),
            )
            : [];
    const contained: readonly ZodIssueLike[] =
        typeof issue?.code === 'string' && CONTAINER_ISSUE_CODES.has(issue.code)
            && Array.isArray(issue?.issues)
            ? (issue.issues as ZodIssueLike[])
            : [];
    const expandable = (branches.length > 0 || contained.length > 0)
        && depth < NESTED_EXPANSION_DEPTH_LIMIT;

    const entry: MetadataIssueEntry = {
        path: path.join('.'),
        message: String(issue?.message ?? 'Invalid value'),
        code: issue?.code === undefined ? undefined : String(issue.code),
    };

    if (!expandable) {
        const key = JSON.stringify([entry.path, entry.code, entry.message]);
        if (seen.has(key)) return;
        seen.add(key);
    }
    out.push(entry);
    if (!expandable) return;

    if (branches.length > 0) {
        for (const branch of selectUnionBranches(branches)) {
            for (const nested of branch) {
                collectMetadataIssues(nested, path, depth + 1, seen, out);
            }
        }
        return;
    }

    // Unranked, and every one of them: see {@link CONTAINER_ISSUE_CODES}.
    for (const nested of contained) {
        collectMetadataIssues(nested, path, depth + 1, seen, out);
    }
}

/**
 * Zod issues → the `422 INVALID_METADATA` envelope's `issues[]`.
 *
 * A rejection behind a `z.union` is expanded (#5364): zod folds every branch of
 * a failed union into ONE top-level issue whose message is the literal
 * `"Invalid input"`, so mapping only top-level issues put
 * `[{path: '', message: 'Invalid input', code: 'invalid_union'}]` on the wire —
 * not one field name — while the branch that says WHICH key is wrong (the #4001
 * curated unknown-key prose, the legal enum of a mistyped discriminator) was
 * produced and dropped at the `.map()`.
 *
 * That mattered most HERE of the four consumers of this defect: `ViewMetadataSchema`
 * is itself a top-level union, so EVERY failed `view` save degraded to that one
 * rootless line and Studio's form had nothing to highlight. The other three —
 * `formatZodError` (#4971), `zodIssuesToFields` (#5014), the CLI's
 * `formatZodErrors` (#5341) — lost prescriptions; this one lost field
 * localisation itself.
 *
 * A rejection inside a CONTAINER is expanded for the same reason (#8783): zod
 * hangs a `z.record`/`z.map` key or element rejection on
 * {@link CONTAINER_ISSUE_CODES} with the bare wrapper `"Invalid key in record"`
 * as its own message and the real rule one level down in `issue.issues`. Both
 * spec walks have descended those since #5389 while this one stopped at the
 * wrapper, so an author who typed `firstName` for a field key was told a key
 * was invalid and never told what a valid one looks like — the declared
 * snake_case prescription exists, is correct, and simply did not reach the
 * author.
 *
 * Branch selection is described on {@link selectUnionBranches} and is identical
 * to the other copies by construction; the container descent is described on
 * {@link CONTAINER_ISSUE_CODES}.
 */
export function zodIssuesToMetadataIssues(issues: unknown): MetadataIssueEntry[] {
    if (!Array.isArray(issues)) return [];
    const out: MetadataIssueEntry[] = [];
    for (const issue of issues) {
        // A fresh `seen` per top-level issue: de-duplication is about one
        // union's branches agreeing, never about two independent issues.
        collectMetadataIssues(issue as ZodIssueLike, [], 0, new Set<string>(), out);
    }
    return out;
}
