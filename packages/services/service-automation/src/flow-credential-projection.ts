// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The flow credential projection — the ONE definition of what a served flow
 * withholds (#20552, #20590)
 *
 * A flow definition holds two kinds of credential, each a literal in one node
 * kind's `config`:
 *
 *  - **the inbound hook's secret** — the start node's `config.secret`. ADR-0041's
 *    `trigger-api` acceptance criteria give an inbound hook exactly one
 *    credential: "a per-flow secret; HMAC signature verification". It is the
 *    object `AutomationEngine.deriveTriggerBinding` hands `trigger-api`'s
 *    `start()` as `binding.config`, and the key the engine's
 *    `validateApiTriggerSecret` refuses a flow without. Whoever holds it can
 *    sign posts to the hook, and the documented inbound pattern runs
 *    `runAs: 'system'`.
 *  - **an outbound callout's signing secret** — the `http` node's
 *    `config.signingSecret` (`HttpConfigSchema`). The durable arm hands it to
 *    the messaging outbox, which signs every delivery with it; whoever holds it
 *    can forge a delivery the receiving endpoint accepts as this platform's.
 *
 * Until this module every definition read served both verbatim: the
 * automation domain's `GET /:name`, and on the metadata plane the item read,
 * the list read, the layered read, the draft preview, the package export. A
 * credential is never readable back, so the projection below removes it from
 * what is SERVED — and nothing else.
 *
 * {@link FLOW_NODE_CREDENTIAL_KEYS} is the table of those positions, by node
 * kind. `flow-credential-positions.test.ts` holds it to the node config
 * contracts the platform declares: it reads every declared key, and a
 * credential-named one this table does not cover turns it red.
 *
 * ## At every depth a node can sit
 *
 * An ADR-0031 container (`loop`, `parallel`, `try_catch`) holds whole
 * sub-graphs inside its own `config` — the slots `FLOW_REGION_SLOTS` declares
 * — and an `http` callout inside a loop body is served with the flow like any
 * top-level node. So the walk follows those slots, through every region, at
 * every depth. A start node inside a region is not a valid flow, and its
 * secret is withheld there too: under-redacting is the dangerous direction.
 *
 * ## Where it applies, and where it deliberately does not
 *
 * It is registered as the `flow` metadata-type redactor (the
 * `@objectstack/spec/kernel` registry, #8300), so every exit that already
 * applies the per-type redaction — `@objectstack/metadata-protocol`'s
 * `decorateMetadataItem`, the layered and diff reads, the published snapshot —
 * withholds it with no per-door code. The `/automation` domain's definition
 * exits reach the same registry entry through `redactMetadataItem('flow', …)`.
 * One helper, applied where each surface's definition leaves the process.
 *
 * It is NOT applied to anything the engine EXECUTES: redaction is a serving
 * act, and a raw-record consumer keeps reading the stored body
 * (`spec/kernel/metadata-type-redaction.ts`). That is why this plugin binds
 * flows from the protocol's EXECUTION read (`getMetaItemsForExecution`) rather
 * than the served one — a packaged flow's literal reaches the engine only
 * through it.
 *
 * [#20790] And a STORED flow no longer carries its credentials at all: the
 * metadata save door moves every explicit value into the write-only flow
 * credential channel (`flow-credential-channel.ts`), using
 * {@link flowCredentialPositions} and {@link stripFlowCredentialValues} below,
 * so the stored row, its history and its hash hold exactly what a read serves.
 * The engine reads a channel-held credential only at verification (an inbound
 * post) and execution (an `http` node signing); the clone door refuses a
 * source that holds one, literal or channel-held.
 *
 * ## Dropped, not masked
 *
 * A withheld key is REMOVED, the datasource redactor's posture: a mask would be
 * a non-blank string, `validateApiTriggerSecret` would accept it, the outbox
 * would sign with it, and any write path that missed the carry-forward would
 * store the mask as the literal secret — silently. An absent start-node secret
 * is what every registration door already refuses loudly, so a round trip that
 * misses the carry-forward fails at the door instead of arming a hook nobody
 * can sign for.
 *
 * ## The write-path inverse, and the one door that removes a credential
 *
 * `@objectstack/metadata-protocol`'s `carryForwardRedactedValues` is the one
 * inverse, on both planes: a body that carries the projected form — the key
 * absent, exactly what was served — keeps the stored value; an explicit value
 * replaces it. The `redactedKeys` below address each node by its index in the
 * stored body, and the inverse resolves that index to the node's `id` (a
 * flow's node ids are one space across every region), so an edit that
 * reorders `nodes`, or a region's `nodes`, or a `parallel` block's branches,
 * still carries each value back onto the node it came from. And it re-runs
 * this projection over what it carried, so a value never lands on a node whose
 * kind no longer holds that credential (#20590 position 3).
 *
 * Absent therefore means "unchanged", never "removed" — so `signingSecret`,
 * which is optional, needs a door of its own: the empty string
 * ({@link FLOW_CREDENTIAL_CLEARED}). It is what the contract already accepts
 * (`z.string().optional()`), it holds no secret, and the messaging outbox
 * signs only with a non-empty one, so a callout whose secret is cleared is
 * delivered unsigned. It is not withheld: the cleared form is served as written, so a
 * reader can tell "cleared" from "withheld", and a round trip of it keeps it
 * cleared. The start node's secret takes the same value and meets the engine's
 * non-blank refusal, which is the answer an `api` flow with no secret is owed.
 *
 * ## Why registered by this plugin, not built into `@objectstack/spec`
 *
 * The registry's own note prefers a built-in for a type whose rows exist
 * without the owning plugin, because the credential stays live there. This
 * one does not: the hook secret is a credential only to an armed hook, a hook
 * is armed only through this engine, and an `http` node signs only when this
 * engine runs it. The knowledge of which key is the credential lives here too
 * (`validateApiTriggerSecret`, the `http` executor), and `packages/spec`
 * declares no start-node config shape to derive it from, so a spec-side copy
 * would be this package's business rule restated in the contract package
 * (Prime Directive #2).
 */

import { FLOW_REGION_SLOTS_BY_TYPE } from '@objectstack/spec/automation';
import { registerMetadataTypeRedactor } from '@objectstack/spec/kernel';
import type { MetadataRedactionResult, MetadataTypeRedactor } from '@objectstack/spec/kernel';

/** The metadata type this projection is registered under (Prime Directive #3: singular). */
export const FLOW_METADATA_TYPE = 'flow';

/** The start-node `config` key that holds the inbound hook's HMAC secret (ADR-0041). */
export const FLOW_HOOK_SECRET_KEY = 'secret';

/** The `http`-node `config` key that holds the outbound delivery's HMAC signing secret (`HttpConfigSchema`). */
export const HTTP_SIGNING_SECRET_KEY = 'signingSecret';

/**
 * Every credential position a flow node holds, by `node.type` → `config` keys.
 *
 * A `Map`, not an object literal: `node.type` is author-controlled and an open
 * namespace (ADR-0018), and an object lookup would resolve `'constructor'`
 * through `Object`'s prototype — the reason `FLOW_REGION_SLOTS_BY_TYPE` is one.
 */
export const FLOW_NODE_CREDENTIAL_KEYS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
    ['start', [FLOW_HOOK_SECRET_KEY]],
    ['http', [HTTP_SIGNING_SECRET_KEY]],
]);

/**
 * [#20790] What each credential key in {@link FLOW_NODE_CREDENTIAL_KEYS} is,
 * in an administrator's words — the CLASS a refusal or a rotation notice names
 * instead of a node id, a path or a value. Beside the table, so a key added to
 * it gets its label in the same place; a key with no label is named by its
 * spelling.
 */
export const FLOW_CREDENTIAL_CLASS_LABELS: ReadonlyMap<string, string> = new Map<string, string>([
    [FLOW_HOOK_SECRET_KEY, 'the inbound hook secret'],
    [HTTP_SIGNING_SECRET_KEY, 'an outbound signing secret'],
]);

/** The class label of a credential key — {@link FLOW_CREDENTIAL_CLASS_LABELS}, else the key's spelling. */
export function flowCredentialClassLabel(key: string): string {
    return FLOW_CREDENTIAL_CLASS_LABELS.get(key) ?? `the credential at \`${key}\``;
}

/** The class labels of a set of credential keys, deduplicated and joined for a sentence. */
export function flowCredentialClassList(keys: Iterable<string>): string {
    return [...new Set([...keys].map(flowCredentialClassLabel))].sort().join(' and ');
}

/**
 * The explicit clearing value: a credential key set to it holds no credential,
 * so it is served as written rather than withheld — the one unambiguous way to
 * remove an optional credential across a round trip whose absent key means
 * "unchanged".
 */
export const FLOW_CREDENTIAL_CLEARED = '';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * [#20790] One credential POSITION of a flow definition: a node of a kind
 * {@link FLOW_NODE_CREDENTIAL_KEYS} lists, one of its keys, and what the
 * definition carries there.
 *
 *  - `absent`   — the key is not written: the served (withheld) form, so it
 *                 means "unchanged" on a write, and on a stored row it means
 *                 the credential, if any, is held by the write-only channel;
 *  - `cleared`  — {@link FLOW_CREDENTIAL_CLEARED}: no credential, on purpose;
 *  - `value`    — a non-empty string: an explicit credential (a literal);
 *  - `unusable` — anything else: no credential a door can use, and the engine
 *                 refuses it where one is required.
 */
export interface FlowCredentialPosition {
    /** Dotted, item-relative (`nodes.0.config.secret`) — the path spelling `redactedKeys` and the runtime gate use. */
    readonly path: string;
    readonly nodeId: string;
    readonly nodeType: string;
    readonly key: string;
    readonly form: 'absent' | 'cleared' | 'value' | 'unusable';
    /** The literal, for `form: 'value'` only. */
    readonly value?: string;
}

function collectNodePositions(nodes: readonly unknown[], path: string, out: FlowCredentialPosition[]): void {
    nodes.forEach((node, index) => collectNodePosition(node, `${path}.${index}`, out));
}

function collectRegionPositions(region: unknown, path: string, out: FlowCredentialPosition[]): void {
    if (isPlainRecord(region) && Array.isArray(region.nodes)) collectNodePositions(region.nodes, `${path}.nodes`, out);
}

function collectNodePosition(node: unknown, path: string, out: FlowCredentialPosition[]): void {
    if (!isPlainRecord(node) || typeof node.type !== 'string') return;
    const config = isPlainRecord(node.config) ? node.config : undefined;
    // `FlowNodeSchema` requires a string id, and every write reaches the
    // channel after the schema gate; a node without one is not a position.
    if (typeof node.id === 'string') {
        for (const key of FLOW_NODE_CREDENTIAL_KEYS.get(node.type) ?? []) {
            const has = !!config && Object.prototype.hasOwnProperty.call(config, key);
            const raw = has ? config![key] : undefined;
            const form: FlowCredentialPosition['form'] = !has
                ? 'absent'
                : raw === FLOW_CREDENTIAL_CLEARED
                    ? 'cleared'
                    : typeof raw === 'string'
                        ? 'value'
                        : 'unusable';
            out.push({
                path: `${path}.config.${key}`,
                nodeId: node.id,
                nodeType: node.type,
                key,
                form,
                ...(form === 'value' ? { value: raw as string } : {}),
            });
        }
    }
    if (!config) return;
    for (const slot of FLOW_REGION_SLOTS_BY_TYPE.get(node.type) ?? []) {
        const value = config[slot.key];
        const slotPath = `${path}.config.${slot.key}`;
        if (slot.arity === 'one') collectRegionPositions(value, slotPath, out);
        else if (Array.isArray(value)) value.forEach((region, i) => collectRegionPositions(region, `${slotPath}.${i}`, out));
    }
}

/**
 * [#20790] Every credential position of a flow definition, at every depth a
 * node can sit — the same table and the same region walk the projection below
 * uses, so the write-only channel and the read projection cannot disagree
 * about where a credential is. Pure.
 */
export function flowCredentialPositions(definition: unknown): FlowCredentialPosition[] {
    const out: FlowCredentialPosition[] = [];
    if (isPlainRecord(definition) && Array.isArray(definition.nodes)) collectNodePositions(definition.nodes, 'nodes', out);
    return out;
}

/**
 * [#20790] `definition` with every credential key that is not the cleared
 * form removed — the `value` and `unusable` positions of
 * {@link flowCredentialPositions}; `absent` and `cleared` are left as written.
 * Copy-on-write: the input is never mutated, and it is returned by reference
 * when there is nothing to remove. It IS the projection's removal, so a
 * stripped definition is byte-identical to what a read serves, and a stored
 * definition never carries a credential key other than the cleared form.
 */
export function stripFlowCredentialValues<T>(definition: T): T {
    if (!isPlainRecord(definition)) return definition;
    return redactFlowCredentials(definition).item as T;
}

/** Project a list of nodes; `undefined` when nothing in it was withheld. */
function projectNodes(nodes: readonly unknown[], path: string, redactedKeys: string[]): unknown[] | undefined {
    let out: unknown[] | undefined;
    nodes.forEach((node, index) => {
        const projected = projectNode(node, `${path}.${index}`, redactedKeys);
        if (projected === node) return;
        out ??= nodes.slice();
        out[index] = projected;
    });
    return out;
}

/** One region (`{ nodes, edges }`), projected; the input by reference when nothing was withheld. */
function projectRegion(region: unknown, path: string, redactedKeys: string[]): unknown {
    if (!isPlainRecord(region) || !Array.isArray(region.nodes)) return region;
    const nodes = projectNodes(region.nodes, `${path}.nodes`, redactedKeys);
    return nodes ? { ...region, nodes } : region;
}

/** One node: its own credential keys, then every region its kind holds. */
function projectNode(node: unknown, path: string, redactedKeys: string[]): unknown {
    if (!isPlainRecord(node) || typeof node.type !== 'string') return node;
    const config = node.config;
    if (!isPlainRecord(config)) return node;

    let next: Record<string, unknown> | undefined;
    for (const key of FLOW_NODE_CREDENTIAL_KEYS.get(node.type) ?? []) {
        if (!Object.prototype.hasOwnProperty.call(config, key)) continue;
        if (config[key] === FLOW_CREDENTIAL_CLEARED) continue;
        next ??= { ...config };
        delete next[key];
        redactedKeys.push(`${path}.config.${key}`);
    }

    for (const slot of FLOW_REGION_SLOTS_BY_TYPE.get(node.type) ?? []) {
        const value = config[slot.key];
        const slotPath = `${path}.config.${slot.key}`;
        let projected: unknown = value;
        if (slot.arity === 'one') {
            projected = projectRegion(value, slotPath, redactedKeys);
        } else if (Array.isArray(value)) {
            let regions: unknown[] | undefined;
            value.forEach((region, index) => {
                const p = projectRegion(region, `${slotPath}.${index}`, redactedKeys);
                if (p === region) return;
                regions ??= value.slice();
                regions[index] = p;
            });
            projected = regions ?? value;
        }
        if (projected === value) continue;
        next ??= { ...config };
        next[slot.key] = projected;
    }

    return next ? { ...node, config: next } : node;
}

/**
 * Project every credential in {@link FLOW_NODE_CREDENTIAL_KEYS} out of a flow
 * definition, at every depth.
 *
 * Every node of a listed kind is projected — not only the first start node,
 * and not only on a flow whose trigger resolves to `api`. The engine reads the
 * first start node of an `api` flow, but a secret authored anywhere else is
 * still a secret, and under-redacting is the dangerous direction.
 *
 * Pure: the input is never mutated, and when there is nothing to withhold the
 * input is returned by reference with `redactedKeys: []`.
 */
export const redactFlowCredentials: MetadataTypeRedactor = (item): MetadataRedactionResult => {
    const nodes = item.nodes;
    if (!Array.isArray(nodes)) return { item, redactedKeys: [] };

    const redactedKeys: string[] = [];
    const projected = projectNodes(nodes, 'nodes', redactedKeys);
    if (!projected) return { item, redactedKeys: [] };
    return { item: { ...item, nodes: projected }, redactedKeys: redactedKeys.sort() };
};

/**
 * Register {@link redactFlowCredentials} as the `flow` read-path redactor.
 * Idempotent — the registry replaces a same-type entry.
 */
export function registerFlowCredentialRedactor(): void {
    registerMetadataTypeRedactor(FLOW_METADATA_TYPE, redactFlowCredentials);
}
