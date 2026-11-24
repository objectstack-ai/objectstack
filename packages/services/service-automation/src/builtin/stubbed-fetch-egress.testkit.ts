// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { EgressGuard } from '@objectstack/core/egress';

/**
 * A stand-in for the outbound-request guard, for a suite that fakes the
 * network by stubbing `globalThis.fetch`: the `http` node is handed this
 * instead of the real guard, so its request reaches the stub.
 *
 * The real guard never sends through the global fetch — it proves at install
 * that its own transport is the one judging every connection — so a stubbed
 * global fetch no longer stands in for the network on its own. Nothing a
 * suite using this sends leaves the process, so there is no connection to
 * judge; the rule itself is pinned in `http-node-egress-guard.test.ts`.
 */
export function stubbedFetchEgress(): EgressGuard {
    return {
        policy: { canConnect: () => ({ allow: true }) },
        ready: async () => undefined,
        describe: () => '[egress] a stubbed-fetch stand-in (tests)',
        judgeUrl: async () => ({ allow: true }),
        fetch: (url, init) => globalThis.fetch(url, init as RequestInit),
    };
}
