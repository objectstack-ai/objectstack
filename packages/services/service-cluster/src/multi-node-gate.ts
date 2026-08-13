// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Multi-node authorization gate (open mechanism).
 *
 * The open framework ships **no gate** — multi-node is always allowed. A
 * distribution (e.g. the Enterprise Edition) registers a gate to authorize
 * whether the runtime may enable a multi-node (remote-driver) topology — for
 * example, an EE license check. The framework deliberately knows nothing about
 * *why* a gate allows or denies; it only consults the registered decision.
 *
 * When a gate denies, the caller (e.g. `os serve`) **downgrades to single-node**
 * rather than failing — multi-node is an add-on, not a precondition for the
 * runtime to serve. This is distinct from the split-brain guard, which throws
 * on an outright misconfiguration (memory driver declared multi-node).
 *
 * ## Two different questions (#8367)
 *
 * A gate answers one verdict that carries **two** separable facts:
 *
 *   1. *May this deployment run multi-node at all?* — `allowed`. A `false` here
 *      is the unlicensed case: there is no clustering entitlement, so the whole
 *      topology folds back to single-node. That has always been the behaviour
 *      and is unchanged.
 *   2. *Given N replicas, how many are within the paid limit?* — `admitted`.
 *      This is the **licensed overflow** case, and it is a different question:
 *      the deployment IS entitled to cluster, it simply asked for more nodes
 *      than it paid for.
 *
 * Case 2 previously had no way to be expressed. The verdict was a bare boolean,
 * so the only refusal a license could state was `allowed: false` — denying the
 * entire cluster. The maintainer ruled on 2026-08-13 (recorded on cloud#1275)
 * that a licensed `max_nodes` overflow must instead **refuse the excess
 * replicas, run up to the paid limit, and warn loudly** — explicitly NOT a
 * whole-cluster degrade. `admitted` is the seam that makes that verdict
 * expressible.
 *
 * ## ⚠️ The count is ADVISORY at this seam — it is not yet enforcement
 *
 * A count-carrying verdict is **necessary but not sufficient** to make the
 * ruling binding, and nothing in this module should be read as claiming
 * otherwise. The gate is consulted **once per process, at boot, by each replica
 * independently** (`os serve`, packages/cli/src/commands/serve.ts). At that
 * moment a replica has:
 *
 *   - no cluster membership view — nothing tracks which nodes are live;
 *     `nodeId` is generated randomly per process (see `cluster.ts`), and there
 *     is no join/leave registry to count;
 *   - no ordinal — the only count available is `OS_CLUSTER_REPLICAS`, an
 *     operator-*declared* desired count that is **identical in every replica**
 *     (see `split-brain-guard.ts`).
 *
 * So with a cap of 3 and 5 replicas booting, every replica computes the *same*
 * verdict ("3 admitted") and none of them can know whether it is one of the
 * admitted 3 or one of the excess 2. Acting on that verdict locally yields
 * either "all 5 join" (nothing actually refused) or "all 5 refuse" (precisely
 * the whole-cluster degrade the ruling rejects).
 *
 * Making "run N, refuse N+1" genuinely binding needs an **atomic slot claim**
 * against the shared cluster primitives this package already ships (`ILock` /
 * `ICounter` / `IKV` on a remote driver): each booting replica claims a slot,
 * the (N+1)th claim fails, and *that* replica downgrades itself — plus slot
 * release on shutdown and TTL expiry so a crashed replica does not leak its
 * seat. That mechanism does not exist yet and is deliberately out of scope
 * here; this module supplies the verdict it would consume.
 *
 * Until it lands, a consumer should treat `refused > 0` as the trigger for the
 * **loud warning** the ruling requires, not as a licence to deny the cluster.
 *
 * ## Why not a per-node admission callback
 *
 * A `admitNode(nodeId): boolean` shape was considered and rejected on
 * measurement: the registered gate is a **module singleton inside a single
 * replica's process**, with no cross-process state. Each replica's provider
 * would start its own private counter at zero and admit itself, so the shape
 * would *look* like per-replica enforcement while enforcing nothing. A verdict
 * that is honestly advisory is better than a callback that is silently vacuous.
 */

/**
 * The verdict a registered gate returns.
 *
 * Backward compatible by construction: `admitted` is optional, so a gate that
 * returns a bare `{ allowed, reason }` — as the EE distribution does today —
 * remains a valid provider and is interpreted as "no count-based cap".
 */
export interface MultiNodeVerdict {
    /** Whether a multi-node topology is authorized at all. */
    allowed: boolean;
    /** Surfaced in logs. */
    reason?: string;
    /**
     * How many nodes this gate admits. **Omit** for no count-based cap (an
     * allowing gate with no `admitted` admits everything requested). Values are
     * normalized by {@link checkMultiNodeAllowed}: non-finite means uncapped,
     * fractional is floored, negative clamps to 0.
     */
    admitted?: number;
}

export interface MultiNodeGate {
    /**
     * Called before the runtime enables a remote-driver (multi-node) topology.
     * Return `allowed: false` to force single-node; `reason` is surfaced in logs.
     *
     * @param requested - How many nodes the caller intends to run, when it
     *   knows. **Optional**: an existing zero-arg implementation stays valid
     *   (a function of fewer parameters is assignable), which is what keeps
     *   `@objectstack/security-enterprise` working unchanged. Gates that
     *   enforce a cap return {@link MultiNodeVerdict.admitted}.
     */
    allowMultiNode(requested?: number): MultiNodeVerdict;
}

/**
 * A gate verdict normalized by the framework. Consumers read this shape and
 * never have to write `?? 0` fallbacks over a third-party gate's output —
 * normalization belongs at the seam, not in every consumer.
 */
export interface ResolvedMultiNodeVerdict {
    /** Whether a multi-node topology is authorized at all. */
    allowed: boolean;
    /** Surfaced in logs. */
    reason?: string;
    /**
     * How many of the requested nodes may run. **Absent** when the gate imposes
     * no count cap. `0` when the gate denied outright.
     */
    admitted?: number;
    /**
     * How many requested nodes exceed what the gate admits. `0` when uncapped,
     * when the request fits, or when the caller declared no count.
     */
    refused: number;
    /**
     * True only for a **partial** refusal — the licensed-overflow case, where
     * the cluster runs at the cap and the excess is refused. Deliberately
     * `false` for an outright denial (`allowed: false`), which is the separate
     * unlicensed case, so a consumer cannot conflate the two.
     */
    capped: boolean;
}

let registered: MultiNodeGate | undefined;

/**
 * Register the multi-node authorization gate. Last registration wins. A
 * distribution calls this at boot (before the cluster topology is resolved).
 */
export function registerMultiNodeGate(gate: MultiNodeGate): void {
    registered = gate;
}

/** A positive, finite, whole node count — or `undefined` for "not declared". */
function normalizeCount(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.floor(value);
}

/**
 * Resolve the multi-node decision. With no gate registered (open framework),
 * multi-node is allowed and uncapped.
 *
 * @param requested - How many nodes the caller intends to run, when it knows.
 *   Omit when no count is available; the verdict is then reported uncapped
 *   (`refused: 0`) because nothing was counted. Meaningless values (zero,
 *   negative, non-finite) are treated as "not declared".
 *
 * ⚠️ See the module doc: the returned counts are **advisory** — no replica can
 * currently act on them alone to refuse itself. Use `refused > 0` to warn.
 */
export function checkMultiNodeAllowed(requested?: number): ResolvedMultiNodeVerdict {
    const wanted = normalizeCount(requested);

    if (!registered) return { allowed: true, refused: 0, capped: false };

    const verdict = registered.allowMultiNode(wanted);

    // Outright denial (unlicensed): everything asked for is refused, but this is
    // NOT a partial cap — keep `capped` false so consumers can tell the ruled
    // licensed-overflow case apart from the unlicensed one.
    if (!verdict.allowed) {
        return {
            allowed: false,
            ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
            admitted: 0,
            refused: wanted ?? 0,
            capped: false,
        };
    }

    const cap =
        typeof verdict.admitted === 'number' && Number.isFinite(verdict.admitted)
            ? Math.max(0, Math.floor(verdict.admitted))
            : undefined;

    // An allowing gate that declared no cap admits whatever was requested.
    if (cap === undefined) {
        return {
            allowed: true,
            ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
            refused: 0,
            capped: false,
        };
    }

    const admitted = wanted === undefined ? cap : Math.min(cap, wanted);
    const refused = wanted === undefined ? 0 : Math.max(0, wanted - cap);

    return {
        allowed: true,
        ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
        admitted,
        refused,
        capped: refused > 0,
    };
}

/** Clear the registered gate. For tests. */
export function __resetMultiNodeGate(): void {
    registered = undefined;
}
