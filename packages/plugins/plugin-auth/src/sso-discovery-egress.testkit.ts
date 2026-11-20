// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import dnsPromises from 'node:dns/promises';
import { EgressRefusedError, type EgressGuard } from '@objectstack/core/egress';
import { createSsoDiscoveryEgressGuard } from './sso-discovery-egress';

/**
 * A stand-in for the SSO discovery guard, for a suite that fakes the identity
 * provider by stubbing `globalThis.fetch`: the `AuthManager` is handed this
 * (`ssoDiscoveryEgress`) instead of the real guard, so its reads reach the
 * stub.
 *
 * The real guard never sends through the global fetch: its own transport
 * resolves the host and connects to the address it judged, so a stubbed global
 * fetch no longer stands in for the identity provider on its own. This one
 * judges each read by the real rule (the SSO discovery policy) against the
 * addresses `node:dns/promises` answers when it is asked (a suite's resolver
 * double, read at each call), refuses as the real guard refuses, and hands an
 * admitted read to the global fetch. A name the runner cannot resolve is handed
 * on too: a stubbed identity provider has no real name. The connection-time
 * rule itself is pinned with the real guard in
 * `sso-discovery-connect-time.test.ts`.
 */
export async function stubbedSsoDiscoveryEgress(): Promise<EgressGuard> {
  const real = await createSsoDiscoveryEgressGuard({
    resolve: (hostname) => dnsPromises.lookup(hostname, { all: true }),
  });
  return {
    policy: real.policy,
    ready: async () => undefined,
    describe: () => '[egress] an SSO discovery stand-in over a stubbed fetch (tests)',
    judgeUrl: (url, ctx) => real.judgeUrl(url, ctx),
    async fetch(url, init, ctx) {
      const verdict = await real.judgeUrl(url, ctx);
      if (!verdict.allow) {
        const refusal = new EgressRefusedError(new URL(url).hostname, verdict.decision ?? { allow: false });
        throw Object.assign(new TypeError('fetch failed'), { cause: refusal });
      }
      return globalThis.fetch(url, init as RequestInit);
    },
  };
}
