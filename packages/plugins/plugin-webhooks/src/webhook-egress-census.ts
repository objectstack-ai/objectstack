// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { EgressGuard } from '@objectstack/core/egress';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';

/**
 * The boot census of stored webhook targets against the outbound-request
 * guard: how many `sys_webhook` rows point at a target the guard will refuse,
 * said ONCE at boot, so an operator learns before the first event that those
 * deliveries will dead-letter as `EGRESS_REFUSED` — and what restores them.
 *
 * It judges each row's url exactly as a delivery would (the host resolved,
 * every address asked of the policy, with the row's organization and the
 * `webhook` source), and sends nothing. A host that does not resolve within
 * {@link CENSUS_RESOLVE_TIMEOUT_MS} is not counted: the guard is not what
 * stops it.
 */

const SYSTEM_QUERY: EngineQueryOptions = {
    context: { isSystem: true, positions: [], permissions: [] },
};

/** Longest wait for one row's host to resolve. */
export const CENSUS_RESOLVE_TIMEOUT_MS = 3_000;

/** Rows judged at once. */
const CENSUS_CONCURRENCY = 8;

interface CensusLogger {
    info?: (msg: string, meta?: unknown) => void;
    warn?: (msg: string, meta?: unknown) => void;
}

export interface WebhookEgressCensus {
    /** Rows read. */
    scanned: number;
    /** Rows whose target the guard refuses. */
    refused: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Count, and log once, the stored webhook rows whose target the guard refuses. */
export async function censusWebhookEgressTargets(
    engine: Pick<IDataEngine, 'find'>,
    guard: EgressGuard,
    logger: CensusLogger,
    options: { resolveTimeoutMs?: number } = {},
): Promise<WebhookEgressCensus | undefined> {
    let rows: Array<Record<string, unknown>>;
    try {
        const found = await engine.find('sys_webhook', SYSTEM_QUERY);
        rows = Array.isArray(found) ? found : (((found as { data?: unknown })?.data as typeof rows) ?? []);
    } catch (err) {
        logger.warn?.('[webhook] egress census skipped — could not read sys_webhook', {
            error: (err as Error)?.message ?? String(err),
        });
        return undefined;
    }
    const timeoutMs = options.resolveTimeoutMs ?? CENSUS_RESOLVE_TIMEOUT_MS;
    let refused = 0;
    let next = 0;
    const worker = async () => {
        while (next < rows.length) {
            const row = rows[next++]!;
            const url = typeof row.url === 'string' ? row.url : undefined;
            if (!url) continue;
            const organizationId = typeof row.organization_id === 'string' ? row.organization_id : undefined;
            const verdict = await withTimeout(
                guard.judgeUrl(url, { source: 'webhook', organizationId }),
                timeoutMs,
                { allow: true, unresolved: true },
            );
            if (!verdict.allow) refused++;
        }
    };
    await Promise.all(Array.from({ length: Math.min(CENSUS_CONCURRENCY, rows.length) }, worker));
    const census = { scanned: rows.length, refused };
    if (refused > 0) {
        logger.warn?.(
            `[webhook] ${refused} of ${rows.length} sys_webhook row(s) target an address the outbound-request guard ` +
                'refuses, so their deliveries will dead-letter as EGRESS_REFUSED. If a target is meant to be internal, ' +
                'list it in OS_EGRESS_ALLOWED_TARGETS (an exact host or a CIDR block) and restart; link-local and cloud ' +
                'metadata addresses cannot be listed.',
            census,
        );
    } else {
        logger.info?.(`[webhook] 0 of ${rows.length} sys_webhook row(s) target an address the outbound-request guard refuses`, census);
    }
    return census;
}
