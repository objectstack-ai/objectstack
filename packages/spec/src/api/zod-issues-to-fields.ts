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
 * The union-branch selection policy (limits, ranking, container descent) is the
 * one `formatZodIssue`'s STRING renderer applies (#4971/#5389, one directory
 * over in `shared/error-map.zod.ts`). The two walks stay separate
 * implementations on purpose — one renders indented prose lines, this one
 * produces structured `{field, code, message}` entries — but the *verdict*
 * (which branches explain a failure) must match, or one mistake gets two
 * different prescriptions depending on whether the author published from the
 * terminal or POSTed to the API (#5014).
 *
 * [#8318] That agreement used to rest on two copies of the ranking and a
 * module header asking whoever edits one to edit the other. It is now
 * structural: both walks import `../shared/union-branch-policy.ts`, and
 * `../shared/union-branch-policy.parity.test.ts` pins the two outputs over one
 * fixture corpus. ⛔ Do not re-declare the ranking, the limits or
 * `CONTAINER_ISSUE_CODES` in this file — what belongs here is the D3 code
 * table and the `{field, code, message}` shape, not which branch explains a
 * failure.
 */

import type { FieldErrorCode } from './errors.zod';
import { refusalHeadOf } from '../shared/refusal-head';
import {
    CONTAINER_ISSUE_CODES,
    NESTED_EXPANSION_DEPTH_LIMIT,
    selectUnionBranches,
} from '../shared/union-branch-policy';

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
 * [#35433] zod's own message for a failed union — the text a union head carries
 * when its schema declared no `error` of its own. {@link collectIssueFields}
 * drops an explained head only when its message is exactly this, so a head
 * carrying the schema's own sentence is never mistaken for filler.
 *
 * A literal, so the rule is only as good as its match with zod's current
 * wording: `zod-issues-to-fields.test.ts` pins this value against a real failed
 * union parse, so a zod upgrade that rewords the default fails that test instead
 * of silently turning the drop off. Exported for that pin only; the `/api`
 * barrel re-exports `zodIssuesToFields` alone.
 *
 * The same literal and the same predicate as `@objectstack/metadata-protocol`'s
 * `collectMetadataIssues` (#35400). They are two declarations rather than one
 * import because that package can reach only `@objectstack/spec`'s public
 * surface, and making this constant public is a contract decision neither card
 * made; `union-branch-policy.cross-package-parity.test.ts` holds the two walks
 * to the same drop instead.
 */
export const ZOD_UNION_DEFAULT_MESSAGE = 'Invalid input';

/**
 * One issue → its `fields[]` entries, appended to `out`.
 *
 * An ordinary issue is one entry. An `invalid_union` is followed by the entries
 * of the branches that explain it, with `field` resolved against the union's own
 * path — branch paths are relative to it.
 *
 * [#35433] The union's own entry — the head, `invalid_shape` — is DROPPED when
 * two things hold together: the expansion appended at least one entry, and the
 * head's message is exactly {@link ZOD_UNION_DEFAULT_MESSAGE}, zod's bare
 * default for a failed union. Such a head says nothing the entries below it do
 * not say better, so a refusal's `fields[]` holds located causes, read by
 * `field` and `code`, never by position — at every depth, so a root head and a
 * nested one go alike. The head is KEPT, ahead of what it explains, in every
 * other case:
 *
 * - nothing below explains it — every branch a bare kind mismatch, zod's
 *   "matched multiple" `errors: []`, or the depth bound reached — so it is the
 *   whole answer, and the only entry naming the slot the client sent;
 * - its message is the schema's own sentence (a union declared with an `error`).
 *   That sentence is a prescription, and it is often said nowhere else in the
 *   list, so dropping the head would drop the fix.
 *
 * This is the rule the metadata envelope took on #35400, by the maintainer's
 * ruling on #35433, so the two machine-read lists say the same thing about one
 * value. It reverses the "strictly additive" design #5014 shipped, under which
 * the head was always kept and only newly accompanied. The prose renderer
 * (`formatZodIssue`) still keeps every head, as the parent line of its indented
 * tree; `union-branch-policy.parity.test.ts` records that asymmetry.
 *
 * [#5389] An `invalid_key` / `invalid_element` descends the same way one
 * property name over: its own entry (zod's `"Invalid key in record"`, also
 * `invalid_shape`) followed by the entries on `issue.issues`, whose paths are
 * likewise relative. Two differences from a union: those issues are not
 * competing candidates, so they are NOT ranked or capped — every one of them is
 * a true statement about the value, and dropping any would be dropping a real
 * diagnosis rather than declining to guess; and the container's own entry is
 * always KEPT, because its code is the one place that says the KEY was refused
 * rather than the value under it.
 *
 * `seen` de-duplicates entries *within one top-level issue*: two branches that
 * reject the same key with the same words say it once. Expanded heads — union
 * and container alike — are exempt, since two same-path wrapper entries can
 * head genuinely different sub-trees.
 *
 * Deliberate divergence from the spec-side renderer: where it prints a trailing
 * "… and N more branches rejected this value", this emits nothing. That line is
 * a rendering affordance; a `fields[]` entry must name a real field and carry a
 * catalog code, and the omission note has neither. [#8318] Since the shared
 * policy computes the number either way, the divergence is now VISIBLE rather
 * than implicit: `selectUnionBranches` hands back `{selected, omitted}` and
 * this walk destructures `selected` alone, at the one line below — the wire
 * dropping `omitted` is a decision recorded in code, not an absence.
 */
function collectIssueFields(
    issue: any,
    parentPath: Array<string | number>,
    depth: number,
    seen: Set<string>,
    input: unknown,
    inputProvided: boolean,
    out: Array<{ field: string; code: FieldErrorCode; message: string; hint?: string }>,
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

    const message = String(issue?.message ?? 'Invalid value');
    // [#32279] A refusal that carries a one-line head (a retired query key or
    // aggregation, a refused comparand: `../shared/refusal-head.ts`) answers
    // the head as `message` and its whole prescription beside it as `hint`.
    // Every other issue maps exactly as before, with no `hint`.
    const head = refusalHeadOf(issue);
    const entry: { field: string; code: FieldErrorCode; message: string; hint?: string } = {
        field,
        // A non-array path keeps the pre-#5014 reading (`valueAtPath` bails and
        // the mapper stays conservative) instead of being coerced into one.
        code: zodIssueToFieldCode(issue, ownPathIsArray ? path : issue?.path, input, inputProvided),
        message: head ?? message,
        ...(head === undefined ? {} : { hint: message }),
    };

    if (!expandable) {
        const key = JSON.stringify([entry.field, entry.code, entry.message]);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(entry);
        return;
    }

    if (branches.length > 0) {
        // `omitted` is deliberately unread here — see the note above. The
        // renderer turns it into a trailing prose line; the wire has nowhere to
        // put a count that names no field.
        const { selected } = selectUnionBranches(branches);
        const below: Array<{ field: string; code: FieldErrorCode; message: string; hint?: string }> = [];
        for (const branch of selected) {
            for (const nested of branch) {
                collectIssueFields(nested, path, depth + 1, seen, input, inputProvided, below);
            }
        }
        // The head stays ahead of what it explains unless BOTH hold: something
        // below explains it, and it says nothing of its own (see the docblock).
        if (below.length === 0 || message !== ZOD_UNION_DEFAULT_MESSAGE) out.push(entry);
        out.push(...below);
        return;
    }

    out.push(entry);
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
 *
 * [#35433] That bare head is now dropped wherever an entry below explains it,
 * so `fields[0]` of such a refusal is the first located cause, not the
 * `invalid_shape` line. Read entries by `field` and `code`, never by index.
 */
export function zodIssuesToFields(
    issues: unknown,
    ...input: [] | [unknown]
): Array<{ field: string; code: FieldErrorCode; message: string; hint?: string }> {
    if (!Array.isArray(issues)) return [];
    const inputProvided = input.length > 0;
    const out: Array<{ field: string; code: FieldErrorCode; message: string; hint?: string }> = [];
    for (const issue of issues) {
        // A fresh `seen` per top-level issue: de-duplication is about one
        // union's branches agreeing, never about two independent issues.
        collectIssueFields(issue, [], 0, new Set<string>(), input[0], inputProvided, out);
    }
    return out;
}
