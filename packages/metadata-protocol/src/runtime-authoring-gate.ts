// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The RUNTIME authoring gate — the fourth door (#4463).
 *
 * ## What was open
 *
 * #4409/#4445 collected 26 author-time rules into one registry and made
 * `os validate`, `os build` and `os lint` run it by construction. All three are
 * CLI commands. Every runtime metadata write — Studio's designer, REST `/meta`
 * item CRUD, an MCP/AI agent authoring a flow — lands in
 * {@link ObjectStackProtocolImplementation.saveMetaItem}, which ran a per-type
 * Zod `safeParse` and stopped. None of the 26 rules ran there.
 *
 * The issue's measured example: a tenant saves an approval flow whose
 * `expression` approver is broken CEL (`record.owner ==`). `approver.value` is
 * a `z.string()`, so the schema is green; the row lands in `sys_metadata`,
 * `registerFlow` registers it, and the node fails at its entry the first time
 * the flow fires. `os lint` had rejected that exact body since #4409 — and a
 * Studio tenant has no `os lint`. `sys_metadata` overlay rows are not in the
 * CLI's config file at all, so there was no command they could have run.
 *
 * ## Shape (the #4463 ruling)
 *
 * ONE shared core, ONE runtime gate — not a gate per surface. This module is
 * that gate. It holds no rules: `@objectstack/lint/runtime` filters the same
 * `AUTHORING_RULES` array the CLI runs, and `authoring-rule-wiring.test.ts`
 * fails if this file ever names a rule itself.
 *
 * ## The four decisions it implements
 *
 * - **D1 — where the gate is.** `state: 'active'` only. A draft save is always
 *   let through: a draft is allowed to be half-finished, gating one would
 *   destroy the Studio editing loop, and a draft cannot execute. `active` IS
 *   the publish verb, the same verb `os build` gates.
 * - **D2 — shape mismatch.** The rules are `(stack) => findings`; a runtime
 *   write is one item. The core builds a per-write snapshot and evaluates
 *   differentially — see `runtime-gate.ts` in `@objectstack/lint`.
 * - **D3 — severity → HTTP.** Gating findings become the SAME 422
 *   `invalid_metadata`-shaped envelope the Zod failure already produces, so
 *   Studio needs no new protocol: `issues[]` with `rule` / `path` / `message` /
 *   `hint`. Advisory findings do not block (P2 puts them on the response).
 * - **D4 — escape hatch + migration.** The gate blocks NEW writes only; stored
 *   rows keep being read (the ADR-0087 asymmetry `applyConversionsToStoredItem`
 *   already proved right). `OS_ALLOW_UNLINTED_METADATA_WRITES=1` degrades the
 *   refusal to a loud log for a migration window.
 */

import {
    runRuntimeAuthoringRules,
    type AuthoringFinding,
    type RuntimePackageScope,
    type RuntimeStackContext,
} from '@objectstack/lint/runtime';
// The ONE declaration of "which `config` key on which container node type holds
// a nested region" (#4401, `spec/src/automation/region-slots.ts`). Four passes
// already walk regions over this table — three in `spec`, one in `lint` — and
// the module's own header records why the WALKS stay separate while the TABLE
// is shared: they take different inputs and yield different units. The walk
// below is the fifth reader of the table and the second raw-record one; it is
// here rather than borrowed from `@objectstack/lint` because the runtime gate
// may only reach that package through its kernel-safe `/runtime` entry (the
// wiring guard's third invariant), and `walkFlowNodes` is not on it.
import { FLOW_REGION_SLOTS_BY_TYPE } from '@objectstack/spec/automation';
// [#20312] The ADR-0080 compiler itself — the function behind the CLI-only
// `validateJsxPages` rule, imported rather than re-implemented, so the save
// door and `os validate` judge a page's source with one compiler. Imported from
// its own package, never through `@objectstack/lint`: the wiring guard allows
// this file only the kernel-safe `/runtime` entry and no registry rule by name.
// The parser is pure (no dependencies, never executes the source), so it adds
// nothing the kernel boot path may not load (`runtime-lazy-deps.test.ts`).
import {
    compile as compileSduiSource,
    type CompileResult as SduiCompileResult,
    type Manifest as SduiManifest,
} from '@objectstack/sdui-parser';
import type { RuntimeAuthoringIssue } from '@objectstack/spec/api';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';

/**
 * The structured issue shape a 422 carries — D3's "reuse the Zod envelope".
 *
 * [#4717] Declared ONCE, in `packages/spec` as `RuntimeAuthoringIssueSchema`,
 * and re-exported here under the name this package has always used. It became a
 * spec declaration the moment D3's other half landed: the advisory findings ride
 * `SaveMetaItemResponseSchema.advisories`, which is a public wire contract, and
 * a hand-written interface next to a Zod schema for the same six keys is exactly
 * the two-dialect drift Prime Directive #1 exists to prevent. The name and the
 * import path callers use are unchanged.
 */
export type { RuntimeAuthoringIssue };

/**
 * The escape hatch (#4463 D4).
 *
 * `OS_ALLOW_*` per Prime Directive #9 — deliberately ungrouped and ugly,
 * because it is an opt-OUT of a check that ships ON. Existing `sys_metadata`
 * rows written before this gate existed may violate a rule; re-saving one
 * during a migration must not be impossible. Setting it makes the violation
 * TOLERATED, never invisible: every refusal it converts is logged in full.
 */
function unlintedWritesAllowed(): boolean {
    return typeof process !== 'undefined' && process.env?.OS_ALLOW_UNLINTED_METADATA_WRITES === '1';
}

/** One warn per `type|name|rule` per process — Studio republishes the same body a lot. */
const _advisoryWarned = new Set<string>();

// ─────────────────────────────────────────────────────────────────────────────
// #6285 — the publish refusal for an UNSTAMPED platform-level scheduled writer
// (#6155 Q2=A + Q3=A, maintainer 2026-08-07).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A schedule-triggered, platform-level flow creates records without declaring
 * which organization they belong to, on a deployment that walls organizations.
 *
 * ## The defect this refuses (#6155 / #5494 / hotcrm#698)
 *
 * `ScheduleTrigger` builds its `AutomationContext` as
 * `{ event: 'schedule', params: { jobId, flowName, schedule } }`
 * (`packages/triggers/trigger-schedule/src/schedule-trigger.ts`) — no
 * `tenantId`. PR #6153 closed the engine half of #5494 on the rule "stamp what
 * the engine KNOWS": a run whose trigger resolved an org carries it through and
 * the driver's tenant machinery fills `organization_id` on rows that omit it.
 * A schedule resolves none, so nothing fills anything, and the dominant
 * production shape of the whole issue — a nightly sweep, which fires on a
 * schedule and not by hand — still inserts rows with `organization_id` NULL.
 *
 * That is not a cosmetic NULL. A `(organization_id, …)` unique index does not
 * constrain across NULL and an org-scoped query does not see the row, so the
 * damage is duplicate and invisible records (hotcrm#698's duplicate numbering),
 * in a stored shape no later fix can retroactively repartition.
 *
 * ## Why the guardrail is here and not in `AUTHORING_RULES`
 *
 * Q3=A, quoted verbatim from the ruling:
 * 「Q3=A:护栏只落运行时发布门——给 `assertRuntimeAuthoringRules` →
 * `evaluateRuntimeAuthoringGate` 补两个缺失输入(写入 org 与 部署形态
 * `postureEnforcesWall(resolveTenancyPosture())`),CLI 纯函数侧 ⛔ 不判(构建机
 * env 是假信号)。」
 *
 * Both missing inputs are facts about the DEPLOYMENT, and the CLI runs on a
 * build machine: `os build`'s environment says nothing about the server the
 * artifact will be served from, so a shared rule would judge every
 * single-organization repository by whatever `OS_TENANCY_POSTURE` happened to
 * be exported in CI. `AUTHORING_RULES` is also structurally closed to a
 * runtime-only rule — `authoring-rule-wiring.test.ts` requires every
 * `runtime-publish` rule to also run on `os build` ("the two publish verbs must
 * not disagree"), which is exactly the disagreement Q3=A is choosing. So the
 * judgement lives at the gate, the gate stays a gate for the 26 shared rules,
 * and this file still names none of them.
 *
 * ## Why refusing is the right verb (Q2=A)
 *
 * The author-side answer already exists and needs no new key: `create_record`'s
 * `config.fields.organization_id`. #6153's fill-only stamping guarantees an
 * author-supplied value wins over any engine fill, so declaring it is both the
 * fix and the only fact source. Refusing at publish is what makes that
 * declaration *enforced* rather than advertised (Prime Directive #10) — and it
 * is the containment candidate #6155's own triage costed as the cheap one.
 */
export const PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING =
    'platform-schedule-create-record-org-missing';

/** The organization column an author declares on a `create_record` node's `fields`. */
const ORGANIZATION_FIELD = 'organization_id';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** A node's diagnostic name: `label` → `id` → `#index`, as the lint walk spells it. */
function nodeLabel(node: AnyRec, index: number): string {
    const label = typeof node.label === 'string' && node.label ? node.label : undefined;
    const id = typeof node.id === 'string' && node.id ? node.id : undefined;
    return label ?? id ?? `#${index}`;
}

/**
 * Every node of a flow, including those nested in `try_catch` / `loop` /
 * `parallel` regions, each with the config path a finding must land on.
 *
 * Nesting is the common case rather than the exotic one here: a sweep that
 * creates a record per matched row keeps its `create_record` inside a `loop`
 * body, so a walk over `flow.nodes` alone would be blind to precisely the shape
 * this rule exists for — the #4380 defect, re-committed. Region slots come from
 * the shared spec table; the depth cap is the same cheap promise
 * `walkFlowNodes` makes (regions are a tree, so this is not a cycle guard).
 */
function walkNodes(
    flow: AnyRec,
    flowPath: string,
): Array<{ node: AnyRec; path: string; index: number }> {
    const out: Array<{ node: AnyRec; path: string; index: number }> = [];
    const visit = (nodes: unknown, basePath: string, depth: number): void => {
        if (!Array.isArray(nodes) || depth > 16) return;
        nodes.forEach((raw, index) => {
            if (!isRec(raw)) return;
            const path = `${basePath}[${index}]`;
            out.push({ node: raw, path, index });
            const type = typeof raw.type === 'string' ? raw.type : undefined;
            const slots = type ? FLOW_REGION_SLOTS_BY_TYPE.get(type) : undefined;
            if (!slots || !isRec(raw.config)) return;
            for (const slot of slots) {
                const value = raw.config[slot.key];
                if (slot.arity === 'many') {
                    if (!Array.isArray(value)) continue;
                    value.forEach((branch, b) => {
                        if (!isRec(branch)) return;
                        visit(branch.nodes, `${path}.config.${slot.key}[${b}].nodes`, depth + 1);
                    });
                    continue;
                }
                if (!isRec(value)) continue;
                visit(value.nodes, `${path}.config.${slot.key}.nodes`, depth + 1);
            }
        });
    };
    visit(flow.nodes, `${flowPath}.nodes`, 0);
    return out;
}

/**
 * Does this flow bind to the SCHEDULE trigger?
 *
 * Mirrors `AutomationEngine.resolveTriggerBinding`
 * (`packages/services/service-automation/src/engine.ts`) branch for branch,
 * INCLUDING its precedence — a start node carrying `timeRelative` binds to the
 * `time_relative` trigger even though it also carries a `schedule` cadence, and
 * a `record-*` `triggerType` binds to record-change whatever else it declares.
 * Reproducing the precedence is what keeps the refusal aimed at the flows that
 * actually reach `ScheduleTrigger`; a looser "has a schedule anywhere" reading
 * would refuse time-relative sweeps, which resolve a record (and therefore an
 * org) per launch and are a different question entirely.
 */
function bindsToScheduleTrigger(flow: AnyRec): boolean {
    const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
    const startNode = nodes.find((n): n is AnyRec => isRec(n) && n.type === 'start');
    const config = isRec(startNode?.config) ? startNode.config : {};
    const triggerType = config.triggerType;

    if (typeof triggerType === 'string' && triggerType.startsWith('record-')) return false;
    if (
        Array.isArray(triggerType)
        && triggerType.some((t) => typeof t === 'string' && t.startsWith('record-'))
    ) return false;
    if (isRec(config.timeRelative)) return false;

    return config.schedule != null || flow.type === 'schedule';
}

/**
 * Has the author declared an organization for this `create_record` node?
 *
 * Reads the ONE canonical key — `config.fields.organization_id`. No `??` alias
 * chain (Prime Directive #12): `CreateRecordConfigSchema` is a `strictObject`
 * that names `fieldValues` as a rejected spelling, and the schema gate runs
 * BEFORE this one in `saveMetaItem`, so a body reaching here spells `fields`.
 *
 * A key present with `null` / `undefined` / whitespace does NOT count. The
 * author-facing promise is a *declaration* of ownership, and the engine's
 * fill-only stamping treats an absent value as "fill it" — so accepting an
 * empty one would let the refusal be silenced by writing the key and nothing
 * else, which is the "declared ≠ enforced" shape this gate exists to close.
 * Any non-empty value passes, template tokens included: `{record.org_id}` is a
 * real answer, resolved at run time by the same interpolation every other field
 * value goes through.
 */
function declaresOrganization(config: AnyRec): boolean {
    const fields = config.fields;
    if (!isRec(fields)) return false;
    if (!Object.prototype.hasOwnProperty.call(fields, ORGANIZATION_FIELD)) return false;
    const value = fields[ORGANIZATION_FIELD];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return true;
}

/**
 * Judge one about-to-be-published body for the #6285 refusal combination, and
 * return one issue per offending `create_record` node.
 *
 * PURE — the two deployment facts arrive as arguments (Q3=A). It reads no
 * `process.env`, which is what lets a test drive both postures without mutating
 * the process, and what keeps the "is this a walled deployment?" question
 * answered by ONE authority (`postureEnforcesWall(resolveTenancyPosture())`,
 * ADR-0105 D1) rather than re-derived here.
 *
 * All five limbs must hold; each one's negation is a legitimate publish:
 *
 * | limb | negation passes because |
 * |------|-------------------------|
 * | walled posture | `single` has no organization partition to land outside of |
 * | platform-level write | an org-scoped row already carries its organization |
 * | schedule binding | every other trigger resolves a user or a record, so #6153 stamps |
 * | has `create_record` | nothing is born, so nothing is born unpartitioned |
 * | no `fields.organization_id` | the author answered the question |
 */
export function findPlatformScheduleOrgGaps(args: {
    /** Singular metadata type of the item being written. */
    type: string;
    /** Metadata name, for the diagnostic `where`. */
    name: string;
    /** The body as it will be persisted. */
    body: unknown;
    /**
     * The organization partition this write lands in — `saveMetaItem`'s
     * `organizationId`. Absent/null IS the platform-level write.
     */
    organizationId?: string | null;
    /** `postureEnforcesWall(resolveTenancyPosture())`, read by the caller. */
    orgWallEnforced: boolean;
}): RuntimeAuthoringIssue[] {
    if (!args.orgWallEnforced) return [];
    if (args.organizationId != null) return [];
    if (args.type !== 'flow') return [];
    if (!isRec(args.body)) return [];

    const flow = args.body;
    if (!bindsToScheduleTrigger(flow)) return [];

    const flowName = typeof flow.name === 'string' && flow.name ? flow.name : args.name;
    const issues: RuntimeAuthoringIssue[] = [];

    for (const { node, path, index } of walkNodes(flow, 'flows[0]')) {
        if (node.type !== 'create_record') continue;
        const config = isRec(node.config) ? node.config : {};
        if (declaresOrganization(config)) continue;
        const objectName = typeof config.objectName === 'string' ? config.objectName : 'the target object';
        issues.push({
            severity: 'error',
            rule: PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING,
            where: `flow "${flowName}" · node "${nodeLabel(node, index)}"`,
            path: `${path}.config.fields.${ORGANIZATION_FIELD}`,
            message:
                `this platform-level schedule flow creates '${objectName}' records without declaring `
                + `'${ORGANIZATION_FIELD}', and this deployment walls organizations — a schedule trigger `
                + `carries no organization, so every row it creates is born with ${ORGANIZATION_FIELD} NULL, `
                + `outside every organization partition.`,
            hint:
                `Declare the owning organization on this node: `
                + `config.fields.${ORGANIZATION_FIELD}. An author-supplied value always wins over the `
                + `engine's fill, and the engine fills only an organization the run resolved — so this is `
                + `the one place the answer can come from for a `
                + `scheduled run. A NULL ${ORGANIZATION_FIELD} is not merely untidy: an `
                + `(${ORGANIZATION_FIELD}, …) unique index does not constrain across NULL and org-scoped `
                + `queries never see the row. Alternatively, publish this flow into an organization, or `
                + `give it a trigger that resolves one.`,
        });
    }

    return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// #10377 — the batch's OWN pending drafts are part of the closure it is judged
// against.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The declarations a package is publishing IN THIS BATCH, keyed exactly like
 * the live resolution context they join.
 *
 * ## The defect this exists for
 *
 * The gate's context collections are read off `engine.registry` — the LIVE
 * universe. A draft is deliberately not in that registry (the write-through
 * runs on `mode: 'publish'`), and the batch door's own promotions do not put
 * it there either: `applyRegistryWriteThrough` runs in Phase 2, AFTER the
 * Phase-1 transaction that gates and promotes every draft. So while a batch is
 * being judged, NO sibling of the batch exists in any collection — measured
 * 2026-08-21 on a cloud rig as `[widget-dataset-unknown] dataset
 * "shyx_customer_ds" does not resolve`, with the dataset sitting in the very
 * same batch. A package shipping a dashboard together with its dataset could
 * never publish, and no intra-batch ordering could help, because the registry
 * is not written until the whole transaction has committed.
 *
 * ## Why the type is `RuntimeStackContext` rather than a new shape
 *
 * It is the SAME set of collections, resolved from a second source. Reusing
 * the declaration is what stops the two from drifting when #8309's "widening
 * the snapshot is a one-key edit" note is next acted on: a key added there
 * arrives here typed, and {@link CLOSURE_CONTEXT_KEY_BY_TYPE} below is the
 * only thing that then needs a decision.
 */
export type RuntimePendingDeclarations = RuntimeStackContext;

/**
 * Which context collection a pending draft of a given metadata type joins.
 *
 * The `satisfies` clause is the drift guard, not decoration: rename a key of
 * `RuntimeStackContext` in `@objectstack/lint` and this table stops compiling,
 * instead of silently routing a collection nowhere — the #4449
 * wired-onto-nothing shape that `TYPE_TO_STACK_KEY`'s own `seed: 'data'` note
 * records paying for.
 *
 * Every metadata type NOT listed here contributes nothing to the closure, and
 * that is the correct answer rather than a gap: a collection is carried
 * because some rule RESOLVES REFERENCES INTO IT, and only these are read that
 * way (`RuntimeStackContext`'s own docblock records the measurement).
 *
 * [#13216 / #17063] `page` WAS the fifth row, added for `validateViewPageRefs`
 * so that a package shipping a custom page together with the object view that
 * mounted it did not report its own sibling as unresolved. That rule and the
 * `type: 'page'` view mount it resolved were retired under ADR-0049
 * enforce-or-remove, `RuntimeStackContext.pages` went with them, and this row
 * went with that — the drift guard below is what made the third edit
 * unforgettable rather than remembered.
 */
export const CLOSURE_CONTEXT_KEY_BY_TYPE = {
    object: 'objects',
    permission: 'permissions',
    book: 'books',
    dataset: 'datasets',
} as const satisfies Readonly<Record<string, keyof RuntimeStackContext>>;

/**
 * Every context collection some row above routes into.
 *
 * Read off the table rather than restated: the `as const` keeps the values a
 * union of literal keys, and the `satisfies` clause above has already pinned
 * that each one is a real {@link RuntimeStackContext} key. So this union
 * cannot name a collection the context does not have, and the only remaining
 * question is the one below.
 */
type RoutedContextCollections =
    (typeof CLOSURE_CONTEXT_KEY_BY_TYPE)[keyof typeof CLOSURE_CONTEXT_KEY_BY_TYPE];

/** Context collections with NO row above. Must be empty — see the assertion. */
type UnroutedContextCollections = Exclude<keyof RuntimeStackContext, RoutedContextCollections>;

/**
 * `never`, or a compile error naming the collection nobody routes into.
 *
 * The constraint is the whole mechanism: a non-empty
 * {@link UnroutedContextCollections} cannot satisfy `never`, so `tsc` reports
 * `Type '"<collection>"' does not satisfy the constraint 'never'` at the
 * assertion below — the missing key, by name, at the file that owns the table.
 */
type NoUnroutedContextCollection<Unrouted extends never> = Unrouted;

/**
 * COMPLETENESS — the half {@link CLOSURE_CONTEXT_KEY_BY_TYPE}'s `satisfies`
 * clause cannot state, and the last one of this set that was still missing.
 *
 * ## What the `satisfies` above does NOT ask
 *
 * It asks that every key the table NAMES is a real `RuntimeStackContext` key.
 * It does not ask that every collection needing a row HAS one — validity, not
 * completeness. That is exactly the asymmetry `NAME_KEYED_STACK_KEYS` carried
 * in `@objectstack/lint` before #13390 derived it, one package over.
 *
 * ## Why it is worth an assertion when nothing is broken
 *
 * The set is correct as it stands. #13390's ruling is about what "correct
 * today" costs: adding the `pages` collection had to touch FIVE spellings of
 * this one set and only ONE announced itself (#17063 removed it again, and the
 * same five spellings had to move back), and the unguarded spelling
 * produced correct-LOOKING findings whose `path` the caller could not resolve,
 * with no test and no gate going red. Four of the five can no longer be
 * forgotten. This was the fifth.
 *
 * ## What goes red, and when
 *
 * Add a key to `RuntimeStackContext` in `@objectstack/lint` without adding the
 * row that routes a metadata type into it, and this package stops building:
 * the dts build reports `TS2344` here. Measured, not assumed — a type error
 * confined to this file fails `pnpm --filter @objectstack/metadata-protocol
 * build` with `DTS Build error`, which is what CI's workspace build runs.
 *
 * The red arrives after `@objectstack/lint` is REBUILT, because the type
 * crosses the package wall through `dist/runtime.d.ts`. That is inherent to
 * the boundary and is the same latency the `satisfies` clause above and
 * `protocol.ts`'s `-?` accumulator already have; turbo's dependency order
 * makes it unconditional in CI.
 *
 * ## Why an assertion rather than a derivation
 *
 * A derivation would have to read the context-collection set as a VALUE, and
 * `metadata-protocol` cannot: `CONTEXT_STACK_KEYS` is module-private in
 * `runtime-gate.ts` and appears on neither of `@objectstack/lint`'s entries.
 * Reaching it would mean widening the deliberately narrow
 * `@objectstack/lint/runtime` entry — a package-boundary change — to buy the
 * same red this costs nothing to get. The TYPE is already here; only the
 * completeness question needed asking.
 *
 * Exported because `noUnusedLocals` is on: a local alias nothing reads is a
 * hard `TS6196` here, so an unexported guard would not compile at all.
 */
export type ClosureRoutingCoversEveryContextCollection =
    NoUnroutedContextCollection<UnroutedContextCollections>;

/**
 * The live collection with this batch's pending drafts folded in — REPLACING
 * by name, never appended beside.
 *
 * Replace-not-erase is the same rule `buildRuntimeWriteSnapshots` already
 * applies when a written item lands in its own context collection, and for the
 * same reason: a draft that EDITS a live declaration is one declaration in two
 * states, so appending it would make an update read as a duplicate name — for
 * `objects` that turns every lookup in the tenant's model into an ambiguity,
 * and for `permissions` it double-counts grants.
 *
 * ⛔ The direction is deliberately additive: a pending draft can only ever make
 * MORE names resolvable, never fewer. A name in neither the batch nor the live
 * universe is still unresolved, which is what keeps the #7529 refusal — the
 * one this change must not weaken — intact for a genuinely dangling binding.
 *
 * Pure and total: an entry that is not an object, or carries no usable `name`,
 * is kept rather than inspected.
 */
export function mergePendingDeclarations(
    live: readonly unknown[],
    pending: readonly unknown[] | undefined,
): readonly unknown[] {
    if (!pending || pending.length === 0) return live;
    const supersededNames = new Set<string>();
    for (const entry of pending) {
        if (!isRec(entry)) continue;
        const name = entry.name;
        if (typeof name === 'string' && name !== '') supersededNames.add(name);
    }
    if (supersededNames.size === 0) return [...live, ...pending];
    const kept = live.filter((entry) => {
        if (!isRec(entry)) return true;
        const name = entry.name;
        return !(typeof name === 'string' && supersededNames.has(name));
    });
    return [...kept, ...pending];
}

// ─────────────────────────────────────────────────────────────────────────────
// #20312 — an html page's source is compiled at save against the deployment's
// SDUI component manifest (ADR-0080 §5).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The service key a host registers its deployment's ADR-0080 SDUI component
 * manifest under — the parsed `sdui.manifest.json` object, a JSON object with a
 * `components` map. `os serve` resolves it once at boot through the CLI's
 * `resolveSduiManifest` and registers the result here; a host that registers
 * nothing keeps the save door exactly as it was before this key existed.
 *
 * A plain service key, deliberately not a `CoreServiceName` slot: the manifest
 * is a fact about the console this deployment serves, not a kernel capability.
 * The protocol reads it per publish (`resolveSduiManifest` on the protocol,
 * the `resolveFlowCanonicalizer` pattern), never at construction, so a value
 * registered after the protocol is assembled is still seen by the next publish.
 */
export const SDUI_MANIFEST_SERVICE = 'sdui-manifest' as const;

/**
 * The gate-local rule that refuses a page whose hand-written `requires`
 * disagrees with the namespaces its compiled source uses. A namespace the
 * deployment's manifest does not carry at all always disagrees: the compiled
 * `requires` holds only namespaces of components the manifest declares.
 */
export const PAGE_REQUIRES_DISAGREES_WITH_SOURCE = 'page-requires-disagrees-with-source';

/**
 * The `rulesRun` name for the save door's own compile of an html page's
 * source. Its findings carry the compiler's diagnostic codes as `jsx-CODE` —
 * the rule ids `os validate` / `os build` report for the same source against
 * the same manifest, so a page refused here is refused under the same name on
 * the CLI.
 */
export const HTML_PAGE_SOURCE_COMPILE = 'html-page-source-compile';

/** The page kinds whose `source` is constrained JSX (the deprecated `jsx` spells `html`). */
const COMPILED_PAGE_KINDS: ReadonlySet<unknown> = new Set(['html', 'jsx']);

/**
 * Whether a value can be compiled against: an object with a `components` map,
 * the one key `compile()` dereferences unconditionally — the same floor the
 * CLI's `resolveSduiManifest` holds a manifest file to.
 */
export function isUsableSduiManifest(value: unknown): value is SduiManifest {
    return isRec(value) && isRec(value.components);
}

/**
 * The plugin namespaces a manifest's components carry — the deployment's
 * answer to "which plugins does the console this deployment serves load".
 * The one derivation both moments of ADR-0080 §5's plugin-presence check read:
 * the save door's `requires` judgement ({@link findHtmlPageSourceGaps}) and the
 * load-time report ({@link findPageRequiresAbsentFromManifest}).
 */
function manifestNamespaces(manifest: SduiManifest): Set<string> {
    return new Set(
        Object.values(manifest.components)
            .map((c) => c?.namespace)
            .filter((ns): ns is string => typeof ns === 'string'),
    );
}

/**
 * The load half of ADR-0080 §5 ("`requires` is inferred at parse and validated
 * at save **and** load — plugin presence"): the namespaces a stored page's
 * `requires` names that no component in the deployment's manifest carries,
 * i.e. the plugins it needs that the console this deployment serves does not
 * load. Each name once, in the order the page lists them; `[]` when every one
 * is present.
 *
 * `null` when nothing was judged — not a page, no `requires` list, or no
 * usable manifest. That last case is the save door's posture on the same
 * host: with no manifest registered nothing is compiled or checked, and the
 * host that registered nothing is the one that says so at boot.
 *
 * Kind-agnostic on purpose: what is judged is the declaration itself (a
 * namespace the page says it needs), not the source it was derived from, so a
 * load needs no compile. A page whose source names a component no manifest
 * carries never gets this far as an html page on a host with a manifest — the
 * save door refuses it.
 */
export function findPageRequiresAbsentFromManifest(
    type: string,
    body: unknown,
    sduiManifest: unknown,
): string[] | null {
    if (type !== 'page' || !isRec(body) || !isUsableSduiManifest(sduiManifest)) return null;
    const declared = body.requires;
    if (!Array.isArray(declared)) return null;
    const provided = manifestNamespaces(sduiManifest);
    return [...new Set(declared.filter((ns): ns is string => typeof ns === 'string' && !provided.has(ns)))];
}

/** The compile of one html page body, or `undefined` when the save door does not compile it. */
function compileHtmlPage(
    type: string,
    body: unknown,
    sduiManifest: unknown,
): { name: string; result: SduiCompileResult } | undefined {
    if (type !== 'page' || !isRec(body) || !COMPILED_PAGE_KINDS.has(body.kind)) return undefined;
    if (!isUsableSduiManifest(sduiManifest)) return undefined;
    // An empty source is PageSchema's refusal, already made before this gate.
    if (typeof body.source !== 'string' || body.source.trim() === '') return undefined;
    const name = typeof body.name === 'string' && body.name !== '' ? body.name : 'page';
    return { name, result: compileSduiSource(body.source, sduiManifest) };
}

const sameNamespaces = (a: readonly string[], b: readonly string[]): boolean => {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((ns) => right.has(ns));
};

/**
 * Judge an html page's source against the deployment's manifest: every
 * compiler diagnostic becomes a finding (errors refuse, warnings advise), and
 * a hand-written `requires` that disagrees with the compiled one is refused
 * with each disagreeing namespace named.
 *
 * Returns `null` when nothing was judged — not a page, not an html page, or
 * no usable manifest — so the caller discloses these rules only when they ran.
 */
export function findHtmlPageSourceGaps(args: {
    type: string;
    body: unknown;
    sduiManifest?: unknown;
}): AuthoringFinding[] | null {
    const compiled = compileHtmlPage(args.type, args.body, args.sduiManifest);
    if (!compiled) return null;
    const { name, result } = compiled;
    const findings: AuthoringFinding[] = result.diagnostics.map((d) => ({
        severity: d.severity === 'error' ? 'error' : 'warning',
        rule: `jsx-${d.code}`,
        where: d.tag ? `page "${name}" › <${d.tag}>` : `page "${name}"`,
        path: `pages.${name}.source`,
        message: d.message,
        hint: 'The source is compiled at save against the SDUI component manifest of the console this '
            + 'deployment serves — fix the JSX; a component the manifest does not declare needs the plugin '
            + 'that provides it installed in that console.',
    }));
    // A source that does not compile has no trustworthy namespace set to
    // compare against; its own errors are the verdict.
    if (!result.ok) return findings;

    const declared = (args.body as AnyRec).requires;
    if (declared === undefined) return findings;
    const declaredList: unknown[] = Array.isArray(declared) ? declared : [declared];
    const declaredNames = declaredList.filter((ns): ns is string => typeof ns === 'string');
    if (declaredNames.length === declaredList.length && sameNamespaces(declaredNames, result.requires)) {
        return findings;
    }

    const provided = manifestNamespaces(args.sduiManifest as SduiManifest);
    const used = new Set(result.requires);
    const unprovided = declaredNames.filter((ns) => !provided.has(ns));
    const unused = declaredNames.filter((ns) => provided.has(ns) && !used.has(ns));
    const missing = result.requires.filter((ns) => !declaredNames.includes(ns));
    const clauses = [
        ...unprovided.map((ns) => `'${ns}' is a namespace no component in this deployment's manifest carries`),
        ...unused.map((ns) => `'${ns}' is not used by the source`),
        ...missing.map((ns) => `'${ns}' is used by the source but not listed`),
    ];
    if (declaredNames.length !== declaredList.length) clauses.push('every entry must be a namespace string');
    findings.push({
        severity: 'error',
        rule: PAGE_REQUIRES_DISAGREES_WITH_SOURCE,
        where: `page "${name}"`,
        path: `pages.${name}.requires`,
        message: `\`requires\` disagrees with the source: ${clauses.join('; ')}.`,
        hint: `\`requires\` is derived from the source at save — omit it, or write exactly `
            + `${JSON.stringify(result.requires)}.`,
    });
    return findings;
}

/**
 * The body to persist for an html page saved on a host with a manifest: its
 * `requires` stamped from the compiled source. Returned unchanged — the same
 * reference — when there is nothing to stamp: not an html page, no usable
 * manifest, a source that does not compile, or a hand-written `requires` that
 * disagrees. The last two are refusals on a publish and are left as written on
 * a draft (drafts are not gated, #4463 D1), so the draft's own publish refuses
 * them rather than a stamp silently replacing what the author wrote.
 *
 * The draft → active promotion applies the same function to the promoted
 * body, so the active row a publish writes carries what an active save of
 * that body would have stored — never the draft's own stamp, which was
 * computed against whatever manifest the host had at the draft's save (or
 * none at all).
 */
export function stampHtmlPageRequires(type: string, body: unknown, sduiManifest: unknown): unknown {
    const compiled = compileHtmlPage(type, body, sduiManifest);
    if (!compiled || !compiled.result.ok) return body;
    const declared = (body as AnyRec).requires;
    if (declared !== undefined) {
        const agrees = Array.isArray(declared)
            && declared.every((ns) => typeof ns === 'string')
            && sameNamespaces(declared as string[], compiled.result.requires);
        if (!agrees) return body;
    }
    return { ...(body as AnyRec), requires: [...compiled.result.requires] };
}

const toIssue = (f: AuthoringFinding): RuntimeAuthoringIssue => ({
    rule: f.rule,
    path: f.path,
    where: f.where,
    message: f.message,
    hint: f.hint,
    severity: f.severity,
});

/**
 * The gate's whole verdict on one write — both severities, in one value.
 *
 * [#4717] This type IS the change #4717 asked for. Until it existed the
 * function was typed `=> Error | null`, so the success path had no return
 * channel at all: the advisory findings the rules had already produced were
 * walked into a deduped `console.warn` and went out of scope. That is the same
 * "ran the rule, discarded the verdict" shape #4463 was filed to close, one
 * notch quieter — and it was unreachable by exactly the authors the gate exists
 * for, since a Studio tenant or an MCP/AI author never sees server stdout.
 *
 * So this is an ADDED channel, not a threaded value, and it is deliberately a
 * record rather than a widened `Error | Issue[] | null` union: both halves of
 * the verdict are always answered, and a caller cannot read one while forgetting
 * the other exists.
 */
export interface RuntimeAuthoringVerdict {
    /**
     * The 422 the caller MUST throw, or `null` when the write may proceed.
     * Exactly the value this function used to return on its own.
     */
    error: Error | null;
    /**
     * The non-gating findings — `severity` `warning` or `info`. Always an
     * array, possibly empty; `saveMetaItem` puts it on the response under
     * `advisories` and omits the key entirely when it is empty, so a clean save
     * is byte-identical to before (`SaveMetaItemResponseSchema`, #4717).
     *
     * Populated alongside a non-null `error` too, but that combination never
     * reaches a response: the caller throws, and a 422 carries its own
     * `issues[]`. Nothing here is a substitute for reading `error`.
     */
    advisories: RuntimeAuthoringIssue[];
}

/**
 * Judge an about-to-be-published metadata body and return BOTH halves of the
 * verdict: the `Error` the caller must throw (or `null` to allow the write),
 * and the advisory findings that do not block it.
 *
 * Returning the error rather than throwing it mirrors
 * {@link ObjectStackProtocolImplementation.assertLockAllowsWrite}: the caller
 * owns the audit trail and the throw site.
 *
 * @param args.state Lifecycle the body is being written into. Anything but
 *   `'active'` returns an empty verdict immediately (D1).
 */
export function evaluateRuntimeAuthoringGate(args: {
    /** Singular metadata type (`flow`, …). */
    type: string;
    name: string;
    state: 'draft' | 'active';
    body: unknown;
    /** Live object declarations, the resolution universe for the rules. */
    objects?: readonly unknown[];
    /**
     * [#8309] Live permission-set declarations — the sibling collection the
     * three cross-collection security rules compare against. Without it a
     * per-write snapshot holds exactly one permission set (the written item),
     * which was measured inventing 38 phantom
     * `security-master-detail-ungranted` findings per-write against the
     * whole-stack run's 4 (PR #7886).
     */
    permissions?: readonly unknown[];
    /**
     * [#8309] Live documentation-book declarations, so a `book` write is
     * judged with its siblings present and book-derived findings cancel in
     * the gate's differential for every other write type.
     */
    books?: readonly unknown[];
    /**
     * [#7529] Live dataset declarations — the resolution universe
     * `validateWidgetBindings` links a dashboard widget's `dataset` /
     * `dimensions` / `values` against. Without it every widget on a fully
     * legitimate board reads as dangling (3 phantom `widget-dataset-unknown`
     * errors measured on a 3-widget board vs 0 with the collection carried),
     * so the thread-through is load-bearing, not optional.
     */
    datasets?: readonly unknown[];
    /**
     * [#10377] The declarations this write's own BATCH is publishing alongside
     * it — folded into the five collections above by
     * {@link mergePendingDeclarations} before any rule runs.
     *
     * Stated by the batch door (`publishPackageDrafts`), which is the only
     * caller that HAS a batch; the single-item door publishes one item, so its
     * batch is itself and it passes nothing. Absent ⇒ the closure is the live
     * universe alone, exactly as before, which is the correct answer for every
     * write that is not part of a package publish rather than a fallback.
     *
     * See {@link RuntimePendingDeclarations} for the measured defect: without
     * it a package shipping a dashboard together with its dataset can never
     * publish.
     */
    pending?: RuntimePendingDeclarations;
    /**
     * ADR-0080 SDUI manifest when the host has one — the value registered under
     * {@link SDUI_MANIFEST_SERVICE}, read by the caller per publish.
     *
     * [#20312] A usable one (a `components` map) makes the gate compile an html
     * page's `source` against it ({@link findHtmlPageSourceGaps}): an unknown
     * component or a `requires` that disagrees with the source refuses the
     * write. Absent, an html page is judged exactly as before.
     */
    sduiManifest?: unknown;
    /**
     * [#9612] The package this write belongs to, and the transitive closure of
     * that package's DECLARED dependencies — resolved by the caller, which is
     * the side holding the package registry.
     *
     * Present ⇒ the gate judges the write against
     * `package + declared deps + platform/system + unpackaged overlay rows`
     * instead of against every object in the tenant, per the maintainer's
     * ruling that the validation unit is the package (「客户开发开发,校验是否
     * 也应该基于软件包」·「当然这里面要考虑系统对象」).
     *
     * ⛔ Absent ⇒ nothing is narrowed and the whole collection is judged. That
     * is the ONLY fallback, and its direction is deliberate: an unresolvable
     * package buys the write MORE input, never less. A fallback that skipped
     * rules — or skipped them past some size — would be the fail-open at scale
     * this card was forbidden to build.
     */
    packageScope?: RuntimePackageScope;
    /**
     * [#6285] The organization partition this write lands in — `saveMetaItem`'s
     * `organizationId`, absent/null for a platform-level (environment) write.
     *
     * One of the two inputs #6155 Q3=A adds. It was always in `saveMetaItem`'s
     * hand and simply never travelled this far, which is why the guardrail
     * could not be written before.
     */
    organizationId?: string | null;
    /**
     * [#6285] Does this deployment enforce an organization wall —
     * `postureEnforcesWall(resolveTenancyPosture())` (ADR-0105 D1)?
     *
     * The second Q3=A input, and an INPUT on purpose: it is a process-level env
     * reading, so the caller performs it and this function stays pure. Defaults
     * to `false` — an unstated posture must not manufacture a refusal, and
     * every call site that can know the answer states it.
     */
    orgWallEnforced?: boolean;
    /**
     * [#20158] The host engine's judge-only filter admission
     * (`IObjectQLEngine.judgeFilter`, #19995 ruling C), BOUND to that engine.
     *
     * The third input of the #6285 kind: a fact only the host holds (its live
     * engine), gathered by the impure caller — `assertRuntimeAuthoringRules`,
     * which probes `typeof engine.judgeFilter === 'function'` — and passed in
     * so this function stays pure. Handed to the shared rules unchanged, where
     * `validateRlsPredicateEnforceability` judges each read-scope RLS `using`
     * with it (ADR-0058 D2). Absent (a host without the member, a test
     * double), that judgement is skipped and every rule answers as before.
     */
    judgeFilter?: IObjectQLEngine['judgeFilter'];
    /**
     * [#20611] The positions in `body` where the write path will restore a
     * credential the read path withheld — dotted, item-relative
     * (`nodes.1.config.secret`), as `redactedPathsCarriedForward` answers
     * them from the stored row. The fourth input of the #6285 kind: a fact only
     * the host holds (the row at rest), gathered by the impure caller and passed
     * in so this function stays pure.
     *
     * The carry-forward itself runs AFTER this gate, deliberately, so no rule
     * handles a restored credential; this hands the rules the positions and
     * nothing else. A rule judging whether a credential is present then reads a
     * listed position as present (withheld and stored), and an unlisted one on
     * the body as sent (absent and not stored is missing). Absent, every
     * position is judged on the body as sent.
     */
    restoredCredentialPaths?: readonly string[];
}): RuntimeAuthoringVerdict {
    // D1 — drafts are never gated. Publishing one runs this same function.
    // No rules ran, so there is nothing to report on either half.
    if (args.state !== 'active') return { error: null, advisories: [] };

    const result = runRuntimeAuthoringRules({
        type: args.type,
        item: args.body,
        ...(args.packageScope !== undefined ? { packageScope: args.packageScope } : {}),
        // [#10377] Live universe + this batch's own pending drafts, folded per
        // collection. Uniform across all five on purpose: the closure ruling
        // judges a package as a self-consistent UNIT, and a per-collection
        // closure is precisely the state that produced this card — `objects`
        // had been threaded, `datasets` had not, and the difference was
        // invisible until an error-severity rule landed on the un-threaded one.
        context: {
            objects: mergePendingDeclarations(args.objects ?? [], args.pending?.objects),
            permissions: mergePendingDeclarations(args.permissions ?? [], args.pending?.permissions),
            books: mergePendingDeclarations(args.books ?? [], args.pending?.books),
            datasets: mergePendingDeclarations(args.datasets ?? [], args.pending?.datasets),
        },
        ...(args.sduiManifest !== undefined ? { sduiManifest: args.sduiManifest } : {}),
        ...(args.judgeFilter !== undefined ? { judgeFilter: args.judgeFilter } : {}),
        ...(args.restoredCredentialPaths !== undefined
            ? { restoredCredentialPaths: args.restoredCredentialPaths }
            : {}),
    });

    // [#6285] The gate-local refusal, folded into the SAME verdict set as the
    // 26 shared rules — deliberately not a second envelope, a second hatch or a
    // second throw site. `runtimeTypes` cannot carry it (Q3=A: the CLI must not
    // judge deployment shape), so this is the one judgement the gate owns; the
    // wiring guard's invariant that this file names no REGISTRY rule is
    // untouched, and everything downstream — the 422, the issues array, the
    // migration hatch, the `rulesRun` disclosure — treats it identically.
    const scheduleOrgGaps = findPlatformScheduleOrgGaps({
        type: args.type,
        name: args.name,
        body: args.body,
        ...(args.organizationId !== undefined ? { organizationId: args.organizationId } : {}),
        orgWallEnforced: args.orgWallEnforced === true,
    });

    // [#20312] The save door's own compile of an html page's source against
    // the deployment's manifest (ADR-0080 §5) — gate-local for the reason the
    // #6285 refusal above is: the manifest is a fact about the deployment, and
    // the registry's `validateJsxPages` is CLI-only. Same verdict set, same
    // 422, same hatch. `null` when it did not run (no usable manifest, not an
    // html page), which keeps an html page on a manifest-less host judged
    // exactly as before.
    const pageSourceFindings = findHtmlPageSourceGaps({
        type: args.type,
        body: args.body,
        ...(args.sduiManifest !== undefined ? { sduiManifest: args.sduiManifest } : {}),
    });
    const localIssues = [
        ...scheduleOrgGaps,
        ...(pageSourceFindings ?? []).filter((f) => f.severity === 'error').map(toIssue),
    ];
    const advisoryFindings = [
        ...result.advisories,
        ...(pageSourceFindings ?? []).filter((f) => f.severity !== 'error'),
    ];

    // [#4717] The advisory half of D3, now with somewhere to go. The deduped
    // log below is KEPT — it is the operator's channel and costs one Set lookup
    // — but it is no longer the only one: these travel back to the caller in
    // `advisories` and `saveMetaItem` puts them on the 2xx response, which is
    // the channel the Studio / MCP / AI author this gate exists for can
    // actually read.
    const advisories = advisoryFindings.map(toIssue);

    for (const advisory of advisoryFindings) {
        const key = `${args.type}|${args.name}|${advisory.rule}|${advisory.path}`;
        if (_advisoryWarned.has(key)) continue;
        _advisoryWarned.add(key);
        console.warn(
            `[Protocol] authoring advisory on ${args.type}/${args.name}: `
            + `[${advisory.rule}] ${advisory.where} — ${advisory.message} (${advisory.hint})`,
        );
    }

    if (result.errors.length === 0 && localIssues.length === 0) return { error: null, advisories };

    const issues = [...result.errors.map(toIssue), ...localIssues];
    // [#10524] Two renderings of one array, two audiences — deliberately NOT
    // one string:
    //
    // - `detail` is the WHOLE refusal — path, rule and message prose — and
    //   goes only where no structured channel exists: the operator's
    //   un-deduped hatch warn below (#4463 acceptance).
    // - the thrown 422's `message` is `headline`: what failed, where, which
    //   rules, how many. Every wire face the message lands on carries the
    //   SAME `issues` array structurally (`error.details.issues` on the
    //   single-item 422, `failed[].issues` on the batch response), so
    //   restating the issue prose in the message made every console render
    //   each finding twice — the summary-then-bullets duplication this trim
    //   removes. The leading count subsumes the old `(+N more)` tail; the
    //   prose lives once, in `issues[]`.
    const locators = issues
        .slice(0, 3)
        .map((i) => `${i.path || i.where || '<root>'} [${i.rule}]`)
        .join('; ');
    const headline = `${issues.length} issue${issues.length === 1 ? '' : 's'} — ${locators}`;
    const detail = issues
        .slice(0, 3)
        .map((i) => `${i.path || i.where || '<root>'}: [${i.rule}] ${i.message}`)
        .join('; ')
        + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '');
    // The registry's own disclosure, plus the gate-local rule when it was
    // applicable to this type. `rulesRun` exists so a caller can tell "clean"
    // from "nothing ran"; a judgement that can refuse a write and never appears
    // here would reintroduce exactly the ambiguity it was added to remove.
    const rulesRun = [
        ...result.rulesRun,
        ...(args.type === 'flow' ? [PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING] : []),
        ...(pageSourceFindings !== null ? [HTML_PAGE_SOURCE_COMPILE, PAGE_REQUIRES_DISAGREES_WITH_SOURCE] : []),
    ];

    if (unlintedWritesAllowed()) {
        // Loud by construction (#4463 acceptance): the operator who set the
        // hatch gets the whole refusal in the log, every time, un-deduped —
        // this is a migration window, not a supported steady state.
        console.warn(
            `[Protocol] OS_ALLOW_UNLINTED_METADATA_WRITES=1 — ALLOWING a publish of `
            + `${args.type}/${args.name} that ${issues.length} author-time gating rule(s) reject: ${detail}. `
            + `The rules that ran: ${rulesRun.join(', ')}. Unset the variable once the metadata is fixed; `
            + `the runtime will execute this body as published.`,
        );
        // [#4717] The hatch converts a REFUSAL into a log; it does not promote
        // the gating findings into the advisory channel. `advisories` means
        // "did not block this write", and a finding that only failed to block
        // because an operator set a migration flag is not that — it is in the
        // un-deduped refusal log above, in full, every time. Widening this to
        // carry them would put `severity: 'error'` entries on a 2xx.
        return { error: null, advisories };
    }

    // The message opens with the sentence, not with a bracketed restatement of
    // the `code` assigned below. The 2026-08-29 maintainer ruling is one
    // envelope semantics — `error` is HUMAN LANGUAGE, `code` is the MACHINE
    // TOKEN — and `withoutDeclaredCodePrefix` strips only the `CODE:` spelling,
    // so a lowercase `[tag]` opener reached every caller's `error.message`
    // restating what `code` already carries. The `[rule]` locators inside
    // `headline` stay: they name WHICH finding, a fact no other field carries.
    // Pinned as an absence in `protocol.bracketed-refusal-opener-absence.test.ts`.
    const err = new Error(
        `${args.type}/${args.name} failed author-time validation: ${headline}`,
    );
    (err as any).code = 'INVALID_METADATA';
    (err as any).status = 422;
    (err as any).issues = issues;
    // Which rules produced the verdict, so a caller can tell "clean" from
    // "nothing ran" without guessing (route 3 of the surface-ownership rules:
    // absence must be loud).
    (err as any).rulesRun = rulesRun;
    // The caller throws `error`; `advisories` rides along for symmetry and is
    // dropped with the response that never happens.
    return { error: err, advisories };
}
