// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type Socket } from 'node:net';
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { createEnvEgressPolicy, EGRESS_ALLOWED_TARGETS_ENV, type EgressContext, type EgressDecision, type EgressPolicy } from './policy.js';

/**
 * The guarded outbound fetch: every connection a request opens — the first
 * hop and every redirect hop — goes through one connector that resolves the
 * host, hands EACH address to the {@link EgressPolicy}, and connects the socket
 * to an address it judged (never re-resolving), then re-judges the connected
 * socket's own remote address. A literal-IP url is judged the same way. The
 * judged addresses are dialled in the order the resolver gave them, moving to
 * the next on a connect error, so a target that answers on only some of its
 * addresses is still reached, as the bare fetch reached it.
 *
 * The request itself is undici's own `fetch` with this connector's
 * dispatcher — never the process's global fetch, whose honouring of a
 * dispatcher is a property of the host runtime. Enforcement is proven, not
 * assumed: every guard probes, before its first send, that a request made
 * this way is routed through its connector, and where that cannot be proven
 * the install refuses and so does every send ({@link EgressGuard.ready}).
 * Every send also checks that the connection it answered over was judged.
 * This needs a Node.js runtime (`undici`, `node:dns`, `node:net`).
 *
 * A refused connect rejects with a `fetch failed` whose `cause` is an
 * {@link EgressRefusedError}; {@link findEgressRefusal} reads it.
 */

/** The error code a refused connect carries. */
export const EGRESS_REFUSED = 'EGRESS_REFUSED';

/**
 * The text a refused request reads, the same whatever the cause — a target
 * that is not public, one that does not resolve, or a guard that cannot prove
 * it is enforced — so it never tells one apart from another.
 */
export function egressRefusalText(hostname: string): string {
    return (
        `${EGRESS_REFUSED}: the request to ${hostname} was not sent — outbound requests reach only a host whose ` +
        `every address is public, or a target the operator's egress allowlist names ` +
        `(${EGRESS_ALLOWED_TARGETS_ENV}; link-local and cloud metadata addresses cannot be listed)`
    );
}

/**
 * A request the guard did not send. `message` is tenant-safe and the same
 * for every cause ({@link egressRefusalText}); the resolved address, its
 * class and the cause are in {@link EgressRefusedError.decision}'s privileged
 * `reason`. `unresolved` marks a host name that did not resolve, which a
 * caller may retry: only the verdict on a resolved address is final.
 */
export class EgressRefusedError extends Error {
    readonly code = EGRESS_REFUSED;
    constructor(
        readonly hostname: string,
        readonly decision: EgressDecision,
        readonly unresolved: boolean = false,
    ) {
        super(egressRefusalText(hostname));
        this.name = 'EgressRefusedError';
    }
}

/** The guard could not prove that a request it sends is routed through its connector: it refuses to install. */
export class EgressGuardUnprovenError extends Error {
    constructor(detail: string) {
        super(
            `the outbound-request guard cannot install: this runtime did not route a probe request through the ` +
                `guard's connector (${detail}), so webhook deliveries and flow http requests could leave unjudged. ` +
                `They need a Node.js runtime in which undici's fetch honours its dispatcher.`,
        );
        this.name = 'EgressGuardUnprovenError';
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
    /**
     * Settles once the guard has proven that a request it sends is routed
     * through its connector; rejects with {@link EgressGuardUnprovenError}
     * when it cannot. Every send awaits the same proof and is refused while
     * it is not proven.
     */
    ready(): Promise<void>;
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
        const verdict = await policy.canConnect({ address, hostname, port }, ctx);
        if (!verdict || typeof verdict.allow !== 'boolean') {
            return { allow: false, reason: 'the egress policy returned no verdict — refused' };
        }
        return verdict;
    } catch (err) {
        return { allow: false, reason: `the egress policy threw (${(err as Error)?.message ?? String(err)}) — refused` };
    }
}

type ConnectOptions = Parameters<ReturnType<typeof buildConnector>>[0];
type ConnectCallback = Parameters<ReturnType<typeof buildConnector>>[1];

/** The probe's target: `.invalid` never resolves (RFC 6761), so even a runtime that ignores the dispatcher sends it nowhere. */
const PROBE_URL = 'http://egress-guard-probe.invalid/';
/** Longest wait for the probe to settle. */
const PROBE_TIMEOUT_MS = 5_000;

function causeChainHas(err: unknown, target: unknown): boolean {
    let current: unknown = err;
    for (let depth = 0; depth < 6 && current; depth++) {
        if (current === target) return true;
        current = (current as { cause?: unknown }).cause;
    }
    return false;
}

/**
 * Prove that a request made the way the guard makes it is routed through the
 * guard's connector: send one to {@link PROBE_URL} through a connector that
 * records the call and fails it with a sentinel. Proven only when the
 * connector was called and the sentinel is what the fetch failed with.
 */
async function proveConnectorRouting(): Promise<void> {
    let consulted = false;
    const sentinel = new Error('egress probe: connector consulted');
    const agent = new Agent({
        connect: (_opts: ConnectOptions, callback: ConnectCallback) => {
            consulted = true;
            callback(sentinel, null);
        },
    });
    let outcome: unknown;
    try {
        outcome = await undiciFetch(PROBE_URL, { dispatcher: agent, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    } catch (err) {
        outcome = err;
    } finally {
        void agent.destroy().catch(() => undefined);
    }
    if (consulted && causeChainHas(outcome, sentinel)) return;
    throw new EgressGuardUnprovenError(
        consulted ? 'the connector was called but the request did not fail with its answer' : 'the connector was never called',
    );
}

function hostnameOf(url: string): string {
    try {
        return stripBrackets(new URL(url).hostname);
    } catch {
        return url;
    }
}

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
    // Prove the requests this guard sends are routed through its connector.
    // Observed by ready() and by every send; never left unhandled.
    const proof = proveConnectorRouting();
    proof.catch(() => undefined);

    const refuse = (hostname: string, decision: EgressDecision, ctx: EgressContext, unresolved = false): EgressRefusedError => {
        logger?.warn(`[egress] refused an outbound connect to ${hostname}: ${decision.reason ?? 'denied by the egress policy'}`, {
            source: ctx.source,
            organizationId: ctx.organizationId,
            hostname,
            denyClass: decision.denyClass,
        });
        return new EgressRefusedError(hostname, decision, unresolved);
    };

    const connectorFor = (ctx: EgressContext, onJudged: () => void) => (opts: ConnectOptions, callback: ConnectCallback): void => {
        const hostname = stripBrackets(opts.hostname);
        const port = opts.port ? Number(opts.port) : undefined;
        const servername = opts.servername || (isIP(hostname) ? undefined : hostname);
        // Dial the judged addresses in turn: a connect error moves to the next
        // one, a refusal of the connected socket ends the attempt.
        const dial = (addresses: readonly string[], index: number, lastError: Error | null): void => {
            if (index >= addresses.length) {
                callback(lastError ?? new Error(`egress: connect to ${hostname} failed`), null);
                return;
            }
            base({ ...opts, hostname: addresses[index]!, servername }, (err, socket) => {
                if (err || !socket) {
                    dial(addresses, index + 1, err ?? new Error(`egress: connect to ${hostname} failed`));
                    return;
                }
                // Every connected socket's own remote address is judged again.
                const remote = (socket as Socket).remoteAddress;
                if (!remote) {
                    socket.destroy();
                    callback(new Error(`egress: the socket to ${hostname} closed before its address could be judged`), null);
                    return;
                }
                void judge(policy, remote, hostname, port, ctx).then((decision) => {
                    if (decision.allow) {
                        onJudged();
                        return callback(null, socket);
                    }
                    socket.destroy();
                    callback(refuse(hostname, decision, ctx), null);
                });
            });
        };
        void (async () => {
            // A host name that does not resolve reads the same refusal text as
            // one that is refused, marked retriable: the author cannot tell them apart.
            let addresses: string[];
            try {
                addresses = await resolveAll(hostname, resolve);
            } catch (err) {
                throw refuse(hostname, { allow: false, reason: `${hostname} did not resolve (${(err as Error)?.message ?? String(err)})` }, ctx, true);
            }
            if (addresses.length === 0) throw refuse(hostname, { allow: false, reason: `${hostname} resolved to no address` }, ctx, true);
            for (const address of addresses) {
                const decision = await judge(policy, address, hostname, port, ctx);
                if (!decision.allow) throw refuse(hostname, decision, ctx);
            }
            return addresses;
        })().then(
            (addresses) => dial(addresses, 0, null),
            (err: Error) => callback(err, null),
        );
    };

    return {
        policy,
        ready: () => proof,
        describe: () =>
            `[egress] outbound guard active: webhook and flow http requests reach only public addresses` +
            ` (${policy.describe?.() ?? 'host-provided egress policy'}; link-local and cloud metadata addresses are never reachable)`,
        async fetch(url, init, ctx) {
            try {
                await proof;
            } catch (err) {
                throw refuse(hostnameOf(url), { allow: false, reason: (err as Error).message }, ctx);
            }
            let judged = false;
            const agent = new Agent({ connect: connectorFor(ctx, () => { judged = true; }) });
            try {
                const response = await undiciFetch(url, { ...init, dispatcher: agent });
                if (!judged) {
                    // Never hand back an answer from a connection the policy did not judge.
                    void agent.destroy().catch(() => undefined);
                    throw refuse(hostnameOf(url), { allow: false, reason: 'the response arrived over a connection the guard never judged' }, ctx);
                }
                // Graceful: the pool closes once the body the caller reads has drained.
                void agent.close().catch(() => undefined);
                return response as unknown as Response;
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
 * one, else the default — prove it is enforced in this runtime, and print the
 * boot line once per policy. Rejects (and so fails the boot) when the guard
 * cannot install: a malformed allowlist, or a runtime in which its requests
 * are not proven to route through its connector.
 */
export async function installEgressGuard(options: { policy?: EgressPolicy; logger: EgressLogger }): Promise<EgressGuard> {
    const guard = options.policy
        ? createEgressGuard({ policy: options.policy, logger: options.logger })
        : withLogger(defaultEgressGuard(), options.logger);
    await guard.ready();
    if (!announced.has(guard.policy)) {
        announced.add(guard.policy);
        if (options.logger.info) options.logger.info(guard.describe());
        else options.logger.warn(guard.describe());
    }
    return guard;
}

const logged = new WeakMap<EgressGuard, WeakMap<EgressLogger, EgressGuard>>();

/**
 * The shared default guard bound to one installer's logger: each installer
 * gets its own binding over the one shared policy, so a refusal is logged to
 * the plugin that made the request, never to whichever plugin installed first.
 */
function withLogger(guard: EgressGuard, logger: EgressLogger): EgressGuard {
    let byLogger = logged.get(guard);
    if (!byLogger) {
        byLogger = new WeakMap();
        logged.set(guard, byLogger);
    }
    let bound = byLogger.get(logger);
    if (!bound) {
        bound = createEgressGuard({ policy: guard.policy, logger });
        byLogger.set(logger, bound);
    }
    return bound;
}
