// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Live client-side Zod validation for metadata drafts.
 *
 * Unblocked by `@objectstack/spec@7.x` — the spec package now ships
 * per-metadata-type Zod schemas under its kernel/data/ui/automation/
 * ai/system subpaths, so we no longer have to wait for the next save
 * round-trip to learn the draft is invalid.
 *
 * Usage (from ResourceEditPage):
 *
 *   const { issues } = await validateMetadataDraft(type, draft);
 *   setIssues(issues);
 *
 * Schemas are loaded lazily — the first call for a given type kicks
 * off a dynamic `import()` of the relevant spec subpath, then caches
 * the result. Types we don't have a client-side schema for (e.g.
 * `validation`, `trigger`, `connector`, etc.) return an empty issue list;
 * the user still gets server-side diagnostics on save.
 */

import type { SchemaFormIssue } from './SchemaForm.js';
import { lintCelPredicate } from './celAuthoring.js';
import { readFields } from './previews/object-fields-io.js';

/**
 * The structural slice of a Zod issue this module reads.
 *
 * `code` and `errors` are optional so the `ZodLikeSchema` contract stays
 * satisfiable by anything shaped like a Zod schema; every real Zod 4 issue
 * carries `code`, and only `invalid_union` carries `errors`.
 */
type ZodLikeIssue = {
  path?: Array<string | number>;
  message: string;
  /** Zod 4 issue discriminator (`invalid_type`, `invalid_union`, …). */
  code?: string;
  /**
   * Present only on `invalid_union`: ONE issue group per union member, in the
   * union's own member order. Zod reports a union failure as a single root
   * issue and buries every member's real diagnostics here.
   */
  errors?: ZodLikeIssue[][];
  /**
   * Present only on `unrecognized_keys`: the offending key names, verbatim.
   * One issue carries EVERY unrecognized key of its object, so a legacy body
   * can list several retired aliases in a single `keys` array.
   */
  keys?: string[];
};

type ZodLikeSchema = {
  safeParse: (value: unknown) => {
    success: boolean;
    error?: { issues: ZodLikeIssue[] };
  };
};

/**
 * Which door a draft came through — the two are validated by different gates
 * (objectstack#5316).
 *
 *  - `create` — the draft is being AUTHORED in this admin. It is judged by the
 *    authoring schema, which is the strict one: a key the authoring contract
 *    does not declare is a mistake the author should see now.
 *  - `edit` — the draft is a body that came back OUT of storage. It is judged by
 *    the same WIRE schema the server's `saveMetaItem` runs, because the platform
 *    itself writes keys into stored bodies that the authoring contract has no
 *    reason to declare.
 *
 * Only `view` currently distinguishes the two; every other loader ignores the
 * mode and returns the one schema it has always returned.
 */
export type DraftMode = 'create' | 'edit';

type SchemaLoader = (mode: DraftMode) => Promise<ZodLikeSchema | undefined>;

/**
 * The `view` metadata type has TWO spec-declared shapes, and the backend serves
 * both (framework `objectql/engine.ts` registration; see the header of
 * `MetadataProvider.mergeViewsIntoObjects`):
 *
 *  - **ViewItem** (`ViewItemSchema`) — the first-class per-view record,
 *    `{ name: '<object>.<key>', object, viewKind, label, config }` (ADR-0017,
 *    "object has-many view"). This is what this admin AUTHORS: see `anchors.ts`
 *    `createBuildBody` and the `view-create-body.test.ts` guard.
 *  - **Container** (`ViewSchema`) — the aggregated
 *    `{ name, label, object, list, form, listViews, formViews }`, still served
 *    for records that were never expanded into ViewItems.
 *
 * This validator used to name only the container. That looked harmless because
 * the container was non-strict: a ViewItem's `viewKind` / `config` were silently
 * STRIPPED, so every draft this admin creates "passed" without one of its own
 * keys ever being checked. Spec 17.0.0 made the container strict, turning that
 * vacuous pass into a loud rejection — which is how `createConformance.test.ts`
 * surfaced it during the 17.0.0-rc.2 uptake.
 *
 * So dispatch on the record's own discriminant rather than guessing: `viewKind`
 * is what makes a record a ViewItem HERE — see {@link isViewItemDraft} for what
 * that does and does not say about the read side. This is NOT a
 * tolerant fallback — neither shape is coerced or waved through, each is checked
 * strictly against its own schema. Which of the two should be the single
 * authorable shape is a real open question, tracked in objectui#3312.
 */
/**
 * The `view` discriminant AS THE TWO GATES IN THIS FILE ASK IT — one place for
 * those two, and deliberately not a claim about anywhere else.
 *
 * Two sentences here used to say this was "the same test
 * `MetadataProvider.isViewItem()` applies on the read side". It is not, and had
 * not been for an unknown length of time. What the three parties actually read,
 * measured on the tree rather than inferred (objectui#8411):
 *
 *   this file, write side  `'viewKind' in value`  — `object` is never read
 *   `MetadataProvider.isViewItem`, read side
 *                          `!!view.viewKind && !!view.object`
 *   `@objectstack/spec` `ViewMetadataSchema`
 *                          a nested `config` marks the standalone ViewItem
 *                          record; its absence marks the flattened overlay
 *
 * Three different tests. This one is the widest of the three: it admits every
 * draft the read side admits and also a draft carrying `viewKind` with no
 * `object`, which the read side does not treat as a ViewItem.
 *
 * Nothing here reconciles them, on purpose. Which of the two shapes should be
 * the single authorable shape is a real open question tracked in objectui#3312,
 * and the difference belongs to that card, not to a comment.
 *
 * What IS local and does hold: both the create gate's schema dispatch
 * (`viewSchemaForDraft`) and the edit gate's union-diagnostic selection
 * (`viewUnionMemberIndex`) read this one function, so those two cannot drift
 * apart from each other.
 */
function isViewItemDraft(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'viewKind' in (value as object);
}

function viewSchemaForDraft(item: ZodLikeSchema, container: ZodLikeSchema): ZodLikeSchema {
  return {
    safeParse: (value: unknown) => (isViewItemDraft(value) ? item : container).safeParse(value),
  };
}

/**
 * ── Union-failure diagnostics for the `view` gates (objectui#3606, #3626, #3678) ──
 *
 * PRESENTATION ONLY. Nothing below can change a verdict: it runs strictly
 * inside the final issue→`SchemaFormIssue` mapping, after `ok` has already been
 * decided by the one gate (`ViewMetadataSchema` on edit, the authoring schemas
 * on create) and after every issue filter has run. Same input set, same `ok`;
 * only the rendered `path`/`message` move.
 *
 * Three rules live here. This first block is the ROOT rule (#3606, edit gate
 * only — neither authoring schema has a union at its root); the two NESTED
 * rules follow below — the content rule for `config.columns` (#3626) and the
 * sole-candidate rule (#3678). The two nested rules read disjoint cells of one
 * partition; `nestedUnionMemberIndex` states and proves that.
 *
 * The edit gate is `z.preprocess(stripViewConsoleDecorations, z.union([…]))`.
 * Zod reports a union failure as a SINGLE root issue — `code: 'invalid_union'`,
 * `path: []`, `message: 'Invalid input'` — and buries each member's real
 * diagnostics in `issue.errors`, one group per member, in member order. Mapping
 * that root issue literally is what collapsed every field-level diagnostic on
 * the edit path into one un-addressable "Invalid input": `SchemaForm` highlights
 * by `path` and Monaco locates by `path`, so an empty path points at nothing,
 * and the guided messages the spec wrote for these rejections (objectstack-ai/objectstack#4001) never
 * reached the user.
 *
 * Selection is by the draft's OWN discriminant — the same `isViewItemDraft` the
 * create gate dispatches on — never by a heuristic over the groups. "Fewest
 * issues / deepest path" was measured and picks wrong: for a container carrying
 * an unknown key, the ViewItem group reports a deeper `viewKind` discriminator
 * error that is the wrong message entirely. We show ONLY the selected member's
 * issues; showing all four would put "this is not a container" in front of
 * someone editing a ViewItem.
 *
 * Measured member layout of `ViewMetadataSchema`'s union (@objectstack/spec
 * 17.0.0-rc.5):
 *
 *   [0] `ViewItemWireSchema`  — the stored ViewItem record (itself a
 *       discriminated union on `viewKind`; a valid discriminator resolves
 *       straight through, so its issues arrive flat and field-addressed).
 *   [1] the aggregated container — same shape as the exported `ViewSchema`.
 *   [2] flattened list-view overlay.
 *   [3] flattened form-view overlay.
 *
 * This indexes members POSITIONALLY, which couples to a spec-internal detail.
 * That coupling is deliberate and it is guarded, not hoped for: reading the
 * groups the failing gate itself produced is the only way the diagnostics
 * cannot describe a schema other than the one that judged. The alternative —
 * re-parsing with the exported member schemas — was measured and rejected: the
 * container member is NOT the exported `ViewSchema` object (equal shape today,
 * a resemblance maintained by hand), and a re-parse would also have to
 * re-apply `stripViewConsoleDecorations` itself, reconstructing the spec's
 * pipeline composition in a second place that can drift. The positional read
 * is pinned by the CANARY tests in `clientValidation.viewDiagnostics.test.ts`:
 * they assert the selected member's exact `path` + `message` for known bodies,
 * so reordering, adding or removing a union member turns them red instead of
 * silently mis-selecting.
 */
const VIEW_UNION_MEMBERS = { wireItem: 0, container: 1 } as const;

function viewUnionMemberIndex(draft: unknown): number {
  return isViewItemDraft(draft) ? VIEW_UNION_MEMBERS.wireItem : VIEW_UNION_MEMBERS.container;
}

/**
 * ── NESTED unions: the array-variant rule (objectui#3626) ──
 *
 * #3606 expanded the union at the ROOT only. `config.columns` is a union too —
 * `string[] | ColumnDef[]`, no discriminant — and it collapsed the same way, on
 * BOTH gates: create reported `config.columns` / `Invalid input` as a top-level
 * issue, edit reported it one level down inside the selected root member. The
 * user was taken to the right field and told nothing about it: not which
 * column, not which key, not what was expected.
 *
 * The discriminant here is the value's OWN CONTENT, which is the same class of
 * rule as the root's `viewKind` — a fact about what the author wrote, not a
 * comparison across error groups. A `columns` array is a list of field NAMES or
 * a list of column OBJECTS, and its first element says which. ("Fewest issues /
 * deepest path" remains banned: it ranks the groups against each other, and
 * #3606 measured it picking wrong.)
 *
 * Applying that naively to every nested union would mis-select, so the rule is
 * narrowed to unions that really are "an array of A or an array of B". Measured
 * over the whole `view` family (@objectstack/spec 17.0.0-rc.5), 16 nested
 * discriminant-less unions exist and `columns` is the only one whose members
 * are BOTH arrays. The neighbour that would break a naive rule is `config.sort`
 * (`string | ColumnSort[]`): for `sort: ['name']` the first element is a string,
 * so first-element-typeof alone would select the plain-`string` member and
 * report "expected string, received array" — technically true, and the wrong
 * thing to say to someone who correctly wrote an array. So a member that
 * rejected the value's TYPE at the union node itself (a bare `invalid_type` at
 * its own relative root) is not a candidate: it never looked at the contents,
 * so contents cannot be evidence for it. That single categorical test — asked
 * of each group on its own, never group-vs-group — is what keeps `sort`,
 * `filter[].value`, `gantt.tooltipFields[]` and the rest out of THIS rule.
 * (It kept them collapsed entirely until #3678, which reads the same test as a
 * census and answers the unions where it leaves exactly one member standing.
 * The narrowing above is unchanged and still load-bearing: delete the
 * `groups.some(memberRejectedNodeType)` line and the content rule elects the
 * plain-`string` member for `sort: ['name']` again.)
 *
 * Boundaries, all measured rather than assumed:
 *
 *  - `columns: []` is VALID under both members, so the empty array never
 *    reaches this code — the union succeeds and there is no issue to expand.
 *    The "what do we do with an empty array" question is structurally moot.
 *  - `columns: [42]` / `[null]` — the first element names neither variant, so
 *    nothing is selected and the node keeps Zod's own message. Both members
 *    reject it identically anyway; picking one would be inventing a preference.
 *  - `columns: 'nope'` — not an array, nothing to discriminate on. (Both
 *    members do agree here, but "all members said the same thing so promote it"
 *    is a different mechanism — issue #3626's direction 1 — not this one.)
 *  - Mixed arrays are the interesting case and they come out right: for
 *    `['name', {field: 1}]` the first element elects `string[]`, which reports
 *    `config.columns.1` — the element that actually broke the list the author
 *    was writing — instead of the object member's two rejections of the shape
 *    they never chose.
 *
 * Like the root rule this indexes members POSITIONALLY and is pinned the same
 * way: the CANARY tests assert the exact `path` + `message` of the selected
 * member, so a spec-side reorder of the `columns` union's two members goes red
 * instead of silently reporting the other variant's complaint.
 */
const ARRAY_VARIANT_MEMBERS = { ofStrings: 0, ofObjects: 1 } as const;

/**
 * Did this member reject the value's TYPE at the union node itself, without
 * ever looking at its contents? Asked of one group in isolation — never
 * group-vs-group — so it is a categorical fact about one member, not a ranking.
 *
 * This single test is the basis of BOTH nested rules (see
 * `nestedUnionMemberIndex`): #3626 uses it to decide which unions the content
 * rule may speak about, #3678 counts it to find a union with exactly one
 * candidate. A member that answers `true` here never read the value, so nothing
 * about the value can be evidence for or against it.
 *
 * Only `invalid_type` counts, and objectui#3694 MEASURED that this is the right
 * line rather than an implementation detail that leaked into the semantics.
 *
 * Zod answers `invalid_value` — not `invalid_type` — whenever an enum or a
 * literal rejects, whatever the input's type. Across the whole `view` family
 * exactly two union sites ever produce `invalid_value` at a member's own root:
 * `columns[].summary` (`enum | {type, field}`) and `sections[].columns`
 * (`enum | 1 | 2 | 3 | 4`). Widening this predicate to count `invalid_value`
 * as a node-level rejection was measured over 51 shapes and is NOT an
 * improvement — it is a TRADE on one union:
 *
 *   summary is an OBJECT (`{type:'bogus'}`, `{}`, `{type,field}`)
 *     today k=2 → collapsed `…summary` / `Invalid input`
 *     widened k=1 → `…summary.type` / the option list          ← 5 shapes GAINED
 *   summary is a non-enum SCALAR (`42`, `true`, `null`, `[]`, `['count']`, …)
 *     today k=1 → the enum is the sole candidate, `…summary` / the option list
 *     widened k=0 → `…summary` / `Invalid input`               ← 8 shapes LOST
 *
 * The loss includes the #3678 CANARY `summary: 'bogus'`. A type-aware variant
 * (categorical only when no allowed literal shares the value's `typeof`) was
 * measured too and merely re-cuts the same trade: 6 gained, 6 lost. So neither
 * qualification of `invalid_value` dominates, and #3694 declined both. Both
 * directions are pinned in the test file's #3694 block, so an attempt to widen
 * this predicate goes red on the shapes it would damage instead of shipping
 * them silently — four of them are pinned nowhere else.
 *
 * Measured with the same run: widening cannot move the CONTENT rule's reach at
 * all. That rule needs two members AND a non-empty array value, and at the one
 * shape satisfying both (`summary: ['count']`) the object member answers
 * `invalid_type`, so `groups.some(memberRejectedNodeType)` is already true and
 * stays true. The whole question lives in the sole-candidate rule.
 *
 * The contract-first fix remains spec-side (objectstack#6391): a union that
 * declares its own discriminant needs none of this census.
 */
function memberRejectedNodeType(group: ZodLikeIssue[]): boolean {
  return group.some((i) => i.code === 'invalid_type' && (i.path ?? []).length === 0);
}

/** Read the draft value a union node's absolute path addresses, or `undefined`. */
function valueAtPath(draft: unknown, path: Array<string | number>): unknown {
  let cursor: unknown = draft;
  for (const seg of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string | number, unknown>)[seg];
  }
  return cursor;
}

/**
 * The `array<A> | array<B>` rule described above. Returns the member index the
 * value's first element elects, or `null` when this union is not of that shape
 * or the content elects nothing.
 *
 * The value is read from the ORIGINAL draft while the paths come from a parse
 * of the PREPROCESSED one. That is exact for this purpose, measured rather than
 * assumed: `stripViewConsoleDecorations` only deletes `id` keys from `filter` /
 * `sort` rows — it maps arrays element-wise and never reorders or drops one, so
 * no index a path carries can shift.
 */
function arrayVariantMemberIndex(groups: ZodLikeIssue[][], value: unknown): number | null {
  if (groups.length !== 2) return null;
  if (!Array.isArray(value) || value.length === 0) return null;
  if (groups.some(memberRejectedNodeType)) return null;
  const first = value[0];
  if (typeof first === 'string') return ARRAY_VARIANT_MEMBERS.ofStrings;
  if (first !== null && typeof first === 'object' && !Array.isArray(first))
    return ARRAY_VARIANT_MEMBERS.ofObjects;
  return null;
}

/**
 * ── NESTED unions: the sole-candidate rule (objectui#3678) ──
 *
 * #3626's narrowing left a gap, and #3678 is that gap: when the categorical
 * test above leaves EXACTLY ONE member standing, naming it is not a heuristic
 * and not a preference — it is the only member that ever read the value, so it
 * is the only member whose complaint can be about what the author wrote. The
 * other members objected to the value's TYPE and stopped there; showing their
 * complaints would describe a shape the author never chose.
 *
 * `config.sort` (`string | ColumnSort[]`) is the case that motivated it. For
 * `sort: [{field: 'n', order: 'bogus'}]` the plain-`string` member rejects the
 * array outright and the `ColumnSort[]` member reports
 * `[0].order` / `Invalid option: expected one of "asc"|"desc"` — the spec's own
 * guided message (objectstack-ai/objectstack#4001), which until now was thrown away and rendered as
 * `config.sort` / `Invalid input`.
 *
 * This rule does NOT index members positionally: the index is derived from the
 * census of the groups the failing gate itself produced, so a spec-side reorder
 * of a union's members cannot mis-select. What a spec change CAN do is move a
 * union between cells — adding a third `sort` member that also accepts arrays
 * would take the census from one candidate to two and collapse the node back to
 * `Invalid input`. That is why the #3678 anchors pin exact paths + messages:
 * the loss shows up as a red test rather than as a quietly worse message.
 *
 * Reach, measured over the `view` family rather than assumed — this is WIDER
 * than issue #3678 estimated. #3678's "范围" paragraph expected only
 * scalar-or-array two-member unions such as `sort` to be reachable, and read
 * `filter[].value` / `sections[].fields[]` as rejecting wholesale. They do
 * reject wholesale for a scalar value, but not for an ARRAY value, where the
 * array member is the sole candidate:
 *
 *   `filter[0].value: [{}]`        → `config.filter.0.value.0` (was `…value`)
 *   `sections[0].fields: [{}]`     → `config.sections.0.fields.0.field`
 *   `columns[0].summary: 'bogus'`  → same path, now the enum's option list
 *
 * All three are strict improvements — a nearer path, or a named expectation
 * instead of `Invalid input` — and each is pinned below. Two of them supersede
 * NARROWING pins #3626 wrote (see the test file's #3678 block); those pins were
 * asserting that no rule spoke there, which is exactly what this rule changes.
 */
function soleTypeAcceptingMember(groups: ZodLikeIssue[][]): number | null {
  let sole: number | null = null;
  for (let i = 0; i < groups.length; i++) {
    if (memberRejectedNodeType(groups[i])) continue;
    if (sole !== null) return null; // two or more candidates — ambiguous, not ours
    sole = i;
  }
  return sole; // stays `null` when every member rejected the type
}

/**
 * The two NESTED rules, and the relationship between them.
 *
 * Census the members with `memberRejectedNodeType` and let `k` be how many
 * ACCEPTED the value's type. That single number partitions every nested union
 * into three cells, and the two rules live in different ones:
 *
 *   k === 1                 → #3678 names the sole candidate.
 *   k === groups.length      → every member read the value, so the value's own
 *     (i.e. k === 0 rejected)  CONTENT decides — #3626's `array<A> | array<B>`
 *                              rule, which declines unless the union really is
 *                              of that shape.
 *   otherwise (k === 0, or  → no rule. Nothing about the value distinguishes
 *    0 < k < groups.length     the members, and #3626 already ruled that
 *    with k !== 1)             inventing a preference is not ours to do.
 *
 * So they cannot both want to select: `k === 1` and `k === groups.length`
 * coincide only at `groups.length === 1`, a one-member "union" the schema does
 * not produce — and even there both rules agree on index 0, since #3626's rule
 * requires `groups.length === 2` and returns `null`. The content rule is NOT a
 * special case of the sole-candidate rule and the sole-candidate rule is NOT a
 * fallback for it; they answer different questions in disjoint cells. #3678's
 * dispatch asked for this to be measured before implementing, and it was: the
 * census in the test block below covers every nested union shape the `view`
 * family produces, and no shape lands in two cells.
 *
 * Order below is therefore unobservable while both guards hold — and it is
 * written content-first ON PURPOSE, so that #3626's narrowing guard stays the
 * thing that fails when it is removed. Deleting
 * `if (groups.some(memberRejectedNodeType)) return null;` from
 * `arrayVariantMemberIndex` still resurrects the exact `sort` mis-selection
 * #3626 measured, and the #3678 sort anchor goes red on it. Hoisting that guard
 * into this function would have made it dead code.
 */
function nestedUnionMemberIndex(groups: ZodLikeIssue[][], value: unknown): number | null {
  const byContent = arrayVariantMemberIndex(groups, value);
  if (byContent !== null) return byContent;
  return soleTypeAcceptingMember(groups);
}

/**
 * Pick the union member whose issues should be shown for one `invalid_union`,
 * or `null` for "nothing better than the union node's own message".
 *
 * `absPath` is the union node's DRAFT-ABSOLUTE path — the root union's is `[]`,
 * which is what selects between the two rules. A member issue's own `path` is
 * relative to its union node, which is why the caller composes prefixes on the
 * way down instead of trusting `issue.path` to be absolute below the root.
 */
function selectViewUnionGroup(
  issue: ZodLikeIssue,
  absPath: Array<string | number>,
  draft: unknown,
): ZodLikeIssue[] | null {
  if (issue.code !== 'invalid_union') return null;
  const groups = issue.errors;
  if (!Array.isArray(groups)) return null;
  const index =
    absPath.length === 0
      ? viewUnionMemberIndex(draft)
      : nestedUnionMemberIndex(groups, valueAtPath(draft, absPath));
  if (index === null) return null;
  const group = groups[index];
  if (!Array.isArray(group) || group.length === 0) return null;
  return group;
}

/**
 * Rewrite a `view` gate's issues into draft-absolute, field-addressed ones.
 *
 * Every issue is emitted with `prefix ++ issue.path`; a union whose member the
 * rules above can name is replaced by that member's issues, recursively, with
 * the union node's own path becoming their prefix. A union no rule can speak
 * for is emitted unchanged — which is the pre-#3606 behaviour, so nothing can
 * be lost. Each expansion descends into strictly-contained sub-issues of a
 * finite tree and only ever yields a non-empty group, so this terminates and a
 * rejected draft always renders at least one issue.
 *
 * There is no depth counter, and #3678 is why there must not be one: the
 * descent is bounded by the rules having nothing to say, not by a level count.
 * A union whose members ALL rejected the value's type ends it — nothing
 * distinguishes them — and so does one where two or more members read the value
 * but the content rule declines. Measured examples of each bound:
 *
 *  - `columns[0].summary` (`enum | {type, field}`) handed an OBJECT: both
 *    members read it, the content rule declines a non-array, descent stops with
 *    Zod's own message now addressed to `config.columns.0.summary`.
 *  - `filter[0].value: [{}]` descends TWO levels — the array member is the sole
 *    candidate, and the element union beneath it is rejected by every member —
 *    ending at `config.filter.0.value.0`. Before #3678 the claim here was "in
 *    the measured schema that is exactly one nested level"; that was true only
 *    while the content rule was the only nested rule, and it is now false.
 */
function expandViewIssues(
  issues: ZodLikeIssue[],
  prefix: Array<string | number>,
  draft: unknown,
): ZodLikeIssue[] {
  return issues.flatMap((issue) => {
    const absPath = [...prefix, ...(issue.path ?? [])];
    const group = selectViewUnionGroup(issue, absPath, draft);
    if (!group) return [{ ...issue, path: absPath }];
    return expandViewIssues(group, absPath, draft);
  });
}

/**
 * ── Author-shape-only types (objectui#3561) ──
 *
 * A spec schema is usable as an EDIT gate only if it declares the ADR-0010
 * protection envelope — `_lock` / `_lockReason` / `_lockSource` / `_provenance`
 * / `_packageId` / `_packageVersion` / `_lockDocsUrl`. A stored body carries
 * those keys: the metadata read path stamps `_packageId` onto any item served
 * out of a package-owned overlay row, and it does so WITHOUT looking at the
 * type. Judging such a body with a `.strict()` schema that does not declare the
 * envelope makes this client stricter than the server — the objectstack#5316
 * inversion the `view` gates above exist to avoid.
 *
 * ── The original reason has EXPIRED. The boundary has NOT. (objectui#6982) ──
 *
 * This block used to read: measured on `@objectstack/spec` 17.0.0-rc.5,
 * `SharingRuleSchema` declares NONE of the 7 envelope keys and is `.strict()`,
 * so it is the one shape that must not judge a stored body. The contract-first
 * repair it was waiting for LANDED. Re-measured on the resolved spec 17.2.0,
 * `SharingRuleSchema` declares all 7 (`_lock`, `_lockReason`, `_lockSource`,
 * `_provenance`, `_packageId`, `_packageVersion`, `_lockDocsUrl`) — envelope
 * keys MISSING: none. A `_packageId`-stamped body is legal input now, and
 * `clientValidation.optOuts.test.ts` already pins the create door accepting it.
 *
 * ⛔ That does NOT make this opt-out removable, and the next person to re-read
 * the envelope and conclude it does should read the measurement below first.
 *
 * A served body carries more than the envelope. The metadata read path
 * DECORATES every item it serves with `_diagnostics` (`decorateMetadataItem`,
 * whenever the type has a registered Zod schema — `sharing_rule` has one), and
 * the spec names that key a READ DECORATION precisely so it is *not* allowlisted
 * the way the envelope is: `kernel/metadata-read-decorations.ts` states that a
 * served body "is therefore NOT a valid input to the schema that produced it
 * until these are removed". `SharingRuleSchema` is still `.strict()`, so it
 * rejects our own annotation with `unrecognized_keys` at the ROOT — a path
 * length the `serverSchema.required` root-cure below cannot reach (it only
 * suppresses ABSENT top-level fields, `path.length === 1`).
 *
 * Measured on the real read path (objectstack protocol over a real engine —
 * save, then read back):
 *
 *   GET .../sharing_rule/:name            item keys += `_diagnostics`  -> REJECT
 *   GET .../sharing_rule/:name?state=draft item keys += `_diagnostics` -> REJECT
 *   layered `effective` (RAW, undecorated)                             -> ACCEPT
 *
 * `ResourceEditPage` builds its edit draft as `{...layered.effective,
 * ...client.getDraft().item}` and strips nothing — so for any sharing rule with
 * a PENDING DRAFT the gate would report a body the server accepts as broken.
 * The server, by contrast, strips read decorations on the way in and never
 * re-parses stored rows through this registry at all. That is the
 * objectstack#5316 inversion wearing a different key, and it is the same defect
 * class the framework has already paid for twice (a served `_diagnostics` 400ing
 * every saved dataset; the cold-boot flow bind, cloud#971).
 *
 * So the type stays wired on `create` — the AUTHORING door, which is exactly
 * where a permissive match-all sharing condition gets written — and deliberately
 * not on `edit`. This is NOT a tolerant fallback: nothing is coerced and no
 * draft is waved through; one door has a client gate and the other keeps the
 * server's.
 *
 * ── The ingress condition was MET, and the answer was still no (the 2026-09-20 ruling) ──
 *
 * This block used to end on a plan: switch the edit gate on once the
 * `_diagnostics` ingress is closed where the draft is assembled (not here —
 * reconstructing the decoration list in this file would be a second de-facto
 * contract), and not before, since until then a gate here would refuse
 * legitimate author input. That condition was met. objectui#7603 stripped the
 * read decorations off the pending draft, and objectui#8181 hoisted the strip
 * into `extractDraftBody`, which removes the spec's own list through the spec's
 * `stripReadDecorations` before the pending draft is merged. So the
 * `getDraft().item` assembly quoted above is the edit path as objectui#6982
 * measured it, not as it stands; for the live answer read
 * `ResourceEditPage.readDecorationStrip.test.tsx`, not this paragraph.
 *
 * The switch was then put to the maintainer on its own card, with the met
 * condition measured on that card and a finished implementation beside it
 * (PR objectui#10054). The maintainer ruled option A on 2026-09-20 (restated on
 * objectui#10150), verbatim 「7612 只需要服务端校验」 ("7612 needs server-side
 * validation only"): the edit door stays ungated, because the server is
 * authoritative on it and that is enough. The PR closed unmerged. The create
 * door was not in question and keeps its client gate.
 *
 * ⇒ A closed ingress is NOT a reason to take `sharing_rule` out of this set:
 * that question was asked with the condition already met, and answered. Only a
 * new maintainer ruling re-opens it, never a re-reading of the ingress.
 */
const AUTHOR_SHAPE_ONLY_TYPES = new Set<string>(['sharing_rule']);

// Map metadata-type name → loader for that type's root Zod schema.
// Each loader pulls only one spec subpath so we don't drag the whole
// 2MB schema bundle into the studio bundle.
//
// Types still falling through to server-only validation:
//   - `validation`: not a top-level metadata file; lives inside object. (DataValidationRuleSchema
//     exists but has empty shape, so it's not useful for client validation.)
//   - `policy`: spec 11.2.0 (PR #2078) removed the generic `PolicySchema` (the org-wide
//     password/network/session/audit policy) from `@objectstack/spec/security`, and the
//     canonical metadata-type→schema registry (spec kernel/metadata-type-schemas.ts) has
//     no `policy` entry — so there is no client schema. `RowLevelSecurityPolicySchema`
//     remains on /security but is a different shape (a per-object RLS rule), NOT the
//     `policy` metadata file, so it must not be substituted.
//   - `trigger`: no standalone TriggerSchema export at runtime (only
//     ConnectorTriggerSchema / WebhookEventSchema variants).
//
// `sharing_rule` / `translation` / `connector` used to be on that list too. All
// three reasons were re-verified against the resolved spec and none held —
// objectui#3561; each is now wired below with the measurement that replaced it.
const LOADERS: Record<string, SchemaLoader> = {
  // data
  object: async () => (await import('@objectstack/spec/data')).ObjectSchema as unknown as ZodLikeSchema,
  hook: async () => (await import('@objectstack/spec/data')).HookSchema as unknown as ZodLikeSchema,
  mapping: async () => (await import('@objectstack/spec/data')).MappingSchema as unknown as ZodLikeSchema,
  analytics_cube: async () => (await import('@objectstack/spec/data')).CubeSchema as unknown as ZodLikeSchema,

  // ui
  //
  // `view` is the one type whose two doors need two gates (objectstack#5316).
  //
  // CREATE — the authoring gate, unchanged: `viewSchemaForDraft` dispatches on
  // the record's own `viewKind` discriminant to `ViewItemSchema` (what
  // `createBuildBody` emits) or `ViewSchema` (the container). objectstack-ai/objectstack#5074 made these
  // strict on purpose and this admin's create path passes them cleanly.
  //
  // EDIT — the WIRE gate. The editor opens a body that came back out of
  // `sys_metadata`, and a stored view body carries keys the PLATFORM wrote:
  // `isPinned` (the view switcher's pin action, `ObjectView.tsx:882`),
  // `sortOrder` (the reorder write, `ObjectView.tsx:931`), and — nested —
  // the console filter/sort builders' per-row `id`. `updateView` GETs the
  // stored item and PUTs `{ ...current, ...partial }`; `saveMetaItem` persists
  // the accepted body verbatim (ADR-0005 §Validation). So the server ACCEPTS
  // this body — it validates against `ViewMetadataSchema` — while the authoring
  // gate rejects it. Judging a stored body by the authoring schema made the
  // client strictly stricter than the server; that is the inversion objectstack-ai/objectstack#5316 fixes.
  //
  // Why `ViewMetadataSchema` and not the narrower `ViewItemWireSchema`, which
  // also declares `isPinned`/`sortOrder`: two measured reasons.
  //   1. It is the schema the `view` metadata type registers, i.e. literally
  //      the one `saveMetaItem` runs — so client and server accept the same
  //      set by construction rather than by a maintained resemblance.
  //   2. `ViewItemWireSchema` covers only the ViewItem record. It rejects the
  //      container and the flattened overlay, and — measurably — still rejects
  //      `config.filter[].id` with `unrecognized_keys`, because that decoration
  //      is stripped by `ViewMetadataSchema`'s `z.preprocess`, which runs ahead
  //      of every union member and reaches nested blocks a member-level
  //      `.strip()` cannot.
  //
  // NOT a "try both, pass if either passes" fallback: each mode has exactly ONE
  // gate and a rejection is final. The last pins in
  // `clientValidation.viewShapes.test.ts` guard that.
  view: async (mode) => {
    const { ViewItemSchema, ViewSchema, ViewMetadataSchema } = await import('@objectstack/spec/ui');
    if (mode === 'edit') return ViewMetadataSchema as unknown as ZodLikeSchema;
    return viewSchemaForDraft(
      ViewItemSchema as unknown as ZodLikeSchema,
      ViewSchema as unknown as ZodLikeSchema,
    );
  },
  page: async () => (await import('@objectstack/spec/ui')).PageSchema as unknown as ZodLikeSchema,
  app: async () => (await import('@objectstack/spec/ui')).AppSchema as unknown as ZodLikeSchema,
  dashboard: async () => (await import('@objectstack/spec/ui')).DashboardSchema as unknown as ZodLikeSchema,
  report: async () => (await import('@objectstack/spec/ui')).ReportSchema as unknown as ZodLikeSchema,
  action: async () => (await import('@objectstack/spec/ui')).ActionSchema as unknown as ZodLikeSchema,
  // `theme` is intentionally absent. It was never a registered metadata type,
  // so metadata-admin never asks for it — and the spec retired the whole
  // `ui/theme.zod.ts` module (objectstack `35ad101bc`), so the
  // `ThemeSchema` the old entry read off this subpath is gone upstream. Nothing
  // here ever went red because objectui's own `@objectstack/spec` pin (17.1.0)
  // still publishes that symbol: the entry type-checked and resolved, and would
  // simply have degraded to a silent no-op validator (`getSchemaForType`'s
  // `safeParse` duck-check) on the first bump past the retirement. Do not
  // re-add it from the spec — a metadata-admin theme editing surface is a
  // capability decision of its own (objectui#5715).

  // automation
  flow: async () => (await import('@objectstack/spec/automation')).FlowSchema as unknown as ZodLikeSchema,
  // `workflow` is no longer a standalone metadata type (ADR-0020) — record
  // state machines are a `state_machine` validation rule on the object,
  // validated as part of ObjectSchema; there is no top-level workflow schema.
  // `approval` is no longer a standalone metadata type — it's a flow node
  // (`type: 'approval'`, ADR-0019). Its config (ApprovalNodeConfigSchema) is
  // validated as part of the enclosing flow; there is no top-level schema, so
  // it falls through to server-side validation.
  webhook: async () => (await import('@objectstack/spec/automation')).WebhookSchema as unknown as ZodLikeSchema,

  // ai
  agent: async () => (await import('@objectstack/spec/ai')).AgentSchema as unknown as ZodLikeSchema,
  tool: async () => (await import('@objectstack/spec/ai')).ToolSchema as unknown as ZodLikeSchema,
  skill: async () => (await import('@objectstack/spec/ai')).SkillSchema as unknown as ZodLikeSchema,

  // system
  // NOTE: `EmailTemplateDefinitionSchema`, NOT the removed `EmailTemplateSchema`.
  // The `email_template` metadata kind has resolved to the Definition schema
  // since spec 7.1.0 (`BUILTIN_METADATA_TYPE_SCHEMAS` in
  // `kernel/metadata-type-schemas.ts` is the authority); `EmailTemplateSchema`
  // survived only as an inline sub-shape of the old `Notification` holder and
  // was deleted with it in objectstack#4610 / objectstack-ai/objectstack#4616. So this validator was
  // checking authored templates against the WRONG contract — `name` + `locale`
  // and `bodyHtml` / `bodyText`, not `id` and `body` + `bodyType`.
  email_template: async () => (await import('@objectstack/spec/system')).EmailTemplateDefinitionSchema as unknown as ZodLikeSchema,
  job: async () => (await import('@objectstack/spec/system')).JobSchema as unknown as ZodLikeSchema,
  // NOTE: `TranslationItemSchema`, NOT `TranslationBundleSchema` — the same
  // wrong-schema class this file already paid for once on `email_template`
  // above (objectui#3561).
  //
  // The old note said "TranslationBundleSchema is z.object({}) — accepts
  // anything". On the resolved spec 17.0.0-rc.5 that schema is
  // `z.record(LocaleSchema, TranslationDataSchema)` — the BUNDLE shape, a map
  // keyed by locale — and it is not lenient at all: it REJECTS a valid
  // translation item, reporting `expected object, received string` on `name`,
  // `locale` and `label`. So the stale reason was wrong twice over, and had the
  // schema been wired on that reasoning it would have flagged every valid
  // draft.
  //
  // `translation` is a registered metadata KIND, so the resolved spec can be
  // asked directly which schema it binds: `getMetadataTypeSchema('translation')`
  // (`@objectstack/spec/kernel`) answers a strict object whose shape is exactly
  // `TranslationItemSchema`'s 19 keys — the translation-data shape plus
  // `locale` / `name` / `label` and all 7 ADR-0010 envelope keys. That parity is
  // asserted in `clientValidation.optOuts.test.ts` so the binding cannot drift
  // out from under this line unnoticed.
  translation: async () => (await import('@objectstack/spec/system')).TranslationItemSchema as unknown as ZodLikeSchema,

  // security
  // NOTE: use PermissionSetSchema from /security, NOT PluginPermissionSchema from /kernel —
  // the kernel one is the plugin-sandbox permission ({id,resource,actions}), not the
  // metadata permission set ({name,objects,fields}). See
  // packages/spec/src/kernel/metadata-type-schemas.ts for the canonical mapping.
  permission: async () => (await import('@objectstack/spec/security')).PermissionSetSchema as unknown as ZodLikeSchema,
  // The old note said `SharingRuleSchema` "is declared but has empty shape".
  // On the resolved spec 17.0.0-rc.5 it is `CriteriaSharingRuleSchema` — a
  // `.strict()` object declaring nine keys (`name`, `label`, `description`,
  // `object`, `active`, `accessLevel`, `sharedWith`, `type`, `condition`) with
  // a curated unknown-key error map. Not empty, and the same shape
  // `ObjectStackSchema.sharingRules` binds element-wise.
  //
  // CREATE ONLY — see `AUTHOR_SHAPE_ONLY_TYPES` above for why this shape may
  // not judge a stored body.
  sharing_rule: async () => (await import('@objectstack/spec/security')).SharingRuleSchema as unknown as ZodLikeSchema,
  // `policy` intentionally omitted — spec 11.2.0 dropped `PolicySchema` and the metadata-type
  // registry has no `policy` schema; drafts fall through to server-side validation (see top).
  // `profile` intentionally omitted — ADR-0090 D2 removed the profile concept (spec 13);
  // `role` is likewise gone, renamed to `position` (ADR-0090 D3).

  // identity
  position: async () => (await import('@objectstack/spec/identity')).PositionSchema as unknown as ZodLikeSchema,

  // api
  api: async () => (await import('@objectstack/spec/api')).ApiEndpointSchema as unknown as ZodLikeSchema,

  // integration
  //
  // NOTE: `DeclarativeConnectorEntrySchema`, NOT the bare `ConnectorSchema`.
  //
  // The old note claimed `ConnectorSchema` "requires an `id` field that's not
  // in the on-disk metadata shape" and that wiring it "would flag every valid
  // connector definition". On the resolved spec 17.0.0-rc.5 there is no `id`
  // key in that schema at all: its required keys are `name`, `label`, `type`,
  // and a minimal `{ name, label, type: 'saas' }` entry parses clean.
  //
  // But `ConnectorSchema` is still the wrong target, for the reason the spec's
  // `DeclarativeConnectorEntrySchema` docblock states: the base is the shape
  // shared with connector defs a plugin builds at runtime, while
  // `DeclarativeConnectorEntrySchema` is that base plus the ADR-0097 rules that
  // apply to a connector AUTHORED in a stack — which is what this admin writes.
  // `ObjectStackSchema.connectors` binds the entry schema element-wise.
  //
  // Measured difference on rc.5 — each of these is ACCEPTED by `ConnectorSchema`
  // and REJECTED by the entry schema, so naming the base would have been a
  // vacuous pass on exactly the authoring mistakes ADR-0097 exists to catch:
  //   - `providerConfig` without a `provider` (§meaningless on a descriptor);
  //   - `auth` without a `provider`;
  //   - a provider-bound instance inlining credentials via `authentication`
  //     rather than referencing them (§3);
  //   - a provider-bound instance authoring `actions` the provider derives (§5).
  // The rules fire only for provider-bound instances, so a catalog descriptor
  // is unaffected. Unlike the two above this schema is NOT strict — unknown keys
  // are stripped, not rejected — so it judges a stored body safely and is wired
  // on both gates.
  connector: async () =>
    (await import('@objectstack/spec/integration'))
      .DeclarativeConnectorEntrySchema as unknown as ZodLikeSchema,
};

/**
 * Field conditional-rule keys validated as CEL predicates (ADR-0036 B2,
 * objectui#1582). The spec's Zod only checks the SHAPE (`string | envelope`);
 * a syntactically broken predicate round-trips fine and then silently
 * fail-opens at runtime, so we lint the CEL here — the same
 * `@objectstack/formula` verdict the field inspector's editor shows live.
 */
const FIELD_RULE_KEYS = ['visibleWhen', 'readonlyWhen', 'requiredWhen'] as const;

/** Extract a predicate's CEL source from either wire shape (string | envelope). */
function predicateSource(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { source?: unknown }).source === 'string') {
    // Only lint envelopes that are (implicitly) CEL — a non-CEL dialect is the
    // engine's own error to raise, not ours to mis-lint as CEL.
    const dialect = (v as { dialect?: unknown }).dialect;
    if (dialect === undefined || dialect === 'cel') return (v as { source: string }).source;
  }
  return null;
}

/**
 * Lint every field conditional rule — and every `formula` field's
 * `expression` (role `value`, objectui#1582 follow-up) — on an object draft.
 * Runs with `scope: 'record'` (fields are namespaced under `record` in both
 * sites) and reports only lint ERRORS — warnings would be noise at the draft
 * level; the inline editor already surfaces them where the author can act.
 */
async function validateObjectFieldRules(draft: unknown): Promise<SchemaFormIssue[]> {
  const d = draft as { name?: unknown; fields?: unknown } | null | undefined;
  const view = readFields(d?.fields);
  if (view.entries.length === 0) return [];
  const objectName = typeof d?.name === 'string' ? d.name : undefined;
  const fieldNames = view.entries.map((e) => e.name);
  const issues: SchemaFormIssue[] = [];
  for (let i = 0; i < view.entries.length; i++) {
    const entry = view.entries[i];
    const pathKey = view.shape === 'array' ? String(i) : entry.name;
    for (const key of FIELD_RULE_KEYS) {
      const source = predicateSource(entry.def[key]);
      if (source == null || !source.trim()) continue;
      const findings = await lintCelPredicate(source, {
        objectName,
        fields: fieldNames,
        scope: 'record',
        // Names the authored key so the wrong-layer advisory takes the
        // platform's published verdict (`e3cb47624`). Only ERRORS are kept
        // below, and that advisory is a `warning`, so this changes nothing
        // this gate reports today — it keeps the two `scope: 'record'` callers
        // asking the same question of the same authority.
        slot: key,
      });
      for (const f of findings) {
        if (f.severity !== 'error') continue;
        issues.push({ path: `fields.${pathKey}.${key}`, message: f.message });
      }
    }
    if (entry.def.type === 'formula') {
      const source = predicateSource(entry.def.expression);
      if (source == null || !source.trim()) continue;
      const findings = await lintCelPredicate(source, {
        objectName,
        // A formula may reference every sibling, not itself (circular).
        fields: fieldNames.filter((n) => n !== entry.name),
        scope: 'record',
        role: 'value',
      });
      for (const f of findings) {
        if (f.severity !== 'error') continue;
        issues.push({ path: `fields.${pathKey}.expression`, message: f.message });
      }
    }
  }
  return issues;
}

/**
 * CEL predicate slots on an object's `validations` rules (objectui#9497).
 *
 * The server's rule evaluator — `rule-validator.ts` in `@objectstack/objectql`
 * — binds a validation predicate's context as `{ record, previous }` and
 * NOTHING else, and since objectstack#4649 a predicate it cannot evaluate is
 * fail-CLOSED: `checkPredicate` logs "predicate failed to evaluate (…) — write
 * rejected (objectstack-ai/objectstack#4649)" and `unevaluableRuleError` turns that into a
 * `rule_violation`. So a bare-shorthand `amount > 100` authored here does not
 * merely fail to match — it rejects EVERY write to the object, and the spec's
 * Zod accepts it (`ExpressionInputSchema` checks the SHAPE only, exactly as it
 * does for the field conditional rules above).
 *
 * Two keys, because the server evaluates two and the spec spells them
 * differently per rule type: `condition` on `script` / `cross_field`
 * (`checkPredicate`), and `when` on `conditional` (`checkConditional`, whose
 * fault text is the same sentence with "when-predicate"). `format`,
 * `state_machine` and `json_schema` carry no CEL and are untouched.
 *
 * ⛔ The authority is the SERVER, not `@object-ui/core`'s
 * `ObjectValidationEngine.scopeFor` — that engine is deprecated and pinned
 * unwired by `validation-engine-stays-unwired.test.ts`, and it binds the bare
 * field names as well, which is the spelling that fail-closes here.
 *
 * ⚠️ `conditionScope.ts`'s ruled table agrees and is NOT read from here, both
 * halves deliberate. Its `validation` row is `record`, on the same server
 * reading — so this gate and the schema-driven editor reach one verdict from
 * one authority rather than from each other. ⛔ Its `object` row (`none`) is
 * not the row that governs this check and must not be read as overruling it:
 * that table answers which scope a condition WIDGET may claim for the metadata
 * type on screen, and its `ConditionScope` has a third value, `none`, that a
 * gate cannot act on. The rules linted here are validation rules, whichever
 * door opened the object draft.
 */
const VALIDATION_RULE_PREDICATE_KEYS = ['condition', 'when'] as const;

/**
 * The nested-rule slots a `conditional` rule branches into. `checkConditional`
 * dispatches the taken branch back through `evaluateRule` with the SAME
 * context, so a nested `script` rule's `condition` fail-closes identically —
 * and the Validations panel's `conditional` skeleton seeds exactly such a
 * nested rule. Linting only the top level would leave that predicate unlinted.
 */
const VALIDATION_RULE_BRANCH_KEYS = ['then', 'otherwise'] as const;

/**
 * Recursion bound. `validateMetadataDraft` takes `unknown` — a draft reaching
 * it from the JSON source editor is acyclic, but nothing in this module's
 * signature promises that, and an unbounded walk of a self-referential object
 * would hang the editor. The spec nests one rule per branch; this is a ceiling,
 * ⛔ not a declared nesting limit.
 */
const VALIDATION_RULE_MAX_DEPTH = 8;

/**
 * Lint every object validation rule's CEL predicate on a draft.
 *
 * Runs with `scope: 'record'` and reports only lint ERRORS — the same contract
 * as `validateObjectFieldRules`, and for the same reason: warnings would be
 * noise at the draft level.
 *
 * ⛔ No `slot` is passed, deliberately. `celAuthoring`'s slot-routed verdict
 * comes from `@objectstack/lint`'s `fieldRuleRootIssue`, whose bound-root set
 * is the FIELD tier's (`record` / `previous` / `parent`). A validation rule
 * binds `record` / `previous` only, so adopting that verdict here would import
 * a judgement derived for a different surface — the drift
 * `FIELD_RULE_VERDICT_SLOTS`' own docblock warns against. Unnamed, the
 * wrong-layer advisory keeps the local instrument; it is a `warning` either
 * way, so this gate's verdict does not move on it.
 */
async function validateObjectValidationRules(draft: unknown): Promise<SchemaFormIssue[]> {
  const d = draft as { name?: unknown; fields?: unknown; validations?: unknown } | null | undefined;
  const rules = d?.validations;
  if (!Array.isArray(rules)) return [];
  const objectName = typeof d?.name === 'string' ? d.name : undefined;
  const fieldNames = readFields(d?.fields).entries.map((e) => e.name);
  const issues: SchemaFormIssue[] = [];

  const visit = async (rule: unknown, path: string, depth: number): Promise<void> => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return;
    if (depth > VALIDATION_RULE_MAX_DEPTH) return;
    const r = rule as Record<string, unknown>;
    for (const key of VALIDATION_RULE_PREDICATE_KEYS) {
      const source = predicateSource(r[key]);
      if (source == null || !source.trim()) continue;
      const findings = await lintCelPredicate(source, {
        objectName,
        fields: fieldNames,
        scope: 'record',
      });
      for (const f of findings) {
        if (f.severity !== 'error') continue;
        issues.push({ path: `${path}.${key}`, message: f.message });
      }
    }
    for (const branch of VALIDATION_RULE_BRANCH_KEYS) {
      await visit(r[branch], `${path}.${branch}`, depth + 1);
    }
  };

  for (let i = 0; i < rules.length; i++) {
    await visit(rules[i], `validations.${i}`, 0);
  }
  return issues;
}

/**
 * ── Retired `formula` alias: point the author at the migration surface (objectui#6526) ──
 *
 * PRESENTATION ONLY — same contract as `expandViewIssues`: this runs strictly
 * inside the final issue→`SchemaFormIssue` mapping, after `ok` has been
 * decided. Same issue set, same paths, same verdict; only one rendered
 * message grows a pointer.
 *
 * The population: the Field Designer's formula textarea wrote a `formula` key
 * until objectui#6043 retired the control, so a stored object can still carry
 * the alias inside a formula field. `FieldSchema` refuses the key by name
 * (`unrecognized_keys` at `fields.<name>`), the same hard `422
 * INVALID_METADATA` that blocks EVERY later save of that object. The
 * adjudicated way out (objectui#6526, upholding objectui#6043) is NOT to
 * strip the key — `object-fields-io`'s `RETIRED_FIELD_KEYS` note records how
 * a strip destroys the authored expression — but to make the blocked state
 * actionable: NAME the field, and POINT at the one surface that migrates the
 * value properly. That surface is `ObjectFieldInspector`'s "Formula (CEL)"
 * editor (`designer.field.formula`): the legacy value seeds it
 * (`def.expression ?? def.formula`) and the first edit commits `expression`
 * and clears the alias. The object staying unsaveable until that edit is the
 * ruling's accepted cost; this pointer is what makes the cost payable.
 *
 * The pointer is APPENDED, never substituted: the spec's message is the
 * contract's voice (AGENTS.md #0.1), and it carries the disclosure for any
 * OTHER unrecognized key riding the same issue — a pre-objectui#6041 body can
 * list `referenceTo` alongside `formula` in one `keys` array, and that key's
 * own rename prescription must survive.
 *
 * Fires only when the field IS a `formula` field: the inspector renders the
 * editor only for that type (the objectui#4306 ruling — a verdict with no
 * on-screen editor to fix it wedges the author), so for any other type the
 * pointer would name a destination that does not render, and the spec's
 * message stands alone.
 */
const RETIRED_FORMULA_KEY = 'formula';

function retiredFormulaKeyPointer(fieldName: string): string {
  return (
    `Field \`${fieldName}\` carries the retired \`${RETIRED_FORMULA_KEY}\` key. ` +
    `To migrate: select the field in the object designer and make one edit in its ` +
    `Formula (CEL) editor — that commits the value to \`expression\`, clears the ` +
    `retired key, and the object saves again.`
  );
}

function annotateRetiredFormulaKeyIssues(issues: ZodLikeIssue[], draft: unknown): ZodLikeIssue[] {
  return issues.map((issue) => {
    if (issue.code !== 'unrecognized_keys') return issue;
    const path = issue.path ?? [];
    if (path.length !== 2 || path[0] !== 'fields' || typeof path[1] !== 'string') return issue;
    if (!issue.keys?.includes(RETIRED_FORMULA_KEY)) return issue;
    const def = valueAtPath(draft, path) as { type?: unknown } | null | undefined;
    if (!def || def.type !== 'formula') return issue;
    return { ...issue, message: `${issue.message} ${retiredFormulaKeyPointer(path[1])}` };
  });
}

// Keyed by mode AND type — `view` resolves to a different schema per mode, so
// caching by type alone would hand the create gate whichever mode asked first.
const SCHEMA_CACHE = new Map<string, ZodLikeSchema | null>();

async function getSchemaForType(type: string, mode: DraftMode): Promise<ZodLikeSchema | null> {
  const key = `${mode}:${type}`;
  if (SCHEMA_CACHE.has(key)) return SCHEMA_CACHE.get(key) ?? null;
  const loader = LOADERS[type];
  // `AUTHOR_SHAPE_ONLY_TYPES` is consulted HERE rather than inside the loader so
  // the fact lives in exactly one place: `hasClientValidator` reads the same set
  // synchronously, and the two can never disagree about which door has a gate.
  if (!loader || (mode === 'edit' && AUTHOR_SHAPE_ONLY_TYPES.has(type))) {
    SCHEMA_CACHE.set(key, null);
    return null;
  }
  try {
    const schema = await loader(mode);
    const value = (schema && typeof schema.safeParse === 'function') ? schema : null;
    SCHEMA_CACHE.set(key, value);
    return value;
  } catch {
    SCHEMA_CACHE.set(key, null);
    return null;
  }
}

/**
 * Returns true if a client-side schema exists for the given metadata type ON
 * THE GIVEN DOOR. Useful for deciding whether to skip the debounce in caller.
 *
 * The `mode` argument is load-bearing, not cosmetic (objectui#3561). Callers do
 * not merely skip work when this is `false` — `ResourceEditPage` also uses it to
 * decide WHERE the diagnostics banner reads its errors from: `true` means "the
 * live client issues are the error source", which suppresses the server's
 * load-time `_diagnostics`. A type wired on `create` only would therefore have
 * silently blanked the server's errors on the edit path had this stayed
 * mode-blind — reporting a stored item as clean because no client gate ran.
 *
 * Defaults to `'create'` to match `validateMetadataDraft`, whose default is the
 * strict authoring door.
 */
export function hasClientValidator(type: string, mode: DraftMode = 'create'): boolean {
  if (!(type in LOADERS)) return false;
  return !(mode === 'edit' && AUTHOR_SHAPE_ONLY_TYPES.has(type));
}

export interface ValidateResult {
  /** Whether a client schema was available and the draft conforms. */
  ok: boolean;
  /** Issues to render in SchemaForm + Monaco. Empty on success or unsupported type. */
  issues: SchemaFormIssue[];
}

/**
 * Run Zod validation for the given metadata draft. Returns `{ok: true,
 * issues: []}` for types without a registered schema so callers can
 * fall back to server-side diagnostics without special-casing.
 */
export async function validateMetadataDraft(
  type: string,
  draft: unknown,
  /**
   * The live server JSON schema for this type (from `/meta/types`, i.e.
   * `RichMetadataTypeEntry.schema`). When provided it ROOT-CURES cross-repo
   * spec skew: the bundled `@objectstack/spec` may lag the running server, so
   * we never let the client be STRICTER than the server — a "missing required
   * field" flagged by the (possibly stale) bundled Zod is suppressed when the
   * server marks that field optional. The server's own validation on save
   * stays authoritative. This makes the editor track the live schema without a
   * per-change shim — which is why the one shim that did exist could be
   * retired: `FORWARD_COMPAT_FLOW_NODE_TYPES` suppressed the published
   * `FlowNodeSchema.type` enum mismatch for `approval` / `connector_action`
   * until ADR-0019 P2 reached npm. Re-measured on the resolved spec 17.2.0
   * that enum is an open non-empty string, so the mismatch it dropped can no
   * longer be produced and the shim was removed (objectui#6982). The
   * measurement is pinned in `clientValidation.flowNodeTypes.test.ts`.
   */
  serverSchema?: { required?: unknown },
  /**
   * Which door the draft came through (objectstack#5316). Defaults to
   * `'create'` — the AUTHORING gate, which is the strict one — so a call site
   * that omits it can only ever over-report, never silently widen the door.
   * Callers that open a STORED body must say `{ mode: 'edit' }`.
   */
  options?: { mode?: DraftMode },
): Promise<ValidateResult> {
  const mode: DraftMode = options?.mode ?? 'create';
  const schema = await getSchemaForType(type, mode);
  if (!schema) return { ok: true, issues: [] };

  // CEL lint for object field conditional rules and object VALIDATION rules —
  // additive to the Zod shape check (a draft can be shape-valid yet carry an
  // unparsable predicate). Two calls, not one merged walk: the field-rule
  // check's contract is unchanged by objectui#9497, and keeping it a separate
  // function is what lets a reader see a fifth check added rather than the
  // existing four moved.
  const celIssues =
    type === 'object'
      ? [...(await validateObjectFieldRules(draft)), ...(await validateObjectValidationRules(draft))]
      : [];

  const result = schema.safeParse(draft);
  if (result.success) {
    return celIssues.length > 0 ? { ok: false, issues: celIssues } : { ok: true, issues: [] };
  }

  let rawIssues = result.error?.issues ?? [];

  // Cross-repo skew root-cure — drop "missing required field" false positives
  // for top-level fields the SERVER schema marks optional. Only suppresses when
  // the field is actually absent in the draft (a present-but-invalid field
  // still surfaces), so the client can never be stricter than the live server.
  const serverRequired = Array.isArray(serverSchema?.required)
    ? new Set((serverSchema!.required as unknown[]).map((x) => String(x)))
    : undefined;
  if (serverRequired && draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const d = draft as Record<string, unknown>;
    rawIssues = rawIssues.filter((i) => {
      const path = i.path ?? [];
      if (path.length !== 1) return true; // only top-level field issues
      const field = String(path[0]);
      const absent = d[field] === undefined || d[field] === null;
      return !(absent && !serverRequired.has(field));
    });
  }
  if (rawIssues.length === 0 && celIssues.length === 0) return { ok: true, issues: [] };

  // Presentation only — see `expandViewIssues` and
  // `annotateRetiredFormulaKeyIssues`. `ok` is already `false` here and
  // `rawIssues` is already final; this only decides what gets RENDERED for
  // each of them, so the verdict cannot move (pinned by the parity test in
  // `clientValidation.viewDiagnostics.test.ts`, and for `object` by the one
  // in `clientValidation.retiredFormulaKey.test.ts`).
  const renderable =
    type === 'view'
      ? expandViewIssues(rawIssues, [], draft)
      : type === 'object'
        ? annotateRetiredFormulaKeyIssues(rawIssues, draft)
        : rawIssues;
  const issues: SchemaFormIssue[] = [
    ...renderable.map((issue) => ({
      path: (issue.path ?? []).map((seg) => String(seg)).join('.'),
      message: issue.message,
    })),
    ...celIssues,
  ];
  return { ok: false, issues };
}
