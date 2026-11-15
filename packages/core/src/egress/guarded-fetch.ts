// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type Socket } from 'node:net';
import { Agent, buildConnector } from 'undici';
import { createEnvEgressPolicy, EGRESS_ALLOWED_TARGETS_ENV, type EgressContext, type EgressDecision, type EgressPolicy } from './policy.js';

/**
 * The guarded outbound fetch: every connection a request opens — the first
 * hop and every redirect hop — goes through one connector that resolves the
 * host, hands EACH address to the {@link EgressPolicy}, and connects the socket
 * to the address it judged (never re-resolving), then re-judges the socket's
 * own remote address. A literal-IP url is judged the same way.
 *
 * The request itself is `globalThis.fetch` with this connector's dispatcher:
 * never a bare fetch. A refused connect rejects with a `fetch failed` whose
 * `cause` is an {@link EgressRefusedError}; {@link findEgressRefusal} reads it.
 */

/** The error code a refused connect carries. */
export const EGRESS_REFUSED = 'EGRESS_REFUSED';

/**
 * A connect the policy refused. `message` is tenant-safe: it names the
 * requested host and the rule, never the resolved address or its class — those
 * are in {@link EgressRefusedError.decision}'s privileged `reason`.
 */
export class EgressRefusedError extends Error {
    readonly code = EGRESS_REFUSED;
    constructor(
        readonly hostname: string,
        readonly decision: EgressDecision,
    ) {
        super(
            `${EGRESS_REFUSED}: the request to ${hostname} was not sent — outbound requests reach only public ` +
                `addresses, and this target is not public and not on the operator's egress allowlist ` +
                `(${EGRESS_ALLOWED_TARGETS_ENV}; link-local and cloud metadata addresses cannot be listed)`,
        );
        this.name = 'EgressRefusedError';
    }
}

/** The {@link EgressRefusedError} an error carries, walking its `cause` chain; `undefined` when none. */
export function findEgressRefusal(err: unknown): EgressRefusedError | undefined {
    let current: unknown = err;
    for (let depth = 0; depth < 6 && current; depth++) {
        if (current instanceof EgressRefusedError) return current;
        const c = current as { code?: unknown; name?: unknown; cause?: unknown };
        if (c.code === EGRESS_REFUSED && c.name === 'EgressRefusedError') return current as EgressRefusedError;
        current = c.cause;
    }
    return undefined;
}

/** A resolver: every address a host name resolves to. */
export type EgressResolver = (hostname: string) => Promise<ReadonlyArray<{ address: string }>>;

const defaultResolver: EgressResolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** The logger the guard reports refusals to (operator-facing, with the privileged reason). */
export interface EgressLogger {
    info?: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Options for {@link createEgressGuard}. */
export interface EgressGuardOptions {
    /** The policy; defaults to {@link createEnvEgressPolicy} (reads `OS_EGRESS_ALLOWED_TARGETS`). */
    policy?: EgressPolicy;
    /** DNS override (tests). */
    resolve?: EgressResolver;
    /** Where refusals are logged. */
    logger?: EgressLogger;
}

/** The init the guarded fetch takes — what both callers send. */
export interface EgressFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}

/** The installed guard: the policy and the one fetch every guarded caller uses. */
export interface EgressGuard {
    readonly policy: EgressPolicy;
    /** Fetch through the guard, for the given source and organization. */
    fetch(url: string, init: EgressFetchInit, ctx: EgressContext): Promise<Response>;
    /**
     * Judge a url without sending anything: resolve its host and ask the
     * policy about every address. `unresolved` when the host does not resolve.
     */
    judgeUrl(url: string, ctx: EgressContext): Promise<{ allow: boolean; unresolved?: boolean; decision?: EgressDecision }>;
    /** The boot line's text. */
    describe(): string;
}

function stripBrackets(host: string): string {
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

async function resolveAll(hostname: string, resolve: EgressResolver): Promise<string[]> {
    if (isIP(hostname)) return [hostname];
    const answers = await resolve(hostname);
    return answers.map((a) => a.address);
}

async function judge(
    policy: EgressPolicy,
    address: string,
    hostname: string,
    port: number | undefined,
    ctx: EgressContext,
): Promise<EgressDecision> {
    try {
        return await policy.canConnect({ address, hostname, port }, ctx);
    } catch (err) {
        return { allow: false, reason: `the egress policy threw (${(err as Error)?.message ?? String(err)}) — refused` };
    }
}

type ConnectOptions = Parameters<ReturnType<typeof buildConnector>>[0];
type ConnectCallback = Parameters<ReturnType<typeof buildConnector>>[1];

/**
 * Build the guard. Throws when the policy cannot be built (a malformed
 * allowlist) or the connector cannot be constructed — the caller's boot fails
 * with it; there is no unguarded fallback.
 */
export function createEgressGuard(options: EgressGuardOptions = {}): EgressGuard {
    const policy = options.policy ?? createEnvEgressPolicy();
    const resolve = options.resolve ?? defaultResolver;
    const logger = options.logger;
    const base = buildConnector({});
    // Prove the dispatcher constructs here, at install, rather than on the first send.
    void new Agent({ connect: base }).close();

    const refuse = (hostname: string, decision: EgressDecision, ctx: EgressContext): EgressRefusedError => {
        logger?.warn(`[egress] refused an outbound connect to ${hostname}: ${decision.reason ?? 'denied by the egress policy'}`, {
            source: ctx.source,
            organizationId: ctx.organizationId,
            hostname,
            denyClass: decision.denyClass,
        });
        return new EgressRefusedError(hostname, decision);
    };

    const connectorFor = (ctx: EgressContext) => (opts: ConnectOptions, callback: ConnectCallback): void => {
        const hostname = stripBrackets(opts.hostname);
        const port = opts.port ? Number(opts.port) : undefined;
        void (async () => {
            const addresses = await resolveAll(hostname, resolve);
            if (addresses.length === 0) throw new Error(`egress: ${hostname} resolved to no address`);
            for (const address of addresses) {
                const decision = await judge(policy, address, hostname, port, ctx);
                if (!decision.allow) throw refuse(hostname, decision, ctx);
            }
            return addresses[0]!;
        })().then(
            (address) => {
                base(
                    {
                        ...opts,
                        hostname: address,
                        servername: opts.servername || (isIP(hostname) ? undefined : hostname),
                    },
                    (err, socket) => {
                        if (err || !socket) return callback(err ?? new Error('egress: connect failed'), null);
                        const remote = (socket as Socket).remoteAddress;
                        if (!remote || remote === address) return callback(null, socket);
                        void judge(policy, remote, hostname, port, ctx).then((decision) => {
                            if (decision.allow) return callback(null, socket);
                            socket.destroy();
                            callback(refuse(hostname, decision, ctx), null);
                        });
                    },
                );
            },
            (err: Error) => callback(err, null),
        );
    };

    return {
        policy,
        describe: () =>
            `[egress] outbound guard active: webhook and flow http requests reach only public addresses` +
            ` (${policy.describe?.() ?? 'host-provided egress policy'}; link-local and cloud metadata addresses are never reachable)`,
        async fetch(url, init, ctx) {
            const agent = new Agent({ connect: connectorFor(ctx) });
            try {
                const response = await globalThis.fetch(url, { ...init, dispatcher: agent } as RequestInit);
                // Graceful: the pool closes once the body the caller reads has drained.
                void agent.close().catch(() => undefined);
                return response;
            } catch (err) {
                void agent.destroy().catch(() => undefined);
                throw err;
            }
        },
        async judgeUrl(url, ctx) {
            let hostname: string;
            let port: number | undefined;
            try {
                const parsed = new URL(url);
                hostname = stripBrackets(parsed.hostname);
                port = parsed.port ? Number(parsed.port) : undefined;
            } catch {
                return { allow: true, unresolved: true };
            }
            let addresses: string[];
            try {
                addresses = await resolveAll(hostname, resolve);
            } catch {
                return { allow: true, unresolved: true };
            }
            for (const address of addresses) {
                const decision = await judge(policy, address, hostname, port, ctx);
                if (!decision.allow) return { allow: false, decision };
            }
            return { allow: true };
        },
    };
}

const memo = new Map<string, EgressGuard>();

/**
 * The process's default guard for the current `OS_EGRESS_ALLOWED_TARGETS`
 * value — one instance per value, so every caller that takes the default
 * shares one policy (and one boot line). Throws on a malformed allowlist.
 */
export function defaultEgressGuard(): EgressGuard {
    const key = process.env[EGRESS_ALLOWED_TARGETS_ENV] ?? '';
    let guard = memo.get(key);
    if (!guard) {
        guard = createEgressGuard({ policy: createEnvEgressPolicy({ allowedTargets: key }) });
        memo.set(key, guard);
    }
    return guard;
}

const announced = new WeakSet<EgressPolicy>();

/**
 * Resolve the guard a plugin boots with — the host's policy when it passed
 * one, else the default — and print the boot line once per policy. Throws (and
 * so fails the boot) when the guard cannot install.
 */
export function installEgressGuard(options: { policy?: EgressPolicy; logger: EgressLogger }): EgressGuard {
    const guard = options.policy
        ? createEgressGuard({ policy: options.policy, logger: options.logger })
        : withLogger(defaultEgressGuard(), options.logger);
    if (!announced.has(guard.policy)) {
        announced.add(guard.policy);
        (options.logger.info ?? options.logger.warn)(guard.describe());
    }
    return guard;
}

const logged = new WeakMap<EgressGuard, EgressGuard>();

function withLogger(guard: EgressGuard, logger: EgressLogger): EgressGuard {
    let bound = logged.get(guard);
    if (!bound) {
        bound = createEgressGuard({ policy: guard.policy, logger });
        logged.set(guard, bound);
    }
    return bound;
}
