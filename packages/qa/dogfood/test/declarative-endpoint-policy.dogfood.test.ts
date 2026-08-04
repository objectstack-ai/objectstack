// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The declarative-endpoint POLICY matrix, on a real boot (#5040 E8 / #5112).
//
// `showcase-declarative-endpoints.dogfood.test.ts` proves the restored showcase
// endpoints answer, and both of those are session-gated — which is the whole
// truth about the showcase and only half the truth about the policy chain. The
// other half is the anonymous arm of ADR-0121 D6, and it is the arm where a
// mistake is unrecoverable: `authRequired: false` opens a free, unauthenticated
// execution entry point into the data pipeline, and the rate limit is the only
// thing standing behind it.
//
// So this file drives a throwaway fixture app (`fixtures/endpoint-policy-
// fixture.ts`) whose entire purpose is to be probed:
//
//   1. an OMITTED `authRequired` really denies anonymous — the upgrade guide
//      tells every maintainer that "an omission is safe", and this is what
//      makes that sentence testable rather than reassuring;
//   2. an EXPLICIT `authRequired: false` really serves anonymous — otherwise
//      D6's obligation would be protecting nothing;
//   3. the armed budget really meters, on the wire: the (N+1)-th anonymous
//      request inside the window gets 429 **with a `Retry-After` header**. A
//      429 that loses that header has told the client nothing it can act on,
//      and only a real transport can prove the header survives the response
//      write — which is why this is not a unit test.
//
// Pre-condition worth stating: the fixture publishes at all. A stack declaring
// `authRequired: false` WITHOUT `rateLimit.enabled === true` is refused by the
// E7 publish gate, so booting this app is itself a positive assertion that the
// armed form is the accepted one.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { endpointPolicyFixtureStack } from './fixtures/endpoint-policy-fixture.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetadataPlugin } from '@objectstack/metadata';

const PUBLIC_FEED = '/apps/e8policy/public-notes';
const PRIVATE_FEED = '/apps/e8policy/private-notes';

let stack: VerifyStack;
let tempDir: string;
let adminToken: string;

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'os-e8-policy-'));
  const artifactPath = join(tempDir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(endpointPolicyFixtureStack));

  stack = await bootStack(endpointPolicyFixtureStack, {
    extraPlugins: [
      new MetadataPlugin({
        rootDir: tempDir,
        watch: false,
        artifactWatch: false,
        registerSystemObjects: false,
        artifactSource: { mode: 'local-file', path: artifactPath },
      }),
    ],
  });
  adminToken = await stack.signIn();
}, 120_000);

afterAll(async () => {
  await stack?.stop();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

describe('[#5112] authRequired — the default is the protection', () => {
  it('an OMITTED authRequired denies anonymous (the schema default is true)', async () => {
    const res = await stack.api(PRIVATE_FEED, { method: 'GET' });
    expect(
      res.status,
      'the upgrade guide tells maintainers an omitted `authRequired` is SAFE — this is that claim, measured',
    ).toBe(401);
  });

  it('the same endpoint serves an authenticated caller', async () => {
    const res = await stack.apiAs(adminToken, 'GET', PRIVATE_FEED);
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe('[#5112] ADR-0121 D6 — anonymous is served, and metered', () => {
  it('an EXPLICIT authRequired:false serves an anonymous caller', async () => {
    const res = await stack.api(PUBLIC_FEED, { method: 'GET' });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { success?: boolean };
    expect(body.success).toBe(true);
  });

  it('carries the declared cacheTtl on the anonymous success', async () => {
    const res = await stack.api(PUBLIC_FEED, { method: 'GET' });
    expect(res.headers.get('cache-control')).toMatch(/max-age=15/);
  });

  it('answers 429 WITH Retry-After once the armed budget is exhausted', async () => {
    // The declared budget is 2 requests / 60s. One was already spent by each of
    // the two cases above, so the very next anonymous call is over budget —
    // but do not rely on that arithmetic: drive until the limiter speaks, with
    // a hard cap so a limiter that never fires fails loudly instead of hanging.
    let limited: Response | undefined;
    for (let i = 0; i < 10 && !limited; i++) {
      const res = await stack.api(PUBLIC_FEED, { method: 'GET' });
      if (res.status === 429) limited = res;
    }

    expect(
      limited,
      'an anonymous endpoint declaring `rateLimit: { enabled: true, maxRequests: 2 }` must actually ' +
        'refuse the over-budget request — an unmetered anonymous execution entry point is what ' +
        'ADR-0121 D6 exists to prevent',
    ).toBeDefined();
    expect(
      limited!.headers.get('retry-after'),
      'a 429 that loses its Retry-After has told the client nothing it can act on',
    ).toBeTruthy();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);

    const body = (await limited!.json()) as { success?: boolean };
    expect(body.success).toBe(false);
  });

  it('never puts a cache directive on the 429', async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 10 && !limited; i++) {
      const res = await stack.api(PUBLIC_FEED, { method: 'GET' });
      if (res.status === 429) limited = res;
    }
    expect(limited).toBeDefined();
    expect(
      limited!.headers.get('cache-control') ?? '',
      'caching a throttle answer for 15s would make the throttle stick past its own window',
    ).not.toMatch(/max-age=15/);
  });

  it('the metered budget is per-ENDPOINT, not global — the session-gated one still answers', async () => {
    const res = await stack.apiAs(adminToken, 'GET', PRIVATE_FEED);
    expect(
      res.status,
      'exhausting one endpoint’s budget must not take down another endpoint of the same stack',
    ).toBe(200);
  });
});
