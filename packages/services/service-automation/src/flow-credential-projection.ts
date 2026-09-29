// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The flow credential projection — the ONE definition of what a served flow
 * withholds (#20552)
 *
 * ADR-0041's `trigger-api` acceptance criteria give an inbound hook exactly one
 * credential: "a per-flow secret; HMAC signature verification". That secret is
 * authored as a literal on the flow's START node, `config.secret` — the object
 * `AutomationEngine.deriveTriggerBinding` hands `trigger-api`'s
 * `start()` as `binding.config`, and the key the engine's
 * `validateApiTriggerSecret` refuses a flow without. Whoever holds it can sign
 * posts to the hook, and the documented inbound pattern runs `runAs: 'system'`.
 *
 * Until this module every definition read served it verbatim: the automation
 * domain's `GET /:name`, and on the metadata plane the item read, the list
 * read, the layered read, the draft preview, the package export. A
 * credential is never readable back, so the projection below removes it from
 * what is SERVED — and nothing else.
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
 * It is NOT applied to anything the engine EXECUTES. The flow map the engine
 * arms triggers from keeps the stored secret, and so does the in-process
 * `getFlow` (the clone door copies a whole definition through it, ADR-0126
 * §7.1): redaction is a serving act, and a raw-record consumer keeps reading
 * the stored body (`spec/kernel/metadata-type-redaction.ts`). That is also why
 * this plugin binds flows from the protocol's EXECUTION read
 * (`getMetaItemsForExecution`) rather than the served one — a binder reading
 * the served view would register every `api` flow without its secret.
 *
 * ## Dropped, not masked
 *
 * The key is REMOVED, the datasource redactor's posture: a mask would be a
 * non-blank string, `validateApiTriggerSecret` would accept it, and any write
 * path that missed the carry-forward would store the mask as the literal HMAC
 * secret — silently. An absent key is what every registration door already
 * refuses loudly, so a round trip that misses the carry-forward fails at the
 * door instead of arming a hook nobody can sign for.
 *
 * ## The write-path inverse
 *
 * `@objectstack/metadata-protocol`'s `carryForwardRedactedValues` is the one
 * inverse, on both planes: a body that carries the projected form — no
 * `secret` on the start node, exactly what was served — keeps the stored
 * secret; an explicit value replaces it. The `redactedKeys` below address the
 * node by its index in the stored body, and the inverse resolves that index to
 * the node's `id`, so an edit that reorders `nodes` still carries the secret
 * back onto the start node it came from.
 *
 * ## Why registered by this plugin, not built into `@objectstack/spec`
 *
 * The registry's own note prefers a built-in for a type whose rows exist
 * without the owning plugin, because the credential stays live there. This
 * one does not: the secret is a credential only to an armed hook, and a hook
 * is armed only through this engine — `trigger-api` registers against the
 * `automation` service and has no other source of flows. The knowledge of
 * which key is the credential lives here too (`validateApiTriggerSecret`), and
 * `packages/spec` declares no start-node config shape to derive it from, so a
 * spec-side copy would be this package's business rule restated in the
 * contract package (Prime Directive #2).
 */

import { registerMetadataTypeRedactor } from '@objectstack/spec/kernel';
import type { MetadataRedactionResult, MetadataTypeRedactor } from '@objectstack/spec/kernel';

/** The metadata type this projection is registered under (Prime Directive #3: singular). */
export const FLOW_METADATA_TYPE = 'flow';

/** The start-node `config` key that holds the inbound hook's HMAC secret (ADR-0041). */
export const FLOW_HOOK_SECRET_KEY = 'secret';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Project the inbound-hook secret out of a flow definition.
 *
 * Every `start` node's `config.secret` is removed — not only the first start
 * node's, and not only on a flow whose trigger resolves to `api`. The engine
 * reads the first start node of an `api` flow, but a secret authored anywhere
 * else is still a secret, and under-redacting is the dangerous direction.
 *
 * Pure: the input is never mutated, and when there is nothing to withhold the
 * input is returned by reference with `redactedKeys: []`.
 */
export const redactFlowCredentials: MetadataTypeRedactor = (item): MetadataRedactionResult => {
    const nodes = item.nodes;
    if (!Array.isArray(nodes)) return { item, redactedKeys: [] };

    const redactedKeys: string[] = [];
    const projected = nodes.map((node, index) => {
        if (!isPlainRecord(node) || node.type !== 'start') return node;
        const config = node.config;
        if (!isPlainRecord(config) || !Object.prototype.hasOwnProperty.call(config, FLOW_HOOK_SECRET_KEY)) {
            return node;
        }
        const { [FLOW_HOOK_SECRET_KEY]: _withheld, ...rest } = config;
        void _withheld;
        redactedKeys.push(`nodes.${index}.config.${FLOW_HOOK_SECRET_KEY}`);
        return { ...node, config: rest };
    });

    if (redactedKeys.length === 0) return { item, redactedKeys: [] };
    return { item: { ...item, nodes: projected }, redactedKeys: redactedKeys.sort() };
};

/**
 * Register {@link redactFlowCredentials} as the `flow` read-path redactor.
 * Idempotent — the registry replaces a same-type entry.
 */
export function registerFlowCredentialRedactor(): void {
    registerMetadataTypeRedactor(FLOW_METADATA_TYPE, redactFlowCredentials);
}
