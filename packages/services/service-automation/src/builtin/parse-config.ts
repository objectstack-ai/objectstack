// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Execute-time `parse()` of a builtin node's config against its Zod contract
 * (#4277 — the enforcement half #4045 deliberately deferred).
 *
 * The contracts in `@objectstack/spec/automation` (`io-node-config.zod.ts`,
 * `builtin-node-config.zod.ts`, `control-flow.zod.ts`) were written by reading
 * what each executor does with `node.config`, and the form↔Zod ledger tests
 * reconcile them against the descriptor forms — but until #4277 nothing
 * `parse()`d them, so `configSchema` provided none of the type / `required`
 * runtime enforcement it appears to promise (`FlowNodeSchema.config` is
 * `z.record(z.unknown())`). This helper is the single seam every
 * contract-carrying builtin runs its config through.
 *
 * ## Where each executor calls this
 *
 * At the executor's **natural read point**, which is not the same for all:
 * `http` interpolates its whole config first and reads the result, so it
 * parses POST-interpolation (its contract describes the interpolated shape —
 * a `{token}` in a typed slot resolves to its value's real type before the
 * contract sees it); everyone else reads the raw stored config key-by-key and
 * parses it as stored, where `{token}` templates are still strings and the
 * string-typed contract slots accept them. `loop` additionally exempts its
 * legacy flat-graph path (no `config.body`) — that shape predates the
 * ADR-0031 construct the contract describes.
 *
 * ## Why failure is a guard refusal, not a routable error
 *
 * A config that fails its contract is wrong METADATA: re-running the flow
 * unchanged can never succeed, and the fix is to edit the node — the exact
 * criteria {@link refuseNode} states ("a missing required config key" is its
 * canonical example). Routing it through a `fault` edge would let one edge
 * silence the contract for a node forever, the same suppression shape #3863
 * closed for the other refuse-to-execute guards.
 *
 * Unknown keys are NOT this seam's job: Zod's default `.strip()` drops them
 * silently here, and `registerFlow()` rejects them loudly at registration
 * (the tightened #4059 check). Type + `required` live here; key membership
 * lives there.
 */

import { refuseNode } from '../guard-refusal.js';

/**
 * Structural view of a Zod schema's `safeParse` — service-automation takes no
 * direct `zod` dependency (the contracts arrive already-built via
 * `@objectstack/spec`), the same boundary that has the form↔Zod ledger tests
 * reading key sets off `.shape` instead of importing zod.
 */
export interface NodeConfigContract<T> {
    safeParse(value: unknown): {
        success: boolean;
        data?: T;
        error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
    };
}

export type ParsedNodeConfig<T> =
    | { ok: true; config: T }
    | { ok: false; refusal: { success: false; error: string; errorClass: 'guard' } };

/** `config.fields[0].name` — the same path spelling the registration-time
 *  undeclared-key diagnostic uses, so both layers report locations alike. */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
    let out = 'config';
    for (const seg of path) {
        out += typeof seg === 'number' ? `[${seg}]` : `.${String(seg)}`;
    }
    return out;
}

/**
 * Parse `config` against the node type's Zod contract. On success returns the
 * parsed config — typed, with the contract's defaults applied — which the
 * executor reads INSTEAD of the raw record. On failure returns a ready-made
 * guard refusal naming every violation with its path, so the step log carries
 * the full prescription instead of the first symptom.
 */
export function parseNodeConfig<T>(
    nodeType: string,
    nodeId: string,
    contract: NodeConfigContract<T>,
    config: unknown,
): ParsedNodeConfig<T> {
    const result = contract.safeParse(config ?? {});
    if (result.success) {
        return { ok: true, config: result.data as T };
    }
    const issues = (result.error?.issues ?? [])
        .map((i) => `${formatIssuePath(i.path)}: ${i.message}`)
        .join('; ');
    return {
        ok: false,
        refusal: refuseNode(
            `${nodeType} '${nodeId}': config does not satisfy the ${nodeType} contract — ${issues || 'invalid config'}. ` +
            `The config is metadata, so re-running changes nothing; fix the node in the flow definition. ` +
            `The declared contract is the node type's configSchema (the Studio form) and the ` +
            `${nodeType} config Zod in @objectstack/spec/automation (#4277).`,
        ),
    };
}
