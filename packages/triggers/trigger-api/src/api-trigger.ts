// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AutomationContext } from '@objectstack/spec/contracts';

/**
 * Structural mirror of the automation engine's `FlowTriggerBinding` — same
 * decoupling pattern as `trigger-schedule` / `trigger-record-change`: this
 * package never imports `service-automation`.
 */
export interface FlowTriggerBinding {
    readonly flowName: string;
    readonly object?: string;
    readonly event?: string;
    readonly condition?: string | { dialect?: string; source?: string; ast?: unknown };
    readonly schedule?: unknown;
    readonly config?: Record<string, unknown>;
    /**
     * The hook's secret, read at VERIFICATION time. The automation engine sets
     * it whenever the flow has a secret — a literal in its start node, or one
     * the write-only flow credential channel holds, in which case `config`
     * carries none. Rejects when a held secret does not come back. A host that
     * binds without that engine leaves it unset and arms from `config.secret`.
     */
    readonly resolveSecret?: () => Promise<string | undefined>;
}

/** Structural mirror of the engine's `FlowTrigger` extension point. */
export interface FlowTrigger {
    readonly type: string;
    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void;
    stop(flowName: string): void;
}

/**
 * The slice of `IQueueService` this trigger needs. Boundary triggers MUST
 * ingest through the queue (ADR-0041 §5): inbound HTTP is the first event
 * source whose rate we don't control, and a slow flow execution may neither
 * drop nor block inbound events. At-least-once delivery; flows should be
 * authored idempotently (an `x-idempotency-key` header passes through to the
 * queue's dedup window).
 */
export interface QueueServiceSurface {
    publish<T = unknown>(queue: string, data: T, options?: { idempotencyKey?: string }): Promise<string>;
    subscribe<T = unknown>(queue: string, handler: (message: { data: T }) => Promise<void> | void): Promise<void>;
    unsubscribe(queue: string): Promise<void>;
}

/** Minimal logger surface (matches core's `ctx.logger`). */
export interface TriggerLogger {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    debug?(msg: string, ...args: unknown[]): void;
}

const QUEUE_PREFIX = 'flow-api';

/**
 * Where an armed hook's secret comes from: the start node's literal, or a
 * reader the engine handed over that reads it at verification time.
 */
type HookSecret =
    | { readonly kind: 'literal'; readonly secret: string }
    | { readonly kind: 'resolved'; readonly resolve: () => Promise<string | undefined> };

/**
 * One armed inbound hook. A secret is required by the type, not only by
 * {@link ApiTrigger.start}'s check: ADR-0041's `trigger-api` acceptance
 * criteria name a per-flow secret and HMAC verification, so a hook without
 * one has no legal shape to be stored in, and {@link ApiTrigger.handleRequest}
 * has no unsigned branch to take.
 */
interface ArmedHook {
    flowName: string;
    hookId: string;
    secret: HookSecret;
    queue: string;
    callback: (ctx: AutomationContext) => Promise<void>;
}

/** The trimmed, non-blank string `value` holds, else `undefined`. */
function usableSecret(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Constant-time string compare (length leak only). */
function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}

/**
 * GitHub/Stripe-style HMAC verification: the sender computes
 * `sha256=<hex hmac of the raw body>` with the shared per-flow secret and
 * sends it as `x-objectstack-signature`.
 */
export function verifySignature(secret: string, rawBody: string, header: string | undefined): boolean {
    if (!header) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    return safeEqual(expected, header.trim());
}

/**
 * `api` flow trigger (ADR-0041 Tier 1) — inbound webhook/HTTP.
 *
 * The engine binds every `type: 'api'` flow to this trigger; `start()` arms a
 * hook (URL path + the required HMAC secret from the start node's `config`)
 * and subscribes a queue consumer that runs the flow. The HTTP side
 * ({@link handleRequest}) validates and **enqueues** — it never executes the
 * flow in-band:
 *
 *   POST /api/v1/automation/hooks/:flowName/:hookId
 *     → 404 unknown flow / wrong hookId
 *     → 401 missing/bad HMAC signature
 *     → 400 non-JSON body
 *     → 202 { accepted, messageId } — queued; a consumer executes the flow
 *
 * The JSON payload is exposed to the flow as the trigger record (`$record` /
 * `record.*`, fields flattened to bare references) plus `params` — the same
 * authoring surface record-change flows use.
 *
 * Start-node config keys:
 *   - `hookId`  — URL path token (default `'default'`); rotate it to revoke
 *                 old URLs without renaming the flow.
 *   - `secret`  — HMAC-SHA256 shared secret. **Required** (ADR-0041): a
 *                 binding with no non-blank `secret` and no
 *                 `resolveSecret` is refused — `start()` throws naming the
 *                 flow, and nothing is armed or subscribed. The automation
 *                 engine refuses the same flow earlier, at registration, so an
 *                 author learns before deploying; this refusal is what holds
 *                 for a host that binds without it. A flow stored through the
 *                 metadata save door keeps its secret in the write-only flow
 *                 credential store instead, and the engine's binding reads it
 *                 per post through `resolveSecret`; a post whose secret cannot
 *                 be read is answered `503`, never verified against nothing.
 */
export class ApiTrigger implements FlowTrigger {
    readonly type = 'api';

    private hooks = new Map<string, ArmedHook>();

    constructor(
        private readonly getQueue: () => QueueServiceSurface | null,
        private readonly logger: TriggerLogger,
    ) {}

    /** Currently armed hooks (for diagnostics/tests). */
    listHooks(): Array<{ flowName: string; hookId: string; signed: boolean }> {
        // Every armed hook is signed: the type admits no unsigned one.
        return [...this.hooks.values()].map(h => ({
            flowName: h.flowName, hookId: h.hookId, signed: true,
        }));
    }

    start(binding: FlowTriggerBinding, callback: (ctx: AutomationContext) => Promise<void>): void {
        const cfg = (binding.config ?? {}) as Record<string, unknown>;
        const hookId = typeof cfg.hookId === 'string' && cfg.hookId.trim() ? cfg.hookId.trim() : 'default';
        const literal = usableSecret(cfg.secret);
        const resolve = typeof binding.resolveSecret === 'function' ? binding.resolveSecret : undefined;
        // ADR-0041 (`trigger-api` acceptance criteria): a per-flow secret and
        // HMAC verification. Refused BEFORE anything is stored or subscribed,
        // so a refused flow leaves no hook behind; the engine's bind catch
        // reports the throw and its binding audit lists the flow as unbound.
        if (!literal && !resolve) {
            throw new Error(
                `[trigger-api] flow '${binding.flowName}' not armed: its start node declares no \`config.secret\`. ` +
                    `An inbound hook is armed only with a per-flow secret that every post is HMAC-verified ` +
                    `against (ADR-0041) — set a non-blank \`config.secret\` on the flow's start node.`,
            );
        }
        const queue = `${QUEUE_PREFIX}:${binding.flowName}`;

        const secret: HookSecret = resolve ? { kind: 'resolved', resolve } : { kind: 'literal', secret: literal! };
        const hook: ArmedHook = { flowName: binding.flowName, hookId, secret, queue, callback };
        this.hooks.set(binding.flowName, hook);

        const q = this.getQueue();
        if (!q) {
            this.logger.warn(
                `[trigger-api] no queue service — inbound posts for flow '${binding.flowName}' will be rejected until one is registered`,
            );
        } else {
            void q.subscribe<{ payload: Record<string, unknown> }>(queue, async (message) => {
                const payload = (message?.data as any)?.payload ?? {};
                await hook.callback({
                    // The webhook body IS the trigger record: `$record`, `record.*`,
                    // and bare field references all resolve, matching how
                    // record-change flows are authored.
                    record: payload,
                    params: { ...payload },
                    event: 'api',
                } as AutomationContext);
            }).catch((err: any) => {
                this.logger.warn(`[trigger-api] subscribe failed for '${queue}': ${err?.message ?? err}`);
            });
        }

        this.logger.info(
            `[trigger-api] armed: POST .../automation/hooks/${binding.flowName}/${hookId} (HMAC required)`,
        );
    }

    stop(flowName: string): void {
        const hook = this.hooks.get(flowName);
        if (!hook) return;
        this.hooks.delete(flowName);
        const q = this.getQueue();
        if (q) void q.unsubscribe(hook.queue).catch(() => { /* already gone */ });
        this.logger.info(`[trigger-api] disarmed: flow '${flowName}'`);
    }

    /**
     * Handle one inbound request. Transport-agnostic: the plugin adapts this
     * to the host HTTP server. Returns the response to send.
     */
    async handleRequest(input: {
        flowName: string;
        hookId: string;
        rawBody: string;
        signatureHeader?: string;
        idempotencyKey?: string;
    }): Promise<{ status: number; body: Record<string, unknown> }> {
        const hook = this.hooks.get(input.flowName);
        // Unknown flow and wrong hookId answer identically — no oracle for
        // probing which flows exist.
        if (!hook || !safeEqual(hook.hookId, input.hookId)) {
            return { status: 404, body: { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'No such hook.' } } };
        }
        // The secret, read now: a rotation applies to the next post. One that
        // cannot be read is the deployment's fault, not the sender's, and is
        // never read as "no secret" — the post is refused without verifying.
        let secret: string | undefined;
        try {
            secret = hook.secret.kind === 'literal' ? hook.secret.secret : usableSecret(await hook.secret.resolve());
        } catch (err: any) {
            this.logger.warn(`[trigger-api] the secret of flow '${hook.flowName}' could not be read: ${err?.message ?? err}`);
            secret = undefined;
        }
        if (!secret) {
            return {
                status: 503,
                body: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'The hook secret is unavailable.' } },
            };
        }
        if (!verifySignature(secret, input.rawBody, input.signatureHeader)) {
            return { status: 401, body: { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } } };
        }

        let payload: Record<string, unknown>;
        try {
            const parsed: unknown = input.rawBody.trim() ? JSON.parse(input.rawBody) : {};
            if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Body must be a JSON object.' } } };
            }
            payload = parsed as Record<string, unknown>;
        } catch {
            return { status: 400, body: { success: false, error: { code: 'INVALID_REQUEST', message: 'Body must be valid JSON.' } } };
        }

        const q = this.getQueue();
        if (!q) {
            return { status: 503, body: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'No queue service is registered.' } } };
        }
        try {
            const messageId = await q.publish(hook.queue, { payload }, {
                idempotencyKey: input.idempotencyKey,
            });
            return { status: 202, body: { accepted: true, messageId } };
        } catch (err: any) {
            this.logger.warn(`[trigger-api] enqueue failed for '${hook.queue}': ${err?.message ?? err}`);
            return { status: 503, body: { success: false, error: { code: 'ENQUEUE_FAILED', message: 'Could not enqueue the trigger message.' } } };
        }
    }
}
