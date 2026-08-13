// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Zod issues → ADR-0114 `fields[]` entries — THE D3 boundary mapper.
 *
 * ADR-0114 D2 makes `FieldErrorSchema.code` a closed catalog ({@link FieldErrorCode},
 * `./errors.zod.ts`); D3 says Zod is mapped at the boundary, never passed
 * through, with an unmapped Zod code landing on `invalid_value` (a catalog
 * member) rather than leaking. This module IS that mapping, and it is meant to
 * be the only implementation of D3's table in the repo (#8124): a second copy
 * is exactly the drift the ADR exists to prevent — the two would disagree the
 * first time Zod adds an issue code.
 *
 * ## Why it lives in `@objectstack/spec` (#8124)
 *
 * It grew up module-local in `@objectstack/rest`'s `rest-server.ts`, while
 * `@objectstack/types`' `fieldsFromZodIssues` — the helper the runtime domain
 * routes emit through — still passed `issue.code` through verbatim, putting
 * `unrecognized_keys` / `too_small` on a wire position the spec declares as
 * `FieldErrorCode`. `types` cannot import `rest` (runtime → rest → types, the
 * arrow only points one way), so sharing the compliant copy meant moving it to
 * the one package both depend on — which is also the contract-first home: next
 * to the catalog it is total over. `rest` re-exports it unchanged; `types`
 * maps through it.
 *
 * ## Relation to `shared/error-map.zod.ts`
 *
 * The union-branch selection policy below (limits, ranking, container descent)
 * is the one `formatZodIssue`'s STRING renderer applies (#4971/#5389, one
 * directory over in `shared/error-map.zod.ts`). The two walks stay separate
 * implementations on purpose — one renders indented prose lines, this one
 * produces structured `{field, code, message}` entries — but the *verdict*
 * (which branches explain a failure) must match, or one mistake gets two
 * different prescriptions depending on whether the author published from the
 * terminal or POSTed to the API (#5014). Change the policy in either file and
 * the sibling moves in the same PR.
 */

import type { FieldErrorCode } from './errors.zod';

/**
 * A Zod issue → the field-level catalog (ADR-0114 D3).
 *
 * Zod's issue codes are Zod's API, not ours, and the wire used to pass them
 * straight through. Two things were wrong with that. The wire carried two
 * vocabularies on one position — `too_small` from a route that parses with
 * Zod, `min_length` from the validators — so a client could not read a field
 * code without knowing which route served it. And Zod's own codes are
 * ambiguous alone: `too_small` covers a short string, a small number AND a
 * short array.
 *
 * `origin` and `format` disambiguate every case, so the mapping is total
 * rather than best-effort. The one row that fixes a user-visible bug rather
 * than tidying a name: Zod reports a MISSING required property as
 * `invalid_type` (expected string, received undefined), so passing it through
 * marked a missing input as a type error.
 */
function zodIssueToFieldCode(issue: any, path: unknown, input?: unknown, inputProvided = false): FieldErrorCode {
    const origin = issue?.origin;
    switch (issue?.code) {
        case 'too_small':
            return origin === 'number' || origin === 'bigint' || origin === 'date' ? 'min_value'
                : origin === 'array' || origin === 'set' ? 'min_items'
                : 'min_length';
        case 'too_big':
            return origin === 'number' || origin === 'bigint' || origin === 'date' ? 'max_value'
                : origin === 'array' || origin === 'set' ? 'max_items'
                : 'max_length';
        case 'invalid_format':
            return issue?.format === 'email' ? 'invalid_email'
                : issue?.format === 'url' ? 'invalid_url'
                : 'invalid_format';
        case 'invalid_type': {
            // Zod spells "absent" as a type mismatch against `undefined`, so a
            // MISSING required property arrives here rather than as its own code.
            // The issue itself cannot tell the two apart — v4 carries `expected`
            // and a message but not the offending value — so the only honest
            // discriminator is the parsed input, walked to `path`. Without it we
            // keep `invalid_type`: reading "received undefined" out of the message
            // would make the wire contract depend on Zod's phrasing, which is the
            // leak this mapping exists to stop.
            //
            // `path` is passed in rather than read off the issue because a union
            // BRANCH issue carries a path relative to the union (#5014): walking
            // the relative one would read the wrong slot of the input — usually
            // `undefined` — and report every branch mismatch as `required`.
            if (!inputProvided) return 'invalid_type';
            return valueAtPath(input, path) === undefined ? 'required' : 'invalid_type';
        }
        case 'invalid_value':
            // A closed set (`z.enum`, `z.literal`) the value is not a member of.
            return 'invalid_option';
        case 'unrecognized_keys':
            return 'unknown_field';
        case 'invalid_union':
        case 'invalid_element':
        case 'invalid_key':
            return 'invalid_shape';
        case 'not_multiple_of':
        case 'custom':
        default:
            // A catalog member, not a leak: an unmapped Zod code still lands on a
            // code the client can read, and `message` carries the specifics.
            return 'invalid_value';
    }
}

/** Walk a Zod issue `path` into the value that was parsed. */
function valueAtPath(input: unknown, path: unknown): unknown {
    if (!Array.isArray(path)) return undefined;
    let cur: any = input;
    for (const seg of path) {
        if (cur === null || cur === undefined) return undefined;
        cur = cur[seg as any];
    }
    return cur;
}

/**
 * How many levels of nested issues are expanded below a top-level issue, and
 * how many equally-informative union branches are emitted at one level.
 *
 * Both bounds — and the whole selection policy below — are the ones
 * `formatZodError` landed for the CLI/spec side of this defect (#4971,
 * `shared/error-map.zod.ts`). See the module header for why the two walks are
 * siblings that must agree rather than one shared implementation.
 */
const NESTED_EXPANSION_DEPTH_LIMIT = 3;
const UNION_BRANCH_EMIT_LIMIT = 3;

/**
 * [#5389] The issue codes that hang their real diagnosis on `issue.issues`
 * rather than on `invalid_union`'s `issue.errors`.
 *
 * `invalid_key` is raised when `z.record(K, V)`'s KEY schema rejects a key (and
 * by `z.map` for a non-`PropertyKey` key); `invalid_element` when `z.map`'s
 * VALUE schema rejects the value under such a key. Both carry a bare wrapper
 * message ("Invalid key in record") with everything the client needs one level
 * down — the same defect as #5014, one property name over. Kept in step with
 * `CONTAINER_ISSUE_CODES` in `shared/error-map.zod.ts`.
 */
const CONTAINER_ISSUE_CODES: ReadonlySet<string> = new Set(['invalid_key', 'invalid_element']);

/** A Zod issue path, normalised to the array Zod always produces. */
function issuePathOf(issue: any): Array<string | number> {
    return Array.isArray(issue?.path) ? issue.path : [];
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
function isKindMismatchOnly(issues: readonly any[]): boolean {
    return issues.every(
        (issue) =>
            issuePathOf(issue).length === 0
            && (issue?.code === 'invalid_type' || issue?.code === 'invalid_value'),
    );
}

/** True when a branch carries the #4001 campaign's unknown-key prescription. */
function carriesUnknownKey(issues: readonly any[]): boolean {
    return issues.some((issue) => issue?.code === 'unrecognized_keys');
}

/**
 * Pick the branch(es) of a failed union whose issues actually explain the
 * failure. Ranking, in order (identical to `selectUnionBranches` in
 * `shared/error-map.zod.ts`):
 *
 * 1. **Kind-mismatch-only branches are dropped entirely.** If *every* branch is
 *    one — a plain `z.union([z.string(), z.number()])` handed an object —
 *    nothing is selected and the union reports exactly what it always has.
 * 2. **Fewest issues wins.** The branch the author was closest to hitting
 *    complains least, so "fewest" is what keeps ONE unknown key from arriving as
 *    N `fields[]` entries, one per branch.
 * 3. **A branch carrying `unrecognized_keys` breaks a tie**, because that is
 *    where the curated prose lives.
 * 4. Declaration order breaks what remains, so the wire is deterministic.
 *
 * Branches that tie at the top are all emitted (capped): when two shapes explain
 * the failure equally well, privileging the first by accident of declaration
 * order would be a lie about which shape was expected.
 */
function selectUnionBranches(branches: readonly (readonly any[])[]): readonly (readonly any[])[] {
    const informative = branches
        .map((issues, index) => ({ issues, index }))
        .filter((branch) => !isKindMismatchOnly(branch.issues));
    if (informative.length === 0) return [];

    const rank = (branch: { issues: readonly any[] }): [number, number] => [
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
 * One issue → its `fields[]` entries, appended to `out`.
 *
 * An ordinary issue is one entry. An `invalid_union` is its own entry (zod's
 * bare `"Invalid input"`, mapped to `invalid_shape`) FOLLOWED by the entries of
 * the branches that explain it, with `field` resolved against the union's own
 * path — branch paths are relative to it.
 *
 * [#5389] An `invalid_key` / `invalid_element` behaves the same way one property
 * name over: its own entry (zod's `"Invalid key in record"`, also
 * `invalid_shape`) followed by the entries on `issue.issues`, whose paths are
 * likewise relative. The one difference from a union: those issues are not
 * competing candidates, so they are NOT ranked or capped — every one of them is
 * a true statement about the value, and dropping any would be dropping a real
 * diagnosis rather than declining to guess.
 *
 * The union's entry is kept rather than replaced: it is the only entry naming
 * the slot the client sent, existing clients already read it, and when every
 * branch is uninformative it is still the whole answer. So the expansion is
 * strictly ADDITIVE — no entry that shipped before this changed is gone or
 * renumbered, only newly accompanied (ADR-0114: same `{field, code, message}`
 * shape as rest's `mapDataError`, which has never bounded the array's length).
 *
 * `seen` de-duplicates entries *within one top-level issue*: two branches that
 * reject the same key with the same words say it once. Union entries themselves
 * are exempt, since two same-path `"Invalid input"` entries can head genuinely
 * different sub-trees.
 *
 * Deliberate divergence from the spec-side renderer: where it prints a trailing
 * "… and N more branches rejected this value", this emits nothing. That line is
 * a rendering affordance; a `fields[]` entry must name a real field and carry a
 * catalog code, and the omission note has neither.
 */
function collectIssueFields(
    issue: any,
    parentPath: Array<string | number>,
    depth: number,
    seen: Set<string>,
    input: unknown,
    inputProvided: boolean,
    out: Array<{ field: string; code: FieldErrorCode; message: string }>,
): void {
    const ownPathIsArray = Array.isArray(issue?.path);
    const path = ownPathIsArray ? [...parentPath, ...issue.path] : parentPath;
    const field = ownPathIsArray
        ? path.join('.')
        : [...parentPath, String(issue?.path ?? '')].join('.');

    const branches: readonly (readonly any[])[] = issue?.code === 'invalid_union' && Array.isArray(issue?.errors)
        ? issue.errors.filter((branch: unknown): branch is any[] => Array.isArray(branch))
        : [];
    const contained: readonly any[] = CONTAINER_ISSUE_CODES.has(issue?.code) && Array.isArray(issue?.issues)
        ? issue.issues
        : [];
    const expandable = (branches.length > 0 || contained.length > 0)
        && depth < NESTED_EXPANSION_DEPTH_LIMIT;

    const entry = {
        field,
        // A non-array path keeps the pre-#5014 reading (`valueAtPath` bails and
        // the mapper stays conservative) instead of being coerced into one.
        code: zodIssueToFieldCode(issue, ownPathIsArray ? path : issue?.path, input, inputProvided),
        message: String(issue?.message ?? 'Invalid value'),
    };

    if (!expandable) {
        const key = JSON.stringify([entry.field, entry.code, entry.message]);
        if (seen.has(key)) return;
        seen.add(key);
    }
    out.push(entry);
    if (!expandable) return;

    if (branches.length > 0) {
        for (const branch of selectUnionBranches(branches)) {
            for (const nested of branch) {
                collectIssueFields(nested, path, depth + 1, seen, input, inputProvided, out);
            }
        }
        return;
    }

    for (const nested of contained) {
        collectIssueFields(nested, path, depth + 1, seen, input, inputProvided, out);
    }
}

/**
 * Zod issues → the data surface's `fields[]` validation envelope
 * (`{ field, code, message }`, docs/api/wire-format §7).
 *
 * A schema `.parse()` at a route ingress must report failures in the SAME shape
 * a validator-thrown `VALIDATION_FAILED` does through rest's `mapDataError`
 * (#3918) — otherwise a client keying on `fields` has to learn a second shape
 * per route, and `code: 'VALIDATION_FAILED'` stops meaning one thing on the
 * wire. Since ADR-0114 that sameness covers the `code` VALUE too, not just the
 * shape: see {@link zodIssueToFieldCode}.
 *
 * The optional second argument is the PARSED INPUT, and it buys precision, not
 * admission: with it, a missing required property is reported as `required`
 * rather than the `invalid_type` Zod spells it as. A caller that does not have
 * the input at hand degrades per the D3 table — every code is still a catalog
 * member — rather than leaking.
 *
 * A rejection behind a `z.union` is expanded (#5014): zod folds every branch of
 * a failed union into ONE top-level issue whose message is the literal
 * `"Invalid input"`, so mapping only top-level issues put `{field: 'query.search',
 * code: 'invalid_shape', message: 'Invalid input'}` on the wire while the branch
 * that says WHICH key is wrong — required-property and unknown-key prescriptions
 * alike — was produced and dropped. See {@link collectIssueFields}.
 */
export function zodIssuesToFields(
    issues: unknown,
    ...input: [] | [unknown]
): Array<{ field: string; code: FieldErrorCode; message: string }> {
    if (!Array.isArray(issues)) return [];
    const inputProvided = input.length > 0;
    const out: Array<{ field: string; code: FieldErrorCode; message: string }> = [];
    for (const issue of issues) {
        // A fresh `seen` per top-level issue: de-duplication is about one
        // union's branches agreeing, never about two independent issues.
        collectIssueFields(issue, [], 0, new Set<string>(), input[0], inputProvided, out);
    }
    return out;
}
