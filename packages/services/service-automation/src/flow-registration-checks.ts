// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The registration-time checks of {@link AutomationEngine}: what `registerFlow`
 * judges a canonical flow by once the parse has accepted it, the same checks
 * the stored pass (`canonicalizeStoredFlow`) previews, and the cycle walk
 * `canonicalizeFlow` runs.
 *
 * [#25222] Slice 1 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link RegistrationCheckHost}
 * literal holding exactly the members the body reads. The module-level
 * declarations below moved with the bodies because nothing else reads them.
 */

import type { FlowGraph, FlowNodeParsed, FlowParsed } from '@objectstack/spec/automation';
import { DecisionConfigSchema, collectFlowGraphs } from '@objectstack/spec/automation';
import { predicateSlotRefusal, resolveFlowNodeExpressions, structuralConditionRefusal } from '@objectstack/spec/automation';
// [#19939] The `{…}` template dialect retired from the value slots — the one
// judge, shared with `objectstack validate` (`@objectstack/lint` calls the same
// function on the same config), so build and registration give one verdict.
import { flowNodeValueTemplateRefusals } from '@objectstack/spec/automation';
// [#22110] The flow TEXT slots read ADR-0032 §3's `{{ }}` holes — the one judge
// of the single-brace tokens they may still carry, and the one list of where
// those slots are, both shared with `objectstack validate`.
import { flowNodeTextSlotSources, textSlotTemplateRefusal } from '@objectstack/spec/automation';
// [#21982] Which node types the spec judges an undeclared config key for — the
// ONE judge of a builtin's undeclared key, met here through `FlowSchema.parse`.
// `validateNodeConfigKeys` asks it and stands aside for every type it names,
// so no node type has two judges.
import { builtinNodeConfigKeysJudged } from '@objectstack/spec/automation';
// [#17322] The EVALUATED-slot rule, IMPORTED rather than re-derived. It is the
// rule `FlowEdgeSchema.condition` already composes since #15807, so a node's
// `config.condition` — which no schema stands in front of — is held to the same
// notion of "blank" and answers the same published sentence. A second,
// hand-written `trim()` here is exactly the drift the #15662 campaign built the
// shared refusal to prevent. See `checkStructuralCondition` in `registerFlow`.
import { EvaluatedExpressionInputSchema, EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';
import { validateExpression, nearestName } from '@objectstack/formula';
import type { AutomationEngine } from './engine.js';

/**
 * The slice of a descriptor's JSON-Schema `configSchema` that the undeclared-key
 * walk reads (#4045). Structural only — no validation semantics.
 */
export interface ConfigSchemaNode {
    type?: string;
    properties?: Record<string, ConfigSchemaNode>;
    items?: ConfigSchemaNode;
    additionalProperties?: unknown;
}

/**
 * Known-confusable flow-node config keys → precise authoring guidance,
 * appended to the undeclared-key rejection (#4277). The `UNKNOWN_KEY_GUIDANCE`
 * pattern from `object.zod.ts`, scoped per node type so a key name that is
 * wrong on one node but real on another never misfires.
 *
 * Entries are seeded only from documented incidents — a tombstone with no
 * history is noise. The generic rejection already carries the path, the
 * did-you-mean and the declared set; an entry here adds the *mechanism* the
 * author was reaching for.
 *
 * ⚠️ [#21982] UNREAD today: every type keyed below (`create_record`,
 * `update_record`, `delete_record`, `screen`) is one the spec judges
 * ({@link builtinNodeConfigKeysJudged}), so {@link
 * AutomationEngine.validateNodeConfigKeys} stands aside for it and never
 * reaches this table. Each entry's prescription is carried by that type's
 * executor contract (`builtin-node-config.zod.ts`, its strictObject
 * `guidance`), which is what an author now meets, at every door. Kept only
 * until the comments in that spec module stop naming this table; a plugin
 * node type would add its own entry here.
 */
/**
 * The bulk-intent spellings, shared by `update_record` and `delete_record`
 * (#5393) — the same curation `builtin-node-config.zod.ts` carries at the
 * execute-time parse, copied here because this is the FIRST door an author
 * hits (registration, at boot) and #4001's finding is that detection
 * generalizes for free while prose does not.
 *
 * All four were measured against a real `safeParse` while #5225 was diagnosed,
 * back when no spelling of bulk intent — `multi` included — existed on either
 * node. Edit distance reaches `multi` from none of them.
 */
const BULK_INTENT_GUIDANCE: Record<string, string> = {
    bulk: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the concept ' +
        'keeps one name from node config to driver call. Without it the write must name one row by ' +
        'scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    all: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the concept ' +
        'keeps one name from node config to driver call. Without it the write must name one row by ' +
        'scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    multiple: 'Bulk intent is `multi: true` — the data engine\'s own word for it (`options.multi`), so the ' +
        'concept keeps one name from node config to driver call. Without it the write must name one row ' +
        'by scalar `id`; a predicate write is refused by the engine rather than silently widened.',
    options: 'This is the NODE config, not the data engine\'s options bag — declare `multi: true` at the top ' +
        'level of `config`, never `options: { multi: true }`. Translating that declaration into `options.multi` ' +
        'on the engine call is the executor\'s job.',
};

const FLOW_NODE_UNKNOWN_KEY_GUIDANCE: Record<string, Record<string, string>> = {
    create_record: {
        fieldValues:
            'The write map is `fields` — `fieldValues` was an AI-authoring dialect that never had a ' +
            'runtime reader; the fix is the authoring source + this rejection. A runtime alias for it was ' +
            'rejected by design: the node keeps one strict `fields` key rather than two spellings.',
    },
    update_record: {
        fieldValues:
            'The write map is `fields` — `fieldValues` was an AI-authoring dialect that never had a ' +
            'runtime reader, and a runtime alias for it was rejected by design: the node keeps one strict ' +
            '`fields` key rather than two spellings.',
        ...BULK_INTENT_GUIDANCE,
    },
    delete_record: BULK_INTENT_GUIDANCE,
    screen: {
        visibleIf:
            'The visibility predicate is `visibleWhen` (bare CEL, re-evaluated client-side as the ' +
            'user types). A predicate under any other key is never read, so the field always shows — and a ' +
            '`required` field meant to stay hidden then blocks the screen from ever being submitted.',
    },
};

/**
 * One site a registration check refuses (#23317): where it is, the shape
 * found there, and the check's own words for it.
 *
 * A check does not throw: it returns a {@link RegistrationCheckRefusal}, which
 * {@link AutomationEngine.registerFlow} throws and
 * {@link AutomationEngine.canonicalizeStoredFlow} lists site by site. So the
 * stored pass (`os migrate meta --stored`) previews exactly what registration
 * refuses, through the same checks, and a check added to registration is
 * previewed with no second change.
 */
export interface RegistrationCheckSite {
    /**
     * The site's path in the stack the stored pass wraps one flow in —
     * `flows[0].nodes[2].config.title`, `flows[0].edges[1].condition` — the
     * spelling `applyConversionsToFlow` gives a TODO's path, so a site a
     * conversion TODO already names is recognised as the same site.
     */
    readonly path: string;
    /** The shape found at the site, serialized: a source text, a key, a declared value. */
    readonly from: string;
    /** The site's refusal on one line: where it is, then the check's message. */
    readonly detail: string;
}

/**
 * What one registration check refuses in a flow: the error `registerFlow`
 * throws, byte for byte, and every site it names.
 */
export interface RegistrationCheckRefusal {
    readonly message: string;
    readonly sites: readonly RegistrationCheckSite[];
}

/**
 * One key the undeclared-config-key walk finds: the key, its path from the
 * node (`config.fields[0].visibleIf`), and the line its refusal prints.
 */
export interface UndeclaredConfigKey {
    readonly key: string;
    readonly at: string;
    readonly line: string;
}

/** The flow's own path in the stack the stored pass wraps it in: `{ flows: [flow] }`. */
const STORED_FLOW_PATH = 'flows[0]';

/**
 * The stored-pass path of one graph's container — `flows[0]` for the flow's
 * own, `flows[0].nodes[1].config.body` for a loop body — built from
 * {@link FlowGraph.path}, so a nested node is named where the conversion walk
 * (`mapFlowNodeList`) names it.
 */
function storedGraphPath(graph: FlowGraph): string {
    let out = STORED_FLOW_PATH;
    for (const segment of graph.path) out += typeof segment === 'number' ? `[${segment}]` : `.${segment}`;
    return out;
}

/** The stored-pass path of one region-scoped list member, by its index in the graph. */
function storedGraphMemberPath(graph: FlowGraph, list: 'nodes' | 'edges', index: number): string {
    return `${storedGraphPath(graph)}.${list}[${index}]`;
}

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those: fields by value (each is read inside one synchronous
 * call), methods as late-bound closures, so a spy or test double set on the
 * instance is still the one called.
 */
export interface RegistrationCheckHost {
    readonly validateNodeConfigKeys: AutomationEngine['validateNodeConfigKeys'];
    readonly validateDecisionModes: AutomationEngine['validateDecisionModes'];
    readonly validateFlowExpressions: AutomationEngine['validateFlowExpressions'];
    readonly validateApiTriggerSecret: AutomationEngine['validateApiTriggerSecret'];
    readonly registrationChecks: AutomationEngine['registrationChecks'];
    readonly actionDescriptors: AutomationEngine['actionDescriptors'];
    readonly collectUndeclaredConfigKeys: AutomationEngine['collectUndeclaredConfigKeys'];
    readonly deriveTriggerBinding: AutomationEngine['deriveTriggerBinding'];
    readonly logger: AutomationEngine['logger'];
    readonly objectSchemaResolver: AutomationEngine['objectSchemaResolver'];
    readonly valueEnvelopeRefusals: AutomationEngine['valueEnvelopeRefusals'];
}

/** The body of {@link AutomationEngine.registrationChecks}, moved unedited; that method's docblock is its contract. */
export function registrationChecks(
    this: Pick<RegistrationCheckHost, 'validateNodeConfigKeys' | 'validateDecisionModes' | 'validateFlowExpressions' | 'validateApiTriggerSecret'>,
    { advisory }: { advisory: boolean },
): ReadonlyArray<(flowName: string, flow: FlowParsed) => RegistrationCheckRefusal | undefined> {
    return [
        // #4277 — config keys the node's descriptor does not declare (the
        // tightened #4059 warning; a `visibleIf` typo used to register in
        // silence), with per-key prescriptions: see validateNodeConfigKeys
        // for why the #4045 reconciliation made this safe, and for the
        // deliberate exemptions (`assignment`, schemaless types, keyValue
        // maps). [#21982] Only for the types the spec does not judge —
        // plugin node types (#22343: `try_catch` was the last builtin here);
        // every builtin's undeclared key was refused by `FlowSchema.parse`.
        (flowName, flow) => this.validateNodeConfigKeys(flowName, flow),
        // #15429 — every `decision` node's config against the spec's
        // `DecisionConfigSchema`, refused on an invalid `mode` with the
        // schema's own sentence — the same answer `os validate` gives.
        (flowName, flow) => this.validateDecisionModes(flowName, flow),
        // ADR-0032 §Decision 1a — every predicate parse-validated, so a
        // malformed condition (e.g. the #1491 `{record.x}` template-brace-in-
        // CEL mistake) is a LOUD registration error with the offending
        // source, not a silent runtime `false`: a broken predicate is never
        // safe to run.
        (flowName, flow) => this.validateFlowExpressions(flowName, flow, { advisory }),
        // ADR-0041 — an `api` flow's inbound hook requires a per-flow
        // secret, refused at the publish seam so the author learns before
        // deploying; `trigger-api`'s own `start()` refuses the same binding
        // for a host that binds without this engine.
        (flowName, flow) => this.validateApiTriggerSecret(flowName, flow),
    ];
}

/** The body of {@link AutomationEngine.registrationCheckRefusals}, moved unedited; that method's docblock is its contract. */
export function registrationCheckRefusals(this: Pick<RegistrationCheckHost, 'registrationChecks'>, flowName: string, flow: FlowParsed): RegistrationCheckRefusal[] {
    const refusals: RegistrationCheckRefusal[] = [];
    for (const check of this.registrationChecks({ advisory: false })) {
        let refusal: RegistrationCheckRefusal | undefined;
        try {
            refusal = check(flowName, flow);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            refusal = { message, sites: [{ path: STORED_FLOW_PATH, from: JSON.stringify(flowName), detail: message }] };
        }
        if (refusal) refusals.push(refusal);
    }
    return refusals;
}

/** The body of {@link AutomationEngine.validateNodeConfigKeys}, moved unedited; that method's docblock is its contract. */
export function validateNodeConfigKeys(this: Pick<RegistrationCheckHost, 'actionDescriptors' | 'collectUndeclaredConfigKeys'>, flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
    const violations: string[] = [];
    const sites: RegistrationCheckSite[] = [];
    // #4389 — every graph, not just the flow's own. `visibleIf` is the typo
    // this check exists to catch, and moving the node into a `loop` body
    // used to restore the silence #4277 closed. No double-reporting from the
    // container side: all three container descriptors declare their region
    // slot as a bare `nodes: { type: 'array' }` with no `items`, so the
    // schema-lockstep walk stops there rather than descending twice.
    for (const graph of collectFlowGraphs(flow)) {
        graph.nodes.forEach((node, index) => {
            // `assignment` config keys are the author's variable names — see the
            // exemption note above.
            if (node.type === 'assignment') return;
            // [#21982] The spec judged this type's keys in `FlowSchema.parse`:
            // one judge per type, never two.
            if (builtinNodeConfigKeysJudged(node.type)) return;
            const schema = this.actionDescriptors.get(node.type)?.configSchema as ConfigSchemaNode | undefined;
            if (!schema) return;
            const found: UndeclaredConfigKey[] = [];
            this.collectUndeclaredConfigKeys(node, schema, node.config, 'config', found);
            for (const key of found) {
                const v = graph.scope ? `${graph.scope} · ${key.line}` : key.line;
                violations.push(v);
                sites.push({
                    path: `${storedGraphMemberPath(graph, 'nodes', index)}.${key.at}`,
                    from: JSON.stringify(key.key),
                    detail: v,
                });
            }
        });
    }
    if (violations.length === 0) return undefined;
    return {
        sites,
        message:
            `Flow '${flowName}' rejected: ${violations.length} undeclared config key(s).\n` +
            violations.map((v) => `  - ${v}`).join('\n') +
            `\nAn undeclared key is never read, so it can only be a typo or dead config — fix the ` +
            `flow's metadata (rename or remove the key). If an executor genuinely reads this key, ` +
            `declare it on the node type's descriptor configSchema instead: the built-in node types were ` +
            `reconciled so every key their executors read is declared, and a read-but-undeclared key is ` +
            `exactly the drift that reconciliation removed.`,
    };
}

/** The body of {@link AutomationEngine.validateDecisionModes}, moved unedited; that method's docblock is its contract. */
export function validateDecisionModes(flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
    const failures: string[] = [];
    const sites: RegistrationCheckSite[] = [];
    for (const graph of collectFlowGraphs(flow)) {
        const at = graph.scope ? `${graph.scope}: ` : '';
        graph.nodes.forEach((node, index) => {
            if (node.type !== 'decision') return;
            const verdict = DecisionConfigSchema.safeParse(node.config ?? {});
            if (verdict.success) return;
            for (const issue of verdict.error.issues) {
                if (issue.path[0] !== 'mode') continue;
                const detail = `${at}node '${node.id}' (decision) at config.mode: ${issue.message}`;
                failures.push(`  • ${detail}`);
                sites.push({
                    path: `${storedGraphMemberPath(graph, 'nodes', index)}.config.mode`,
                    from: JSON.stringify((node.config as Record<string, unknown> | undefined)?.mode ?? null),
                    detail,
                });
            }
        });
    }
    if (failures.length === 0) return undefined;
    return {
        sites,
        message:
            `Flow '${flowName}' rejected: ${failures.length} invalid decision \`mode\` ` +
            `declaration${failures.length > 1 ? 's' : ''}. The config is metadata, so re-registering ` +
            `changes nothing; fix the node in the flow definition:\n${failures.join('\n')}`,
    };
}

/** The body of {@link AutomationEngine.validateApiTriggerSecret}, moved unedited; that method's docblock is its contract. */
export function validateApiTriggerSecret(this: Pick<RegistrationCheckHost, 'deriveTriggerBinding'>, flowName: string, flow: FlowParsed): RegistrationCheckRefusal | undefined {
    const resolved = this.deriveTriggerBinding(flowName, flow);
    if (resolved?.triggerType !== 'api') return undefined;
    const config = (resolved.binding.config ?? {}) as Record<string, unknown>;
    if (typeof config.secret === 'string' && config.secret.trim() !== '') return undefined;
    // [#20790] …or the write-only credential channel holds it: a flow stored
    // through the metadata save door keeps no secret in its definition, and
    // its binding carries the reader instead. Only for the WITHHELD form —
    // `hookSecretResolver` yields no reader for a start node that writes
    // `secret: ''` (cleared), so that one is refused below whatever the
    // channel still holds.
    if (resolved.binding.resolveSecret) return undefined;
    const asks = [
        flow.type === 'api' ? "`type: 'api'`" : undefined,
        config.triggerType === 'api' ? "start-node `config.triggerType: 'api'`" : undefined,
    ].filter((s): s is string => s !== undefined);
    const why =
        `it binds the inbound \`api\` trigger (${asks.join(' and ')}) but its ` +
        `start node declares no \`config.secret\`. An inbound hook is armed only with a per-flow secret that ` +
        `every post is HMAC-verified against (ADR-0041), so this flow could never be armed. Name the secret in ` +
        `the start node's \`config.secretRef\` (the deployment fills that name; the engine reads it at every ` +
        `post), or set a non-blank \`config.secret\`. A flow that is only ever started explicitly and never receives ` +
        `inbound posts is \`type: 'autolaunched'\`, with no \`triggerType: 'api'\` on its start node.`;
    // The site is the start node's `config.secret`, the key the author sets
    // (the flow itself when it has no start node). What was found there is
    // shown only as a blank string or `null`: a secret that is set clears
    // this check, so nothing this prints can be one.
    const startIndex = flow.nodes.findIndex((n) => n.type === 'start');
    const found = typeof config.secret === 'string' ? config.secret : null;
    return {
        message: `Flow '${flowName}' rejected: ${why}`,
        sites: [{
            path: startIndex < 0 ? STORED_FLOW_PATH : `${STORED_FLOW_PATH}.nodes[${startIndex}].config.secret`,
            from: JSON.stringify(found),
            detail: `${startIndex < 0 ? 'the flow' : `node '${flow.nodes[startIndex]!.id}' (start) at config.secret`}: ${why}`,
        }],
    };
}

/** The body of {@link AutomationEngine.collectUndeclaredConfigKeys}, moved unedited; that method's docblock is its contract. */
export function collectUndeclaredConfigKeys(
    this: Pick<RegistrationCheckHost, 'collectUndeclaredConfigKeys'>,
    node: FlowNodeParsed,
    schema: ConfigSchemaNode,
    value: unknown,
    path: string,
    violations: UndeclaredConfigKey[],
): void {
    if (schema.type === 'array' && schema.items) {
        if (!Array.isArray(value)) return;
        value.forEach((element, index) => {
            this.collectUndeclaredConfigKeys(node, schema.items!, element, `${path}[${index}]`, violations);
        });
        return;
    }

    // A free-form map declares no properties — its keys are author data.
    if (!schema.properties || schema.additionalProperties === true) return;
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return;

    const declared = Object.keys(schema.properties);
    for (const key of Object.keys(value as Record<string, unknown>)) {
        const child = schema.properties[key];
        if (child) {
            this.collectUndeclaredConfigKeys(node, child, (value as Record<string, unknown>)[key], `${path}.${key}`, violations);
            continue;
        }
        // The declared set is printed ALWAYS, not only as a fallback when the
        // edit-distance heuristic misses. It misses more than you would
        // expect: `visibleIf` → `visibleWhen` is distance 4 against a
        // threshold of 3, so the very typo this check exists to catch gets no
        // suggestion. Loosening `nearestName` is the wrong fix — it is shared
        // with the unknown-field and unknown-role diagnostics, where a looser
        // threshold means confidently wrong suggestions over hundreds of
        // candidates. A config object declares at most a dozen keys, so simply
        // listing them is both cheap and complete, and the suggestion becomes
        // a bonus for the cases it does catch.
        const suggestion = nearestName(key, declared);
        const guidance = FLOW_NODE_UNKNOWN_KEY_GUIDANCE[node.type]?.[key];
        violations.push({
            key,
            at: `${path}.${key}`,
            line:
                `node '${node.id}' (${node.type}): unknown config key \`${key}\` at ${path}.${key}` +
                (suggestion ? ` — did you mean \`${suggestion}\`?` : '') +
                ` It is not declared by this node type's configSchema, so nothing reads it.` +
                ` Declared here: ${declared.join(', ')}.` +
                (guidance ? ` ${guidance}` : ''),
        });
    }
}

/** The body of {@link AutomationEngine.validateFlowExpressions}, moved unedited; that method's docblock is its contract. */
export function validateFlowExpressions(
    this: Pick<RegistrationCheckHost, 'logger' | 'objectSchemaResolver' | 'valueEnvelopeRefusals'>,
    flowName: string,
    flow: FlowParsed,
    { advisory }: { advisory: boolean },
): RegistrationCheckRefusal | undefined {
    const failures: string[] = [];
    const sites: RegistrationCheckSite[] = [];
    /** One failure: its line in the thrown message, and its site for the stored pass. */
    const refuse = (path: string, where: string, message: string, source: unknown): void => {
        failures.push(`  • ${where}: ${message}\n      source: \`${source}\``);
        sites.push({ path, from: JSON.stringify(String(source)), detail: `${where}: ${message}` });
    };

    // Resolve the flow's record-change target object (start node's
    // `config.objectName`) so `record.*`/bare field refs can be checked
    // against the real schema. Absent resolver / non-record flow → the hint
    // is undefined and only the fatal syntax/bare-ref pass runs (unchanged).
    const startNode = flow.nodes.find((n) => n.type === 'start');
    const objectName = ((startNode?.config ?? {}) as Record<string, unknown>).objectName;
    const schemaHint = typeof objectName === 'string'
        ? (() => {
            const s = this.objectSchemaResolver?.(objectName);
            return s ? { objectName, fields: s.fields, fieldTypes: s.fieldTypes, scope: 'flattened' as const } : undefined;
        })()
        : undefined;

    const check = (path: string, where: string, raw: unknown, useSchemaHint = true): void => {
        if (raw == null) return;
        // Fatal pass — syntax, brace-in-CEL, unknown-function (ADR-0032 §5).
        // Unchanged: matches the CLI build's fatal set exactly.
        const result = validateExpression('predicate', raw as string | { dialect?: string; source?: string });
        for (const e of result.errors) {
            refuse(path, where, e.message, e.source);
        }
        // Advisory schema-aware pass — only when the source is syntactically
        // valid (else it would just re-report the fatal error). Everything it
        // finds (field-existence, tier-3 typo, tier-4 type mismatch) is LOGGED,
        // never thrown, so registration behaviour is strictly additive (#1928).
        if (advisory && useSchemaHint && result.errors.length === 0 && schemaHint) {
            const schemaPass = validateExpression('predicate', raw as string | { dialect?: string; source?: string }, schemaHint);
            for (const issue of [...schemaPass.errors, ...schemaPass.warnings]) {
                // #6499's separately-argued 14th site — the OPPOSITE cause
                // of the thrown-text seams: no foreign thrown value is
                // involved; this message simply AUTHORED a second physical
                // line (`\n      source: …`) into a one-record-per-call
                // logger, and `issue.source` is the flow AUTHOR's
                // expression text, whose line count is theirs (CEL is
                // newline-tolerant). Same downstream damage as the family
                // (see `forgetSuspendedRun`'s catch, #6299), same fix
                // shape: the message stays one line (`issue.message`
                // embeds at most identifier names, which cannot carry
                // newlines), the source moves to the structured slot.
                //
                // #4632 verdict: FUNCTIONAL — stays `warn` BY CONTRACT:
                // #1928 defines this advisory schema pass as logged-never-
                // thrown and strictly additive to registration; a finding
                // here must not fail or alarm a flow that registers
                // cleanly.
                this.logger.warn(`[flow '${flowName}'] ${where}: ${issue.message}`, { source: issue.source });
            }
        }
    };

    /**
     * [#15662] The STRUCTURAL condition surfaces — `config.condition` on any
     * node and `edge.condition` — refused on SHAPE before anything tries to
     * read a source out of them.
     *
     * ⚠️ Not `predicateSlotRefusal`, the ledger arm's rule, and the
     * difference is measured rather than assumed: `FlowEdgeSchema.condition`
     * is `EvaluatedExpressionInputSchema` (#15807), whose string arm
     * transforms into `{ dialect: 'cel', source }`, so after
     * `FlowSchema.parse` EVERY authored edge condition is an envelope — the
     * ledger rule here would refuse every conditional edge in every flow.
     * An envelope written at a node's `config.condition` is likewise passed
     * through verbatim by the open `z.record` and evaluated correctly
     * (#4336). Both are legitimate; `structuralConditionRefusal` admits them
     * — an envelope carrying a string `source`, that is. Since #15807 an
     * `ast`-only envelope is NOT admitted on either slot: the edge schema
     * refuses it one step earlier at `FlowSchema.parse`, and on
     * `config.condition` (an open record, so no schema stands in front) this
     * pass is the producer-side gate, refusing what `evaluateCondition`
     * would otherwise read as an empty condition.
     *
     * What it refuses is the value that is neither text nor an expression.
     * `evaluateCondition` reads `expression?.source ?? ''` and the
     * empty-source arm answers `false` — "an unauthored branch must not
     * open", applied to a value that was authored — so `42` / `true` /
     * `['a']` registered clean and ran silently, on the same key the start
     * node's trigger gate is read from. Same severity as a malformed
     * predicate (this throws): the reject set of registration and the reject
     * set of evaluation must be one set.
     *
     * [#17322] SECOND gate, after the shape one and before the CEL one: the
     * source must be non-blank. `structuralConditionRefusal` admits every
     * string by design, so a whitespace-only `config.condition` passed here
     * and landed on `evaluateCondition`'s empty-source arm — a SILENT
     * `false`, i.e. a branch that never runs, forever, under a comment that
     * names that arm as being for an UNAUTHORED condition. `'   '` was
     * authored, and on a `start` node that key is the trigger gate. Since
     * #15807 the EDGE door refuses exactly this value at
     * `FlowSchema.parse`, and 带治理的一侧胜出,另一侧改绑: the node door,
     * which has no schema in front of it, aligns to the governed side HERE,
     * at the producer.
     */
    const evaluatedSourceRefusal = (raw: unknown): { message: string; source: string } | undefined => {
        // Reached only after `structuralConditionRefusal` cleared the value,
        // so `raw` is bare text or an envelope carrying a string `source`.
        const source = typeof raw === 'string' ? raw : (raw as { source?: unknown }).source;
        if (typeof source !== 'string') return undefined;
        // The rule and its sentence both come from the edge door's own
        // schema. Applied to the SOURCE rather than to the whole value on
        // purpose: the union would also refuse an envelope with no
        // `dialect` or a dialect outside its enum, both of which this slot
        // admits (`structuralConditionRefusal`'s docblock, and #4336) — and
        // refusing them would widen this narrowing past what was ruled.
        const verdict = EvaluatedExpressionInputSchema.safeParse(source);
        if (verdict.success) return undefined;
        return { message: verdict.error.issues[0]?.message ?? EVALUATED_EXPRESSION_SOURCE_REQUIRED, source };
    };

    const checkStructuralCondition = (path: string, where: string, raw: unknown): void => {
        if (raw == null) return;
        const shapeRefusal = structuralConditionRefusal(raw);
        if (shapeRefusal) {
            refuse(path, where, shapeRefusal.message, shapeRefusal.source);
            return;
        }
        const blankRefusal = evaluatedSourceRefusal(raw);
        if (blankRefusal) {
            refuse(path, where, blankRefusal.message, blankRefusal.source);
            return;
        }
        check(path, where, raw);
    };

    // #4347 — every graph in the flow, not just the top-level arrays. An
    // ADR-0031 container keeps a whole sub-graph in its `config`, so
    // iterating `flow.nodes`/`flow.edges` checked PART of the flow while
    // reporting on all of it: the `{record.x}` brace-trap this pass exists
    // to catch registered in silence one level in, and the flow then failed
    // at run time with the loud diagnostic suppressed. `scope` names the
    // region so a nested finding says where it is.
    for (const graph of collectFlowGraphs(flow)) {
        const at = graph.scope ? `${graph.scope}: ` : '';
        for (const [index, node] of graph.nodes.entries()) {
            const nodePath = storedGraphMemberPath(graph, 'nodes', index);
            const cfg = (node.config ?? {}) as Record<string, unknown>;
            // start-node trigger gate + decision/branch predicates live in config.condition
            checkStructuralCondition(`${nodePath}.config.condition`, `${at}node '${node.id}' (${node.type}) condition`, cfg.condition);

            // [#19939] The value slots' OTHER form — a literal — refused where
            // it still spells the retired `{…}` template dialect (the C half
            // of #11182 ruling D). Every value the ledger's `value` role holds
            // is walked (`resolveFlowNodeValueSlots`, inside the judge), plus
            // the two legacy `assignment` shapes the executor still reads, so
            // neither shape is a way around the refusal. The executors refuse
            // the same set at run time — `parseNodeConfig` through
            // `FlowValueSlotSchema` on the CRUD nodes, the same call on the
            // `assignment` node — so a flow that registers is never refused
            // there, and vice versa.
            //
            // [#27968] The node is handed for its sibling blocks: a
            // `connector_action` node's `connectorConfig.input` is a value slot
            // the ledger roots in that block, located as `connectorConfig.…`.
            for (const refusal of flowNodeValueTemplateRefusals(node.type, node.config, node)) {
                refuse(
                    `${nodePath}.${refusal.block}.${refusal.path}`,
                    `${at}node '${node.id}' (${node.type}) ${refusal.label} at ${refusal.block}.${refusal.path}`,
                    refusal.message,
                    refusal.source,
                );
            }

            // [#22110] The TEXT slots (a notify `title` / `message`, a screen
            // `title` / `description`, an `end` `message`) render ADR-0032
            // §3's `{{ }}` holes. A single-brace token left from the 17.x
            // dialect is refused with its hole spelling (the spec's one
            // judge — the node contracts refuse the same set at parse), and
            // a slot carrying none is compiled as the template it is, so a
            // hole holding logic or an unknown formatter stops the flow here
            // instead of throwing at the node mid-run.
            for (const slot of flowNodeTextSlotSources(node.type, node.config)) {
                const slotPath = `${nodePath}.config.${slot.path}`;
                const slotWhere = `${at}node '${node.id}' (${node.type}) ${slot.label} at config.${slot.path}`;
                const tokenRefusal = textSlotTemplateRefusal(slot.source);
                if (tokenRefusal !== undefined) {
                    refuse(slotPath, slotWhere, tokenRefusal, slot.source);
                    continue;
                }
                for (const e of validateExpression('template', slot.source).errors) {
                    refuse(slotPath, slotWhere, e.message, slot.source);
                }
            }

            // Descriptor-declared expression slots (#4027). The ledger names them
            // per node type and carries the dialect each one takes, so a declared
            // key like `screen.fields[].visibleWhen` is checked as the bare CEL it
            // is — the traversal gap that let #3528 ship a `{var}` predicate.
            //
            // A `predicate` slot is checked as bare CEL, and a `value` slot's
            // envelope as a CEL value (#15137) — the two roles the ledger has
            // since #19939 retired the single-brace one with the `loop` / `map`
            // `collection` it recorded.
            //
            // [#27968] Handed the node, the ledger reaches a slot rooted in a
            // sibling block too — a `connector_action` node's
            // `connectorConfig.input` — and names the block it is in.
            for (const found of resolveFlowNodeExpressions(node.type, node.config, node)) {
                const slotPath = `${nodePath}.${found.block}.${found.path}`;
                const slotWhere =
                    `${at}node '${node.id}' (${node.type}) ${found.entry.label} at ${found.block}.${found.path}`;
                // [#15137] `value` slots — the ruled `assignment.assignments.*`
                // and, since #19938, `create_record` / `update_record`
                // `fields.*`. The resolver emits ONLY envelope-shaped objects
                // for this role (a plain string there is literal text, whose
                // `{token}` the value-slot judge above refuses, and every other
                // literal is data), so everything
                // that arrives here is an author saying "this is an
                // expression" and must be a valid one. Same severity as a
                // predicate — a malformed envelope stops the flow registering
                // — because the alternative is what these cards replaced: the
                // envelope stored verbatim (a variable `notify` rendered as
                // JSON, a record column holding the envelope object), with
                // nothing said at any layer.
                if (found.entry.role === 'value') {
                    for (const refusal of this.valueEnvelopeRefusals(found.value)) {
                        refuse(slotPath, slotWhere, refusal.message, refusal.source);
                    }
                    continue;
                }
                if (found.entry.role !== 'predicate') continue;
                // [#15572] A predicate slot is declared bare CEL TEXT
                // (`z.string()`), and until now a NON-string there was seen
                // by nobody: the resolver skipped it for "the schema pass"
                // to report, `validateNodeConfigKeys` exempts the schemaless
                // types that own two of these slots, and `evaluateCondition`
                // accepted the `{ dialect, source }` envelope regardless —
                // so a `decision` branch predicate written as an envelope
                // registered clean and only the evaluator ever read it.
                // Same severity as a malformed predicate (this throw): the
                // reject set of registration and the reject set of
                // evaluation must be one set, and the refusal itself is the
                // spec's, shared with `objectstack validate` so build and
                // author time cannot disagree about the shape.
                //
                // [#17493] The same call now refuses a BLANK string too: the
                // resolver emits it for this role, and `predicateSlotRefusal`
                // refuses it under the same sentence. ⚠️ For that value this
                // is the second line, not the first — `FlowSchema.parse`
                // (in `canonicalizeStoredFlow`, above) refuses it before
                // this pass runs, the same way it meets a blank
                // `edge.condition` before `checkStructuralCondition` does.
                const shapeRefusal = predicateSlotRefusal(found.value);
                if (shapeRefusal) {
                    refuse(slotPath, slotWhere, shapeRefusal.message, shapeRefusal.source);
                    continue;
                }
                // No schema hint: a screen's `visibleWhen` binds the screen's OWN
                // collected values, not the trigger record's fields, so the
                // field-existence pass would report every field name as unknown.
                check(slotPath, slotWhere, found.value, false);
            }
        }
        for (const [index, edge] of graph.edges.entries()) {
            checkStructuralCondition(
                `${storedGraphMemberPath(graph, 'edges', index)}.condition`,
                `${at}edge '${edge.id}' (${edge.source}→${edge.target}) condition`,
                edge.condition as unknown,
            );
        }
    }

    if (failures.length === 0) return undefined;
    return {
        sites,
        message:
            `Flow '${flowName}' has ${failures.length} invalid expression${failures.length > 1 ? 's' : ''} (ADR-0032 §1a). ` +
            `Predicates — conditions and declared bare-CEL slots such as a screen field's \`visibleWhen\` — ` +
            `must not wrap references in \`{…}\` template braces, and neither may a value slot (a computed ` +
            `value is a CEL envelope, the list a \`loop\` or \`map\` iterates included):\n` +
            `${failures.join('\n')}`,
    };
}

/** The body of {@link AutomationEngine.detectCycles}, moved unedited; that method's docblock is its contract. */
export function detectCycles(flow: FlowParsed): void {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string>();

    // Build adjacency list from edges
    const adj = new Map<string, string[]>();
    for (const node of flow.nodes) {
        color.set(node.id, WHITE);
        adj.set(node.id, []);
    }
    for (const edge of flow.edges) {
        if (edge.type === 'back') continue; // ADR-0044 declared back-edge
        const targets = adj.get(edge.source);
        if (targets) targets.push(edge.target);
    }

    const dfs = (nodeId: string): string[] | null => {
        color.set(nodeId, GRAY);
        for (const neighbor of adj.get(nodeId) ?? []) {
            if (color.get(neighbor) === GRAY) {
                // Back edge found — reconstruct cycle
                const cycle = [neighbor, nodeId];
                let cur = nodeId;
                while (cur !== neighbor) {
                    cur = parent.get(cur)!;
                    if (cur) cycle.push(cur);
                    else break;
                }
                return cycle.reverse();
            }
            if (color.get(neighbor) === WHITE) {
                parent.set(neighbor, nodeId);
                const result = dfs(neighbor);
                if (result) return result;
            }
        }
        color.set(nodeId, BLACK);
        return null;
    };

    for (const node of flow.nodes) {
        if (color.get(node.id) === WHITE) {
            const cycle = dfs(node.id);
            if (cycle) {
                throw new Error(
                    `Flow contains a cycle: ${cycle.join(' → ')}. Only DAG flows are allowed — ` +
                    `to author an intentional rework loop, mark the cycle-closing edge with type: 'back' (ADR-0044).`,
                );
            }
        }
    }
}
