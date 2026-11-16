// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
    cidr,
    cidrWithin,
    classifyAddress,
    isNeverAllowlistable,
    NEVER_ALLOWLISTABLE_BLOCKS,
    parseAddress,
    unwrapEmbeddedV4,
    cidrContains,
    type CidrBlock,
    type EgressDenyClass,
} from './address.js';

/**
 * EgressPolicy — the host-injectable gate a guarded outbound request is judged
 * by, at the moment its socket connects. Today the guarded requests are
 * webhook deliveries (the messaging HTTP outbox) and the flow `http` node,
 * inline and `durable: true`. The shape mirrors `DatasourceConnectPolicy`
 * (`@objectstack/service-datasource`): one decision method, sync or async, a
 * verdict with a privileged `reason`, and fail-closed on a throw.
 *
 * The rule it carries: a webhook delivery or a flow `http` node request
 * reaches only public addresses unless the operator allowlists the target,
 * and a link-local or cloud metadata address can never be allowlisted. The
 * open-core default ({@link createEnvEgressPolicy}) reads the operator's
 * allowlist from `OS_EGRESS_ALLOWED_TARGETS`; a multi-tenant host binds a
 * stricter policy — per organization, per source — through the same seam,
 * since every decision is handed both.
 */

/** Where the request comes from. Open: a host may route its own sources through the guard. */
export type EgressSource = 'webhook' | 'flow-http' | (string & {});

/** Who the request is made for. */
export interface EgressContext {
    /** The surface making the request (`webhook`, `flow-http`, …). */
    source: EgressSource;
    /** The organization the request is made on behalf of, when one is in scope. */
    organizationId?: string;
}

/** What the socket is about to connect to. */
export interface EgressTarget {
    /** The address the socket connects to — an IPv4 or IPv6 literal. */
    address: string;
    /** The hostname the request named (an IP literal when the url named one). */
    hostname: string;
    /** The destination port. */
    port?: number;
}

/** A policy verdict. */
export interface EgressDecision {
    allow: boolean;
    /** The refused address class, when the refusal is a class refusal. */
    denyClass?: EgressDenyClass;
    /** True when the target was allowed only because the allowlist names it. */
    allowlisted?: boolean;
    /**
     * Operator-facing explanation — PRIVILEGED: it may name the resolved
     * address and its class, so it goes to the server log, never into what a
     * tenant reads back.
     */
    reason?: string;
}

/** Host-provided gate consulted before every outbound connect. Throwing is a refusal (fail-closed). */
export interface EgressPolicy {
    canConnect(target: EgressTarget, ctx: EgressContext): EgressDecision | Promise<EgressDecision>;
    /** A one-line description for the boot line (e.g. the allowlist size). */
    describe?(): string;
}

/** The environment variable naming the operator's allowlist. */
export const EGRESS_ALLOWED_TARGETS_ENV = 'OS_EGRESS_ALLOWED_TARGETS';

/** The narrowest prefix an allowlist CIDR may have — anything wider is refused as over-broad. */
export const EGRESS_ALLOWLIST_MIN_PREFIX = 8;

/** One allowlist entry: an exact host, or a CIDR block (a bare IP is a full-length block). */
export type EgressAllowEntry =
    | { readonly kind: 'host'; readonly host: string; readonly text: string }
    | { readonly kind: 'cidr'; readonly block: CidrBlock; readonly text: string };

/** A malformed or refused allowlist — the boot refuses it. */
export class EgressAllowlistError extends Error {
    readonly code = 'EGRESS_ALLOWLIST_INVALID';
    constructor(readonly problems: readonly string[]) {
        super(
            `${EGRESS_ALLOWED_TARGETS_ENV} is not a valid allowlist, so the outbound-request guard cannot start: ` +
                `${problems.join('; ')}. Each comma-separated entry is an exact host name (lower-case letters, ` +
                `digits, hyphens and dots — no scheme, port, path or wildcard), an IP address, or a CIDR block ` +
                `with host bits zero and a prefix of at least /${EGRESS_ALLOWLIST_MIN_PREFIX}. Link-local and ` +
                `cloud metadata addresses cannot be listed.`,
        );
        this.name = 'EgressAllowlistError';
    }
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Parse the allowlist text. Strict: every entry must be well-formed, and the
 * whole list is refused — every problem named at once — when any is not.
 * Empty or unset text is the empty allowlist.
 */
export function parseEgressAllowlist(raw: string | undefined): EgressAllowEntry[] {
    if (raw === undefined || raw.trim() === '') return [];
    const problems: string[] = [];
    const entries: EgressAllowEntry[] = [];
    for (const piece of raw.split(',')) {
        const text = piece.trim();
        if (text === '') {
            problems.push('an empty entry (a stray comma)');
            continue;
        }
        const entry = parseEntry(text, problems);
        if (entry) entries.push(entry);
    }
    if (problems.length > 0) throw new EgressAllowlistError(problems);
    return entries;
}

function parseEntry(text: string, problems: string[]): EgressAllowEntry | null {
    const slash = text.indexOf('/');
    const addressPart = slash === -1 ? text : text.slice(0, slash);
    const parsed = parseAddress(addressPart);
    if (parsed && !addressPart.startsWith('[')) {
        const full = parsed.family === 4 ? 32 : 128;
        let prefix = full;
        if (slash !== -1) {
            const prefixText = text.slice(slash + 1);
            if (!/^\d{1,3}$/.test(prefixText)) {
                problems.push(`'${text}' has a malformed prefix`);
                return null;
            }
            prefix = Number(prefixText);
            if (prefix > full) {
                problems.push(`'${text}' has a prefix longer than /${full}`);
                return null;
            }
        }
        if (prefix < EGRESS_ALLOWLIST_MIN_PREFIX) {
            problems.push(`'${text}' is over-broad (a prefix under /${EGRESS_ALLOWLIST_MIN_PREFIX})`);
            return null;
        }
        const block = cidr(addressPart, prefix);
        if (!block) {
            problems.push(`'${text}' does not parse`);
            return null;
        }
        if (block.network !== parsed.value) {
            problems.push(`'${text}' has host bits set below its /${prefix} prefix`);
            return null;
        }
        const effective = unwrapEmbeddedV4({ family: block.family, value: block.network });
        // An IPv6 block in a form that embeds IPv4 in its low 32 bits (mapped,
        // NAT64, compat) is held as the IPv4 block it covers, because the
        // judged address is unwrapped the same way.
        const embedsLow32 = effective.family === 4 && prefix >= 96 && effective.value === (block.network & 0xffffffffn);
        const effectiveBlock: CidrBlock = embedsLow32 ? { family: 4, network: effective.value, prefix: prefix - 96 } : block;
        if (effectiveBlock.family === 4 && effectiveBlock.prefix < EGRESS_ALLOWLIST_MIN_PREFIX) {
            problems.push(`'${text}' is over-broad (it covers an IPv4 range under /${EGRESS_ALLOWLIST_MIN_PREFIX})`);
            return null;
        }
        // A single address is refused when the connect would refuse it as
        // never-allowlistable in any form it carries (a local-use NAT64 layout included).
        const single = prefix === full && isNeverAllowlistable(effective);
        if (single || NEVER_ALLOWLISTABLE_BLOCKS.some((never) => cidrWithin(effectiveBlock, never))) {
            problems.push(`'${text}' is a link-local or cloud metadata address, which no allowlist can open`);
            return null;
        }
        return { kind: 'cidr', block: effectiveBlock, text };
    }
    if (slash !== -1 || /[:/?#@*\s[\]]/.test(text)) {
        problems.push(`'${text}' is neither an exact host name, an IP address nor a CIDR block`);
        return null;
    }
    const host = text.toLowerCase();
    const labels = host.split('.');
    if (host.length > 253 || labels.some((label) => !HOST_LABEL.test(label))) {
        problems.push(`'${text}' is not a valid host name`);
        return null;
    }
    if (labels.every((label) => /^\d+$/.test(label))) {
        problems.push(`'${text}' looks like an IP address but is not one`);
        return null;
    }
    return { kind: 'host', host, text };
}

/** Options for {@link createEnvEgressPolicy}. */
export interface EnvEgressPolicyOptions {
    /** The allowlist text; defaults to `process.env.OS_EGRESS_ALLOWED_TARGETS`. */
    allowedTargets?: string;
}

/** The open-core default policy, with the allowlist it was built from. */
export interface EnvEgressPolicy extends EgressPolicy {
    readonly allowlist: readonly EgressAllowEntry[];
}

const CLASS_TEXT: Record<EgressDenyClass, string> = {
    unspecified: 'an unspecified',
    loopback: 'a loopback',
    private: 'a private',
    cgnat: 'a carrier-grade NAT',
    'link-local': 'a link-local',
    multicast: 'a multicast',
    broadcast: 'a broadcast',
    reserved: 'a reserved (not globally reachable)',
    documentation: 'a documentation',
    benchmarking: 'a benchmarking',
    'unique-local': 'a unique-local',
    'nat64-local': 'a local-use NAT64',
    metadata: 'a cloud metadata',
};

/**
 * The open-core default: refuse every address that is not public (every
 * class {@link classifyAddress} names), open what the allowlist names, and
 * never open a link-local or metadata address. Throws
 * {@link EgressAllowlistError} on a malformed allowlist — the boot refuses it.
 *
 * It reads only the allowlist; the organization and source handed to every
 * decision are for a host's stricter policy.
 */
export function createEnvEgressPolicy(options: EnvEgressPolicyOptions = {}): EnvEgressPolicy {
    const raw = options.allowedTargets ?? process.env[EGRESS_ALLOWED_TARGETS_ENV];
    const allowlist = Object.freeze(parseEgressAllowlist(raw));
    const hosts = new Set(allowlist.flatMap((e) => (e.kind === 'host' ? [e.host] : [])));
    const blocks = allowlist.flatMap((e) => (e.kind === 'cidr' ? [e.block] : []));
    return {
        allowlist,
        describe: () => `${allowlist.length} allowlisted target${allowlist.length === 1 ? '' : 's'} from ${EGRESS_ALLOWED_TARGETS_ENV}`,
        canConnect(target) {
            const parsed = parseAddress(target.address);
            if (!parsed) {
                return { allow: false, denyClass: 'reserved', reason: `'${target.address}' is not an IP address` };
            }
            const effective = unwrapEmbeddedV4(parsed);
            const denyClass = classifyAddress(parsed);
            if (denyClass === null) return { allow: true };
            const where = `${target.hostname} resolves to ${target.address}, ${CLASS_TEXT[denyClass]} address`;
            if (denyClass === 'metadata' || isNeverAllowlistable(effective)) {
                return { allow: false, denyClass, reason: `${where}, which no allowlist entry can open` };
            }
            const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
            if (hosts.has(hostname) || blocks.some((b) => cidrContains(b, effective) || cidrContains(b, parsed))) {
                return { allow: true, allowlisted: true };
            }
            return {
                allow: false,
                denyClass,
                reason: `${where}, and ${EGRESS_ALLOWED_TARGETS_ENV} does not list the target`,
            };
        },
    };
}
