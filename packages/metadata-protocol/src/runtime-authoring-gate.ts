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

import { runRuntimeAuthoringRules, type AuthoringFinding } from '@objectstack/lint/runtime';
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
import type { RuntimeAuthoringIssue } from '@objectstack/spec/api';

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
                + `engine's fill (#6153), so this is the one place the answer can come from for a `
                + `scheduled run. A NULL ${ORGANIZATION_FIELD} is not merely untidy: an `
                + `(${ORGANIZATION_FIELD}, …) unique index does not constrain across NULL and org-scoped `
                + `queries never see the row. Alternatively, publish this flow into an organization, or `
                + `give it a trigger that resolves one.`,
        });
    }

    return issues;
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
    /** ADR-0080 SDUI manifest when the host has one. */
    sduiManifest?: unknown;
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
}): RuntimeAuthoringVerdict {
    // D1 — drafts are never gated. Publishing one runs this same function.
    // No rules ran, so there is nothing to report on either half.
    if (args.state !== 'active') return { error: null, advisories: [] };

    const result = runRuntimeAuthoringRules({
        type: args.type,
        item: args.body,
        context: {
            objects: args.objects ?? [],
            permissions: args.permissions ?? [],
            books: args.books ?? [],
        },
        ...(args.sduiManifest !== undefined ? { sduiManifest: args.sduiManifest } : {}),
    });

    // [#6285] The gate-local refusal, folded into the SAME verdict set as the
    // 26 shared rules — deliberately not a second envelope, a second hatch or a
    // second throw site. `runtimeTypes` cannot carry it (Q3=A: the CLI must not
    // judge deployment shape), so this is the one judgement the gate owns; the
    // wiring guard's invariant that this file names no REGISTRY rule is
    // untouched, and everything downstream — the 422, the issues array, the
    // migration hatch, the `rulesRun` disclosure — treats it identically.
    const localIssues = findPlatformScheduleOrgGaps({
        type: args.type,
        name: args.name,
        body: args.body,
        ...(args.organizationId !== undefined ? { organizationId: args.organizationId } : {}),
        orgWallEnforced: args.orgWallEnforced === true,
    });

    // [#4717] The advisory half of D3, now with somewhere to go. The deduped
    // log below is KEPT — it is the operator's channel and costs one Set lookup
    // — but it is no longer the only one: these travel back to the caller in
    // `advisories` and `saveMetaItem` puts them on the 2xx response, which is
    // the channel the Studio / MCP / AI author this gate exists for can
    // actually read.
    const advisories = result.advisories.map(toIssue);

    for (const advisory of result.advisories) {
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
    const summary = issues
        .slice(0, 3)
        .map((i) => `${i.path || i.where || '<root>'}: [${i.rule}] ${i.message}`)
        .join('; ');
    const detail = summary + (issues.length > 3 ? ` (+${issues.length - 3} more)` : '');
    // The registry's own disclosure, plus the gate-local rule when it was
    // applicable to this type. `rulesRun` exists so a caller can tell "clean"
    // from "nothing ran"; a judgement that can refuse a write and never appears
    // here would reintroduce exactly the ambiguity it was added to remove.
    const rulesRun = args.type === 'flow'
        ? [...result.rulesRun, PLATFORM_SCHEDULE_CREATE_RECORD_ORG_MISSING]
        : result.rulesRun;

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

    const err = new Error(
        `[invalid_metadata] ${args.type}/${args.name} failed author-time validation: ${detail}`,
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
